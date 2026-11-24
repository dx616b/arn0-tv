/*
 * Settings → Music: the radio station and playlist pickers and the custom radio URL editor. Entry points
 * are exposed on window.SettingsMusicPickers; the page itself is settings-music.js.
 */
(function () {
    'use strict';


    function renderMusic() { return SettingsMusic.render.apply(null, arguments); }

    function maskSecret(value) {
        if (!value) return 'Set password';
        return 'Password set';
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
            var p = Prefs.get().music;
            var options = list.map(function (pl) {
                var label = pl.name;
                if (pl.songCount != null) label += ' · ' + pl.songCount;
                return {
                    label: label,
                    checked: p.source === 'playlist' && String(p.playlistId) === String(pl.id),
                    run: function () {
                        Music.setSource('playlist', pl);
                        renderMusic();
                        UI.refresh();
                        UI.toast('Music: ' + Music.sourceLabel());
                    }
                };
            });
            options.push({ label: 'Cancel' });
            UI.menu('Playlists', options);
        }).catch(function (e) {
            UI.toast('Playlists failed: ' + ((e && e.message) || 'error'));
        });
    }

    // Add one stream to Your list. Only the URL is needed; the name comes from its address.
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
            pickYourList();
        }, { title: 'Stream URL', maxLength: 200 });
    }

    function cap(text) {
        var t = String(text || '');
        return t.charAt(0).toUpperCase() + t.slice(1);
    }

    // A genre source (SomaFM, Radio Record): how to load it, group it, show and play its entries.
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

    // Genres first (the most stations at the top), then the channels of the chosen genre.
    function pickGenres(source) {
        UI.busy(source.refresh()).then(function () {
            var groups = source.groups();
            if (!groups.length) {
                UI.toast(source.name + ' unavailable — check the connection');
                return;
            }
            var options = groups.map(function (g) {
                return {
                    label: cap(g.genre) + ' (' + g.channels.length + ')',
                    run: function () { pickChannels(source, g); }
                };
            });
            options.push({ label: 'Cancel' });
            UI.menu(source.name + ' genres', options);
        });
    }

    // The channels of one genre. OK plays one; Right and Left work as on every list.
    function pickChannels(source, group) {
        var p = Prefs.get().music;
        var options = group.channels.map(function (c) {
            return playRow(source.entry(c), source.title(c), source.current(c, p), null, null);
        });
        options.push({ label: 'Cancel' });
        UI.menu(source.name + ' · ' + cap(group.genre), options, {
            onBack: function () { pickGenres(source); }
        });
    }

    function pickSomaGenre() { pickGenres(SOMAFM); }

    function pickRadioRecord() { pickGenres(RADIO_RECORD); }

    // Favourites: stations and SomaFM channels the user has saved. Stored in the Music prefs as
    // { type: 'station' | 'soma', id, title, genre }; a SomaFM favourite keeps its playlist links so it
    // can play without reloading the feed.
    function favs() {
        var list = Prefs.get().music.favourites;
        if (!Array.isArray(list)) return [];
        var customIds = Music.customStations().map(function (st) { return st.id; });
        return list.filter(function (x) {
            if (x.type === 'station') return Music.radioStations().some(function (st) { return st.id === x.id; });
            if (x.type === 'custom') return customIds.indexOf(x.id) >= 0;
            return true;
        });
    }

    function isFav(type, id) {
        return favs().some(function (x) { return x.type === type && x.id === id; });
    }

    function toggleFav(entry) {
        var p = Prefs.get().music;
        var list = Array.isArray(p.favourites) ? p.favourites : [];
        var i = list.findIndex(function (x) { return x.type === entry.type && x.id === entry.id; });
        if (i >= 0) list.splice(i, 1); else list.push(entry);
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
            UI.toast('Radio: ' + f.title);
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
            UI.toast('Radio: ' + f.title);
        });
    }

    // One station, channel, or Your list entry in a menu, the same in every list:
    // OK plays it, Right toggles the favourite (☆ / ★ shown on the row), Left removes it from the
    // list you are in. `removal` overrides Left: { label, run, drop } where drop takes the row out of
    // the menu. Without it, Left removes the favourite (or says it is not one).
    var focusTimer = null;

    // OK on a row: pause it if it is the station playing now, otherwise play it.
    function toggleRow(entry) {
        var key = entry.type === 'soma' ? 'somafm:' + entry.id : entry.id;
        if (Music.isPlaying() && Prefs.get().music.radioId === key) {
            clearTimeout(focusTimer);
            Music.pause();
            UI.toast('Paused');
            return;
        }
        playEntry(entry);
    }

    function playRow(entry, label, checked, options, removal) {
        // current: the station selected (where the list opens); checked: the tick, only while it plays.
        var opt = { label: label, current: !!checked, checked: !!checked && Music.isPlaying(), keep: true, run: function () { toggleRow(entry); } };
        // Moving onto a row plays it after a short pause, so scrolling past several rows plays only the last.
        opt.focus = function () {
            clearTimeout(focusTimer);
            var key = entry.type === 'soma' ? 'somafm:' + entry.id : entry.id;
            if (Music.isPlaying() && Prefs.get().music.radioId === key) return;
            focusTimer = setTimeout(function () {
                focusTimer = null;
                playEntry(entry);
            }, 700);
        };
        function paint() {
            var saved = isFav(entry.type, entry.id);
            opt.label = label + '  ' + (saved ? '★' : '☆');
            opt.altLabel = saved ? 'Unfavourite' : 'Favourite';
        }
        paint();
        opt.alt = function () {
            toggleFav(entry);
            paint();
            UI.toast(isFav(entry.type, entry.id) ? 'Added to favourites' : 'Removed from favourites');
            UI.refreshMenu();
        };
        var rm = removal || {
            label: 'Remove favourite',
            run: function () {
                if (!isFav(entry.type, entry.id)) {
                    UI.toast('Not a favourite');
                    return false;
                }
                toggleFav(entry);
                return true;
            }
        };
        opt.alt2Label = rm.label;
        opt.alt2 = function () {
            if (rm.drop) {
                rm.run();
                options.splice(options.indexOf(opt), 1);
            } else {
                if (rm.run() === false) return;
                paint();
            }
            UI.refreshMenu();
        };
        return opt;
    }

    function pickFavourites() {
        var options = favs().map(function (f) {
            return playRow(f, (f.genre ? cap(f.genre) + ' · ' : '') + f.title, false, options, {
                label: 'Remove favourite',
                drop: true,
                run: function () { toggleFav(f); }
            });
        });
        options.push({ label: 'Cancel' });
        UI.menu('Favourites', options);
    }

    function removeYourList(entryId) {
        Music.removeCustomUrl(entryId.slice('custom:'.length));
        renderMusic();
        UI.refresh();
    }

    // Your list: the streams the user added, then "Add stream…". Left arrow removes an entry.
    function pickYourList() {
        if (!window.Music) return;
        var p = Prefs.get().music;
        var options = [];
        Music.customStations().forEach(function (st) {
            options.push(playRow(stationEntry(st), st.title, p.radioId === st.id, options, {
                label: 'Remove from Your list',
                drop: true,
                run: function () { removeYourList(st.id); }
            }));
        });
        options.push({ label: 'Add stream…', run: function () { addYourListUrl(); } });
        options.push({ label: 'Cancel' });
        UI.menu('Your list', options);
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
    };
})();
