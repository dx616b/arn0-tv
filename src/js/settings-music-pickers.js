/*
 * Settings → Music: radio station and playlist pickers, and the custom radio URL editor.
 * Lists use the Settings detail page (#music-pick) instead of the overlay menu.
 */
(function () {
    'use strict';

    var $ = UI.$;
    var el = UI.el;
    var KEY = UI.KEY;

    function renderMusic() { return SettingsMusic.render.apply(null, arguments); }

    function maskSecret(value) {
        if (!value) return 'Set password';
        return 'Password set';
    }

    function cap(text) {
        var t = String(text || '');
        return t.charAt(0).toUpperCase() + t.slice(1);
    }

    // ---------- Music pick page (Settings-style list)

    var pick = {
        title: 'Music',
        entries: [],
        mode: 'nav', // nav | play | playlist
        stack: []
    };
    var focusTimer = null;
    var registered = false;
    var HOLD_MS = 600;
    var holdTimer = null;
    var holdKey = 0;
    var holdFired = false;
    // Long-press already ran — stay set until keyup so release / focus churn cannot fire Next.
    var rightHoldDone = false;

    function clearHold() {
        clearTimeout(holdTimer);
        holdTimer = null;
        // Do not clear rightHoldDone / holdKey here: fav() repaints and would let keyup Next.
        if (!rightHoldDone) {
            holdKey = 0;
            holdFired = false;
        }
    }

    function clearFocusPlay() {
        clearTimeout(focusTimer);
        focusTimer = null;
        clearHold();
    }

    function rightNext() {
        if (pick.mode !== 'play' && pick.mode !== 'playlist') return;
        if (Prefs.get().music.source === 'playlist' || (Music.isRadio && Music.isRadio())) {
            Music.next();
            return;
        }
        if (pick.mode === 'playlist') UI.toast('Play a playlist first');
        else Music.next();
    }

    function startRightHold(item) {
        if (rightHoldDone) return;
        clearTimeout(holdTimer);
        holdTimer = null;
        holdKey = KEY.RIGHT;
        holdFired = false;
        holdTimer = setTimeout(function () {
            holdTimer = null;
            holdFired = true;
            rightHoldDone = true;
            var it = item || currentPickItem();
            if (it && it.fav) {
                if (window.Sound) Sound.play('select');
                it.fav();
            }
        }, HOLD_MS);
    }

    function paintPick() {
        var titleEl = $('music-pick-title');
        var list = $('music-pick-list');
        if (titleEl) titleEl.textContent = pick.title;
        if (!list) return;
        list.innerHTML = '';
        pick.entries.forEach(function (e) {
            var cls = 'setting-row';
            if (e.kind === 'action') cls += ' setting-row-action';
            var li = el('li', cls);
            li.appendChild(el('span', 'setting-label', e.label));
            if (e.value) li.appendChild(el('span', 'setting-value', e.value));
            if (e.chevron) li.appendChild(el('span', 'setting-chevron', '\u203A'));
            li._item = e;
            list.appendChild(li);
        });
    }

    function openMusicPick(title, entries, opts) {
        opts = opts || {};
        clearFocusPlay();
        if (opts.push && UI.current() === 'music-pick') {
            var f = document.querySelector('#music-pick .focused');
            var focusId = f && f._item && f._item.id != null ? String(f._item.id) : '';
            pick.stack.push({
                title: pick.title,
                entries: pick.entries,
                mode: pick.mode,
                focusId: focusId
            });
        } else if (!opts.replace) {
            pick.stack = [];
        }
        pick.title = title;
        pick.entries = entries || [];
        pick.mode = opts.mode || 'nav';
        if (UI.current() === 'music-pick') {
            paintPick();
            UI.refreshHints();
            UI.refresh();
            return;
        }
        UI.show('music-pick');
    }

    function popOrBack() {
        clearFocusPlay();
        if (pick.stack.length) {
            var prev = pick.stack.pop();
            pick.title = prev.title;
            pick.entries = prev.entries;
            pick.mode = prev.mode;
            paintPick();
            UI.refreshHints();
            if (prev.focusId) {
                var match = null;
                var nodes = $('music-pick-list').querySelectorAll('.setting-row');
                for (var i = 0; i < nodes.length; i++) {
                    if (nodes[i]._item && String(nodes[i]._item.id) === prev.focusId) {
                        match = nodes[i];
                        break;
                    }
                }
                if (match) UI.focusOn(match);
                else UI.refresh();
            } else {
                UI.refresh();
            }
            return true;
        }
        return false;
    }

    function currentPickItem() {
        var cur = document.querySelector('#music-pick .focused');
        return cur && cur._item ? cur._item : null;
    }

    function pickHints() {
        var item = currentPickItem();
        var back = window.SettingsCore && SettingsCore.backPair
            ? SettingsCore.backPair('Music')
            : ['Back', 'Music'];
        var isPlaylistRow = item && item.id && String(item.id).indexOf('pl:') === 0;
        if (pick.mode === 'playlist' || isPlaylistRow) {
            // ▶ next track; hold ▶ favourite. Exit keeps the last played playlist.
            var plKeys = [['OK', 'Play / pause'], ['▶', 'Next']];
            if (item && item.fav) plKeys.push(['Hold ▶', item.favLabel || 'Favourite']);
            if (item && item.remove) plKeys.push(['◀', item.removeLabel || 'Remove']);
            else plKeys.push(['◀', 'Music']);
            plKeys.push(back);
            return plKeys;
        }
        if (pick.mode === 'play') {
            var keys = [['OK', 'Play / pause'], ['▶', 'Next']];
            if (item && item.fav) keys.push(['Hold ▶', item.favLabel || 'Favourite']);
            if (item && item.remove) keys.push(['◀', item.removeLabel || 'Remove']);
            else keys.push(['◀', pick.stack.length ? 'Back' : 'Music']);
            keys.push(back);
            return keys;
        }
        return [['OK / ▶', 'Open'], ['◀', pick.stack.length ? 'Back' : 'Music'], back];
    }

    function register() {
        if (registered) return;
        registered = true;
        UI.register('music-pick', {
            el: $('music-pick'),
            wrap: true,
            onShow: function () {
                paintPick();
            },
            rows: function () {
                return UI.children($('music-pick-list')).filter(function (li) {
                    return !!li._item;
                }).map(function (li) { return [li]; });
            },
            activate: function (item) {
                if (!item) return;
                if (item.run) item.run();
            },
            onFocus: function () {
                UI.refreshHints();
                clearFocusPlay();
            },
            onBack: function () {
                if (popOrBack()) return true;
                // Leave the picker: last played playlist is already the Music source.
                renderMusic();
                return false;
            },
            onKey: function (k) {
                var item = currentPickItem();
                if (k === KEY.RIGHT) {
                    // Play / playlist lists: short ▶ = next, hold ▶ = favourite.
                    if (pick.mode === 'play' || pick.mode === 'playlist' ||
                            (item && item.id && String(item.id).indexOf('pl:') === 0)) {
                        // Ignore key-repeat while holding (including after long-press fired).
                        if (rightHoldDone || holdTimer || holdFired) return true;
                        startRightHold(item);
                        return true;
                    }
                    // Genre / nav lists: ▶ opens.
                    if (item && item.run) {
                        if (window.Sound) Sound.play('select');
                        item.run();
                    }
                    return true;
                }
                if (k === KEY.LEFT) {
                    clearHold();
                    if (item && item.remove) {
                        item.remove();
                        return true;
                    }
                    if (popOrBack()) return true;
                    renderMusic();
                    UI.back();
                    return true;
                }
                return false;
            },
            hints: pickHints
        });
        document.addEventListener('keyup', function (e) {
            if (!(UI.isVisible && UI.isVisible('music-pick'))) return;
            if (e.keyCode !== KEY.RIGHT) return;
            if (holdKey !== KEY.RIGHT && !holdTimer && !rightHoldDone) return;
            var skipNext = holdFired || rightHoldDone;
            clearTimeout(holdTimer);
            holdTimer = null;
            holdKey = 0;
            holdFired = false;
            rightHoldDone = false;
            if (!skipNext) rightNext();
        });
        if (window.Music) {
            Music.onUpdate(function () {
                if (!(UI.isVisible && UI.isVisible('music-pick'))) return;
                if (pick.mode !== 'play' && pick.mode !== 'playlist') return;
                SettingsCore.withFocusRestore($('music-pick-list'), function () {
                    pick.entries.forEach(function (e) {
                        if (e.repaint) e.repaint();
                    });
                    paintPick();
                });
            });
        }
    }

    // ---------- Favourites / stations

    function favs() {
        var list = Prefs.get().music.favourites;
        if (!Array.isArray(list)) return [];
        var customIds = Music.customStations().map(function (st) { return st.id; });
        return list.filter(function (x) {
            if (x.type === 'station') return Music.radioStations().some(function (st) { return st.id === x.id; });
            if (x.type === 'custom') return customIds.indexOf(x.id) >= 0;
            if (x.type === 'playlist') return !!(x && x.id);
            return true;
        });
    }

    function isFav(type, id) {
        var want = String(id);
        return favs().some(function (x) { return x.type === type && String(x.id) === want; });
    }

    function toggleFav(entry) {
        var p = Prefs.get().music;
        var list = Array.isArray(p.favourites) ? p.favourites : [];
        var want = String(entry.id);
        var i = list.findIndex(function (x) { return x.type === entry.type && String(x.id) === want; });
        if (i >= 0) list.splice(i, 1);
        else {
            entry = Object.assign({}, entry, { id: want });
            list.push(entry);
        }
        p.favourites = list;
        Prefs.save();
    }

    function stationEntry(st) {
        if (st.custom) return { type: 'custom', id: st.id, title: st.title, genre: 'Your list' };
        return { type: 'station', id: st.id, title: st.title, genre: st.genre || '' };
    }

    function somaEntry(c) {
        return { type: 'soma', id: c.id, title: c.title, genre: (c.genres || [])[0] || '', pls: c.pls };
    }

    function playEntry(f) {
        if (f.type === 'station' || f.type === 'custom') {
            Music.setRadio(f.id, true);
            renderMusic();
            UI.refresh();
            return;
        }
        UI.busy(SomaFM.resolve({ pls: f.pls })).then(function (urls) {
            if (!urls.length) {
                UI.toast('Not possible to play ' + f.title);
                return;
            }
            Music.setSomaChannel({ id: f.id, title: f.title, genres: [f.genre] }, urls, true);
            renderMusic();
            UI.refresh();
        });
    }

    function toggleRow(entry) {
        var key = entry.type === 'soma' ? 'somafm:' + entry.id : entry.id;
        if (Music.isPlaying() && Prefs.get().music.radioId === key) {
            clearFocusPlay();
            Music.pause();
            return;
        }
        playEntry(entry);
    }

    // Station / channel row for the music-pick play mode.
    // opts.remove: Left removes (Your list / Favourites); otherwise Left backs out.
    function playPickRow(entry, label, opts) {
        opts = opts || {};
        // Custom ids are already custom:…; others get type:id.
        var rowId = entry.type === 'custom' ? entry.id : (entry.type + ':' + entry.id);
        var row = {
            id: rowId,
            label: label,
            run: function () { toggleRow(entry); }
        };
        function paint() {
            var saved = isFav(entry.type, entry.id);
            row.value = saved ? '★' : '☆';
            row.favLabel = saved ? 'Unfavourite' : 'Favourite';
        }
        paint();
        row.repaint = paint;
        row.fav = function () {
            toggleFav(entry);
            paint();
            UI.toast(isFav(entry.type, entry.id) ? 'Added to favourites' : 'Removed from favourites');
            SettingsCore.withFocusRestore($('music-pick-list'), function () {
                paintPick();
            });
        };
        if (opts.remove) {
            row.removeLabel = opts.removeLabel || 'Remove';
            row.remove = function () {
                opts.remove();
            };
        }
        return row;
    }

    // ---------- Genre sources

    var SOMAFM = {
        name: 'SomaFM',
        refresh: function () { return window.SomaFM ? SomaFM.refresh() : Promise.resolve([]); },
        groups: function () { return window.SomaFM ? SomaFM.groupByGenre(SomaFM.current()) : []; },
        entry: function (c) { return somaEntry(c); },
        title: function (c) { return c.title; },
        current: function (c, p) { return p.radioId === 'somafm:' + c.id; }
    };

    var RADIO_RECORD = {
        name: 'Radio Record',
        refresh: function () { return window.RadioRecord ? RadioRecord.refresh() : Promise.resolve([]); },
        groups: function () { return window.RadioRecord && window.Music ? RadioRecord.groupByGenre(Music.radioStations()) : []; },
        entry: function (st) { return stationEntry(st); },
        title: function (st) { return st.title; },
        current: function (st, p) { return p.radioId === st.id; }
    };

    function pickChannels(source, group) {
        var p = Prefs.get().music;
        var entries = group.channels.map(function (c) {
            return playPickRow(source.entry(c), source.title(c), {});
        });
        openMusicPick(source.name + ' · ' + cap(group.genre), entries, {
            mode: 'play',
            push: true
        });
        // Focus the playing / current station when possible.
        var want = null;
        group.channels.forEach(function (c) {
            if (!source.current(c, p)) return;
            var ent = source.entry(c);
            want = ent.type === 'custom' ? ent.id : (ent.type + ':' + ent.id);
        });
        focusPickId(want);
    }

    function focusPickId(want) {
        if (!want) return;
        var nodes = $('music-pick-list').querySelectorAll('.setting-row');
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i]._item && nodes[i]._item.id === want) {
                UI.focusOn(nodes[i]);
                return;
            }
        }
    }

    function pickGenres(source) {
        UI.busy(source.refresh()).then(function () {
            var groups = source.groups();
            if (!groups.length) {
                UI.toast(source.name + ' unavailable — check the connection');
                return;
            }
            var entries = groups.map(function (g) {
                return {
                    id: 'genre:' + g.genre,
                    label: cap(g.genre),
                    value: String(g.channels.length),
                    chevron: true,
                    run: function () { pickChannels(source, g); }
                };
            });
            openMusicPick(source.name, entries, { mode: 'nav' });
        });
    }

    function pickSomaGenre() { pickGenres(SOMAFM); }

    function pickRadioRecord() { pickGenres(RADIO_RECORD); }

    // ---------- Playlists

    function repaintPlaylistPick() {
        SettingsCore.withFocusRestore($('music-pick-list'), function () {
            pick.entries.forEach(function (e) { if (e.repaint) e.repaint(); });
            paintPick();
        });
    }

    // Play / pause in place (like Radio stations). Leaving the list keeps this playlist selected.
    function togglePlaylist(pl) {
        var p = Prefs.get().music;
        var same = p.source === 'playlist' && String(p.playlistId) === String(pl.id);
        if (same && Music.isPlaying()) {
            Music.pause();
            repaintPlaylistPick();
            return;
        }
        if (same) {
            if (!p.enabled) {
                p.enabled = true;
                Prefs.save();
            }
            Music.play();
            repaintPlaylistPick();
            return;
        }
        if (!p.enabled) {
            p.enabled = true;
            Prefs.save();
        }
        // setSource only auto-starts when already playing — force start when idle.
        var wasPlaying = Music.isPlaying();
        Music.setSource('playlist', pl);
        if (!wasPlaying) {
            p = Prefs.get().music;
            p.playing = true;
            Prefs.save();
            Music.play();
        }
        clearFocusPlay();
        repaintPlaylistPick();
    }

    // OK play/pause; Right toggles ★ favourite. Exit keeps the last played playlist selected.
    function playlistPickRow(pl) {
        var entry = {
            type: 'playlist',
            id: String(pl.id),
            title: pl.name || 'Playlist',
            songCount: pl.songCount
        };
        var row = {
            id: 'pl:' + entry.id,
            label: entry.title,
            run: function () { togglePlaylist(pl); }
        };
        function paint() {
            var p = Prefs.get().music;
            var on = p.source === 'playlist' && String(p.playlistId) === entry.id;
            var saved = isFav('playlist', entry.id);
            // Keep the name readable: status as a short prefix, value = count + star only.
            row.label = (on ? (Music.isPlaying() ? '▶ ' : '● ') : '') + entry.title;
            var bits = [];
            if (pl.songCount != null) bits.push(String(pl.songCount));
            bits.push(saved ? '★' : '☆');
            row.value = bits.join(' · ');
            row.favLabel = saved ? 'Unfavourite' : 'Favourite';
        }
        paint();
        row.repaint = paint;
        row.fav = function () {
            toggleFav(entry);
            paint();
            UI.toast(isFav('playlist', entry.id) ? 'Added to favourites' : 'Removed from favourites');
            SettingsCore.withFocusRestore($('music-pick-list'), function () {
                paintPick();
            });
        };
        return row;
    }

    function pickMusicPlaylist() {
        if (!Subsonic.configured()) {
            UI.toast('Set server, user and password first');
            return;
        }
        UI.busy(Subsonic.getPlaylists()).then(function (list) {
            if (!list.length) {
                UI.toast('No playlists on this server');
                return;
            }
            var entries = list.map(function (pl) { return playlistPickRow(pl); });
            // Favourited playlists first, then the rest (stable within each group).
            entries.sort(function (a, b) {
                var af = isFav('playlist', String(a.id).slice(3)) ? 0 : 1;
                var bf = isFav('playlist', String(b.id).slice(3)) ? 0 : 1;
                return af - bf;
            });
            openMusicPick('Playlists', entries, { mode: 'playlist' });
            var cur = Prefs.get().music;
            if (cur.playlistId) focusPickId('pl:' + cur.playlistId);
        }).catch(function (e) {
            UI.toast('Playlists failed: ' + ((e && e.message) || 'error'));
        });
    }

    // ---------- Your list / Favourites

    function removeYourList(entryId) {
        Music.removeCustomUrl(entryId.slice('custom:'.length));
        renderMusic();
        UI.refresh();
    }

    function addYourListUrl() {
        SettingsCore.rename('https://', function (url) {
            var entry = Music.addCustomUrl(url);
            if (!entry) {
                UI.toast('Enter an HTTPS stream URL');
                return;
            }
            UI.toast('Added ' + entry.title);
            renderMusic();
            UI.refresh();
            pickYourList({ replace: true });
        }, { title: 'Stream URL', maxLength: 200 });
    }

    function favouritePickRow(f) {
        if (f.type === 'playlist') {
            var row = playlistPickRow({
                id: f.id,
                name: f.title,
                songCount: f.songCount
            });
            row.removeLabel = 'Remove favourite';
            row.remove = function () {
                toggleFav(f);
                UI.toast('Removed from favourites');
                if (!favList().length) {
                    pick.stack = [];
                    UI.back();
                    return;
                }
                pickFavouritesReplace();
            };
            return row;
        }
        return playPickRow(f, (f.genre ? cap(f.genre) + ' · ' : '') + f.title, {
            removeLabel: 'Remove favourite',
            remove: function () {
                toggleFav(f);
                UI.toast('Removed from favourites');
                if (!favList().length) {
                    pick.stack = [];
                    UI.back();
                    return;
                }
                pickFavouritesReplace();
            }
        });
    }

    var favPickOpts = {};

    function favList() {
        var list = favs();
        if (favPickOpts.playlistsOnly) {
            list = list.filter(function (f) { return f.type === 'playlist'; });
        }
        return list;
    }

    function pickFavourites(opts) {
        favPickOpts = opts || {};
        var list = favList();
        if (!list.length) {
            UI.toast(favPickOpts.playlistsOnly ? 'No favourite playlists yet' : 'No favourites yet');
            return;
        }
        // Mixed radio + playlists: playlists use Select mode cues via their own run/fav.
        var hasPlay = list.some(function (f) { return f.type !== 'playlist'; });
        openMusicPick('Favourites', list.map(favouritePickRow), {
            mode: hasPlay ? 'play' : 'playlist'
        });
    }

    function pickFavouritesReplace() {
        var list = favList();
        if (!list.length) {
            pick.stack = [];
            UI.back();
            return;
        }
        var hasPlay = list.some(function (f) { return f.type !== 'playlist'; });
        openMusicPick('Favourites', list.map(favouritePickRow), {
            mode: hasPlay ? 'play' : 'playlist',
            replace: true
        });
    }

    function pickYourList(opts) {
        opts = opts || {};
        if (!window.Music) return;
        var p = Prefs.get().music;
        var entries = [];
        Music.customStations().forEach(function (st) {
            entries.push(playPickRow(stationEntry(st), st.title, {
                removeLabel: 'Remove from Your list',
                remove: function () {
                    removeYourList(st.id);
                    UI.toast('Removed');
                    pickYourList({ replace: true });
                }
            }));
        });
        entries.push({
            id: 'add-stream',
            label: 'Add stream…',
            kind: 'action',
            run: function () { addYourListUrl(); }
        });
        openMusicPick('Your list', entries, {
            mode: 'play',
            replace: !!opts.replace
        });
        if (p.radioId && String(p.radioId).indexOf('custom:') === 0) {
            focusPickId(p.radioId);
        }
    }

    window.SettingsMusicPickers = {
        maskSecret: maskSecret,
        pickMusicPlaylist: pickMusicPlaylist,
        addYourListUrl: addYourListUrl,
        pickRadioRecord: pickRadioRecord,
        pickYourList: pickYourList,
        pickFavourites: pickFavourites,
        favs: favs,
        pickSomaGenre: pickSomaGenre,
        register: register
    };
})();
