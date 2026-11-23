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

    // Curated streams. SomaFM paths try SOMA_HOSTS (+ aac). `urls` = fixed HTTPS list.
    var SOMA_HOSTS = [
        'https://ice2.somafm.com/',
        'https://ice1.somafm.com/',
        'https://ice4.somafm.com/',
        'https://ice6.somafm.com/'
    ];
    var STATIONS = [
        // House / dance first (distinct channels — no near-duplicate chill pairs).
        { id: 'beatblender', title: 'Beat Blender', genre: 'Deep house', credit: 'SomaFM',
            path: 'beatblender-128-mp3', alt: ['beatblender-128-aac'] },
        { id: 'thetrip', title: 'The Trip', genre: 'Prog house', credit: 'SomaFM',
            path: 'thetrip-128-mp3', alt: ['thetrip-128-aac'] },
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
        { id: 'poptron', title: 'PopTron', genre: 'Electropop', credit: 'SomaFM',
            path: 'poptron-128-mp3', alt: ['poptron-128-aac'] },
        { id: 'defcon', title: 'DEF CON Radio', genre: 'Electronic', credit: 'SomaFM',
            path: 'defcon-128-mp3', alt: ['defcon-128-aac'] },
        { id: 'dubstep', title: 'Dub Step Beyond', genre: 'Bass', credit: 'SomaFM',
            path: 'dubstep-128-mp3', alt: ['dubstep-128-aac'] },
        { id: 'fluid', title: 'Fluid', genre: 'Trip-hop', credit: 'SomaFM',
            path: 'fluid-128-mp3', alt: ['fluid-128-aac'] },
        { id: 'groovesalad', title: 'Groove Salad', genre: 'Downtempo', credit: 'SomaFM',
            path: 'groovesalad-128-mp3', alt: ['groovesalad-128-aac'] },
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
            ] },
        { id: 'indiepop', title: 'Indie Pop Rocks', genre: 'Indie pop', credit: 'SomaFM',
            path: 'indiepop-128-mp3', alt: ['indiepop-128-aac'] },
        { id: 'u80s', title: 'Underground 80s', genre: '80s', credit: 'SomaFM',
            path: 'u80s-128-mp3', alt: ['u80s-128-aac'] },
        { id: 'digitalis', title: 'Digitalis', genre: 'Synth', credit: 'SomaFM',
            path: 'digitalis-128-mp3', alt: ['digitalis-128-aac'] },
        { id: 'reggae', title: 'Heavyweight Reggae', genre: 'Reggae', credit: 'SomaFM',
            path: 'reggae-128-mp3', alt: ['reggae-128-aac'] },
        { id: 'illstreet', title: 'Illinois Street Lounge', genre: 'Lounge', credit: 'SomaFM',
            path: 'illstreet-128-mp3', alt: ['illstreet-128-aac'] },
        { id: 'goa', title: 'Suburbs of Goa', genre: 'World', credit: 'SomaFM',
            path: 'suburbsofgoa-128-mp3', alt: ['suburbsofgoa-128-aac'] },
        { id: 'sonicuniverse', title: 'Sonic Universe', genre: 'Jazz', credit: 'SomaFM',
            path: 'sonicuniverse-128-mp3', alt: ['sonicuniverse-128-aac'] },
        { id: 'seveninch', title: 'Seven Inch Soul', genre: 'Soul', credit: 'SomaFM',
            path: 'seveninch-128-mp3', alt: ['seveninch-128-aac'] },
        { id: 'dronezone', title: 'Drone Zone', genre: 'Ambient', credit: 'SomaFM',
            path: 'dronezone-128-mp3', alt: ['dronezone-128-aac'] }
    ];

    var audio = null;
    var queue = [];
    var current = null;
    var fetching = false;
    var lastError = '';
    var toastSkip = false;
    var radioFailStreak = 0;
    var radioMirror = 0;       // index into urlsFor(current station)
    var radioPlayGen = 0;      // ignore stale Audio error after a src change
    var listeners = [];
    // Cached playlist entries for source === 'playlist' (shuffled, cursor walks through).
    var playlistCache = { id: null, songs: [], cursor: 0 };
    // Silent stall recovery (ice streams often die without firing `error`).
    var WATCH_MS = 5000;
    var STALL_MS = 14000;
    var RETRY_ALL_MS = 45000;
    var watchTimer = null;
    var lastProgressAt = 0;
    var lastProgressTime = -1;
    var softRestartUsed = false;
    var healing = false;
    var retryAllTimer = null;

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

    function customUrl() {
        return String(prefs().radioCustomUrl || '').trim();
    }

    function customStation() {
        var url = customUrl();
        return {
            id: 'custom',
            title: 'Custom',
            genre: 'URL',
            url: url,
            custom: true
        };
    }

    function findStation(id) {
        if (id === 'custom') return customStation();
        var hit = STATIONS.find(function (s) { return s.id === id; });
        return hit || STATIONS[0];
    }

    // Curated list, plus Custom when a URL is saved (for Next wrap).
    function playableStations() {
        var list = STATIONS.slice();
        if (customUrl()) list.push(customStation());
        return list;
    }

    function stationIndex(id) {
        var list = playableStations();
        var i = list.findIndex(function (s) { return s.id === id; });
        return i < 0 ? 0 : i;
    }

    // Ordered candidate URLs for a station (good host first, then mirrors / aac).
    function urlsFor(st) {
        if (!st) return [];
        if (st.custom || st.id === 'custom') {
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
            if (p.radioId === 'custom') {
                var u = customUrl();
                if (!u) return 'Custom';
                return u.length > 28 ? ('Custom · ' + u.slice(0, 24) + '…') : ('Custom · ' + u);
            }
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
        if (retryAllTimer) {
            clearTimeout(retryAllTimer);
            retryAllTimer = null;
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
        onAudioError();
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

    function onAudioError() {
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
        var st = findStation(prefs().radioId);
        var urls = urlsFor(st);
        radioMirror++;
        if (radioMirror < urls.length) {
            DevLog.log('Music: radio try mirror ' + radioMirror + '/' + urls.length +
                ' for ' + st.id);
            resetProgressClock();
            playRadioUrl(st, urls[radioMirror], false, gen);
            return;
        }
        // All mirrors for this station failed — advance station.
        if (!toastSkip) {
            toastSkip = true;
            UI.toast('Station failed — trying next');
        }
        radioMirror = 0;
        next(true);
    }

    function ensureAudio() {
        if (audio) return audio;
        audio = new Audio();
        // Download ahead of the playhead while playing (engine-managed progressive buffer).
        audio.preload = 'auto';
        audio.addEventListener('ended', function () { next(true); });
        audio.addEventListener('error', onAudioError);
        audio.addEventListener('timeupdate', markProgress);
        audio.addEventListener('playing', function () {
            if (!audio || !audio.src) return;
            resetProgressClock();
            if (!isRadio()) return;
            radioFailStreak = 0;
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
            if (p.radioId === 'custom') {
                if (!customUrl()) p.radioId = STATIONS[0].id;
            } else if (!p.radioId || !STATIONS.some(function (s) { return s.id === p.radioId; })) {
                p.radioId = STATIONS[0].id;
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
        radioFailStreak = 0;
        radioMirror = 0;
        dropCurrentAudio();
        if (p.playing && p.enabled) {
            if (p.source === 'radio') playStation(findStation(p.radioId), false);
            else next(true);
        }
        notify();
    }

    function setRadio(id) {
        var st = findStation(id);
        var p = prefs();
        p.source = 'radio';
        p.radioId = st.id;
        Prefs.save();
        clearQueue();
        lastError = '';
        radioFailStreak = 0;
        radioMirror = 0;
        dropCurrentAudio();
        if (p.playing && p.enabled) playStation(st, false);
        notify();
        return st;
    }

    function setCustomUrl(url) {
        var p = prefs();
        p.radioCustomUrl = String(url || '').trim();
        p.source = 'radio';
        p.radioId = p.radioCustomUrl ? 'custom' : (STATIONS[0] && STATIONS[0].id);
        Prefs.save();
        clearQueue();
        lastError = '';
        radioFailStreak = 0;
        radioMirror = 0;
        dropCurrentAudio();
        var st = findStation(p.radioId);
        if (p.playing && p.enabled && p.radioCustomUrl) playStation(st, false);
        notify();
        return st;
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
        a.src = url;
        applyVolume();
        resetProgressClock();
        startWatch();
        var playPromise = a.play();
        if (playPromise && playPromise.catch) {
            playPromise.catch(function (e) {
                if (gen != null && gen !== radioPlayGen) return;
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
                onAudioError();
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
            lastError = st.id === 'custom' ? 'Set a stream URL' : 'No stream URL';
            UI.toast(lastError);
            prefs().playing = false;
            Prefs.save();
            stopWatch();
            notify();
            return;
        }
        radioPlayGen++;
        radioMirror = 0;
        // Keep radioFailStreak — cleared on successful `playing` or user Play.
        playRadioUrl(st, urls[0], announce, radioPlayGen);
    }

    function nextRadio(auto) {
        var p = prefs();
        if (!p.enabled) {
            p.enabled = true;
        }
        p.playing = true;
        Prefs.save();

        var list = playableStations();
        if (!list.length) {
            lastError = 'No stations';
            p.playing = false;
            Prefs.save();
            notify();
            return;
        }
        var i = stationIndex(p.radioId);
        // First Play: keep the selected station. Next / stream error: advance (wrap).
        var advance = auto || !!(current && current.radio);
        if (advance) {
            if (auto) {
                radioFailStreak++;
                if (radioFailStreak > list.length) {
                    // Keep intent to play — retry after a cooldown instead of giving up.
                    lastError = 'All stations failed — retrying…';
                    DevLog.log('Music: all stations failed; retry in ' + (RETRY_ALL_MS / 1000) + 's');
                    dropCurrentAudio();
                    notify();
                    if (retryAllTimer) clearTimeout(retryAllTimer);
                    retryAllTimer = setTimeout(function () {
                        retryAllTimer = null;
                        if (!wantPlaying() || !isRadio()) return;
                        radioFailStreak = 0;
                        radioMirror = 0;
                        toastSkip = false;
                        playStation(findStation(prefs().radioId), false);
                    }, RETRY_ALL_MS);
                    return;
                }
            }
            i = (i + 1) % list.length;
        }
        var st = list[i];
        p.radioId = st.id;
        Prefs.save();
        radioMirror = 0;
        resetProgressClock();
        playStation(st, !auto);
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

    function next(auto) {
        if (!ready()) return;
        if (isRadio()) {
            nextRadio(auto);
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
        radioFailStreak = 0;
        if (retryAllTimer) {
            clearTimeout(retryAllTimer);
            retryAllTimer = null;
        }
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
    function fillMarquee(el, text, animate) {
        if (!el) return;
        el.classList.remove('scroll');
        el.innerHTML = '';
        if (!text) return;
        if (!animate) {
            el.textContent = text;
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
        if (current) {
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
        init: init,
        ready: ready,
        play: play,
        pause: pause,
        toggle: toggle,
        stop: stop,
        next: function () { next(false); },
        setEnabled: setEnabled,
        setVolume: setVolume,
        setSource: setSource,
        setRadio: setRadio,
        setCustomUrl: setCustomUrl,
        customUrl: customUrl,
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
