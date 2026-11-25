/*
 * Settings → Background page (photo, live wallpaper and pins). Entry points are exposed on
 * window.SettingsBackground and wired up by settings.js.
 */
(function () {
    'use strict';

    var warmBgPicker = SettingsBackgroundLive.warmBgPicker;
    var busyLiveProviderChange = SettingsBackgroundLive.busyLiveProviderChange;
    var bgLiveSoftSig = SettingsBackgroundLive.bgLiveSoftSig;
    var liveCapText = SettingsBackgroundLive.liveCapText;
    var shuffleNoteFor = SettingsBackgroundLive.shuffleNoteFor;
    var showShuffleBlock = SettingsBackgroundLive.showShuffleBlock;

    var pinStorageLabel = SettingsBackgroundPins.pinStorageLabel;
    var afterPinChange = SettingsBackgroundPins.afterPinChange;
    var removeOnePin = SettingsBackgroundPins.removeOnePin;
    var hideOneBundled = SettingsBackgroundPins.hideOneBundled;
    var restoreBundledPhotos = SettingsBackgroundPins.restoreBundledPhotos;
    var usePhotoKey = SettingsBackgroundPins.usePhotoKey;
    var useLiveNow = SettingsBackgroundPins.useLiveNow;
    var saveLivePermanent = SettingsBackgroundPins.saveLivePermanent;
    var livePhotoMenu = SettingsBackgroundPins.livePhotoMenu;
    var clearSavedPins = SettingsBackgroundPins.clearSavedPins;

    var $ = UI.$;
    var el = UI.el;
    var chip = SettingsCore.chip;

    // ---------- Background

    // Page state shared with the other settings-background-*.js files (see SettingsCore.bgState).
    var bgState = SettingsCore.bgState;

    function redrawBackground() {
        SettingsCore.withFocusRestore($('bg-body'), renderBackground);
    }

    // Append-only thumbs + status — used when Live notifies during warm (chips unchanged).
    // Live status line and caption; shared by the full render and the live-only refresh.
    function renderLiveStatus(p, live, browseLive) {
        var liveStatus = $('bg-live-status-block');
        if (liveStatus) {
            liveStatus.classList.toggle('hidden', !browseLive || !!(window.LiveWallpaper && LiveWallpaper.needsSetup()));
            var pool = live ? Wallpaper.list() : [];
            var cur = live ? Wallpaper.find(p.liveKey) : null;
            var src = window.LiveWallpaper ? LiveWallpaper.providerLabel() : 'Bing';
            var fetching = (window.LiveWallpaper && LiveWallpaper.status()) || 'Fetching ' + src + '…';
            $('bg-live-status').textContent = (cur || bgState.keepLivePicker) ? '' : fetching;
            $('bg-live-cap').textContent = liveCapText(p, pool, src);
        }
    }

    function makeThumb(w, kind, selected) {
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
        return t;
    }

    function renderBackgroundLiveDelta() {
        var p = Prefs.get().wallpaper;
        var live = p.mode === 'live';
        var browseLive = live || bgState.keepLivePicker;
        var prov = p.liveProvider || 'bing';
        renderLiveStatus(p, live, browseLive);
        var showLiveThumbs = browseLive && prov !== 'mix' &&
            !(window.LiveWallpaper && LiveWallpaper.needsSetup());
        if (!showLiveThumbs) return;
        var photos = $('bg-photos');
        var photosBlock = $('bg-photos-block');
        if (!photos || !photosBlock) return;
        if (bgState.gridMode !== 'live') return;
        var list = (window.LiveWallpaper && LiveWallpaper.pickList)
            ? LiveWallpaper.pickList()
            : [];
        list.forEach(function (w) {
            if (bgState.photosKeys[w.key]) return;
            bgState.photosKeys[w.key] = true;
            photos.appendChild(makeThumb(w, 'pinLive', false));
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
        var browseLive = live || bgState.keepLivePicker;
        var cycle = live;
        bgState.softSig = bgLiveSoftSig(p);

        var modes = $('bg-mode');
        modes.innerHTML = '';
        [['off', 'Off'], ['photo', 'Photo'], ['live', 'Live']].forEach(function (m) {
            modes.appendChild(chip(m[1], p.mode === m[0], { kind: 'mode', key: m[0] }));
        });

        var intervals = $('bg-interval');
        intervals.innerHTML = '';
        Wallpaper.INTERVALS.forEach(function (i) {
            intervals.appendChild(chip(i.label, p.interval === i.key, { kind: 'interval', key: i.key }));
        });
        $('bg-interval-block').classList.toggle('hidden', !cycle);

        var portraitBlock = $('bg-portrait-block');
        if (portraitBlock) {
            portraitBlock.classList.toggle('hidden', p.mode === 'off');
            var portraitChips = $('bg-portrait');
            if (portraitChips) {
                portraitChips.innerHTML = '';
                var allowP = !!p.allowPortrait;
                [[false, 'No'], [true, 'Yes']].forEach(function (o) {
                    portraitChips.appendChild(chip(o[1], allowP === o[0], { kind: 'allowPortrait', value: o[0] }));
                });
            }
        }

        if (browseLive && window.LiveWallpaper && LiveWallpaper.syncLiveProvider) {
            LiveWallpaper.syncLiveProvider();
            p = Prefs.get().wallpaper;
        }
        var prov = p.liveProvider || 'bing';
        var mixOn = prov === 'mix';

        var mixBlock = $('bg-live-mix-block');
        if (mixBlock) {
            mixBlock.classList.toggle('hidden', !browseLive);
            var mixChips = $('bg-live-mix');
            if (mixChips) {
                mixChips.innerHTML = '';
                [[false, 'Off'], [true, 'On']].forEach(function (o) {
                    mixChips.appendChild(chip(o[1], mixOn === o[0], { kind: 'mixMode', value: o[0] }));
                });
            }
        }

        var rotateBlock = $('bg-photos-rotate-block');
        if (rotateBlock) {
            rotateBlock.classList.toggle('hidden', !(browseLive && prov === 'photos'));
            var rotateChips = $('bg-photos-rotate');
            if (rotateChips) {
                rotateChips.innerHTML = '';
                var rotateOn = p.rotateOn === true;
                [[true, 'On'], [false, 'Off']].forEach(function (o) {
                    rotateChips.appendChild(chip(o[1], rotateOn === o[0], { kind: 'photosRotate', value: o[0] }));
                });
            }
        }

        var liveProvBlock = $('bg-live-provider-block');
        if (liveProvBlock) {
            liveProvBlock.classList.toggle('hidden', !browseLive);
            var providers = $('bg-live-provider');
            providers.innerHTML = '';
            (window.LiveWallpaper ? LiveWallpaper.PROVIDERS : [{ key: 'bing', label: 'Bing' }])
                .filter(function (x) { return x.key !== 'mix'; })
                .forEach(function (x) {
                    // Mix On: multi-select roster. Mix Off: single selected source.
                    var on = mixOn
                        ? (window.LiveWallpaper
                            ? LiveWallpaper.mixSourceOn(x.key)
                            : false)
                        : prov === x.key;
                    providers.appendChild(chip(x.label, on, { kind: 'provider', key: x.key }));
                });
            var provNote = $('bg-live-provider-note');
            if (provNote) {
                provNote.classList.toggle('hidden', !browseLive || !mixOn);
                provNote.textContent = mixOn ? 'At least one source must stay on.' : '';
            }
        }

        var unsplashOn = mixOn
            ? (window.LiveWallpaper ? LiveWallpaper.mixSourceOn('unsplash') : false)
            : prov === 'unsplash';
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

        var wallhavenOn = mixOn
            ? (window.LiveWallpaper ? LiveWallpaper.mixSourceOn('wallhaven') : false)
            : prov === 'wallhaven';
        var showWallhaven = browseLive && wallhavenOn;
        var wallhavenBlock = $('bg-live-wallhaven-block');
        if (wallhavenBlock) {
            wallhavenBlock.classList.toggle('hidden', !showWallhaven);
            var whChips = $('bg-live-wallhaven');
            whChips.innerHTML = '';
            var whCats = (window.LiveWallpaper && LiveWallpaper.WALLHAVEN_CATEGORIES) || [
                { key: 'general', label: 'General' }
            ];
            var whCur = window.LiveWallpaper ? LiveWallpaper.wallhavenCategory() : 'general';
            whCats.forEach(function (c) {
                whChips.appendChild(chip(c.label, whCur === c.key, { kind: 'wallhavenCategory', key: c.key }));
            });
        }

        var immichOn = mixOn
            ? (window.LiveWallpaper ? LiveWallpaper.mixSourceOn('immich') : false)
            : prov === 'immich';
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

        var moreWanted = browseLive && (showShuffleBlock(p) || prov !== 'photos');
        var moreOpen = bgState.liveMore;
        if (moreOpen == null) {
            moreOpen = !!(p.random || (p.livePool && p.livePool !== 'small' && p.livePool !== 'normal'));
        }
        var liveMoreBlock = $('bg-live-more-block');
        if (liveMoreBlock) {
            liveMoreBlock.classList.toggle('hidden', !moreWanted);
            var moreChips = $('bg-live-more');
            if (moreChips) {
                moreChips.innerHTML = '';
                [[false, 'Off'], [true, 'On']].forEach(function (o) {
                    moreChips.appendChild(chip(o[1], moreOpen === o[0], { kind: 'liveMore', value: o[0] }));
                });
            }
        }

        var shuffleBlock = $('bg-shuffle-block');
        if (shuffleBlock) {
            var showShuffle = moreWanted && moreOpen && showShuffleBlock(p);
            shuffleBlock.classList.toggle('hidden', !showShuffle);
            if (showShuffle) {
                var shuffleChips = $('bg-shuffle');
                shuffleChips.innerHTML = '';
                [[false, 'Off'], [true, 'On']].forEach(function (o) {
                    shuffleChips.appendChild(chip(o[1], !!p.random === o[0], { kind: 'random', value: o[0] }));
                });
                var shuffleNote = $('bg-shuffle-note');
                if (shuffleNote) {
                    shuffleNote.textContent = shuffleNoteFor(p);
                    shuffleNote.classList.toggle('hidden', !shuffleNote.textContent);
                }
            }
        }

        var poolBlock = $('bg-live-pool-block');
        if (poolBlock) {
            // Solo Bing: 8 stays selectable; 20/40 stay visible but locked (Bing window ~8).
            var bingSolo = browseLive && prov === 'bing';
            poolBlock.classList.toggle('hidden', !(moreWanted && moreOpen && browseLive));
            var poolChips = $('bg-live-pool');
            poolChips.innerHTML = '';
            var poolTitle = poolBlock.querySelector('h2');
            if (browseLive && prov === 'photos') {
                // Saved photos are all on the device: show the count only, nothing to choose.
                var count = (window.Wallpaper && Wallpaper.savedPool) ? Wallpaper.savedPool().length : 0;
                var shown = document.createElement('span');
                shown.className = 'chip disabled';
                shown.textContent = count + ' photos';
                poolChips.appendChild(shown);
                if (poolTitle) poolTitle.textContent = 'Photos';
            } else {
            var pools = (window.LiveWallpaper && LiveWallpaper.LIVE_POOLS) || {
                small: { label: '8' },
                normal: { label: '20' },
                large: { label: '40' }
            };
            if (bingSolo && p.livePool && p.livePool !== 'small') {
                p.livePool = 'small';
                Prefs.save();
            }
            Object.keys(pools).forEach(function (key) {
                var locked = bingSolo && key !== 'small';
                var c = chip(
                    pools[key].label,
                    !locked && (p.livePool || 'small') === key,
                    locked
                        ? { kind: 'livePoolLocked', value: key }
                        : { kind: 'livePool', value: key }
                );
                if (locked) c.classList.add('disabled');
                poolChips.appendChild(c);
            });
            if (poolTitle) poolTitle.textContent = 'Queue size';
            }
        }

        renderLiveStatus(p, live, browseLive);

        var photos = $('bg-photos');
        var photosBlock = $('bg-photos-block');
        var photosTitle = photosBlock && photosBlock.querySelector('h2');
        // Mix rotates across sources — no static picker grid.
        var showLiveThumbs = browseLive && prov !== 'mix' &&
            !(window.LiveWallpaper && LiveWallpaper.needsSetup());
        var showPhotoThumbs = p.mode === 'photo' && !bgState.keepLivePicker;
        var gridMode = showLiveThumbs ? 'live' : (showPhotoThumbs ? 'photo' : '');

        function addThumb(w, kind, selected) {
            photos.appendChild(makeThumb(w, kind, selected));
        }

        var emptyNote = photosBlock && photosBlock.querySelector('.bg-photos-empty');
        if (emptyNote) emptyNote.parentNode.removeChild(emptyNote);

        // Rebuilding the grid aborts in-flight thumb loads — append-only while Live warms.
        if (gridMode !== bgState.gridMode) {
            photos.innerHTML = '';
            bgState.gridMode = gridMode;
            bgState.photosKeys = {};
        }

        var storageEl = $('bg-photos-storage');
        var pinMax = (window.Wallpaper && Wallpaper.PIN_MAX) || 20;
        var pinSum = pinStorageLabel();
        var pinCount = ((window.Wallpaper && Wallpaper.pinsList && Wallpaper.pinsList()) || []).length;

        if (showLiveThumbs) {
            if (photosTitle) {
                photosTitle.textContent = prov === 'photos' ? 'Photos'
                    : (pinSum ? 'Save (' + pinSum + ')' : 'Save (up to ' + pinMax + ')');
            }
            if (storageEl) {
                var liveNote = pinCount
                    ? (pinSum + ' saved · OK for Use now / Save')
                    : ('Up to ' + pinMax + ' · OK for Use now / Save');
                if (bgState.keepLivePicker && p.mode === 'photo') {
                    liveNote = 'Photo frozen on Home · ' + liveNote;
                }
                storageEl.textContent = liveNote;
                storageEl.classList.remove('hidden');
            }
            if (prov === 'photos' && storageEl) storageEl.classList.add('hidden');
            var pool = (prov === 'photos' && window.Wallpaper && Wallpaper.savedPool)
                ? Wallpaper.savedPool()
                : (window.LiveWallpaper && LiveWallpaper.pickList)
                ? LiveWallpaper.pickList()
                : ((window.LiveWallpaper && LiveWallpaper.list()) || []);
            var usingKey = (!live && p.photo) ? p.photo : '';
            if (!pool.length && !Object.keys(bgState.photosKeys).length) {
                photosBlock.insertBefore(
                    el('p', 'setting-note muted bg-photos-empty',
                        'Photos appear after the first fetch'),
                    photos
                );
            } else {
                pool.forEach(function (w) {
                    if (bgState.photosKeys[w.key]) return;
                    bgState.photosKeys[w.key] = true;
                    addThumb(w, prov === 'photos' ? 'readonly' : 'pinLive', !!(usingKey && w.key === usingKey));
                });
                // Thumbs load lazily via <img loading=lazy>; rememberPick already warms a few.
            }
            var moreBlock = $('bg-photos-more');
            if (moreBlock) {
                // Always offer Load more while browsing Live (even before the first batch); not for Saved photos.
                moreBlock.classList.toggle('hidden', prov === 'photos');
                moreBlock.innerHTML = '';
                if (prov !== 'photos') moreBlock.appendChild(chip('Load more', false, { kind: 'pickMore' }));
            }
        } else if (showPhotoThumbs) {
            if (photosTitle) photosTitle.textContent = 'Photo';
            if (storageEl) {
                var hiddenN = Wallpaper.hiddenBundledCount ? Wallpaper.hiddenBundledCount() : 0;
                var note = pinCount ? (pinSum + ' saved · OK selects') : 'OK selects · OK again for options';
                if (hiddenN) note += ' · ' + hiddenN + ' hidden';
                storageEl.textContent = note;
                storageEl.classList.remove('hidden');
            }
            var pins = (Wallpaper.pinsList && Wallpaper.pinsList()) || [];
            var visibleShip = (Wallpaper.bundledVisible && Wallpaper.bundledVisible()) ||
                Wallpaper.bundled();
            var temp = Wallpaper.tempPhotoEntry && Wallpaper.tempPhotoEntry();
            if (!Object.keys(bgState.photosKeys).length) {
                if (temp) {
                    bgState.photosKeys[temp.key] = true;
                    addThumb(temp, 'photoTemp', p.photo === temp.key);
                }
                pins.forEach(function (pin) {
                    if (bgState.photosKeys[pin.key]) return;
                    bgState.photosKeys[pin.key] = true;
                    addThumb(pin, 'photoPin', p.photo === pin.key);
                });
                visibleShip.forEach(function (w) {
                    if (bgState.photosKeys[w.key]) return;
                    bgState.photosKeys[w.key] = true;
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

    function activateBackground(item) {
        var p = Prefs.get().wallpaper;
        if (item.kind === 'immichLink') {
            SettingsCore.rename('', function (link) {
                if (window.LiveWallpaper) {
                    LiveWallpaper.setImmichLink(link);
                    LiveWallpaper.clearCache();
                }
                p.liveKey = '';
                Prefs.save();
                Wallpaper.ensureLive();
                redrawBackground();
            }, { title: 'Immich shared album link', maxLength: 200, allowEmpty: true });
            return;
        }
        if (item.kind === 'unsplashKey') {
            SettingsCore.rename('', function (key) {
                if (window.LiveWallpaper) {
                    LiveWallpaper.setUnsplashKey(key);
                    LiveWallpaper.clearCache();
                }
                p.liveKey = '';
                Prefs.save();
                Wallpaper.ensureLive();
                redrawBackground();
            }, { title: 'Unsplash Access Key', maxLength: 64, password: true });
            return;
        }
        if (item.kind === 'unsplashCollection') {
            SettingsCore.rename(window.LiveWallpaper ? LiveWallpaper.unsplashCollection() : '', function (id) {
                if (window.LiveWallpaper) {
                    LiveWallpaper.setUnsplashCollection(id);
                    LiveWallpaper.clearCache();
                }
                p.liveKey = '';
                Prefs.save();
                Wallpaper.ensureLive();
                redrawBackground();
            }, { title: 'Unsplash collection ID', maxLength: 64, allowEmpty: true });
            return;
        }
        if (item.kind === 'wallhavenCategory') {
            if (!window.LiveWallpaper) return;
            var prevCat = LiveWallpaper.wallhavenCategory ? LiveWallpaper.wallhavenCategory() : '';
            if (prevCat === item.key) return;
            LiveWallpaper.setWallhavenCategory(item.key);
            p.liveKey = '';
            p.lastChange = Date.now();
            bgState.gridMode = '';
            bgState.photosKeys = {};
            Prefs.save();
            if (LiveWallpaper.switchProvider) LiveWallpaper.switchProvider();
            else LiveWallpaper.clearCache();
            busyLiveProviderChange().then(function () {
                redrawBackground();
            }, function () {
                redrawBackground();
            });
            return;
        }
        if (item.kind === 'liveMore') {
            bgState.liveMore = !!item.value;
            redrawBackground();
            return;
        }
        if (item.kind === 'allowPortrait') {
            var wantPortrait = !!item.value;
            if (!!p.allowPortrait === wantPortrait) return;
            p.allowPortrait = wantPortrait;
            Prefs.save();
            if (Wallpaper.clearUnfitHome) Wallpaper.clearUnfitHome();
            // Portraits previously skipped as failed can re-enter the Live queue.
            if (wantPortrait && window.LiveState) LiveState.failedFiles = {};
            if (p.mode === 'live' && window.LiveWallpaper && LiveWallpaper.rebuildPlan) {
                LiveWallpaper.rebuildPlan();
            }
            Wallpaper.apply();
            redrawBackground();
            return;
        }
        if (item.kind === 'mode') {
            bgState.keepLivePicker = false;
            p.mode = item.key;
            if (item.key === 'rotate' || item.key === 'live') p.lastChange = Date.now();
        } else if (item.kind === 'interval') {
            p.interval = item.key;
            p.lastChange = Date.now();
        } else if (item.kind === 'photosRotate') {
            p.rotateOn = !!item.value;
            p.lastChange = Date.now();
        } else if (item.kind === 'random') {
            p.random = !!item.value;
            // Rebuild plan; Shuffle On reshuffles Mix provider order.
            if (p.mode === 'live' && window.LiveWallpaper && LiveWallpaper.rebuildPlan) {
                LiveWallpaper.rebuildPlan();
            }
        } else if (item.kind === 'livePoolLocked') {
            UI.toast('Bing only offers 8 photos');
            return;
        } else if (item.kind === 'livePool') {
            if (p.liveProvider === 'bing' && item.value !== 'small') {
                UI.toast('Bing only offers 8 photos');
                return;
            }
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
            redrawBackground();
            return;
        } else if (item.kind === 'mixMode') {
            if (!window.LiveWallpaper || !LiveWallpaper.setMixMode) return;
            var wantMix = !!item.value;
            var prevMix = (p.liveProvider || '') === 'mix';
            if (wantMix === prevMix) return;
            LiveWallpaper.setMixMode(wantMix);
            p = Prefs.get().wallpaper;
            p.liveKey = '';
            p.lastChange = Date.now();
            bgState.gridMode = '';
            bgState.photosKeys = {};
            Prefs.save();
            if (LiveWallpaper.switchProvider) LiveWallpaper.switchProvider();
            if (LiveWallpaper.needsSetup && LiveWallpaper.needsSetup()) {
                UI.toast(LiveWallpaper.status());
            }
            busyLiveProviderChange().then(function () {
                redrawBackground();
            }, function () {
                redrawBackground();
            });
            return;
        } else if (item.kind === 'provider') {
            if (!window.LiveWallpaper) return;
            if (item.key === 'mix') return;
            var prevProv = p.liveProvider || 'bing';
            var nextProv = prevProv;
            var mixNow = prevProv === 'mix';

            if (mixNow) {
                // Mix On: multi-select roster chips.
                if (!LiveWallpaper.setMixSource) return;
                var wantOn = !LiveWallpaper.mixSourceOn(item.key);
                var nowOn = LiveWallpaper.setMixSource(item.key, wantOn);
                if (!wantOn && nowOn) {
                    UI.toast('Keep at least one source on');
                    redrawBackground();
                    return;
                }
                nextProv = 'mix';
                p.liveProvider = 'mix';
                Prefs.save();
                if (LiveWallpaper.rebuildPlan) LiveWallpaper.rebuildPlan();
            } else {
                // Mix Off: radio — one source to browse / play.
                if (prevProv === item.key) return;
                if (LiveWallpaper.setSoloProvider) LiveWallpaper.setSoloProvider(item.key);
                else {
                    p.liveProvider = item.key;
                    Prefs.save();
                }
                nextProv = item.key;
                p.liveKey = '';
                p.lastChange = Date.now();
                bgState.gridMode = '';
                bgState.photosKeys = {};
                Prefs.save();
                if (LiveWallpaper.switchProvider) LiveWallpaper.switchProvider();
                else if (LiveWallpaper.clearCache) LiveWallpaper.clearCache();
            }

            if (LiveWallpaper.needsSetup && LiveWallpaper.needsSetup()) {
                UI.toast(LiveWallpaper.status());
                redrawBackground();
                return;
            }
            // Fetch can take a couple of seconds — keep the busy ring up to 5 s, then show grid.
            if ((p.mode === 'live' || bgState.keepLivePicker) &&
                    (nextProv !== prevProv || nextProv === 'mix')) {
                busyLiveProviderChange().then(function () {
                    redrawBackground();
                }, function () {
                    redrawBackground();
                });
                return;
            }
            redrawBackground();
            return;
        } else if (item.kind === 'pickMore') {
            if (!window.LiveWallpaper || !LiveWallpaper.loadMorePicks) return;
            UI.busy(LiveWallpaper.loadMorePicks()).then(function (n) {
                redrawBackground();
                if (!n) UI.toast('No more photos');
            }, function () {
                UI.toast('Could not load more');
            });
            return;
        } else if (item.kind === 'readonly') {
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
        redrawBackground();
        if (item.kind === 'mode' && item.key === 'live' &&
                Prefs.get().wallpaper.liveProvider !== 'mix' &&
                !(window.LiveWallpaper && LiveWallpaper.needsSetup())) {
            warmBgPicker();
        }
    }

    // Live provider changes while the Background page is open: refresh the chips (soft path when
    // they would not change). Debounced, because warm notifies often.
    function onLiveChange() {
        if (UI.current() !== 'bg') return;
        if (bgState.liveRefreshTimer) clearTimeout(bgState.liveRefreshTimer);
        bgState.liveRefreshTimer = setTimeout(function () {
            bgState.liveRefreshTimer = null;
            var p = Prefs.get().wallpaper;
            var sig = bgLiveSoftSig(p);
            if (sig === bgState.softSig) {
                renderBackgroundLiveDelta();
                return;
            }
            redrawBackground();
        }, 350);
    }

    window.SettingsBackground = {
        render: renderBackground,
        redraw: redrawBackground,
        activate: activateBackground,
        warm: warmBgPicker,
        onLiveChange: onLiveChange,
        pinStorageLabel: pinStorageLabel,
        clearSavedPins: clearSavedPins,
        restoreBundledPhotos: restoreBundledPhotos
    };
})();
