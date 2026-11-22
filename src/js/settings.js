/* Settings: hub (Home / Atmosphere / Samsung / Advanced) then detail pages. */
(function () {
    'use strict';

    var $ = UI.$;
    var el = UI.el;
    var KEY = UI.KEY;
    var THUMB_COLS = 6;

    // Samsung's on-screen keyboard (IME) sends these for its Done / Cancel buttons.
    var IME_DONE = 65376;
    var IME_CANCEL = 65385;

    // Samsung's own home screen (Smart Hub). TV Settings uses Apps.openTvSettings()
    // (ApplicationControl → org.tizen.menu); plain launch of coba.setting shows nothing.
    var SAMSUNG_HOME = 'com.samsung.tv.csfs';

    var LOGOS = [
        { key: 'playstation', label: 'PlayStation' },
        { key: 'xbox', label: 'Xbox' },
        { key: 'switch', label: 'Nintendo Switch' },
        { key: '', label: 'None' }
    ];

    var METHODS = [
        { key: 'switch+viewer', label: 'TV input', hint: 'Game Mode works' },
        { key: 'inapp', label: 'Inside the launcher', hint: 'Back returns here' }
    ];

    // ---------- Generic list pages

    // entries: [{ label, value, mini, run }]
    function renderList(list, entries) {
        list.innerHTML = '';
        entries.forEach(function (e) {
            var li = el('li', 'setting-row');
            if (e.mini) li.appendChild(e.mini);
            li.appendChild(el('span', 'setting-label', e.label));
            if (e.value) li.appendChild(el('span', 'setting-value', e.value));
            li._item = e;
            list.appendChild(li);
        });
    }

    /*
     * A two-column list fills the first column before the second, so visual row r holds items
     * r and r + rowCount. The focus grid has to be built that way round or Down would jump
     * across columns.
     */
    function columnRows(items) {
        var rowCount = Math.ceil(items.length / 2);
        var rows = [];
        for (var r = 0; r < rowCount; r++) {
            var row = [items[r]];
            if (items[r + rowCount]) row.push(items[r + rowCount]);
            rows.push(row);
        }
        return rows;
    }

    function registerList(name, entries, hints, twoColumn) {
        var view = $(name);
        var list = view.querySelector('ul');
        var render = function () {
            renderList(list, entries());
            // Set in JS so the split follows the number of entries rather than a hard-coded four.
            if (twoColumn) {
                list.style.gridTemplateRows =
                    'repeat(' + Math.ceil(list.children.length / 2) + ', auto)';
            }
        };
        UI.register(name, {
            el: view,
            rows: function () {
                var items = UI.children(list);
                return twoColumn ? columnRows(items) : items.map(function (li) { return [li]; });
            },
            onShow: render,
            activate: function (item) { item.run(); },
            hints: hints
        });
        return render;
    }

    var opening = false;
    function openSamsungHome() {
        if (opening) return;
        opening = true;
        DevLog.log('Open Samsung Home');
        UI.busy(Apps.launch(SAMSUNG_HOME)).catch(function (err) {
            DevLog.log('Samsung Home failed: ' + DevLog.errorText(err));
            UI.toast('Could not open Samsung Home: ' + DevLog.errorText(err));
        }).then(function () { opening = false; });
    }

    function openTvSettings() {
        if (opening) return;
        opening = true;
        DevLog.log('Open TV Settings');
        UI.busy(Apps.openTvSettings()).catch(function (err) {
            DevLog.log('TV Settings failed: ' + DevLog.errorText(err));
            UI.toast('Could not open TV Settings: ' + DevLog.errorText(err));
        }).then(function () { opening = false; });
    }

    // ---------- Overview

    // Top-level hub: four groups instead of a flat list of every page.
    function overviewEntries() {
        return [
            { label: 'Home screen', run: function () { UI.show('settings-home'); } },
            { label: 'Atmosphere', run: function () { UI.show('settings-atmosphere'); } },
            { label: 'Samsung', run: function () { UI.show('settings-samsung'); } },
            { label: 'Advanced', run: function () { UI.show('advanced'); } }
        ];
    }

    function homeGroupEntries() {
        return [
            { label: 'Apps on Home', run: function () { UI.show('homeapps'); } },
            { label: 'Consoles', run: function () { UI.show('consoles'); } }
        ];
    }

    function pinStorageLabel() {
        if (!window.Wallpaper || !Wallpaper.pinsStorageSummary) return '';
        return Wallpaper.pinsStorageSummary();
    }

    function isPinnedKey(key) {
        var list = (window.Wallpaper && Wallpaper.pinsList && Wallpaper.pinsList()) || [];
        return list.some(function (pin) { return pin.key === key; });
    }

    function afterPinChange(focusKey) {
        bgPhotosGridMode = '';
        bgPhotosKeys = {};
        if (typeof renderAtmosphere === 'function') renderAtmosphere();
        renderBackground();
        if (focusKey) focusBgThumb(focusKey);
        else UI.refresh();
    }

    function removeOnePin(key) {
        if (!window.Wallpaper || !Wallpaper.removePin) return;
        UI.busy(Wallpaper.removePin(key)).then(function (ok) {
            if (!ok) {
                UI.toast('Could not remove');
                return;
            }
            var sum = pinStorageLabel();
            UI.toast(sum ? 'Removed · ' + sum : 'Removed');
            afterPinChange(Prefs.get().wallpaper.photo);
        }, function () {
            UI.toast('Could not remove');
        });
    }

    function hideOneBundled(key) {
        if (!window.Wallpaper || !Wallpaper.hideBundled) return;
        if (!Wallpaper.hideBundled(key)) {
            UI.toast('Keep at least one photo');
            return;
        }
        UI.toast('Hidden from Photo / Rotate');
        afterPinChange(Prefs.get().wallpaper.photo);
        if (typeof renderAtmosphere === 'function') renderAtmosphere();
    }

    function restoreBundledPhotos() {
        if (!window.Wallpaper || !Wallpaper.restoreBundled) return;
        var n = Wallpaper.hiddenBundledCount ? Wallpaper.hiddenBundledCount() : 0;
        if (!n) {
            UI.toast('No hidden bundled photos');
            return;
        }
        UI.menu('Restore ' + n + ' bundled photo' + (n === 1 ? '' : 's') + '?', [
            {
                label: 'Restore', run: function () {
                    Wallpaper.restoreBundled();
                    UI.toast('Bundled photos restored');
                    afterPinChange(Prefs.get().wallpaper.photo);
                    if (typeof renderAtmosphere === 'function') renderAtmosphere();
                }
            },
            { label: 'Cancel' }
        ]);
    }

    function usePhotoKey(key) {
        var p = Prefs.get().wallpaper;
        bgKeepLivePicker = false;
        // Switching to a pin or shipped still drops the temporary Live use.
        if (p.tempPhoto && p.tempPhoto.key !== key && Wallpaper.clearTempPhoto) {
            Wallpaper.clearTempPhoto();
        }
        p.photo = key;
        p.mode = 'photo';
        Prefs.save();
        Wallpaper.apply();
        afterPinChange(key);
    }

    function useLiveNow(entry) {
        if (!Wallpaper.useTemporary || !Wallpaper.useTemporary(entry)) {
            UI.toast('Could not use photo');
            return;
        }
        bgKeepLivePicker = true;
        UI.toast('Using now (not saved)');
        afterPinChange(entry.key);
    }

    function saveLivePermanent(entry) {
        UI.busy(Wallpaper.pinLive(entry)).then(function (ok) {
            bgKeepLivePicker = true;
            var sum = pinStorageLabel();
            UI.toast(ok
                ? ('Saved permanently' + (sum ? ' · ' + sum : ''))
                : 'Saved (online only)');
            afterPinChange(entry.key);
        }, function () {
            UI.toast('Could not save');
        });
    }

    function livePhotoMenu(entry) {
        if (!entry) {
            UI.toast('Could not use photo');
            return;
        }
        if (isPinnedKey(entry.key)) {
            UI.menu(entry.title || 'Saved photo', [
                {
                    label: 'Use', run: function () { usePhotoKey(entry.key); }
                },
                {
                    label: 'Remove save', run: function () { removeOnePin(entry.key); }
                },
                { label: 'Cancel' }
            ]);
            return;
        }
        UI.menu(entry.title || 'Photo', [
            {
                label: 'Use now', run: function () { useLiveNow(entry); }
            },
            {
                label: 'Save permanently', run: function () { saveLivePermanent(entry); }
            },
            { label: 'Cancel' }
        ]);
    }

    function clearSavedPins() {
        var pins = (Wallpaper.pinsList && Wallpaper.pinsList()) || [];
        if (!pins.length) {
            UI.toast('No saved pins');
            return;
        }
        var size = pinStorageLabel();
        UI.menu(size ? 'Clear saved pins (' + size + ')?' : 'Clear saved pins?', [
            {
                label: 'Clear', run: function () {
                    UI.busy(Wallpaper.clearPins()).then(function () {
                        var p = Prefs.get().wallpaper;
                        var visible = (Wallpaper.bundledVisible && Wallpaper.bundledVisible()) ||
                            Wallpaper.bundled();
                        if (visible.length) {
                            p.photo = visible[0].key;
                            Prefs.save();
                            Wallpaper.apply();
                        }
                        bgPhotosGridMode = '';
                        bgPhotosKeys = {};
                        UI.toast('Saved pins cleared');
                        // Atmosphere list label + Background storage note both bake size at render.
                        if (typeof renderAtmosphere === 'function') renderAtmosphere();
                        if ($('bg-settings') && !$('bg-settings').classList.contains('hidden')) {
                            renderBackground();
                        }
                        UI.refresh();
                    });
                }
            },
            { label: 'Cancel' }
        ]);
    }

    function atmosphereGroupEntries() {
        var clearLabel = 'Clear saved pins';
        var size = pinStorageLabel();
        if (size && ((Wallpaper.pinsList && Wallpaper.pinsList()) || []).length) {
            clearLabel += ' (' + size + ')';
        }
        var entries = [
            { label: 'Background', run: function () { UI.show('bg'); } },
            { label: 'Screen saver', run: function () { UI.show('screensaver-settings'); } },
            { label: 'Music', run: function () { UI.show('music-settings'); } },
            { label: clearLabel, run: clearSavedPins }
        ];
        var hidden = window.Wallpaper && Wallpaper.hiddenBundledCount
            ? Wallpaper.hiddenBundledCount() : 0;
        if (hidden) {
            entries.push({
                label: 'Restore bundled photos (' + hidden + ')',
                run: restoreBundledPhotos
            });
        }
        return entries;
    }

    function samsungGroupEntries() {
        return [
            { label: 'TV Settings', run: openTvSettings },
            { label: 'Samsung Home', run: openSamsungHome }
        ];
    }

    // ---------- Chips (Background, Appearance)

    function chip(label, on, item) {
        var c = el('div', 'chip' + (on ? ' on' : ''), label);
        c._item = item;
        return c;
    }

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

    function chipRows(container) {
        var rows = [];
        UI.children(container).forEach(function (block) {
            if (block.classList.contains('hidden')) return;
            var parts = block.querySelectorAll('.chips, .thumbs');
            if (!parts.length) return;
            Array.prototype.forEach.call(parts, function (chips) {
                if (chips.classList.contains('hidden')) return;
                if (chips.classList.contains('thumbs')) {
                    rows = rows.concat(UI.chunk(UI.children(chips), THUMB_COLS));
                    return;
                }
                // Skip spacer nodes (e.g. Controls | Volume gap) so focus stays on real chips.
                var row = UI.children(chips).filter(function (n) {
                    return !n.classList.contains('chip-gap');
                });
                if (row.length) rows.push(row);
            });
        });
        return rows;
    }

    // ---------- Background

    // Live thumb grid: keep existing <img> nodes while the catalog grows (full rebuild is slow).
    var bgPhotosGridMode = '';
    var bgPhotosKeys = {};
    var bgLiveRefreshTimer = null;
    // After Save from Live, Home switches to Photo but the Live picker stays open for more saves.
    var bgKeepLivePicker = false;
    // Soft onChange refresh: skip chip rebuild when only the live catalog grew.
    var bgSoftSig = '';

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
            if (l.length && !LiveWallpaper.find(wall.liveKey)) {
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
        var work = Promise.all([boot, warm, hasPhotos]);
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
            bgKeepLivePicker ? '1' : '0'
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

    // Shuffle matters for Rotate (photos) or Live Mix (2+ sources). Hide for solo Live.
    function showShuffleBlock(p) {
        if (p.mode === 'rotate') return true;
        if (p.mode !== 'live' && !bgKeepLivePicker) return false;
        var n = window.LiveWallpaper ? LiveWallpaper.enabledSourceKeys().length : 0;
        return n >= 2;
    }

    // Append-only thumbs + status — used when Live notifies during warm (chips unchanged).
    function renderBackgroundLiveDelta() {
        var p = Prefs.get().wallpaper;
        var live = p.mode === 'live';
        var browseLive = live || bgKeepLivePicker;
        var prov = p.liveProvider || 'bing';
        var liveStatus = $('bg-live-status-block');
        if (liveStatus) {
            liveStatus.classList.toggle('hidden', !browseLive || !!(window.LiveWallpaper && LiveWallpaper.needsSetup()));
            var pool = live ? Wallpaper.list() : [];
            var cur = live ? Wallpaper.find(p.liveKey) : null;
            var src = window.LiveWallpaper ? LiveWallpaper.providerLabel() : 'Bing';
            var fetching = (window.LiveWallpaper && LiveWallpaper.status()) || 'Fetching ' + src + '…';
            $('bg-live-status').textContent = (cur || bgKeepLivePicker) ? '' : fetching;
            $('bg-live-cap').textContent = liveCapText(p, pool, src);
        }
        var showLiveThumbs = browseLive && prov !== 'mix' &&
            !(window.LiveWallpaper && LiveWallpaper.needsSetup());
        if (!showLiveThumbs) return;
        var photos = $('bg-photos');
        var photosBlock = $('bg-photos-block');
        if (!photos || !photosBlock) return;
        if (bgPhotosGridMode !== 'live') return;
        var list = (window.LiveWallpaper && LiveWallpaper.pickList)
            ? LiveWallpaper.pickList()
            : [];
        list.forEach(function (w) {
            if (bgPhotosKeys[w.key]) return;
            bgPhotosKeys[w.key] = true;
            var t = el('div', 'thumb');
            var img = new Image();
            img.decoding = 'async';
            img.loading = 'lazy';
            img.src = w.thumb || w.file;
            img.onerror = function () {
                if (w.file && img.getAttribute('src') !== w.file) img.src = w.file;
            };
            t.appendChild(img);
            t.appendChild(el('div', 'thumb-title', w.title || ''));
            t._item = { kind: 'pinLive', key: w.key, entry: w };
            photos.appendChild(t);
        });
        var moreBlock = $('bg-photos-more');
        if (moreBlock) {
            moreBlock.classList.remove('hidden');
            if (!moreBlock.querySelector('.chip')) {
                moreBlock.innerHTML = '';
                moreBlock.appendChild(chip('Load more', false, { kind: 'pickMore' }));
            }
        }
    }

    function renderBackground() {
        var p = Prefs.get().wallpaper;
        var live = p.mode === 'live';
        var browseLive = live || bgKeepLivePicker;
        var cycle = p.mode === 'rotate' || live;
        bgSoftSig = bgLiveSoftSig(p);

        var modes = $('bg-mode');
        modes.innerHTML = '';
        [['off', 'Off'], ['photo', 'Photo'], ['rotate', 'Rotate'], ['live', 'Live']].forEach(function (m) {
            // While saving more from Live, keep Live highlighted even though Home is Photo.
            var on = bgKeepLivePicker ? m[0] === 'live' : p.mode === m[0];
            modes.appendChild(chip(m[1], on, { kind: 'mode', key: m[0] }));
        });

        var intervals = $('bg-interval');
        intervals.innerHTML = '';
        Wallpaper.INTERVALS.forEach(function (i) {
            intervals.appendChild(chip(i.label, p.interval === i.key, { kind: 'interval', key: i.key }));
        });
        $('bg-interval-block').classList.toggle('hidden', !cycle);

        // Multi-select: chips = mixEnabled; liveProvider is sole source or mix.
        if (browseLive && window.LiveWallpaper && LiveWallpaper.syncLiveProvider) {
            LiveWallpaper.syncLiveProvider();
            p = Prefs.get().wallpaper;
        }
        var prov = p.liveProvider || 'bing';
        var liveProvBlock = $('bg-live-provider-block');
        if (liveProvBlock) {
            liveProvBlock.classList.toggle('hidden', !browseLive);
            var providers = $('bg-live-provider');
            providers.innerHTML = '';
            (window.LiveWallpaper ? LiveWallpaper.PROVIDERS : [{ key: 'bing', label: 'Bing' }])
                .filter(function (x) { return x.key !== 'mix'; })
                .forEach(function (x) {
                    var on = window.LiveWallpaper
                        ? LiveWallpaper.mixSourceOn(x.key)
                        : prov === x.key;
                    providers.appendChild(chip(x.label, on, { kind: 'provider', key: x.key }));
                });
            var provNote = $('bg-live-provider-note');
            if (provNote) provNote.classList.toggle('hidden', !browseLive);
        }

        var unsplashOn = window.LiveWallpaper
            ? LiveWallpaper.mixSourceOn('unsplash')
            : (prov === 'unsplash' || prov === 'mix');
        var showUnsplash = browseLive && unsplashOn;
        var unsplashBlock = $('bg-live-unsplash-block');
        if (unsplashBlock) {
            unsplashBlock.classList.toggle('hidden', !showUnsplash);
            var keyChips = $('bg-live-unsplash-key');
            keyChips.innerHTML = '';
            keyChips.appendChild(chip(
                window.LiveWallpaper ? LiveWallpaper.unsplashKeySummary() : 'Set Access Key',
                window.LiveWallpaper && LiveWallpaper.unsplashConfigured(),
                { kind: 'unsplashKey' }
            ));
            keyChips.appendChild(chip(
                window.LiveWallpaper ? LiveWallpaper.unsplashCollectionSummary() : 'Popular photos',
                !!(window.LiveWallpaper && LiveWallpaper.unsplashCollection()),
                { kind: 'unsplashCollection' }
            ));
        }

        var immichOn = window.LiveWallpaper
            ? LiveWallpaper.mixSourceOn('immich')
            : (prov === 'immich' || prov === 'mix');
        var showImmich = browseLive && immichOn;
        var immichBlock = $('bg-live-immich-block');
        if (immichBlock) {
            immichBlock.classList.toggle('hidden', !showImmich);
            var immichChips = $('bg-live-immich');
            immichChips.innerHTML = '';
            immichChips.appendChild(chip(
                window.LiveWallpaper ? LiveWallpaper.immichSummary() : 'Set share link',
                !!(window.LiveWallpaper && LiveWallpaper.immichConfigured()),
                { kind: 'immichLink' }
            ));
        }

        var shuffleBlock = $('bg-shuffle-block');
        if (shuffleBlock) {
            var showShuffle = showShuffleBlock(p);
            shuffleBlock.classList.toggle('hidden', !showShuffle);
            if (showShuffle) {
                var shuffleChips = $('bg-shuffle');
                shuffleChips.innerHTML = '';
                [[false, 'Off'], [true, 'On']].forEach(function (o) {
                    shuffleChips.appendChild(chip(o[1], !!p.random === o[0], { kind: 'random', value: o[0] }));
                });
                var shuffleNote = $('bg-shuffle-note');
                if (shuffleNote) shuffleNote.textContent = shuffleNoteFor(p);
            }
        }

        var poolBlock = $('bg-live-pool-block');
        if (poolBlock) {
            poolBlock.classList.toggle('hidden', !browseLive);
            var poolChips = $('bg-live-pool');
            poolChips.innerHTML = '';
            var pools = (window.LiveWallpaper && LiveWallpaper.LIVE_POOLS) || {
                small: { label: '8' },
                normal: { label: '20' },
                large: { label: '40' }
            };
            Object.keys(pools).forEach(function (key) {
                poolChips.appendChild(chip(pools[key].label, (p.livePool || 'normal') === key,
                    { kind: 'livePool', value: key }));
            });
        }

        var liveStatus = $('bg-live-status-block');
        if (liveStatus) {
            liveStatus.classList.toggle('hidden', !browseLive || !!(window.LiveWallpaper && LiveWallpaper.needsSetup()));
            var pool = live ? Wallpaper.list() : [];
            var cur = live ? Wallpaper.find(p.liveKey) : null;
            var src = window.LiveWallpaper ? LiveWallpaper.providerLabel() : 'Bing';
            var fetching = (window.LiveWallpaper && LiveWallpaper.status()) || 'Fetching ' + src + '…';
            $('bg-live-status').textContent = (cur || bgKeepLivePicker) ? '' : fetching;
            $('bg-live-cap').textContent = liveCapText(p, pool, src);
        }

        var photos = $('bg-photos');
        var photosBlock = $('bg-photos-block');
        var photosTitle = photosBlock && photosBlock.querySelector('h2');
        // Mix rotates across sources — no static picker grid.
        var showLiveThumbs = browseLive && prov !== 'mix' &&
            !(window.LiveWallpaper && LiveWallpaper.needsSetup());
        var showPhotoThumbs = p.mode === 'photo' && !bgKeepLivePicker;
        var gridMode = showLiveThumbs ? 'live' : (showPhotoThumbs ? 'photo' : '');

        function addThumb(w, kind, selected) {
            var t = el('div', 'thumb' + (selected ? ' on' : ''));
            var img = new Image();
            img.decoding = 'async';
            img.loading = 'lazy';
            img.src = w.thumb || w.file;
            img.onerror = function () {
                if (w.file && img.getAttribute('src') !== w.file) img.src = w.file;
            };
            t.appendChild(img);
            t.appendChild(el('div', 'thumb-title', w.title || ''));
            t._item = { kind: kind, key: w.key, entry: w };
            photos.appendChild(t);
        }

        var emptyNote = photosBlock && photosBlock.querySelector('.bg-photos-empty');
        if (emptyNote) emptyNote.parentNode.removeChild(emptyNote);

        // Rebuilding the grid aborts in-flight thumb loads — append-only while Live warms.
        if (gridMode !== bgPhotosGridMode) {
            photos.innerHTML = '';
            bgPhotosGridMode = gridMode;
            bgPhotosKeys = {};
        }

        var storageEl = $('bg-photos-storage');
        var pinMax = (window.Wallpaper && Wallpaper.PIN_MAX) || 20;
        var pinSum = pinStorageLabel();
        var pinCount = ((window.Wallpaper && Wallpaper.pinsList && Wallpaper.pinsList()) || []).length;

        if (showLiveThumbs) {
            if (photosTitle) {
                photosTitle.textContent = pinSum
                    ? 'Save (' + pinSum + ')'
                    : 'Save (up to ' + pinMax + ')';
            }
            if (storageEl) {
                storageEl.textContent = (pinCount
                    ? 'Saved ' + pinSum + '. '
                    : 'Up to ' + pinMax + ' saved locally. ') +
                    'OK → Use now (no save) or Save permanently.';
                storageEl.classList.remove('hidden');
            }
            var pool = (window.LiveWallpaper && LiveWallpaper.pickList)
                ? LiveWallpaper.pickList()
                : ((window.LiveWallpaper && LiveWallpaper.list()) || []);
            if (!pool.length && !Object.keys(bgPhotosKeys).length) {
                photosBlock.insertBefore(
                    el('p', 'setting-note muted bg-photos-empty',
                        'Photos appear after the first fetch'),
                    photos
                );
            } else {
                pool.forEach(function (w) {
                    if (bgPhotosKeys[w.key]) return;
                    bgPhotosKeys[w.key] = true;
                    addThumb(w, 'pinLive', false);
                });
                // Thumbs load lazily via <img loading=lazy>; rememberPick already warms a few.
            }
            var moreBlock = $('bg-photos-more');
            if (moreBlock) {
                // Always offer Load more while browsing Live (even before the first batch).
                moreBlock.classList.remove('hidden');
                moreBlock.innerHTML = '';
                moreBlock.appendChild(chip('Load more', false, { kind: 'pickMore' }));
            }
        } else if (showPhotoThumbs) {
            if (photosTitle) photosTitle.textContent = 'Photo';
            if (storageEl) {
                var hiddenN = Wallpaper.hiddenBundledCount ? Wallpaper.hiddenBundledCount() : 0;
                var note = 'OK selects. OK again on the current photo for options.';
                if (pinCount) note = 'Saved pins ' + pinSum + ' (local). ' + note;
                if (hiddenN) note += ' ' + hiddenN + ' shipped hidden (Atmosphere → Restore).';
                storageEl.textContent = note;
                storageEl.classList.remove('hidden');
            }
            var pins = (Wallpaper.pinsList && Wallpaper.pinsList()) || [];
            var visibleShip = (Wallpaper.bundledVisible && Wallpaper.bundledVisible()) ||
                Wallpaper.bundled();
            var temp = Wallpaper.tempPhotoEntry && Wallpaper.tempPhotoEntry();
            if (!Object.keys(bgPhotosKeys).length) {
                if (temp) {
                    bgPhotosKeys[temp.key] = true;
                    addThumb(temp, 'photoTemp', p.photo === temp.key);
                }
                pins.forEach(function (pin) {
                    if (bgPhotosKeys[pin.key]) return;
                    bgPhotosKeys[pin.key] = true;
                    addThumb(pin, 'photoPin', p.photo === pin.key);
                });
                visibleShip.forEach(function (w) {
                    if (bgPhotosKeys[w.key]) return;
                    bgPhotosKeys[w.key] = true;
                    addThumb(w, 'photoBundled', p.photo === w.key);
                });
            } else {
                UI.children(photos).forEach(function (t) {
                    if (!t._item) return;
                    var on = p.photo === t._item.key;
                    t.classList.toggle('on', on);
                });
            }
            var moreHide = $('bg-photos-more');
            if (moreHide) {
                moreHide.innerHTML = '';
                moreHide.classList.add('hidden');
            }
        } else {
            if (storageEl) {
                storageEl.textContent = '';
                storageEl.classList.add('hidden');
            }
            var moreOff = $('bg-photos-more');
            if (moreOff) moreOff.classList.add('hidden');
        }
        photosBlock.classList.toggle('hidden', !showLiveThumbs && !showPhotoThumbs);
    }

    function focusBgThumb(key) {
        var photos = $('bg-photos');
        if (!photos) {
            UI.refresh();
            return;
        }
        var nodes = UI.children(photos);
        var i;
        for (i = 0; i < nodes.length; i++) {
            if (nodes[i]._item && nodes[i]._item.key === key) {
                UI.focusOn(nodes[i]);
                return;
            }
        }
        UI.refresh();
    }

    function activateBackground(item) {
        var p = Prefs.get().wallpaper;
        if (item.kind === 'immichLink') {
            rename('', function (link) {
                if (window.LiveWallpaper) {
                    LiveWallpaper.setImmichLink(link);
                    LiveWallpaper.clearCache();
                }
                p.liveKey = '';
                Prefs.save();
                Wallpaper.ensureLive();
                renderBackground();
                UI.refresh();
            }, { title: 'Immich shared album link', maxLength: 200, allowEmpty: true });
            return;
        }
        if (item.kind === 'unsplashKey') {
            rename('', function (key) {
                if (window.LiveWallpaper) {
                    LiveWallpaper.setUnsplashKey(key);
                    LiveWallpaper.clearCache();
                }
                p.liveKey = '';
                Prefs.save();
                Wallpaper.ensureLive();
                renderBackground();
                UI.refresh();
            }, { title: 'Unsplash Access Key', maxLength: 64, password: true });
            return;
        }
        if (item.kind === 'unsplashCollection') {
            rename(window.LiveWallpaper ? LiveWallpaper.unsplashCollection() : '', function (id) {
                if (window.LiveWallpaper) {
                    LiveWallpaper.setUnsplashCollection(id);
                    LiveWallpaper.clearCache();
                }
                p.liveKey = '';
                Prefs.save();
                Wallpaper.ensureLive();
                renderBackground();
                UI.refresh();
            }, { title: 'Unsplash collection ID', maxLength: 64, allowEmpty: true });
            return;
        }
        if (item.kind === 'mode') {
            bgKeepLivePicker = false;
            p.mode = item.key;
            if (item.key === 'rotate' || item.key === 'live') p.lastChange = Date.now();
        } else if (item.kind === 'interval') {
            p.interval = item.key;
            p.lastChange = Date.now();
        } else if (item.kind === 'random') {
            p.random = !!item.value;
            // Rebuild plan; Shuffle On reshuffles Mix provider order.
            if (p.mode === 'live' && window.LiveWallpaper && LiveWallpaper.rebuildPlan) {
                LiveWallpaper.rebuildPlan();
            }
        } else if (item.kind === 'livePool') {
            if (p.livePool === item.value) return;
            p.livePool = item.value;
            Prefs.save();
            // Grow/trim toward the new ahead target; rebuild plan length.
            if (p.mode === 'live' && window.LiveWallpaper) {
                if (LiveWallpaper.rebuildPlan) LiveWallpaper.rebuildPlan();
                if (LiveWallpaper.warmForPicker && p.liveProvider !== 'mix' &&
                        !(LiveWallpaper.needsSetup && LiveWallpaper.needsSetup())) {
                    warmBgPicker();
                }
            }
            renderBackground();
            UI.refresh();
            return;
        } else if (item.kind === 'provider') {
            if (!window.LiveWallpaper || !LiveWallpaper.setMixSource) return;
            if (item.key === 'mix') return;
            var prevProv = p.liveProvider || 'bing';
            var wantOn = !LiveWallpaper.mixSourceOn(item.key);
            var nowOn = LiveWallpaper.setMixSource(item.key, wantOn);
            if (!wantOn && nowOn) {
                UI.toast('Keep at least one source on');
                renderBackground();
                UI.refresh();
                return;
            }
            var nextProv = LiveWallpaper.deriveLiveProvider
                ? LiveWallpaper.deriveLiveProvider()
                : item.key;
            p.liveProvider = nextProv;
            Prefs.save();
            if (nextProv !== prevProv) {
                p.liveKey = '';
                p.lastChange = Date.now();
                bgPhotosGridMode = '';
                bgPhotosKeys = {};
                Prefs.save();
                if (LiveWallpaper.switchProvider) LiveWallpaper.switchProvider();
                else if (LiveWallpaper.clearCache) LiveWallpaper.clearCache();
            } else if (nextProv === 'mix' && LiveWallpaper.rebuildPlan) {
                LiveWallpaper.rebuildPlan();
            }
            if (LiveWallpaper.needsSetup && LiveWallpaper.needsSetup()) {
                UI.toast(LiveWallpaper.status());
                renderBackground();
                UI.refresh();
                return;
            }
            // Fetch can take a couple of seconds — keep the busy ring up to 5 s, then show grid.
            if ((p.mode === 'live' || bgKeepLivePicker) &&
                    (nextProv !== prevProv || nextProv === 'mix')) {
                busyLiveProviderChange().then(function () {
                    renderBackground();
                    UI.refresh();
                }, function () {
                    renderBackground();
                    UI.refresh();
                });
                return;
            }
            renderBackground();
            UI.refresh();
            return;
        } else if (item.kind === 'pickMore') {
            if (!window.LiveWallpaper || !LiveWallpaper.loadMorePicks) return;
            UI.busy(LiveWallpaper.loadMorePicks()).then(function (n) {
                renderBackground();
                UI.refresh();
                if (!n) UI.toast('No more photos');
            }, function () {
                UI.toast('Could not load more');
            });
            return;
        } else if (item.kind === 'pinLive') {
            livePhotoMenu(item.entry ||
                (window.LiveWallpaper && LiveWallpaper.find(item.key)));
            return;
        } else if (item.kind === 'photoTemp') {
            // Already the current temporary photo → options only.
            if (p.photo !== item.key) {
                useLiveNow(item.entry || (Wallpaper.tempPhotoEntry && Wallpaper.tempPhotoEntry()));
                return;
            }
            UI.menu((item.entry && item.entry.title) || 'Temporary photo', [
                {
                    label: 'Save permanently', run: function () {
                        saveLivePermanent(item.entry || Wallpaper.tempPhotoEntry());
                    }
                },
                {
                    label: 'Discard', run: function () {
                        if (Wallpaper.clearTempPhoto) Wallpaper.clearTempPhoto();
                        var next = Prefs.get().wallpaper.photo;
                        if (next === item.key) {
                            var pins = (Wallpaper.pinsList && Wallpaper.pinsList()) || [];
                            var ship = (Wallpaper.bundledVisible && Wallpaper.bundledVisible()) ||
                                Wallpaper.bundled();
                            next = (pins[0] && pins[0].key) || (ship[0] && ship[0].key) || next;
                            Prefs.get().wallpaper.photo = next;
                            Prefs.save();
                            Wallpaper.apply();
                        }
                        UI.toast('Discarded');
                        afterPinChange(Prefs.get().wallpaper.photo);
                    }
                },
                { label: 'Cancel' }
            ]);
            return;
        } else if (item.kind === 'photoPin') {
            // First OK selects; OK again on the selected one opens remove menu.
            if (p.photo !== item.key) {
                usePhotoKey(item.key);
                return;
            }
            UI.menu((item.entry && item.entry.title) || 'Saved photo', [
                {
                    label: 'Remove', run: function () {
                        removeOnePin(item.key);
                    }
                },
                { label: 'Cancel' }
            ]);
            return;
        } else if (item.kind === 'photoBundled') {
            if (p.photo !== item.key) {
                usePhotoKey(item.key);
                return;
            }
            UI.menu((item.entry && item.entry.title) || 'Bundled photo', [
                {
                    label: 'Remove', run: function () {
                        hideOneBundled(item.key);
                    }
                },
                { label: 'Cancel' }
            ]);
            return;
        } else if (item.kind === 'photo') {
            usePhotoKey(item.key);
            return;
        }
        Prefs.save();
        Wallpaper.apply();
        if (p.mode === 'live') Wallpaper.ensureLive();
        renderBackground();
        UI.refresh();
        if (item.kind === 'mode' && item.key === 'live' &&
                Prefs.get().wallpaper.liveProvider !== 'mix' &&
                !(window.LiveWallpaper && LiveWallpaper.needsSetup())) {
            warmBgPicker();
        }
    }

    // ---------- Appearance (Clock vs Look)

    // Same view, two entry points: Atmosphere → Clock; Advanced → Appearance (font / names).
    var appearanceSection = 'clock';

    function appearanceBlocks() {
        var clock = [
            { title: 'Clock', key: 'clock', options: [['24h', '24-hour'], ['12h', '12-hour']] },
            { title: 'Date', key: 'showDate', options: [[true, 'Show'], [false, 'Hide']] },
            { title: 'Date language', key: 'locale', options: Appearance.LOCALES.map(function (l) { return [l.key, l.label]; }) }
        ];
        var look = [
            { title: 'Font', key: 'font', options: Appearance.FONTS.map(function (f) { return [f.key, f.label, f.family]; }) },
            { title: 'App names', key: 'names', options: [['always', 'Always'], ['focused', 'When selected'], ['never', 'Never']] },
            {
                title: 'Focus',
                key: 'focus',
                options: [['both', 'Both'], ['scale', 'Scale'], ['ring', 'Ring']]
            },
            {
                title: 'Tiles',
                key: 'tiles',
                options: [['comfortable', 'Comfortable'], ['compact', 'Compact']]
            }
        ];
        if (appearanceSection === 'look') return look;
        return clock;
    }

    function setAppearanceTitle() {
        var h = $('appearance') && $('appearance').querySelector('.page-head h1');
        if (h) h.textContent = appearanceSection === 'look' ? 'Appearance' : 'Clock';
    }

    function openClock() {
        appearanceSection = 'clock';
        setAppearanceTitle();
        UI.show('appearance');
    }

    function openLook() {
        appearanceSection = 'look';
        setAppearanceTitle();
        UI.show('appearance');
    }

    function renderAppearance() {
        setAppearanceTitle();
        var p = Prefs.get().appearance;
        var body = $('appearance-body');
        body.innerHTML = '';
        appearanceBlocks().forEach(function (b) {
            var block = el('div', 'setting-block');
            block.appendChild(el('h2', '', b.title));
            var chips = el('div', 'chips');
            b.options.forEach(function (o) {
                var c = chip(o[1], p[b.key] === o[0], { key: b.key, value: o[0] });
                if (o[2]) c.style.fontFamily = o[2];
                chips.appendChild(c);
            });
            block.appendChild(chips);
            body.appendChild(block);
        });
    }

    function activateAppearance(item) {
        Prefs.get().appearance[item.key] = item.value;
        Prefs.save();
        Appearance.apply();
        Home.updateClock();
        renderAppearance();
        UI.refresh();
    }

    // ---------- Navigation sound

    function renderSound() {
        var p = Prefs.get().sound;
        var body = $('sound-body');
        body.innerHTML = '';

        var enabledBlock = el('div', 'setting-block');
        enabledBlock.appendChild(el('h2', '', 'Sound'));
        var enabledChips = el('div', 'chips');
        enabledChips.appendChild(chip('On', p.enabled, { kind: 'enabled', value: true }));
        enabledChips.appendChild(chip('Off', !p.enabled, { kind: 'enabled', value: false }));
        enabledBlock.appendChild(enabledChips);
        body.appendChild(enabledBlock);

        var presetBlock = el('div', 'setting-block');
        presetBlock.appendChild(el('h2', '', 'Style'));
        var presetChips = el('div', 'chips');
        Sound.presetOptions().forEach(function (preset) {
            presetChips.appendChild(chip(preset.label, p.preset === preset.key,
                { kind: 'preset', value: preset.key }));
        });
        presetBlock.appendChild(presetChips);
        body.appendChild(presetBlock);

        var volumeBlock = el('div', 'setting-block');
        volumeBlock.appendChild(el('h2', '', 'Volume'));
        var volumeChips = el('div', 'chips');
        Sound.volumeOptions().forEach(function (vol) {
            volumeChips.appendChild(chip(vol.label, (p.volume || 'normal') === vol.key,
                { kind: 'volume', value: vol.key }));
        });
        volumeBlock.appendChild(volumeChips);
        body.appendChild(volumeBlock);

        var previewBlock = el('div', 'setting-block');
        previewBlock.appendChild(el('h2', '', 'Try it'));
        var previewChips = el('div', 'chips');
        previewChips.appendChild(chip('Preview selected sound', false, { kind: 'preview' }));
        previewBlock.appendChild(previewChips);
        body.appendChild(previewBlock);
    }

    function activateSound(item) {
        var p = Prefs.get().sound;
        if (item.kind === 'enabled') {
            p.enabled = item.value;
            Prefs.save();
            renderSound();
            UI.refresh();
            if (p.enabled) Sound.preview();
            return;
        }
        if (item.kind === 'preset') {
            p.preset = item.value;
            Prefs.save();
            renderSound();
            UI.refresh();
            Sound.preview();
            return;
        }
        if (item.kind === 'volume') {
            p.volume = item.value;
            Prefs.save();
            renderSound();
            UI.refresh();
            Sound.preview();
            return;
        }
        if (item.kind === 'preview') Sound.preview();
    }

    // ---------- Music (Subsonic ambient)

    function maskSecret(value) {
        if (!value) return 'Set password';
        return 'Password set';
    }

    function renderMusic() {
        var p = Prefs.get().music;
        var c = Subsonic.cfg();
        var body = $('music-body');
        body.innerHTML = '';

        var status = el('p', 'setting-note', Music.statusText());
        body.appendChild(status);

        var onBlock = el('div', 'setting-block');
        onBlock.appendChild(el('h2', '', 'Music'));
        var onChips = el('div', 'chips');
        onChips.appendChild(chip('On', p.enabled, { kind: 'enabled', value: true }));
        onChips.appendChild(chip('Off', !p.enabled, { kind: 'enabled', value: false }));
        onBlock.appendChild(onChips);
        body.appendChild(onBlock);

        var serverBlock = el('div', 'setting-block');
        serverBlock.appendChild(el('h2', '', 'Server'));
        var serverChips = el('div', 'chips wrap');
        serverChips.appendChild(chip(c.baseUrl || 'Set server URL', !!c.baseUrl, { kind: 'server' }));
        serverChips.appendChild(chip(c.user || 'Set username', !!c.user, { kind: 'user' }));
        serverChips.appendChild(chip(maskSecret(c.password), !!c.password, { kind: 'password' }));
        serverChips.appendChild(chip('Test connection', false, { kind: 'test' }));
        serverBlock.appendChild(serverChips);
        body.appendChild(serverBlock);
        body.appendChild(el('p', 'setting-note muted', Subsonic.summary()));

        var srcBlock = el('div', 'setting-block');
        srcBlock.appendChild(el('h2', '', 'Source'));
        var srcChips = el('div', 'chips wrap');
        var onPlaylist = p.source === 'playlist' && !!p.playlistId;
        srcChips.appendChild(chip('Random', !onPlaylist, { kind: 'source', value: 'random' }));
        srcChips.appendChild(chip(
            onPlaylist ? (p.playlistName || 'Playlist') : 'Playlist…',
            onPlaylist,
            { kind: 'source', value: 'playlist' }
        ));
        srcBlock.appendChild(srcChips);
        body.appendChild(srcBlock);

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

        body.appendChild(el('p', 'setting-note muted',
            'Plays while this launcher is open. Pauses when you open another app. Saved on the TV — no rebuild needed.'));
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

    function activateMusic(item) {
        var c = Subsonic.cfg();
        if (item.kind === 'server') {
            rename(c.baseUrl || 'http://', function (url) {
                Subsonic.setCreds({ baseUrl: url });
                Music.clearQueue();
                Music.pause();
                Music.renderBar();
                renderMusic();
                UI.refresh();
            }, { title: 'Server URL', maxLength: 120 });
            return;
        }
        if (item.kind === 'user') {
            rename(c.user || '', function (user) {
                Subsonic.setCreds({ user: user });
                Music.clearQueue();
                Music.pause();
                Music.renderBar();
                renderMusic();
                UI.refresh();
            }, { title: 'Username', maxLength: 64 });
            return;
        }
        if (item.kind === 'password') {
            rename('', function (password) {
                Subsonic.setCreds({ password: password });
                Music.clearQueue();
                Music.pause();
                Music.renderBar();
                renderMusic();
                UI.refresh();
            }, { title: 'Password', maxLength: 64, password: true });
            return;
        }
        if (item.kind === 'test') {
            if (!Subsonic.configured()) {
                UI.toast('Set server, user and password first');
                return;
            }
            UI.busy(Subsonic.ping()).then(function () {
                UI.toast('Connected');
                renderMusic();
                UI.refresh();
            }).catch(function (e) {
                UI.toast('Failed: ' + ((e && e.message) || 'error'));
                renderMusic();
                UI.refresh();
            });
            return;
        }
        if (item.kind === 'source') {
            if (item.value === 'playlist') {
                pickMusicPlaylist();
                return;
            }
            Music.setSource('random');
            UI.toast('Music: Random');
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
        renderMusic();
        UI.refresh();
    }

    // ---------- Weather

    var weatherBusy = false;

    function applyWeatherPlace(resolved) {
        var p = Prefs.get().weather;
        p.place = resolved.place;
        p.latitude = resolved.latitude;
        p.longitude = resolved.longitude;
        p.label = resolved.label;
        Prefs.save();
        Weather.applySettings();
        renderWeather();
        UI.refresh();
    }

    function renderWeather() {
        var p = Prefs.get().weather;
        var body = $('weather-body');
        body.innerHTML = '';
        var auto = p.place === 'auto';
        var custom = p.place === 'custom' && Weather.configured();
        var label = Weather.placeLabel();

        var placeBlock = el('div', 'setting-block');
        placeBlock.appendChild(el('h2', '', 'Place'));
        var placeChips = el('div', 'chips wrap');
        placeChips.appendChild(chip('Off', p.place === 'off', { kind: 'place', value: 'off' }));
        placeChips.appendChild(chip(
            auto && label ? ('Auto · ' + label) : 'Automatic',
            auto,
            { kind: 'place', value: 'auto' }
        ));
        if (custom) {
            placeChips.appendChild(chip(label || 'Custom', true, { kind: 'place', value: 'current' }));
        }
        placeChips.appendChild(chip('Search city…', false, { kind: 'search' }));
        placeBlock.appendChild(placeChips);
        body.appendChild(placeBlock);

        var unitBlock = el('div', 'setting-block');
        unitBlock.appendChild(el('h2', '', 'Unit'));
        var unitChips = el('div', 'chips');
        unitChips.appendChild(chip('Celsius', p.unit === 'celsius', { kind: 'unit', value: 'celsius' }));
        unitChips.appendChild(chip('Fahrenheit', p.unit === 'fahrenheit', { kind: 'unit', value: 'fahrenheit' }));
        unitBlock.appendChild(unitChips);
        body.appendChild(unitBlock);

        var note = el('p', 'setting-note muted',
            'Shown on Home and the screen saver. Automatic uses approximate IP location (Open-Meteo).');
        body.appendChild(note);
    }

    function activateWeather(item) {
        var p = Prefs.get().weather;
        if (item.kind === 'search') {
            rename('', function (query) {
                if (weatherBusy) return;
                weatherBusy = true;
                UI.busyShow();
                Weather.searchPlaces(query, function (err, results) {
                    weatherBusy = false;
                    UI.busyHide();
                    if (err) {
                        UI.toast('Search failed');
                        DevLog.log('Weather search failed: ' + err);
                        return;
                    }
                    if (!results || !results.length) {
                        UI.toast('No cities found');
                        return;
                    }
                    UI.menu('Cities', results.map(function (r) {
                        return {
                            label: r.label,
                            run: function () {
                                applyWeatherPlace(
                                    Weather.resolvePlace(r.latitude, r.longitude, r.label)
                                );
                                UI.toast('Weather: ' + Weather.summary());
                            }
                        };
                    }).concat([{ label: 'Cancel' }]));
                });
            }, { title: 'City name', maxLength: 64 });
            return;
        }
        if (item.kind === 'place') {
            if (item.value === 'current') return;
            if (item.value === 'auto') {
                if (weatherBusy) return;
                p.place = 'auto';
                p.latitude = null;
                p.longitude = null;
                p.label = null;
                Prefs.save();
                Weather.applySettings();
                weatherBusy = true;
                UI.busyShow();
                Weather.detectLocation(function (err, loc) {
                    weatherBusy = false;
                    UI.busyHide();
                    if (err || !loc) {
                        UI.toast('Could not find location');
                        DevLog.log('Weather detect failed: ' + (err || 'unknown'));
                        renderWeather();
                        UI.refresh();
                        return;
                    }
                    Weather.applyDetected(loc);
                    renderWeather();
                    UI.refresh();
                    UI.toast('Weather: ' + Weather.summary());
                });
                return;
            }
            if (item.value !== 'off') return;
            p.place = 'off';
            p.latitude = null;
            p.longitude = null;
            p.label = null;
        } else if (item.kind === 'unit') {
            p.unit = item.value;
        } else {
            return;
        }
        Prefs.save();
        Weather.applySettings();
        renderWeather();
        UI.refresh();
    }

    // ---------- Screen saver

    /*
     * "Change photo" only means something while the Background is on Rotate or Live: with a
     * single photo the screen saver holds it, exactly as Home does.
     */
    function screensaverBlocks() {
        var mode = Prefs.get().wallpaper.mode;
        var blocks = [
            { title: 'Screen saver', key: 'enabled', options: [[true, 'On'], [false, 'Off']] },
            { title: 'Start after', key: 'delay', options: optionPairs(Screensaver.DELAYS) }
        ];
        if (mode === 'rotate' || mode === 'live') {
            blocks.push({ title: 'Change photo every', key: 'photoEvery', options: optionPairs(Screensaver.PHOTO_EVERY) });
        }
        blocks.push({ title: 'Go dark after', key: 'dark', options: optionPairs(Screensaver.DARK_AFTER) });
        blocks.push({ title: 'Drift', key: 'pan', options: [[true, 'On'], [false, 'Off']] });
        if (Prefs.get().screensaver.pan !== false) {
            blocks.push({ title: 'Drift speed', key: 'panSpeed', options: optionPairs(Screensaver.PAN_SPEEDS) });
        }
        blocks.push({ title: 'Blur fill', key: 'blur', options: [[true, 'On'], [false, 'Off']] });
        return blocks;
    }

    function optionPairs(list) {
        return list.map(function (o) { return [o.key, o.label]; });
    }

    function renderScreensaver() {
        var p = Prefs.get().screensaver;
        var body = $('screensaver-body');
        body.innerHTML = '';
        screensaverBlocks().forEach(function (b) {
            var block = el('div', 'setting-block');
            block.appendChild(el('h2', '', b.title));
            var chips = el('div', 'chips');
            b.options.forEach(function (o) {
                chips.appendChild(chip(o[1], p[b.key] === o[0], { key: b.key, value: o[0] }));
            });
            block.appendChild(chips);
            body.appendChild(block);
        });

        var tryBlock = el('div', 'setting-block');
        tryBlock.appendChild(el('h2', '', 'Try it'));
        var tryChips = el('div', 'chips');
        tryChips.appendChild(chip('Show it now', false, { kind: 'preview' }));
        tryBlock.appendChild(tryChips);
        body.appendChild(tryBlock);
    }

    function activateScreensaver(item) {
        if (item.kind === 'preview') {
            Screensaver.open();
            return;
        }
        Prefs.get().screensaver[item.key] = item.value;
        Prefs.save();
        // Otherwise a countdown that began before the change could fire straight away.
        Screensaver.poke();
        renderScreensaver();
        UI.refresh();
    }

    // ---------- Apps on Home editor (two columns, custom navigation)

    var ed = { col: 0, idx: [0, 0], moving: -1, snapshot: null, items: [], others: [] };

    function edLoad() {
        ed.items = Home.homeItems().slice();
        var onHome = {};
        ed.items.forEach(function (i) { onHome[i.id] = true; });
        ed.others = Apps.allSorted(Home.apps(), false).filter(function (a) { return !onHome[a.id]; });
        // Built-in tile: re-addable when removed from Home.
        if (!onHome['arn0:tvsettings']) {
            ed.others.unshift(Apps.tvSettingsItem());
        }
    }

    function edRow(item, moving) {
        var row = el('div', 'ed-item' + (moving ? ' moving' : ''));
        row.appendChild(Home.miniTile(item));
        row.appendChild(el('span', 'ed-label', item.label));
        if (moving) row.appendChild(el('span', 'ed-move', '↕'));
        return row;
    }

    function edRender() {
        var home = $('ed-home');
        home.innerHTML = '';
        ed.items.forEach(function (item, i) { home.appendChild(edRow(item, i === ed.moving)); });
        var other = $('ed-other');
        other.innerHTML = '';
        ed.others.forEach(function (item) { other.appendChild(edRow(item, false)); });
        $('ed-home-title').textContent = 'On Home · ' + ed.items.length;
        $('ed-other-title').textContent = 'Add apps · ' + ed.others.length;
        if (!ed.others.length) ed.col = 0;
    }

    function edFocusEl() {
        var list = [$('ed-home'), $('ed-other')][ed.col];
        if (!list.children.length) return null;
        ed.idx[ed.col] = UI.clamp(ed.idx[ed.col], 0, list.children.length - 1);
        return list.children[ed.idx[ed.col]];
    }

    function edSave() {
        Home.setHomeItems(ed.items);
        edLoad();
    }

    /*
     * Focus plus hints, but the hint bar is only rebuilt when its content would actually differ.
     * Arrowing through the list is the hot path on this screen and should not churn the DOM.
     */
    function edRefresh() {
        var sig = ed.col + '/' + (ed.moving >= 0);
        if (sig !== ed.hintSig) {
            ed.hintSig = sig;
            UI.refreshHints();
        }
        UI.refresh();
    }

    function edKey(k) {
        var moving = ed.moving >= 0;
        if (k === KEY.UP || k === KEY.DOWN) {
            var d = k === KEY.UP ? -1 : 1;
            if (moving) {
                var to = ed.moving + d;
                if (to < 0 || to >= ed.items.length) return true;
                var tmp = ed.items[to];
                ed.items[to] = ed.items[ed.moving];
                ed.items[ed.moving] = tmp;
                ed.moving = to;
                ed.idx[0] = to;
                edRender();
            } else {
                ed.idx[ed.col] += d;
            }
            edRefresh();
            return true;
        }
        if (k === KEY.LEFT || k === KEY.RIGHT) {
            if (!moving) {
                var col = k === KEY.LEFT ? 0 : 1;
                if ([$('ed-home'), $('ed-other')][col].children.length) ed.col = col;
                edRefresh();
            }
            return true;
        }
        if (k === KEY.ENTER) {
            if (ed.col === 0) {
                if (moving) {
                    ed.moving = -1;
                    ed.snapshot = null;
                    edSave();
                    edRender();
                } else {
                    edMenu();
                }
            } else if (ed.others.length) {
                var added = ed.others[ed.idx[1]];
                ed.items.push(added);
                edSave();
                edRender();
                UI.toast('Added ' + added.label + ' to Home');
            }
            edRefresh();
            return true;
        }
        return false;
    }

    function edMenu() {
        var i = ed.idx[0];
        var item = ed.items[i];
        if (!item) return;
        UI.menu(item.label, [
            {
                label: 'Move', run: function () {
                    ed.moving = i;
                    ed.snapshot = ed.items.slice();
                    edRender();
                    UI.refresh();
                }
            },
            {
                label: 'Remove from Home', run: function () {
                    if (ed.items.length <= 1) {
                        UI.toast('Home needs at least one app');
                        return;
                    }
                    ed.items.splice(i, 1);
                    edSave();
                    edRender();
                    UI.refresh();
                }
            },
            { label: 'Cancel' }
        ]);
    }

    function edBack() {
        if (ed.moving < 0) return false;
        ed.items = ed.snapshot;
        ed.moving = -1;
        ed.snapshot = null;
        edRender();
        UI.refresh();
        return true;
    }

    // ---------- Consoles

    var renderConsoles = null;
    var renderAtmosphere = null;

    function methodOf(input) {
        var key = input.method || window.LAUNCHER_CONFIG.inputMethod;
        return METHODS.find(function (m) { return m.key === key; }) || METHODS[0];
    }

    function logoOf(input) {
        return LOGOS.find(function (l) { return l.key === (input.brand || ''); }) || LOGOS[3];
    }

    function consoleEntries() {
        var entries = Home.inputs().map(function (input, i) {
            return {
                label: input.label,
                value: input.hidden ? 'Hidden' : 'HDMI ' + input.hdmi + ' · ' + methodOf(input).label,
                mini: Home.miniInputTile(input),
                run: function () { consoleMenu(i); }
            };
        });
        entries.push({ label: '+ Add a console', value: '', run: addConsole });
        return entries;
    }

    function editInputs(change) {
        var list = Home.inputs().map(function (i) { return Object.assign({}, i); });
        change(list);
        Home.setInputs(list);
        renderConsoles();
        UI.refresh();
    }

    function consoleMenu(i) {
        var c = Home.inputs()[i];
        var count = Home.inputs().length;
        var status = Home.hdmiStatus();
        var options = [
            {
                label: 'Rename', run: function () {
                    rename(c.label, function (name) { editInputs(function (l) { l[i].label = name; }); });
                }
            },
            {
                label: 'HDMI port · HDMI ' + c.hdmi, run: function () {
                    UI.menu('HDMI port', [1, 2, 3, 4].map(function (n) {
                        return {
                            label: 'HDMI ' + n + (status[n] ? ' · connected' : ''),
                            checked: n === c.hdmi,
                            run: function () { editInputs(function (l) { l[i].hdmi = n; }); }
                        };
                    }));
                }
            },
            {
                label: 'Logo · ' + logoOf(c).label, run: function () {
                    UI.menu('Logo', LOGOS.map(function (logo) {
                        return {
                            label: logo.label,
                            checked: logo.key === (c.brand || ''),
                            run: function () { editInputs(function (l) { l[i].brand = logo.key; }); }
                        };
                    }));
                }
            },
            {
                label: 'Opens · ' + methodOf(c).label, run: function () {
                    UI.menu('Opens', METHODS.map(function (m) {
                        return {
                            label: m.label + ' · ' + m.hint,
                            checked: m.key === methodOf(c).key,
                            run: function () { editInputs(function (l) { l[i].method = m.key; }); }
                        };
                    }));
                }
            },
            {
                label: c.hidden ? 'Show on Home' : 'Hide from Home',
                run: function () { editInputs(function (l) { l[i].hidden = !c.hidden; }); }
            }
        ];
        if (i > 0) {
            options.push({ label: 'Move earlier', run: function () { editInputs(function (l) { l.splice(i - 1, 0, l.splice(i, 1)[0]); }); } });
        }
        if (i < count - 1) {
            options.push({ label: 'Move later', run: function () { editInputs(function (l) { l.splice(i + 1, 0, l.splice(i, 1)[0]); }); } });
        }
        options.push({
            label: 'Remove', run: function () {
                UI.menu('Remove ' + c.label + '?', [
                    { label: 'Remove', run: function () { editInputs(function (l) { l.splice(i, 1); }); } },
                    { label: 'Cancel' }
                ]);
            }
        });
        options.push({ label: 'Cancel' });
        UI.menu(c.label, options);
    }

    function addConsole() {
        var used = {};
        Home.inputs().forEach(function (i) { used[i.hdmi] = true; });
        var port = [1, 2, 3, 4].find(function (n) { return !used[n]; }) || 1;
        editInputs(function (l) { l.push({ hdmi: port, label: 'Console', brand: '' }); });
        var index = Home.inputs().length - 1;
        rename('Console', function (name) { editInputs(function (l) { l[index].label = name; }); });
    }

    // ---------- Rename dialog (uses Samsung's on-screen keyboard)

    var renameDone = null;
    var renameAllowEmpty = false;

    function rename(current, done, opts) {
        opts = opts || {};
        renameDone = done;
        renameAllowEmpty = !!opts.allowEmpty;
        var title = $('rename-title');
        if (title) title.textContent = opts.title || 'Name';
        var input = $('rename-input');
        input.value = current || '';
        input.maxLength = opts.maxLength || 28;
        // Keep type=text: Samsung's IME often returns an empty value for type=password.
        // Mask with CSS instead (Unsplash key + Music password).
        input.type = 'text';
        input.classList.toggle('secret', !!opts.password);
        input.setAttribute('autocomplete', opts.password ? 'off' : 'off');
        UI.show('rename');
    }

    function closeRename(save) {
        var input = $('rename-input');
        var value = input.value.trim();
        var done = renameDone;
        renameDone = null;
        var allowEmpty = renameAllowEmpty;
        renameAllowEmpty = false;
        input.blur();
        input.type = 'text';
        input.classList.remove('secret');
        input.maxLength = 28;
        var title = $('rename-title');
        if (title) title.textContent = 'Name';
        UI.back();
        if (save && (value || allowEmpty) && done) done(value);
    }

    // ---------- Advanced

    function advancedEntries() {
        var entries = [
            { label: 'Clock', run: openClock },
            { label: 'Weather', run: function () { UI.show('weather-settings'); } },
            { label: 'Appearance', run: openLook },
            { label: 'Navigation sound', run: function () { UI.show('sound-settings'); } },
            {
                label: 'Refresh app list', run: function () {
                    UI.busy(Home.reloadApps()).then(function () {
                        UI.toast('App list refreshed');
                    });
                }
            }
        ];
        if (window.LAUNCHER_CONFIG.devLogUrl) {
            entries.push({
                label: 'Export settings', run: function () {
                    DevLog.log('Settings export', Prefs.get());
                    UI.toast('Settings sent to the Mac log');
                }
            });
        }
        entries.push({
            label: 'Reset all settings', run: function () {
                UI.menu('Reset all settings?', [
                    {
                        label: 'Reset', run: function () {
                            Prefs.reset();
                            location.reload();
                        }
                    },
                    { label: 'Cancel' }
                ]);
            }
        });
        entries.push({ label: 'Lab', run: function () { UI.show('lab'); } });
        return entries;
    }

    // ---------- Registration

    function init() {
        registerList('settings', overviewEntries,
            [['OK', 'Open'], ['Back', 'Home']]);
        registerList('settings-home', homeGroupEntries, [['OK', 'Open'], ['Back', 'Settings']]);
        renderAtmosphere = registerList('settings-atmosphere', atmosphereGroupEntries,
            [['OK', 'Open'], ['Back', 'Settings']]);
        registerList('settings-samsung', samsungGroupEntries, [['OK', 'Open'], ['Back', 'Settings']]);
        registerList('advanced', advancedEntries, [['OK', 'Run'], ['Back', 'Settings']]);
        renderConsoles = registerList('consoles', consoleEntries,
            [['OK', 'Options'], ['Back', 'Settings']]);

        if (window.LiveWallpaper) {
            LiveWallpaper.onChange(function () {
                if (UI.current() !== 'bg') return;
                // Debounce: warm notifies often. Soft path when chips would not change.
                if (bgLiveRefreshTimer) clearTimeout(bgLiveRefreshTimer);
                bgLiveRefreshTimer = setTimeout(function () {
                    bgLiveRefreshTimer = null;
                    var p = Prefs.get().wallpaper;
                    var sig = bgLiveSoftSig(p);
                    if (sig === bgSoftSig) {
                        renderBackgroundLiveDelta();
                        return;
                    }
                    renderBackground();
                    UI.refresh();
                }, 350);
            });
        }
        UI.register('bg', {
            el: $('bg-settings'),
            rows: function () { return chipRows($('bg-body')); },
            onShow: function () {
                renderBackground();
                var wp = Prefs.get().wallpaper;
                if (wp.mode === 'live' && wp.liveProvider !== 'mix') warmBgPicker();
            },
            activate: activateBackground,
            onFocus: function () { UI.refreshHints(); },
            hints: function () {
                var focus = document.querySelector('#bg-settings .focused');
                var item = focus && focus._item;
                if (item && item.kind === 'pinLive') {
                    return [['OK', 'Use now / Save'], ['Back', 'Settings']];
                }
                if (item && (item.kind === 'photoPin' || item.kind === 'photoBundled' ||
                        item.kind === 'photoTemp')) {
                    var cur = Prefs.get().wallpaper.photo;
                    if (item.key === cur) {
                        return [['OK', 'Options'], ['Back', 'Settings']];
                    }
                }
                return [['OK', 'Select'], ['Back', 'Settings']];
            }
        });

        UI.register('appearance', {
            el: $('appearance'),
            rows: function () { return chipRows($('appearance-body')); },
            onShow: renderAppearance,
            activate: activateAppearance,
            hints: [['OK', 'Select'], ['Back', 'Settings']]
        });

        UI.register('sound-settings', {
            el: $('sound-settings'),
            rows: function () { return chipRows($('sound-body')); },
            onShow: renderSound,
            activate: activateSound,
            hints: [['OK', 'Select / Preview'], ['Back', 'Settings']]
        });

        UI.register('screensaver-settings', {
            el: $('screensaver-settings'),
            rows: function () { return chipRows($('screensaver-body')); },
            onShow: renderScreensaver,
            activate: activateScreensaver,
            hints: [['OK', 'Select'], ['Back', 'Settings']]
        });

        UI.register('weather-settings', {
            el: $('weather-settings'),
            rows: function () { return chipRows($('weather-body')); },
            onShow: renderWeather,
            activate: activateWeather,
            hints: [['OK', 'Select'], ['Back', 'Settings']]
        });

        UI.register('music-settings', {
            el: $('music-settings'),
            rows: function () { return chipRows($('music-body')); },
            onShow: renderMusic,
            activate: activateMusic,
            hints: [['OK', 'Select'], ['Back', 'Settings']]
        });

        if (window.Music) {
            Music.onUpdate(function () {
                if (UI.isVisible && UI.isVisible('music-settings')) {
                    renderMusic();
                    UI.refresh();
                }
            });
        }

        UI.register('homeapps', {
            el: $('homeapps'),
            onShow: function (opts) {
                if (!opts.back) {
                    ed.col = 0;
                    ed.idx = [0, 0];
                    ed.moving = -1;
                }
                edLoad();
                edRender();
            },
            focusEl: edFocusEl,
            onKey: edKey,
            onBack: edBack,
            hints: function () {
                if (ed.moving >= 0) {
                    return [['▲ ▼', 'Reorder'], ['OK', 'Drop here'], ['Back', 'Cancel']];
                }
                return [
                    ['OK', ed.col === 0 ? 'Options' : 'Add to Home'],
                    ['◀ ▶', 'Switch column'],
                    ['Back', 'Settings']
                ];
            }
        });

        UI.register('rename', {
            el: $('rename'),
            overlay: true,
            focusEl: function () { return $('rename-input'); },
            hints: [['OK', 'Save'], ['Back', 'Cancel']],
            onShow: function () {
                setTimeout(function () {
                    var input = $('rename-input');
                    input.focus();
                    input.setSelectionRange(input.value.length, input.value.length);
                }, 0);
            },
            onKey: function (k) {
                if (k === KEY.ENTER || k === IME_DONE) {
                    closeRename(true);
                    return true;
                }
                if (k === KEY.BACK || k === KEY.ESC || k === IME_CANCEL) {
                    closeRename(false);
                    return true;
                }
                return 'pass';
            }
        });

        Home.onAppsChanged(function () {
            if (UI.isVisible('homeapps') && ed.moving < 0) {
                edLoad();
                edRender();
                UI.refresh();
            }
        });
    }

    window.Settings = { init: init };
})();
