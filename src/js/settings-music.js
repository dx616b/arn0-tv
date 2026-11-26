/*
 * Settings → Music, on one page: On/Off, the source (Navidrome or Radio) with its settings shown
 * below it, then the playback controls. Entry points are exposed on window.SettingsMusic and wired
 * up by settings.js.
 */
(function () {
    'use strict';

    var pickMusicPlaylist = SettingsMusicPickers.pickMusicPlaylist;

    var $ = UI.$;
    var el = UI.el;
    var chip = SettingsCore.chip;

    // Soft playback updates only touch Controls when the source layout is unchanged.
    var lastLayoutSig = '';
    // Which Source panel is open — independent of what is actually playing, so the user can
    // edit Navidrome while Radio keeps going (and the other way round).
    var sourcePanel = '';

    function iconChip(svg, on, item, label) {
        var c = el('div', 'chip icon-chip' + (on ? ' on' : ''));
        c.innerHTML = svg;
        c._item = item;
        if (label) c.setAttribute('aria-label', label);
        return c;
    }

    var ICON = {
        play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
        pause: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',
        next: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>',
        volLow: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 9v6h4l5 5V4L9 9H5zm11.5 3a2.5 2.5 0 0 0-1.5-2.3v4.6a2.5 2.5 0 0 0 1.5-2.3z"/></svg>',
        volMed: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 9v6h4l5 5V4L9 9H5zm11.5 3c0-1.8-1-3.3-2.5-4v8c1.5-.7 2.5-2.2 2.5-4z"/><path d="M14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" opacity=".45"/></svg>',
        volHigh: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 9v6h4l5 5V4L9 9H5zm11.5 3c0-1.8-1-3.3-2.5-4v8c1.5-.7 2.5-2.2 2.5-4z"/><path d="M14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>'
    };

    function layoutSig(p, c) {
        return [
            p.enabled ? 1 : 0,
            p.source || '',
            p.playlistId || '',
            p.playlistShuffle !== false ? 1 : 0,
            p.playlistRepeat !== false ? 1 : 0,
            p.radioNav || '',
            sourcePanel || '',
            c.baseUrl ? 1 : 0,
            c.user ? 1 : 0,
            c.password ? 1 : 0,
            SettingsMusicPickers.favs().length
        ].join('|');
    }

    function panelFor(p) {
        if (sourcePanel === 'radio' || sourcePanel === 'navidrome') return sourcePanel;
        return p.source === 'radio' ? 'radio' : 'navidrome';
    }

    function navidromeBlock(p, c) {
        var server = el('div', 'setting-block');
        server.appendChild(el('h2', '', 'Navidrome server'));
        var serverChips = el('div', 'chips wrap');
        serverChips.appendChild(chip('Server', !!c.baseUrl, { kind: 'server' }));
        serverChips.appendChild(chip('Username', !!c.user, { kind: 'user' }));
        serverChips.appendChild(chip('Password', !!c.password, { kind: 'password' }));
        serverChips.appendChild(chip('Test connection', false, { kind: 'test' }));
        server.appendChild(serverChips);

        // Own card — selected server chips used to sit on top of the Play heading in one block.
        var play = el('div', 'setting-block');
        play.appendChild(el('h2', '', 'Play'));
        var modeChips = el('div', 'chips wrap');
        var onPlaylist = p.source === 'playlist' && !!p.playlistId;
        modeChips.appendChild(chip('Random', p.source === 'random', { kind: 'mode', value: 'random' }));
        // Long Navidrome names used to blow out the chip row — keep a short label.
        var plLabel = 'Playlist…';
        if (onPlaylist) {
            var plName = String(p.playlistName || 'Playlist');
            plLabel = plName.length > 22 ? plName.slice(0, 21) + '…' : plName;
        }
        modeChips.appendChild(chip(plLabel, onPlaylist, { kind: 'mode', value: 'playlist' }));
        var plFavs = SettingsMusicPickers.favs().filter(function (f) { return f.type === 'playlist'; });
        if (plFavs.length) {
            modeChips.appendChild(chip('Favourites (' + plFavs.length + ')', false, { kind: 'openPlFavs' }));
        }
        play.appendChild(modeChips);

        var root = el('div', '');
        root.appendChild(server);
        root.appendChild(play);

        // Playlist order options — shown whenever a playlist is the active source.
        if (onPlaylist) {
            var shuffle = el('div', 'setting-block');
            shuffle.appendChild(el('h2', '', 'Shuffle playlist'));
            var shuffleChips = el('div', 'chips');
            var shuffleOn = p.playlistShuffle !== false;
            shuffleChips.appendChild(chip('On', shuffleOn, { kind: 'playlistShuffle', value: true }));
            shuffleChips.appendChild(chip('Off', !shuffleOn, { kind: 'playlistShuffle', value: false }));
            shuffle.appendChild(shuffleChips);
            root.appendChild(shuffle);

            var repeat = el('div', 'setting-block');
            repeat.appendChild(el('h2', '', 'Repeat playlist'));
            var repeatChips = el('div', 'chips');
            var repeatOn = p.playlistRepeat !== false;
            repeatChips.appendChild(chip('On', repeatOn, { kind: 'playlistRepeat', value: true }));
            repeatChips.appendChild(chip('Off', !repeatOn, { kind: 'playlistRepeat', value: false }));
            repeat.appendChild(repeatChips);
            root.appendChild(repeat);
        }

        return root;
    }

    function radioBlock(p) {
        var wrap = el('div', 'setting-block');
        wrap.appendChild(el('h2', '', 'Stations'));
        var listChips = el('div', 'chips wrap');
        listChips.appendChild(chip('SomaFM', false, { kind: 'openSoma' }));
        listChips.appendChild(chip('Radio Record', false, { kind: 'openRecord' }));
        listChips.appendChild(chip('Your list', false, { kind: 'openList' }));
        var favCount = SettingsMusicPickers.favs().length;
        if (favCount) listChips.appendChild(chip('Favourites (' + favCount + ')', false, { kind: 'openFavs' }));
        wrap.appendChild(listChips);
        return wrap;
    }

    // Shared for Radio and Navidrome — Favourites mixes stations and playlists.
    function appendNextGoesThrough(body, p) {
        var nextBlock = el('div', 'setting-block');
        nextBlock.appendChild(el('h2', '', 'Next goes through'));
        var navChips = el('div', 'chips wrap');
        Music.radioNavOptions().forEach(function (o) {
            navChips.appendChild(chip(o.label, (p.radioNav || 'all') === o.nav, { kind: 'radioNav', value: o.nav }));
        });
        nextBlock.appendChild(navChips);
        body.appendChild(nextBlock);
    }

    function appendTransport(body, p) {
        var controlsBlock = el('div', 'setting-block');
        controlsBlock.appendChild(el('h2', '', 'Controls'));
        var controlChips = el('div', 'chips');
        var playing = Music.isPlaying();
        controlChips.appendChild(iconChip(ICON.play, playing, { kind: 'play' }, 'Play'));
        controlChips.appendChild(iconChip(ICON.pause, !playing && !!Music.current(), { kind: 'pause' }, 'Pause'));
        controlChips.appendChild(iconChip(ICON.next, false, { kind: 'next' }, 'Next'));
        controlsBlock.appendChild(controlChips);
        body.appendChild(controlsBlock);

        var volumeBlock = el('div', 'setting-block');
        volumeBlock.appendChild(el('h2', '', 'Volume'));
        var volumeChips = el('div', 'chips');
        volumeChips.appendChild(iconChip(ICON.volLow, p.volume === 'low', { kind: 'volume', value: 'low' }, 'Low'));
        volumeChips.appendChild(iconChip(ICON.volMed, p.volume === 'med', { kind: 'volume', value: 'med' }, 'Med'));
        volumeChips.appendChild(iconChip(ICON.volHigh, p.volume === 'high', { kind: 'volume', value: 'high' }, 'High'));
        volumeBlock.appendChild(volumeChips);
        body.appendChild(volumeBlock);
    }

    function updateTransportSoft(p) {
        var body = $('music-body');
        if (!body) return false;
        var chips = body.querySelectorAll('.chip.icon-chip');
        if (chips.length < 6) return false;
        var playing = Music.isPlaying();
        var hasTrack = !!Music.current();
        chips[0].classList.toggle('on', playing);
        chips[1].classList.toggle('on', !playing && hasTrack);
        chips[3].classList.toggle('on', p.volume === 'low');
        chips[4].classList.toggle('on', p.volume === 'med');
        chips[5].classList.toggle('on', p.volume === 'high');
        return true;
    }

    function showMusic() {
        var p = Prefs.get().music;
        sourcePanel = p.source === 'radio' ? 'radio' : 'navidrome';
        renderMusic();
    }

    function renderMusic() {
        var p = Prefs.get().music;
        var c = Subsonic.cfg();
        var body = $('music-body');
        body.innerHTML = '';
        var panel = panelFor(p);
        sourcePanel = panel;
        lastLayoutSig = layoutSig(p, c);

        var onBlock = el('div', 'setting-block');
        onBlock.appendChild(el('h2', '', 'Music'));
        var onChips = el('div', 'chips');
        onChips.appendChild(chip('On', p.enabled, { kind: 'enabled', value: true }));
        onChips.appendChild(chip('Off', !p.enabled, { kind: 'enabled', value: false }));
        onBlock.appendChild(onChips);
        body.appendChild(onBlock);

        var srcBlock = el('div', 'setting-block');
        srcBlock.appendChild(el('h2', '', 'Source'));
        var srcChips = el('div', 'chips');
        srcChips.appendChild(chip('Navidrome', panel === 'navidrome', { kind: 'source', value: 'navidrome' }));
        srcChips.appendChild(chip('Radio', panel === 'radio', { kind: 'source', value: 'radio' }));
        srcBlock.appendChild(srcChips);
        body.appendChild(srcBlock);

        body.appendChild(panel === 'radio' ? radioBlock(p) : navidromeBlock(p, c));
        appendNextGoesThrough(body, p);
        appendTransport(body, p);
    }

    function render() {
        if (!UI.isVisible('music-settings')) return;
        var p = Prefs.get().music;
        var c = Subsonic.cfg();
        var sig = layoutSig(p, c);
        if (sig === lastLayoutSig && updateTransportSoft(p)) {
            UI.refreshHints();
            return;
        }
        SettingsCore.withFocusRestore($('music-body'), renderMusic);
    }

    function activateMusic(item) {
        var c = Subsonic.cfg();
        if (item.kind === 'source') {
            // Panel only — leave whatever is playing alone until the user picks a station,
            // Random, playlist, or Play.
            sourcePanel = item.value === 'radio' ? 'radio' : 'navidrome';
            render();
            return;
        } else if (item.kind === 'openSoma') {
            SettingsMusicPickers.pickSomaGenre();
            return;
        } else if (item.kind === 'openRecord') {
            SettingsMusicPickers.pickRadioRecord();
            return;
        } else if (item.kind === 'openList') {
            SettingsMusicPickers.pickYourList();
            return;
        } else if (item.kind === 'openFavs') {
            SettingsMusicPickers.pickFavourites();
            return;
        } else if (item.kind === 'openPlFavs') {
            SettingsMusicPickers.pickFavourites({ playlistsOnly: true });
            return;
        } else if (item.kind === 'server') {
            SettingsCore.rename(c.baseUrl || 'http://', function (url) {
                Subsonic.setCreds({ baseUrl: url });
                Music.clearQueue();
                Music.pause();
                Music.renderBar();
                render();
            }, { title: 'Server URL', maxLength: 120 });
            return;
        } else if (item.kind === 'user') {
            SettingsCore.rename(c.user || '', function (user) {
                Subsonic.setCreds({ user: user });
                Music.clearQueue();
                Music.pause();
                Music.renderBar();
                render();
            }, { title: 'Username', maxLength: 64 });
            return;
        } else if (item.kind === 'password') {
            SettingsCore.rename('', function (password) {
                Subsonic.setCreds({ password: password });
                Music.clearQueue();
                Music.pause();
                Music.renderBar();
                render();
            }, { title: 'Password', maxLength: 64, password: true });
            return;
        } else if (item.kind === 'test') {
            if (!Subsonic.configured()) {
                UI.toast('Set server, user and password first');
                return;
            }
            UI.busy(Subsonic.ping()).then(function () {
                UI.toast('Connected');
                render();
            }).catch(function (e) {
                UI.toast('Failed: ' + ((e && e.message) || 'error'));
                render();
            });
            return;
        } else if (item.kind === 'mode') {
            if (!Subsonic.configured()) {
                UI.toast('Set server, user and password first');
                return;
            }
            if (item.value === 'playlist') {
                pickMusicPlaylist();
                return;
            }
            Music.setSource('random');
        } else if (item.kind === 'playlistShuffle') {
            Music.setPlaylistShuffle(!!item.value);
            UI.toast('Shuffle: ' + (item.value ? 'On' : 'Off'));
        } else if (item.kind === 'playlistRepeat') {
            Music.setPlaylistRepeat(!!item.value);
            UI.toast('Repeat: ' + (item.value ? 'On' : 'Off'));
        } else if (item.kind === 'radioNav') {
            Music.setRadioNav(item.value);
            var picked = Music.radioNavOptions().filter(function (o) { return o.nav === item.value; })[0];
            UI.toast('Next: ' + (picked ? picked.label : item.value));
        } else if (item.kind === 'enabled') {
            Music.setEnabled(item.value);
            if (!item.value) Music.pause();
        } else if (item.kind === 'volume') {
            Music.setVolume(item.value);
        } else if (item.kind === 'play') {
            Music.play();
        } else if (item.kind === 'pause') {
            Music.pause();
        } else if (item.kind === 'next') {
            Music.next();
        }
        render();
    }

    window.SettingsMusic = {
        render: render,
        renderMusic: renderMusic,
        show: showMusic,
        activate: activateMusic
    };
})();
