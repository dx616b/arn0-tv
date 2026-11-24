/*
 * Settings → Background: the Live picker. Warms the picker's catalogue, reports which provider is
 * busy, builds the caption and shuffle notes, and decides when the picker needs a soft or full redraw.
 * Entry points are exposed on window.SettingsBackgroundLive; the page itself is settings-background.js.
 */
(function () {
    'use strict';

    var bgState = SettingsCore.bgState;

    function renderBackground() { return SettingsBackground.render.apply(null, arguments); }

    function warmBgPicker() {
        if (!window.LiveWallpaper || !LiveWallpaper.warmForPicker) return;
        if (LiveWallpaper.needsSetup && LiveWallpaper.needsSetup()) return;
        UI.busy(LiveWallpaper.warmForPicker()).then(function () {
            renderBackground();
            UI.refresh();
        }, function () {
            renderBackground();
            UI.refresh();
        });
    }

    // After a Live source change: hold the busy ring until thumbs/history exist, max 5 s.
    function busyLiveProviderChange() {
        var maxMs = 5000;
        if (!window.LiveWallpaper) return Promise.resolve();
        if (LiveWallpaper.needsSetup && LiveWallpaper.needsSetup()) return Promise.resolve();
        var prov = Prefs.get().wallpaper.liveProvider || 'bing';
        var boot = LiveWallpaper.ensureDaily().then(function () {
            var wall = Prefs.get().wallpaper;
            var l = LiveWallpaper.list();
            if (l.length && (!wall.liveKey || !LiveWallpaper.find(wall.liveKey))) {
                wall.liveKey = l[0].key;
                Prefs.save();
            }
            if (window.Wallpaper && Wallpaper.apply) Wallpaper.apply();
        }, function () { /* keep waiting on warm/poll */ });
        var warm = (prov !== 'mix' && LiveWallpaper.warmForPicker)
            ? LiveWallpaper.warmForPicker()
            : Promise.resolve();
        var hasPhotos = new Promise(function (resolve) {
            var t0 = Date.now();
            function tick() {
                var n = LiveWallpaper.list().length;
                var picks = LiveWallpaper.pickList ? LiveWallpaper.pickList().length : 0;
                if (n > 0 || (prov !== 'mix' && picks > 0) || Date.now() - t0 >= maxMs) {
                    resolve();
                    return;
                }
                setTimeout(tick, 150);
            }
            tick();
        });
        var work = Promise.all([boot, warm, hasPhotos]).then(function () {
            var wall = Prefs.get().wallpaper;
            var l = LiveWallpaper.list();
            // warmForPicker may fill picks before history — promote first pick onto Home.
            if (!l.length && LiveWallpaper.pickList) {
                var picks = LiveWallpaper.pickList();
                if (picks[0] && picks[0].key) {
                    wall.liveKey = picks[0].key;
                    Prefs.save();
                    // takeNext would wait on plan; apply the pick we already have.
                    if (LiveWallpaper.showPick) LiveWallpaper.showPick(picks[0]);
                }
            } else if (l.length && (!wall.liveKey || !LiveWallpaper.find(wall.liveKey))) {
                wall.liveKey = l[0].key;
                Prefs.save();
            }
            if (window.Wallpaper && Wallpaper.apply) Wallpaper.apply();
        });
        var cap = new Promise(function (resolve) { setTimeout(resolve, maxMs); });
        return UI.busy(Promise.race([work, cap]));
    }

    function bgLiveSoftSig(p) {
        return [
            p.mode,
            p.liveProvider || '',
            p.livePool || '',
            !!p.random,
            p.interval || '',
            window.LiveWallpaper ? LiveWallpaper.enabledSourceKeys().join(',') : '',
            bgState.keepLivePicker ? '1' : '0'
        ].join('|');
    }

    // Status line under Live: current focus + Mix roster when relevant.
    function liveCapText(p, pool, src) {
        var cap = (pool.length ? pool.length + ' recent · ' : '') + src;
        if ((p.liveProvider || '') === 'mix' && window.LiveWallpaper && LiveWallpaper.mixSources) {
            var names = Array.prototype.slice.call(LiveWallpaper.mixSources());
            if (names.length) {
                cap += ' · ' + names.join(' → ');
                if (p.random) cap += ' (shuffled)';
            }
        }
        return cap;
    }

    function shuffleNoteFor(p) {
        if (p.mode === 'rotate') {
            return 'On: random photo from the rotate set. Off: play in order.';
        }
        return 'Mix only: On shuffles provider order, then plays them in turn. Photos stay in fetch order.';
    }

    // Shuffle matters for Rotate (photos) or Live Mix On with 2+ sources.
    function showShuffleBlock(p) {
        if (p.mode === 'rotate') return true;
        if (p.mode !== 'live' && !bgState.keepLivePicker) return false;
        if ((p.liveProvider || '') !== 'mix') return false;
        var n = window.LiveWallpaper ? LiveWallpaper.enabledSourceKeys().length : 0;
        return n >= 2;
    }

    window.SettingsBackgroundLive = {
        warmBgPicker: warmBgPicker,
        busyLiveProviderChange: busyLiveProviderChange,
        bgLiveSoftSig: bgLiveSoftSig,
        liveCapText: liveCapText,
        shuffleNoteFor: shuffleNoteFor,
        showShuffleBlock: showShuffleBlock,
    };
})();
