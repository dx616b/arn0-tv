/*
 * Ambient playback while the launcher is foreground (including screensaver):
 * curated online Radio (no server) and/or Subsonic/Navidrome.
 * Pauses on document.hidden when another app takes over. Starts only after a user gesture.
 */
(function () {
    'use strict';

    var BATCH = 20;
    var REFILL_AT = 3;
    var VOLUMES = [
        { key: 'low', label: 'Low', value: 0.18 },
        { key: 'med', label: 'Med', value: 0.35 },
        { key: 'high', label: 'High', value: 0.55 }
    ];

    // Curated streams (Radio Record). SomaFM channels come from the SomaFM feed. `urls` = fixed HTTPS list.
    var SOMA_HOSTS = [
        'https://ice2.somafm.com/',
        'https://ice1.somafm.com/',
        'https://ice4.somafm.com/',
        'https://ice6.somafm.com/'
    ];
    var STATIONS = [
        // House / dance first (distinct channels — no near-duplicate chill pairs).
        { id: 'rrdeep', title: 'Deep', genre: 'Deep house', credit: 'Radio Record',
            urls: [
                'https://radiorecord.hostingradio.ru/deep96.aacp',
                'https://radiorecord.hostingradio.ru/deep64.aacp'
            ] },
        { id: 'rrhouse', title: 'House Hits', genre: 'House', credit: 'Radio Record',
            urls: [
                'https://radiorecord.hostingradio.ru/house96.aacp',
                'https://radiorecord.hostingradio.ru/house64.aacp'
            ] },
        { id: 'rrtechno', title: 'Techno', genre: 'Techno', credit: 'Radio Record',
            urls: [
                'https://radiorecord.hostingradio.ru/techno96.aacp',
                'https://radiorecord.hostingradio.ru/techno64.aacp'
            ] },
        { id: 'rrhiphop', title: 'Hip-Hop', genre: 'Hip-hop', credit: 'Radio Record',
            urls: [
                'https://radiorecord.hostingradio.ru/rap96.aacp',
                'https://radiorecord.hostingradio.ru/rap64.aacp'
            ] },
        { id: 'rrtrap', title: 'Trap', genre: 'Hip-hop', credit: 'Radio Record',
            urls: [
                'https://radiorecord.hostingradio.ru/trap96.aacp',
                'https://radiorecord.hostingradio.ru/trap64.aacp'
            ] },
        { id: 'rrdnb', title: 'Drum & Bass', genre: 'DnB', credit: 'Radio Record',
            urls: [
                'https://radiorecord.hostingradio.ru/drumhits96.aacp',
                'https://radiorecord.hostingradio.ru/drumhits64.aacp'
            ] }
    ];

    var audio = null;
    var queue = [];
    var current = null;
    var fetching = false;
    var lastError = '';
    var stationFailed = '';    // shown until audio plays or another station is chosen
    var autoSkipLeft = 0;      // Next may move past failing stations this many more times
    var connectTimer = null;   // gives up on a stream that never starts playing
    var CONNECT_MS = 5000;
    var toastSkip = false;
    var radioMirror = 0;       // index into urlsFor(current station)
    var radioPlayGen = 0;      // ignore stale Audio error after a src change
    var navSeq = 0;            // latest Next request; a slow SomaFM resolve for an older one is dropped
    var radioUrlNow = '';      // the stream URL currently set on the element
    var listeners = [];
    // Cached playlist entries for source === 'playlist' (shuffled, cursor walks through).
    var playlistCache = { id: null, songs: [], cursor: 0 };
    // Silent stall recovery (ice streams often die without firing `error`).
    var WATCH_MS = 5000;
    var STALL_MS = 14000;
    var watchTimer = null;
    var lastProgressAt = 0;
    var lastProgressTime = -1;
    var softRestartUsed = false;
    var healing = false;

    function prefs() {
        return Prefs.get().music;
    }

    function isRadio() {
        return prefs().source === 'radio';
    }

    // Home bar / screensaver: Radio needs no server; Random/Playlist need Subsonic.
    function ready() {
        return isRadio() || !!(window.Subsonic && Subsonic.configured());
    }

    // Your list: streams the user added. Each one is a station with id 'custom:<id>'.
    function customList() {
        var list = prefs().customList;
        return Array.isArray(list) ? list : [];
    }

    function customStations() {
        return customList().map(function (c) {
            return { id: 'custom:' + c.id, title: c.title, genre: 'Your list', url: c.url, custom: true, credit: 'Your list' };
        });
    }

    function customStation(id) {
        return customStations().find(function (s) { return s.id === id; }) || null;
    }

    // The station name comes from the address, e.g. https://ice2.somafm.com/x -> ice2.somafm.com
    function titleFromUrl(url) {
        var m = String(url).match(/^https?:\/\/([^/?#]+)/i);
        return m ? m[1] : url;
    }

    function addCustomUrl(url) {
        var u = String(url || '').trim();
        if (!/^https:\/\/\S+$/i.test(u)) return null;
        var p = prefs();
        var id = String(Date.now());
        while (customList().some(function (c) { return c.id === id; })) id = String(Number(id) + 1);
        var entry = { id: id, title: titleFromUrl(u), url: u };
        p.customList = customList().concat([entry]);
        Prefs.save();
        notify();
        return entry;
    }

    function removeCustomUrl(id) {
        var p = prefs();
        var key = 'custom:' + id;
        p.customList = customList().filter(function (c) { return c.id !== id; });
        if (p.radioId === key) p.radioId = radioStations()[0].id;
        Prefs.save();
        notify();
    }

    // Before Your list existed, one custom URL was kept in radioCustomUrl. Move it into the list once.
    function migrateCustomUrl() {
        var p = prefs();
        var legacy = String(p.radioCustomUrl || '').trim();
        if (!legacy) return;
        var entry = addCustomUrl(legacy);
        p.radioCustomUrl = '';
        if (entry && p.radioId === 'custom') p.radioId = 'custom:' + entry.id;
        Prefs.save();
    }

    // A SomaFM channel chosen from the catalogue: its stream mirrors are stored with the choice.
    function somaStation(id) {
        var sel = prefs().somaSelected;
        if (!sel || !sel.urls || !sel.urls.length || 'somafm:' + sel.id !== id) return null;
        return { id: id, title: sel.title, genre: sel.genre || '', credit: 'SomaFM', urls: sel.urls.slice() };
    }

    // Radio Record stations: from its feed once fetched; the built-in list only while no feed is cached.
    function radioStations() {
        var feed = window.RadioRecord ? RadioRecord.current() : [];
        return feed.length ? feed : STATIONS;
    }

    function findStation(id) {
        if (String(id || '').indexOf('custom:') === 0) {
            var cs = customStation(id);
            if (cs) return cs;
        }
        if (String(id || '').indexOf('somafm:') === 0) {
            var soma = somaStation(id);
            if (soma) return soma;
        }
        var hit = radioStations().find(function (s) { return s.id === id; });
        return hit || radioStations()[0];
    }

    // Curated list, plus Custom when a URL is saved (for Next wrap).
    // Ordered candidate URLs for a station (good host first, then mirrors / aac).
    function urlsFor(st) {
        if (!st) return [];
        if (st.custom) {
            return st.url ? [st.url] : [];
        }
        if (st.urls && st.urls.length) return st.urls.slice();
        var paths = [st.path].concat(st.alt || []).filter(Boolean);
        var good = String(prefs().radioGoodHost || '');
        var hosts = SOMA_HOSTS.slice();
        if (good) {
            hosts = [good].concat(hosts.filter(function (h) { return h !== good; }));
        }
        var out = [];
        paths.forEach(function (path) {
            hosts.forEach(function (host) {
                out.push(host + path);
            });
        });
        return out;
    }

    function rememberGoodUrl(url) {
        if (!url) return;
        var i;
        for (i = 0; i < SOMA_HOSTS.length; i++) {
            if (url.indexOf(SOMA_HOSTS[i]) === 0) {
                if (prefs().radioGoodHost !== SOMA_HOSTS[i]) {
                    prefs().radioGoodHost = SOMA_HOSTS[i];
                    Prefs.save();
                }
                return;
            }
        }
    }

    function shuffleInPlace(list) {
        for (var i = list.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = list[i];
            list[i] = list[j];
            list[j] = t;
        }
        return list;
    }

    function clearQueue() {
        queue = [];
        playlistCache = { id: null, songs: [], cursor: 0 };
    }

    function sourceLabel() {
        var p = prefs();
        if (p.source === 'radio') {
            var st = findStation(p.radioId);
            return st ? st.title : 'Radio';
        }
        if (p.source === 'playlist' && p.playlistName) return p.playlistName;
        if (p.source === 'playlist' && p.playlistId) return 'Playlist';
        return 'Random';
    }

    function notify() {
        listeners.forEach(function (fn) {
            try { fn(); } catch (e) { /* ignore */ }
        });
    }

    function statusText() {
        if (!ready()) {
            return 'Pick Radio, or set a Subsonic server';
        }
        if (stationFailed) return stationFailed;
        if (lastError) return lastError;
        if (current) {
            return current.title + (current.artist ? ' · ' + current.artist : '');
        }
        if (prefs().playing) return 'Loading…';
        return prefs().enabled ? 'Ready' : 'Off';
    }

    function wantPlaying() {
        var p = prefs();
        return !!(p.enabled && p.playing && !document.hidden);
    }

    function markProgress() {
        if (!audio) return;
        var t = audio.currentTime;
        if (t !== lastProgressTime) {
            lastProgressTime = t;
            stationFailed = '';
            lastProgressAt = Date.now();
            softRestartUsed = false;
        } else if (!lastProgressAt) {
            lastProgressAt = Date.now();
        }
    }

    function startWatch() {
        if (watchTimer) return;
        watchTimer = setInterval(watchTick, WATCH_MS);
    }

    function stopWatch() {
        if (watchTimer) {
            clearInterval(watchTimer);
            watchTimer = null;
        }
    }

    function resetProgressClock() {
        lastProgressTime = audio ? audio.currentTime : -1;
        lastProgressAt = Date.now();
        softRestartUsed = false;
    }

    // Soft-restart same URL once, then mirrors / next station via onAudioError.
    function healRadio(reason) {
        if (healing || !wantPlaying() || !isRadio()) return;
        healing = true;
        var st = findStation(prefs().radioId);
        var urls = urlsFor(st);
        var gen = radioPlayGen;
        DevLog.log('Music: radio heal (' + reason + ')' +
            (softRestartUsed ? ' → mirror/next' : ' → soft restart'));
        if (!softRestartUsed && urls.length) {
            softRestartUsed = true;
            lastProgressAt = Date.now();
            var url = urls[Math.min(radioMirror, urls.length - 1)];
            playRadioUrl(st, url, false, gen);
            healing = false;
            return;
        }
        healing = false;
        lastProgressAt = Date.now();
        softRestartUsed = false;
        onAudioError(radioUrlNow);
    }

    function watchTick() {
        if (!wantPlaying()) return;
        if (!isRadio()) {
            // Subsonic: unexpected pause while prefs say playing.
            if (audio && audio.paused && current && audio.src) {
                audio.play().catch(function () { /* next via user / error */ });
            }
            return;
        }
        if (!audio || !audio.src || !current) {
            healRadio('empty');
            return;
        }
        if (audio.paused) {
            DevLog.log('Music: watchdog resume (paused while playing)');
            audio.play().catch(function () { healRadio('play-fail'); });
            return;
        }
        markProgress();
        if (!lastProgressAt) {
            lastProgressAt = Date.now();
            return;
        }
        if (Date.now() - lastProgressAt < STALL_MS) return;
        healRadio('stall');
    }

    // After a long black / idle stretch: force a progress check now.
    function kick() {
        if (!wantPlaying()) return;
        startWatch();
        watchTick();
    }

    function onAudioError(failedUrl) {
        var gen = radioPlayGen;
        lastError = 'Stream failed';
        DevLog.log('Music: stream error');
        if (!isRadio()) {
            if (!toastSkip) {
                toastSkip = true;
                UI.toast('Music stream failed — skipping');
            }
            next(true);
            return;
        }
        // Stale error from a previous src — ignore.
        if (gen !== radioPlayGen) return;
        // A failure for a URL we already moved past (an old play() or error event) — ignore.
        if (failedUrl !== radioUrlNow) {
            DevLog.log('Music: ignored stale stream failure');
            return;
        }
        // This URL has failed now. Its other error events (play() rejection, error) must not count again.
        radioUrlNow = '';
        var st = findStation(prefs().radioId);
        var urls = urlsFor(st);
        radioMirror++;
        var title = st.title || 'this station';
        var action = RadioPlan.afterFailure({ mirrorIndex: radioMirror, mirrorCount: urls.length, skipLeft: autoSkipLeft });
        if (action === 'mirror') {
            DevLog.log('Music: radio try mirror ' + radioMirror + '/' + urls.length + ' for ' + st.id);
            resetProgressClock();
            playRadioUrl(st, urls[radioMirror], false, gen);
            return;
        }
        // All mirrors for this station failed.
        radioMirror = 0;
        if (action === 'skip') {
            autoSkipLeft--;
            stationFailed = 'Not possible to play ' + title;
            UI.toast(stationFailed + ' — trying next');
            nextRadio(true);
            return;
        }
        stopRadio('Not possible to play ' + title);
    }

    function clearConnect() {
        if (connectTimer) {
            clearTimeout(connectTimer);
            connectTimer = null;
        }
    }

    function stopRadio(message) {
        stopWatch();
        clearConnect();
        autoSkipLeft = 0;
        dropCurrentAudio();
        var p = prefs();
        p.playing = false;
        Prefs.save();
        stationFailed = message;
        UI.toast(message);
        notify();
    }

    function ensureAudio() {
        if (audio) return audio;
        audio = new Audio();
        // Download ahead of the playhead while playing (engine-managed progressive buffer).
        audio.preload = 'auto';
        audio.addEventListener('ended', function () {
            if (isRadio()) stopRadio('Stream ended');
            else next(true);
        });
        audio.addEventListener('error', function () { onAudioError(audio.src); });
        audio.addEventListener('timeupdate', markProgress);
        audio.addEventListener('playing', function () {
            if (!audio || !audio.src) return;
            resetProgressClock();
            if (!isRadio()) return;
            clearConnect();
            autoSkipLeft = 0;
            lastError = '';
            rememberGoodUrl(audio.src);
            startWatch();
        });
        audio.addEventListener('stalled', function () {
            if (wantPlaying() && isRadio()) DevLog.log('Music: stream stalled');
        });
        audio.addEventListener('waiting', function () {
            // Buffer underrun — do not reset the stall clock; watchdog will heal if stuck.
            if (wantPlaying() && isRadio()) DevLog.log('Music: stream waiting');
        });
        applyVolume();
        return audio;
    }

    function applyVolume() {
        if (!audio) return;
        var p = prefs();
        var v = VOLUMES.find(function (o) { return o.key === p.volume; });
        audio.volume = v ? v.value : 0.35;
    }

    function ensurePlaylistCache() {
        var p = prefs();
        var id = p.playlistId ? String(p.playlistId) : '';
        if (!id) return Promise.reject(new Error('No playlist selected'));
        if (playlistCache.id === id && playlistCache.songs.length) {
            return Promise.resolve(playlistCache);
        }
        return Subsonic.getPlaylist(id).then(function (pl) {
            if (!pl.songs.length) throw new Error('Playlist is empty');
            playlistCache = {
                id: id,
                songs: shuffleInPlace(pl.songs.slice()),
                cursor: 0
            };
            if (pl.name && p.playlistName !== pl.name) {
                p.playlistName = pl.name;
                Prefs.save();
            }
            return playlistCache;
        });
    }

    function takeFromPlaylist(n) {
        return ensurePlaylistCache().then(function (cache) {
            var out = [];
            var i;
            for (i = 0; i < n; i++) {
                if (cache.cursor >= cache.songs.length) {
                    shuffleInPlace(cache.songs);
                    cache.cursor = 0;
                }
                out.push(cache.songs[cache.cursor++]);
            }
            return out;
        });
    }

    function refill() {
        if (fetching || isRadio() || !Subsonic.configured()) return Promise.resolve();
        fetching = true;
        var p = prefs();
        var fetch = (p.source === 'playlist' && p.playlistId)
            ? takeFromPlaylist(BATCH)
            : Subsonic.getRandomSongs(BATCH);
        return fetch.then(function (songs) {
            fetching = false;
            lastError = '';
            songs.forEach(function (s) { queue.push(s); });
            DevLog.log('Music: queued ' + songs.length + ' from ' + sourceLabel() +
                ' (' + queue.length + ' total)');
        }).catch(function (e) {
            fetching = false;
            lastError = (e && e.message) || 'Fetch failed';
            DevLog.log('Music: ' + lastError);
            UI.toast('Music: ' + lastError);
        });
    }

    function dropCurrentAudio() {
        radioPlayGen++;
        current = null;
        if (audio) {
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
        }
    }

    function setSource(source, playlist) {
        var p = prefs();
        if (source === 'radio') {
            p.source = 'radio';
            if (String(p.radioId || '').indexOf('custom:') === 0 && customStation(p.radioId)) {
                // A saved stream of Your list stays selected.
            } else if (String(p.radioId || '').indexOf('somafm:') === 0 && somaStation(p.radioId)) {
                // A chosen SomaFM channel stays selected.
            } else if (!p.radioId || !radioStations().some(function (s) { return s.id === p.radioId; })) {
                p.radioId = radioStations()[0].id;
            }
        } else if (source === 'playlist' && playlist && playlist.id != null) {
            p.source = 'playlist';
            p.playlistId = String(playlist.id);
            p.playlistName = playlist.name || 'Playlist';
        } else {
            p.source = 'random';
            p.playlistId = null;
            p.playlistName = null;
        }
        Prefs.save();
        clearQueue();
        lastError = '';
        radioMirror = 0;
        dropCurrentAudio();
        if (p.playing && p.enabled) {
            if (p.source === 'radio') playStation(findStation(p.radioId), false);
            else next(true);
        }
        notify();
    }

    // play: start this station now (the station menu's Play). Otherwise it is only selected.
    function setRadio(id, play) {
        stationFailed = '';
        autoSkipLeft = 0;
        var st = findStation(id);
        var p = prefs();
        p.source = 'radio';
        p.radioId = st.id;
        if (play) {
            p.enabled = true;
            p.playing = true;
        }
        Prefs.save();
        clearQueue();
        lastError = '';
        radioMirror = 0;
        dropCurrentAudio();
        if (play) startWatch();
        if (p.playing && p.enabled) playStation(st, false);
        notify();
        return st;
    }

    // Pick a SomaFM channel from the catalogue. urls are its stream mirrors (from its .pls playlist).
    function setSomaChannel(channel, urls, play) {
        storeSoma(channel, urls);
        return setRadio(prefs().radioId, play);
    }

    function setRadioNav(mode) {
        prefs().radioNav = mode === 'favourites' || mode === 'list' ? mode : 'all';
        Prefs.save();
        notify();
    }

    function playRadioUrl(st, url, announce, gen) {
        if (!st || !url) return;
        if (gen != null && gen !== radioPlayGen) return;
        lastError = '';
        current = {
            id: st.id,
            title: st.title,
            artist: st.custom
                ? 'Custom stream'
                : (st.genre + ' · ' + (st.credit || 'SomaFM')),
            album: st.genre || '',
            radio: true
        };
        var a = ensureAudio();
        a.preload = 'auto';
        // Drop previous src so a soft-restart of the same URL actually reconnects.
        try {
            a.pause();
            a.removeAttribute('src');
            a.load();
        } catch (e) { /* ignore */ }
        radioUrlNow = url;
        a.src = url;
        applyVolume();
        resetProgressClock();
        startWatch();
        clearConnect();
        connectTimer = setTimeout(function () {
            connectTimer = null;
            if (gen != null && gen !== radioPlayGen) return;
            if (!isRadio() || !wantPlaying()) return;
            DevLog.log('Music: no audio after ' + (CONNECT_MS / 1000) + 's');
            onAudioError(url);
        }, CONNECT_MS);
        var playPromise = a.play();
        if (playPromise && playPromise.catch) {
            playPromise.catch(function (e) {
                if (gen != null && gen !== radioPlayGen) return;
                // AbortError is our own pause() or src change, not a stream failure.
                if (e && e.name === 'AbortError') return;
                var msg = (e && e.message) ? e.message : String(e || '');
                DevLog.log('Music: play() failed: ' + msg);
                // Gesture / autoplay block — do not burn through mirrors.
                if (e && (e.name === 'NotAllowedError' || /not allowed|user gesture|interact/i.test(msg))) {
                    lastError = 'Play blocked';
                    prefs().playing = false;
                    Prefs.save();
                    stopWatch();
                    notify();
                    return;
                }
                // Network / decode — try next mirror or station.
                onAudioError(url);
            });
        }
        if (announce && !barVisible()) {
            UI.toast(st.title + (st.genre ? ' · ' + st.genre : ''));
        }
        notify();
    }

    function playStation(st, announce) {
        if (!st) return;
        var urls = urlsFor(st);
        if (!urls.length) {
            lastError = st.custom ? 'Set a stream URL' : 'No stream URL';
            UI.toast(lastError);
            prefs().playing = false;
            Prefs.save();
            stopWatch();
            notify();
            return;
        }
        radioPlayGen++;
        radioMirror = 0;
        playRadioUrl(st, urls[0], announce, radioPlayGen);
    }

    // What Next steps through: 'all' = curated stations, custom URL, then every SomaFM channel
    // grouped by genre; 'favourites' = only the saved favourites, in the order they were added.
    function navItems() {
        var p = prefs();
        return RadioPlan.navList({
            mode: p.radioNav,
            stations: radioStations(),
            customs: customStations(),
            somaGroups: window.SomaFM ? SomaFM.groupByGenre(SomaFM.current()) : [],
            favourites: Array.isArray(p.favourites) ? p.favourites : []
        });
    }

    // Save a SomaFM choice (channel plus resolved mirrors) without starting playback.
    function storeSoma(channel, urls) {
        var p = prefs();
        p.somaSelected = { id: channel.id, title: channel.title, genre: (channel.genres || [])[0] || '', urls: (urls || []).slice() };
        p.radioId = 'somafm:' + channel.id;
        p.source = 'radio';
        Prefs.save();
    }

    function nextRadio(auto, user, skips) {
        if (!auto) stationFailed = '';
        if (user) autoSkipLeft = RadioPlan.skipBudget(navItems().length, true);
        var p = prefs();
        if (!p.enabled) {
            p.enabled = true;
        }
        p.playing = true;
        Prefs.save();

        var list = navItems();
        if (!list.length) {
            lastError = p.radioNav === 'favourites' ? 'No favourites yet' : 'No stations';
            p.playing = false;
            Prefs.save();
            notify();
            return;
        }
        // Play keeps the selected station. Only Next (or skipping a channel with no streams) moves on.
        var item = list[(auto || user) ? RadioPlan.nextIndex(list, p.radioId) : RadioPlan.indexOf(list, p.radioId)];
        var token = ++navSeq;
        if (item.station) {
            p.radioId = item.station.id;
            Prefs.save();
            radioMirror = 0;
            resetProgressClock();
            playStation(item.station, !auto);
            return;
        }
        // SomaFM channel: its stream mirrors come from the .pls playlist, so resolve them first.
        var tries = skips || 0;
        if (!window.SomaFM) return;
        SomaFM.resolve(item.soma).then(function (urls) {
            if (token !== navSeq) return;
            if (!urls.length) {
                DevLog.log('Music: no streams for ' + item.soma.title + '; skipping');
                if (tries >= list.length) {
                    lastError = 'No streams available';
                    notify();
                    return;
                }
                p.radioId = item.key;
                Prefs.save();
                nextRadio(auto, user, tries + 1);
                return;
            }
            storeSoma(item.soma, urls);
            radioMirror = 0;
            resetProgressClock();
            playStation(findStation(item.key), !auto);
        });
    }

    function playSong(song, announce) {
        current = song;
        var a = ensureAudio();
        a.preload = 'auto';
        a.src = Subsonic.streamUrl(song.id);
        applyVolume();
        // Start immediately; the engine keeps buffering ahead while it plays.
        var playPromise = a.play();
        if (playPromise && playPromise.catch) {
            playPromise.catch(function (e) {
                lastError = 'Play blocked';
                DevLog.log('Music: play() failed: ' + (e && e.message ? e.message : e));
                prefs().playing = false;
                Prefs.save();
                notify();
            });
        }
        // Title lives on the Home dock; toast only when that bar is not on screen.
        if (announce && !barVisible()) {
            UI.toast(song.title + (song.artist ? ' · ' + song.artist : ''));
        }
        notify();
        if (queue.length < REFILL_AT) refill();
    }

    function next(auto, user) {
        if (!ready()) return;
        if (isRadio()) {
            nextRadio(auto, user);
            return;
        }
        if (!Subsonic.configured()) return;
        var p = prefs();
        if (!p.enabled) {
            p.enabled = true;
            Prefs.save();
        }
        p.playing = true;
        Prefs.save();
        if (!queue.length) {
            // User hit Play/Next with an empty queue — wait visibly for the first fetch.
            var wait = auto ? refill() : UI.busy(refill());
            wait.then(function () {
                if (queue.length) next(auto);
                else notify();
            });
            return;
        }
        playSong(queue.shift(), !auto);
    }

    function play() {
        if (!ready()) {
            UI.toast('Pick Radio, or set a Subsonic server');
            return;
        }
        if (!isRadio() && !Subsonic.configured()) {
            UI.toast('Set server, user and password in Music settings');
            return;
        }
        var p = prefs();
        p.enabled = true;
        p.playing = true;
        Prefs.save();
        toastSkip = false;
        lastError = '';
        startWatch();
        if (current && audio && audio.src && audio.paused && !audio.ended) {
            applyVolume();
            resetProgressClock();
            audio.play().catch(function () { next(false); });
            notify();
            return;
        }
        next(false);
    }

    function pause() {
        var p = prefs();
        p.playing = false;
        Prefs.save();
        stopWatch();
        if (audio) audio.pause();
        notify();
    }

    function toggle() {
        if (isPlaying()) pause();
        else play();
    }

    function barVisible() {
        var bar = document.getElementById('music-bar');
        return !!(bar && !bar.classList.contains('hidden'));
    }

    /*
     * Long title/artist: scroll a few times, then freeze (ellipsis). Infinite animation was
     * a large idle-CPU cost on this SoC (~40%).
     */
    // Scrolls a long line once through, then holds it. A re-draw with the same text keeps the scroll
    // where it is; only a new text starts it again.
    function fillMarquee(el, text, animate) {
        if (!el) return;
        var key = (animate ? 'scroll|' : 'static|') + (text || '');
        if (el.getAttribute('data-marquee') === key) return;
        el.classList.remove('scroll');
        el.innerHTML = '';
        if (!text) {
            el.setAttribute('data-marquee', key);
            return;
        }
        if (!animate) {
            el.textContent = text;
            el.setAttribute('data-marquee', key);
            return;
        }
        var track = document.createElement('div');
        track.className = 'marquee-track';
        var span = document.createElement('span');
        span.textContent = text;
        track.appendChild(span);
        el.appendChild(track);
        // Two frames: first paint after un-hiding (screensaver) needs a real clientWidth.
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                if (!el.contains(track)) return;
                if (track.scrollWidth <= el.clientWidth + 1) {
                    el.textContent = text;
                    el.setAttribute('data-marquee', key);
                    return;
                }
                var copy = span.cloneNode(true);
                copy.setAttribute('aria-hidden', 'true');
                track.appendChild(copy);
                function freeze() {
                    track.removeEventListener('animationend', freeze);
                    if (!el.contains(track)) return;
                    el.classList.remove('scroll');
                    el.textContent = text;
                }
                track.addEventListener('animationend', freeze);
                el.classList.add('scroll');
                el.setAttribute('data-marquee', key);
            });
        });
    }

    // Focusing the bar scrolls the title and artist once more, so a long line can be read in full.
    function showFull() {
        if (!current) return;
        fillMarquee(document.getElementById('music-now-title'), current.title, true);
        fillMarquee(document.getElementById('music-now-artist'), current.artist || current.album || '', true);
    }

    function renderBar() {
        var bar = document.getElementById('music-bar');
        var sep = document.getElementById('home-music-sep');
        var clock = document.querySelector('#home .clock');
        if (!bar) return;
        var show = ready();
        var weatherOn = !!(clock && clock.classList.contains('with-weather'));
        bar.classList.toggle('hidden', !show);
        if (sep) sep.classList.toggle('hidden', !(show && weatherOn));
        if (clock) clock.classList.toggle('with-music', show);
        if (!show) return;

        var title = document.getElementById('music-now-title');
        var artist = document.getElementById('music-now-artist');
        var playIcon = bar.querySelector('.music-icon-play');
        var pauseIcon = bar.querySelector('.music-icon-pause');
        var playing = isPlaying();
        // Scroll on track change / when a song is shown; stops after 3 loops.
        if (stationFailed) {
            fillMarquee(title, stationFailed, false);
            fillMarquee(artist, '', false);
        } else if (current) {
            fillMarquee(title, current.title, true);
            fillMarquee(artist, current.artist || current.album || '', true);
        } else if (lastError) {
            fillMarquee(title, lastError, false);
            fillMarquee(artist, 'Music', false);
        } else {
            fillMarquee(title, 'Not playing', false);
            fillMarquee(artist, isRadio() ? 'Radio' : '', false);
        }
        if (playIcon) playIcon.classList.toggle('hidden', playing);
        if (pauseIcon) pauseIcon.classList.toggle('hidden', !playing);
    }

    function stop() {
        pause();
        current = null;
        if (audio) {
            audio.removeAttribute('src');
            audio.load();
        }
        notify();
    }

    function setEnabled(on) {
        var p = prefs();
        p.enabled = !!on;
        if (!on) {
            p.playing = false;
            stopWatch();
            if (audio) audio.pause();
        }
        Prefs.save();
        notify();
    }

    function setVolume(key) {
        prefs().volume = key;
        Prefs.save();
        applyVolume();
        notify();
    }

    function isPlaying() {
        return !!(audio && !audio.paused && !audio.ended && current);
    }

    function summary() {
        if (!ready()) return 'Radio or server';
        var p = prefs();
        var src = sourceLabel();
        if (!p.enabled) return 'Off · ' + src;
        if (isPlaying() && current) return current.title;
        return (p.playing ? 'Playing' : 'On · paused') + ' · ' + src;
    }

    function onVisibility() {
        if (document.hidden) {
            if (audio && !audio.paused) audio.pause();
            return;
        }
        // Back in the launcher: resume only if the user left music in a playing state.
        if (prefs().enabled && prefs().playing && current && audio && audio.src) {
            resetProgressClock();
            startWatch();
            audio.play().catch(function () { kick(); });
        }
    }

    function init() {
        document.addEventListener('visibilitychange', onVisibility);
        migrateCustomUrl();
        if (window.SomaFM) SomaFM.refresh();
        applyVolume();
        // Do not auto-start: needs a remote gesture (Play on the dock or in Settings).
        if (prefs().playing && prefs().enabled) {
            prefs().playing = false;
            Prefs.save();
        }
        var playBtn = document.getElementById('music-btn-play');
        var nextBtn = document.getElementById('music-btn-next');
        if (playBtn) playBtn._item = { kind: 'music', action: 'toggle' };
        if (nextBtn) nextBtn._item = { kind: 'music', action: 'next' };
        listeners.push(renderBar);
        renderBar();
    }

    window.Music = {
        VOLUMES: VOLUMES,
        STATIONS: STATIONS,
        radioStations: radioStations,
        init: init,
        ready: ready,
        play: play,
        pause: pause,
        toggle: toggle,
        stop: stop,
        next: function () { next(false, true); },
        setEnabled: setEnabled,
        setVolume: setVolume,
        setSource: setSource,
        setRadio: setRadio,
        setSomaChannel: setSomaChannel,
        setRadioNav: setRadioNav,
        customList: customList,
        customStations: customStations,
        addCustomUrl: addCustomUrl,
        removeCustomUrl: removeCustomUrl,
        sourceLabel: sourceLabel,
        clearQueue: clearQueue,
        isPlaying: isPlaying,
        current: function () { return current; },
        statusText: statusText,
        summary: summary,
        renderBar: renderBar,
        showFull: showFull,
        fillMarquee: fillMarquee,
        barVisible: barVisible,
        kick: kick,
        onUpdate: function (fn) { listeners.push(fn); }
    };
})();
