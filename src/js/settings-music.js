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

    function navidromeBlock(p, c) {
        var wrap = el('div', 'setting-block');
        wrap.appendChild(el('h2', '', 'Navidrome server'));
        var serverChips = el('div', 'chips wrap');
        serverChips.appendChild(chip('Server', !!c.baseUrl, { kind: 'server' }));
        serverChips.appendChild(chip('Username', !!c.user, { kind: 'user' }));
        serverChips.appendChild(chip('Password', !!c.password, { kind: 'password' }));
        serverChips.appendChild(chip('Test connection', false, { kind: 'test' }));
        wrap.appendChild(serverChips);

        wrap.appendChild(el('h2', '', 'Play'));
        var modeChips = el('div', 'chips wrap');
        var onPlaylist = p.source === 'playlist' && !!p.playlistId;
        modeChips.appendChild(chip('Random', p.source === 'random', { kind: 'mode', value: 'random' }));
        modeChips.appendChild(chip(
            onPlaylist ? (p.playlistName || 'Playlist') : 'Playlist…',
            onPlaylist,
            { kind: 'mode', value: 'playlist' }
        ));
        wrap.appendChild(modeChips);
        return wrap;
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

        var nextBlock = el('div', 'setting-block');
        nextBlock.appendChild(el('h2', '', 'Next goes through'));
        var navChips = el('div', 'chips');
        navChips.appendChild(chip('All channels', p.radioNav !== 'favourites' && p.radioNav !== 'list', { kind: 'radioNav', value: 'all' }));
        navChips.appendChild(chip('Favourites', p.radioNav === 'favourites', { kind: 'radioNav', value: 'favourites' }));
        navChips.appendChild(chip('Your list', p.radioNav === 'list', { kind: 'radioNav', value: 'list' }));
        nextBlock.appendChild(navChips);
        var root = el('div', '');
        root.appendChild(wrap);
        root.appendChild(nextBlock);
        return root;
    }

    function renderMusic() {
        var p = Prefs.get().music;
        var c = Subsonic.cfg();
        var body = $('music-body');
        body.innerHTML = '';

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
        var onRadio = p.source === 'radio';
        srcChips.appendChild(chip('Navidrome', !onRadio, { kind: 'source', value: 'navidrome' }));
        srcChips.appendChild(chip('Radio', onRadio, { kind: 'source', value: 'radio' }));
        srcBlock.appendChild(srcChips);
        body.appendChild(srcBlock);

        body.appendChild(onRadio ? radioBlock(p) : navidromeBlock(p, c));

        var playBlock = el('div', 'setting-block');
        var heads = el('div', 'setting-inline-heads');
        heads.appendChild(el('h2', '', 'Controls'));
        heads.appendChild(el('h2', '', 'Volume'));
        playBlock.appendChild(heads);
        var playChips = el('div', 'chips');
        var playing = Music.isPlaying();
        playChips.appendChild(iconChip(ICON.play, playing, { kind: 'play' }, 'Play'));
        playChips.appendChild(iconChip(ICON.pause, !playing && !!Music.current(), { kind: 'pause' }, 'Pause'));
        playChips.appendChild(iconChip(ICON.next, false, { kind: 'next' }, 'Next'));
        playChips.appendChild(el('div', 'chip-gap'));
        playChips.appendChild(iconChip(ICON.volLow, p.volume === 'low', { kind: 'volume', value: 'low' }, 'Low'));
        playChips.appendChild(iconChip(ICON.volMed, p.volume === 'med', { kind: 'volume', value: 'med' }, 'Med'));
        playChips.appendChild(iconChip(ICON.volHigh, p.volume === 'high', { kind: 'volume', value: 'high' }, 'High'));
        playBlock.appendChild(playChips);
        body.appendChild(playBlock);
    }

    function render() {
        if (UI.isVisible('music-settings')) renderMusic();
        UI.refresh();
    }

    function activateMusic(item) {
        var c = Subsonic.cfg();
        var p = Prefs.get().music;
        if (item.kind === 'source') {
            if (item.value === 'radio') {
                Music.setSource('radio');
            } else if (p.source === 'radio') {
                Music.setSource('random');
            }
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
            UI.toast('Music: Random');
        } else if (item.kind === 'radioNav') {
            Music.setRadioNav(item.value);
            UI.toast(item.value === 'favourites' ? 'Next: favourites' : item.value === 'list' ? 'Next: your list' : 'Next: all channels');
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
        activate: activateMusic
    };
})();
