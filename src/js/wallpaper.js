/* Wallpaper display and rotation, driven by Prefs.wallpaper. */
(function () {
    'use strict';

    var INTERVALS = [
        { key: 'open', label: 'Each time Home opens', ms: 0 },
        { key: '30s', label: '30 s', ms: 30 * 1000 },
        { key: '5m', label: '5 min', ms: 5 * 60 * 1000 },
        { key: '15m', label: '15 min', ms: 15 * 60 * 1000 },
        { key: '1h', label: '1 hour', ms: 60 * 60 * 1000 },
        { key: '1d', label: 'Daily', ms: 24 * 60 * 60 * 1000 }
    ];

    // Decode the next photo (sharp + blur thumb) before it is shown — keep lean on TV.
    var PRELOAD_N = 1;
    var preloadHold = [];

    var token = 0;
    var lastHomeUrl = '';

    function bundled() { return window.WALLPAPERS || []; }

    function hiddenBundledKeys() {
        var list = Prefs.get().wallpaper.hiddenBundled;
        return Array.isArray(list) ? list : [];
    }

    function isBundledHidden(key) {
        return hiddenBundledKeys().indexOf(key) >= 0;
    }

    // Shipped stills still shown in Photo / Rotate.
    function bundledVisible() {
        return bundled().filter(function (w) { return w && !isBundledHidden(w.key); });
    }

    function isLive() { return Prefs.get().wallpaper.mode === 'live'; }

    // Active catalog for the current mode (visible bundled or live pool).
    function list() {
        return isLive() ? LiveWallpaper.list() : bundledVisible();
    }

    // First usable Photo key after a remove/hide (temp, pins, then visible shipped).
    function fallbackPhotoKey(exceptKey) {
        var temp = tempMeta();
        if (temp && temp.key && temp.key !== exceptKey) return temp.key;
        var pins = pinsMeta();
        var i;
        for (i = 0; i < pins.length; i++) {
            if (pins[i] && pins[i].key && pins[i].key !== exceptKey) return pins[i].key;
        }
        var ship = bundledVisible();
        for (i = 0; i < ship.length; i++) {
            if (ship[i] && ship[i].key && ship[i].key !== exceptKey) return ship[i].key;
        }
        return '';
    }

    var PIN_MAX = 20;
    var PIN_DB = 'arn0.pins.v1';
    var PIN_STORE = 'blobs';
    var blobUrls = {}; // key → object URL (session)

    function pinsMeta() {
        var list = Prefs.get().wallpaper.pins;
        return Array.isArray(list) ? list : [];
    }

    function formatBytes(n) {
        var b = Math.max(0, Math.floor(Number(n) || 0));
        if (b < 1024) return b + ' B';
        if (b < 1024 * 1024) return (b / 1024).toFixed(b < 10 * 1024 ? 1 : 0) + ' KB';
        return (b / (1024 * 1024)).toFixed(b < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
    }

    // Sum of stored pin image bytes (IndexedDB). Missing sizes count as 0 until hydrate.
    function pinsBytes() {
        return pinsMeta().reduce(function (sum, p) {
            return sum + (p && p.bytes > 0 ? p.bytes : 0);
        }, 0);
    }

    // e.g. "3/20 · 4.2 MB" for Settings labels.
    function pinsStorageSummary() {
        var n = pinsMeta().length;
        var bytes = pinsBytes();
        var count = n + '/' + PIN_MAX;
        if (!n || !bytes) return count;
        return count + ' · ' + formatBytes(bytes);
    }

    function openPinDb() {
        return new Promise(function (resolve, reject) {
            if (!window.indexedDB) {
                reject(new Error('no IndexedDB'));
                return;
            }
            var req = indexedDB.open(PIN_DB, 1);
            req.onupgradeneeded = function () {
                var db = req.result;
                if (!db.objectStoreNames.contains(PIN_STORE)) db.createObjectStore(PIN_STORE);
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error || new Error('idb open')); };
        });
    }

    function idbReq(fn) {
        return openPinDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(PIN_STORE, 'readwrite');
                var store = tx.objectStore(PIN_STORE);
                var req = fn(store);
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error || new Error('idb')); };
            });
        });
    }

    function putPinBlob(key, blob) {
        return idbReq(function (store) { return store.put(blob, key); });
    }

    function getPinBlob(key) {
        return openPinDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(PIN_STORE, 'readonly');
                var req = tx.objectStore(PIN_STORE).get(key);
                req.onsuccess = function () { resolve(req.result || null); };
                req.onerror = function () { reject(req.error || new Error('idb get')); };
            });
        });
    }

    function deletePinBlob(key) {
        return idbReq(function (store) { return store.delete(key); }).catch(function () {});
    }

    function clearPinBlobs() {
        return openPinDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(PIN_STORE, 'readwrite');
                var req = tx.objectStore(PIN_STORE).clear();
                req.onsuccess = function () { resolve(); };
                req.onerror = function () { reject(req.error || new Error('idb clear')); };
            });
        }).catch(function () {});
    }

    function revokeBlobUrl(key) {
        if (blobUrls[key]) {
            try { URL.revokeObjectURL(blobUrls[key]); } catch (e) { /* ignore */ }
            delete blobUrls[key];
        }
    }

    function setBlobUrl(key, blob) {
        revokeBlobUrl(key);
        if (!blob) return '';
        blobUrls[key] = URL.createObjectURL(blob);
        return blobUrls[key];
    }

    function entryFromPin(meta) {
        if (!meta || !meta.key) return null;
        var local = blobUrls[meta.key] || '';
        return {
            key: meta.key,
            title: meta.title || 'Pinned',
            sub: meta.sub || '',
            file: local || meta.file,
            fileFallback: meta.file || '',
            fileFallbacks: [].concat(meta.fileFallback || [], meta.fileFallbacks || []),
            thumb: local || meta.thumb || meta.file,
            credit: meta.credit || '',
            remote: !local,
            stored: !!local,
            bytes: meta.bytes > 0 ? meta.bytes : 0
        };
    }

    function pinnedEntry() {
        var photo = Prefs.get().wallpaper.photo;
        var meta = pinsMeta().find(function (p) { return p.key === photo; });
        return entryFromPin(meta) || entryFromPin(pinsMeta()[0]);
    }

    function pinsList() {
        return pinsMeta().map(entryFromPin).filter(Boolean);
    }

    function tempMeta() {
        var t = Prefs.get().wallpaper.tempPhoto;
        return t && t.key ? t : null;
    }

    function entryFromTemp(meta) {
        if (!meta || !meta.key) return null;
        return {
            key: meta.key,
            title: meta.title || 'Temporary',
            sub: meta.sub || '',
            file: meta.file,
            fileFallback: meta.fileFallback || '',
            fileFallbacks: meta.fileFallbacks || [],
            thumb: meta.thumb || meta.file,
            credit: meta.credit || '',
            remote: true,
            stored: false,
            temporary: true
        };
    }

    function tempPhotoEntry() {
        return entryFromTemp(tempMeta());
    }

    function clearTempPhoto() {
        var w = Prefs.get().wallpaper;
        if (!w.tempPhoto) return;
        w.tempPhoto = null;
        Prefs.save();
    }

    function find(key) {
        if (isLive()) return LiveWallpaper.find(key);
        var pin = pinsMeta().find(function (p) { return p.key === key; });
        if (pin) return entryFromPin(pin);
        var temp = tempMeta();
        if (temp && temp.key === key) return entryFromTemp(temp);
        var hit = bundled().find(function (w) { return w.key === key; });
        if (hit && !isBundledHidden(hit.key)) return hit;
        if (temp) return entryFromTemp(temp);
        var visible = bundledVisible();
        if (visible[0]) return visible[0];
        return entryFromPin(pinsMeta()[0]) || bundled()[0] || null;
    }

    // Apply a Live photo as Photo without adding it to the pin shelf (needs network).
    function useTemporary(entry) {
        if (!entry || !entry.key || !entry.file) return false;
        var w = Prefs.get().wallpaper;
        w.tempPhoto = PhotoUtil.entryFields(entry, entry.title || 'Temporary');
        w.tempPhoto.source = entry.source || '';
        w.photo = entry.key;
        w.mode = 'photo';
        Prefs.save();
        apply();
        return true;
    }

    var fetchBlob = Http.getBlob;

    function pinUrls(entry) {
        var urls = [];
        function add(u) {
            if (u && urls.indexOf(u) < 0) urls.push(u);
        }
        add(entry.file);
        add(entry.fileFallback);
        (entry.fileFallbacks || []).forEach(add);
        add(entry.thumb);
        return urls;
    }

    function downloadPinBlob(entry) {
        var urls = pinUrls(entry);
        var i = 0;
        function next() {
            if (i >= urls.length) return Promise.reject(new Error('download failed'));
            var url = urls[i++];
            return fetchBlob(url).catch(next);
        }
        return next();
    }

    function rememberPinMeta(meta) {
        var p = Prefs.get().wallpaper;
        var pins = pinsMeta().filter(function (x) { return x.key !== meta.key; });
        pins.unshift(meta);
        while (pins.length > PIN_MAX) {
            var drop = pins.pop();
            if (drop && drop.key) {
                revokeBlobUrl(drop.key);
                deletePinBlob(drop.key);
            }
        }
        p.pins = pins;
        p.pinned = null;
        Prefs.save();
    }

    // Shelf + show as static Photo on Home (Settings can keep the Live picker open).
    function activatePin(meta) {
        rememberPinMeta(meta);
        var p = Prefs.get().wallpaper;
        // Permanent pin replaces any temporary use of this (or another) Live shot.
        p.tempPhoto = null;
        p.photo = meta.key;
        p.mode = 'photo';
        Prefs.save();
        apply();
    }

    // Save up to PIN_MAX favorites with image bytes (IndexedDB), then apply as Photo.
    // Returns a Promise<boolean> — true when bytes were stored locally.
    function pinLive(entry) {
        if (!entry || !entry.key || !entry.file) return Promise.resolve(false);
        var existing = pinsMeta().find(function (x) { return x.key === entry.key; });
        var meta = PhotoUtil.entryFields(entry, entry.title || 'Pinned');
        meta.remote = true;
        meta.bytes = existing && existing.bytes > 0 ? existing.bytes : 0;
        if (blobUrls[entry.key] || existing) {
            if (blobUrls[entry.key]) {
                activatePin(meta);
                return Promise.resolve(true);
            }
        }
        return downloadPinBlob(entry).then(function (blob) {
            return putPinBlob(entry.key, blob).then(function () {
                setBlobUrl(entry.key, blob);
                meta.bytes = blob && blob.size ? blob.size : 0;
                activatePin(meta);
                return true;
            });
        }, function (e) {
            DevLog.log('Pin save failed: ' + (e && e.message ? e.message : e));
            // Still remember + apply via URL while online.
            activatePin(meta);
            return false;
        });
    }

    function clearPins() {
        pinsMeta().forEach(function (p) { revokeBlobUrl(p.key); });
        var w = Prefs.get().wallpaper;
        w.pins = [];
        w.pinned = null;
        Prefs.save();
        return clearPinBlobs();
    }

    // Drop one saved pin (metadata + IndexedDB bytes). Returns true if it was removed.
    function removePin(key) {
        if (!key) return Promise.resolve(false);
        var before = pinsMeta();
        if (!before.some(function (p) { return p.key === key; })) {
            return Promise.resolve(false);
        }
        revokeBlobUrl(key);
        var w = Prefs.get().wallpaper;
        w.pins = before.filter(function (p) { return p.key !== key; });
        w.pinned = null;
        if (w.photo === key) {
            w.photo = fallbackPhotoKey(key) || (bundled()[0] && bundled()[0].key) || 'forest';
            if (w.mode === 'photo') apply();
        }
        Prefs.save();
        return deletePinBlob(key).then(function () { return true; }, function () { return true; });
    }

    // Hide a shipped still from Photo / Rotate (app file stays; Restore bundled brings it back).
    // Returns false when this would leave no photos at all.
    function hideBundled(key) {
        if (!key || !bundled().some(function (w) { return w.key === key; })) return false;
        if (isBundledHidden(key)) return true;
        if (!fallbackPhotoKey(key)) return false;
        var w = Prefs.get().wallpaper;
        var hidden = hiddenBundledKeys().slice();
        if (hidden.indexOf(key) < 0) hidden.push(key);
        w.hiddenBundled = hidden;
        if (w.photo === key) {
            w.photo = fallbackPhotoKey(key);
            if (w.mode === 'photo') apply();
        }
        Prefs.save();
        return true;
    }

    function restoreBundled() {
        var w = Prefs.get().wallpaper;
        var n = hiddenBundledKeys().length;
        w.hiddenBundled = [];
        Prefs.save();
        if (w.mode === 'photo' || w.mode === 'rotate') apply();
        return n;
    }

    function hiddenBundledCount() {
        return hiddenBundledKeys().length;
    }

    // Legacy name used when switching to a bundled photo (does not wipe the pin shelf).
    function clearPinned() { /* no-op: pins are kept until Clear saved pins */ }

    var pinsHydrating = null;

    function hydrateOnePin(meta) {
        if (!meta || !meta.key || blobUrls[meta.key]) return Promise.resolve();
        return getPinBlob(meta.key).then(function (blob) {
            if (!blob) return false;
            setBlobUrl(meta.key, blob);
            if (!(meta.bytes > 0) || meta.bytes !== blob.size) {
                meta.bytes = blob.size || 0;
                return true;
            }
            return false;
        }, function () { return false; });
    }

    // Full shelf (Settings Photos). Boot only hydrates the pin currently on Home.
    function hydratePins() {
        if (pinsHydrating) return pinsHydrating;
        var sizeChanged = false;
        pinsHydrating = Promise.all(pinsMeta().map(function (meta) {
            return hydrateOnePin(meta).then(function (changed) {
                if (changed) sizeChanged = true;
            });
        })).then(function () {
            pinsHydrating = null;
            if (sizeChanged) Prefs.save();
            if (!isLive() && Prefs.get().wallpaper.mode === 'photo') apply();
        }, function () { pinsHydrating = null; });
        return pinsHydrating;
    }

    function hydrateCurrentPin() {
        var p = Prefs.get().wallpaper;
        if (p.mode === 'live' || p.mode === 'off') return Promise.resolve();
        var meta = pinsMeta().find(function (x) { return x && x.key === p.photo; });
        if (!meta) return Promise.resolve();
        return hydrateOnePin(meta).then(function (changed) {
            if (changed) Prefs.save();
            apply();
        });
    }

    function interval(key) {
        var findI = function (k) { return INTERVALS.find(function (i) { return i.key === k; }); };
        return findI(key) || findI('15m');
    }

    function bg() { return document.getElementById('bg'); }
    function bgPhoto() { return document.getElementById('bg-photo'); }
    function bgPhotoBlur() { return document.getElementById('bg-photo-blur'); }

    function clearBlur(el) {
        if (!el) return;
        el.onerror = null;
        el.classList.remove('on');
        el.removeAttribute('src');
    }
    function scrim() { return document.getElementById('bg-scrim'); }

    function setScrim(on) {
        var el = scrim();
        if (el) el.classList.toggle('hidden', !on);
    }

    var photoUrls = PhotoUtil.photoUrls;
    var orientedSize = PhotoUtil.orientedSize;

    function preloadUrl(url) {
        if (!url) return;
        var img = new Image();
        img.decoding = 'async';
        img.src = url;
        if (typeof img.decode === 'function') {
            img.decode().catch(function () { /* ignore */ });
        }
        preloadHold.push(img);
        if (preloadHold.length > PRELOAD_N * 6) {
            preloadHold = preloadHold.slice(-PRELOAD_N * 6);
        }
    }

    // One URL only — decoding every fallback + thumb on each change stalls this SoC.
    function preloadEntry(w) {
        if (!w) return;
        preloadUrl(w.file || w.fileFallback || w.thumb);
    }

    // EXIF-oriented measure is costly (second full decode). Only Immich / local pins need it.
    function needsOrientProbe(w) {
        if (!w) return false;
        if (!w.remote) return true;
        return w.source === 'immich';
    }

    function preloadEntries(list, n) {
        var limit = n == null ? PRELOAD_N : n;
        (list || []).slice(0, limit).forEach(preloadEntry);
    }

    // Live: next entries in the plan. Rotate: next N after the current key.
    function preloadAhead() {
        if (isLive() && window.LiveWallpaper && LiveWallpaper.upcoming) {
            preloadEntries(LiveWallpaper.upcoming(), PRELOAD_N);
            return;
        }
        var l = list();
        if (!l.length) return;
        var key = currentKey();
        var i = l.findIndex(function (w) { return w.key === key; });
        if (i < 0) i = 0;
        var ahead = [];
        var k;
        for (k = 1; k <= PRELOAD_N; k++) {
            ahead.push(l[(i + k) % l.length]);
        }
        preloadEntries(ahead, PRELOAD_N);
    }

    // Home: always cover. Portrait biases object-position up (faces/subjects).
    function homeUrls(w) {
        var urls = [];
        function add(u) {
            if (u && urls.indexOf(u) < 0) urls.push(u);
        }
        // Display URL first (Immich fullsize / Bing HD / …); fall back if a URL fails to load. Never the
        // thumb: it is a small preview (Wallhaven's is 300px), which looks soft when stretched to the TV.
        add(w.file);
        add(w.fileFallback);
        (w.fileFallbacks || []).forEach(add);
        return urls.length ? urls : photoUrls(w);
    }

    function display(w) {
        var t = ++token;
        var photo = bgPhoto();
        var blurEl = bgPhotoBlur();
        if (!w) {
            lastHomeUrl = '';
            bg().style.backgroundImage = '';
            if (photo) {
                photo.removeAttribute('src');
                photo.classList.remove('on', 'portrait');
            }
            clearBlur(blurEl);
            setScrim(false);
            return;
        }
        var urls = homeUrls(w);

        var i = 0;
        var probe = new Image();
        function paint(url, ow, oh) {
            if (t !== token) return;
            if (url === lastHomeUrl && photo && photo.classList.contains('on')) return;
            lastHomeUrl = url;
            bg().style.backgroundImage = 'none';
            // Portrait (after EXIF): cover with upward bias — no tiles/blur on Home.
            var portrait = !!(ow && oh && oh > ow);
            if (photo) {
                photo.src = url;
                photo.classList.add('on');
                photo.classList.toggle('portrait', portrait);
            }
            if (portrait && blurEl && Prefs.get().screensaver.blur !== false) {
                blurEl.onerror = function () {
                    blurEl.onerror = null;
                    if (blurEl.getAttribute('src') !== url) blurEl.src = url;
                };
                blurEl.src = w.thumb || url;
                blurEl.classList.add('on');
            } else {
                clearBlur(blurEl);
            }
            setScrim(!!w.remote);
        }
        function tryUrl() {
            if (i >= urls.length) {
                DevLog.log('Wallpaper failed to load: ' + w.file);
                if (t === token && w.remote) setScrim(false);
                return;
            }
            probe.onload = function () {
                if (t !== token) return;
                var url = urls[i];
                if (!needsOrientProbe(w)) {
                    paint(url, probe.naturalWidth, probe.naturalHeight);
                    return;
                }
                orientedSize(url, probe, function (ow, oh) {
                    paint(url, ow, oh);
                });
            };
            probe.onerror = function () {
                DevLog.log('Wallpaper failed to load: ' + urls[i]);
                i++;
                tryUrl();
            };
            probe.src = urls[i];
        }
        tryUrl();
    }

    function currentKey() {
        var p = Prefs.get().wallpaper;
        return isLive() ? (p.liveKey || (list()[0] && list()[0].key)) : p.photo;
    }

    function apply() {
        var p = Prefs.get().wallpaper;
        if (p.mode === 'off') {
            display(null);
            return;
        }
        // Hidden shipped still: move Photo / Rotate onto something still visible.
        if ((p.mode === 'photo' || p.mode === 'rotate') &&
                !pinsMeta().some(function (x) { return x.key === p.photo; }) &&
                isBundledHidden(p.photo)) {
            var next = fallbackPhotoKey(p.photo);
            if (next) {
                p.photo = next;
                Prefs.save();
            }
        }
        display(find(currentKey()));
    }

    // Next catalog entry: sequential wrap, or random excluding the current key.
    function pickNext(l, key, random) {
        if (!l || !l.length) return null;
        if (!random || l.length < 2) {
            var i = l.findIndex(function (w) { return w.key === key; });
            return l[((i < 0 ? 0 : i) + 1) % l.length];
        }
        var others = l.filter(function (w) { return w.key !== key; });
        return others[Math.floor(Math.random() * others.length)];
    }

    // `done(w)` is called with the chosen entry (async for on-demand live sources).
    function next(done) {
        var p = Prefs.get().wallpaper;
        var finish = function (w) {
            if (typeof done === 'function') done(w || null);
            return w || null;
        };
        // Live: pull the next planned photo.
        if (isLive() && window.LiveWallpaper) {
            // Manual next (Settings / Green) passes done; timer rotation does not — no spinner then.
            if (typeof done === 'function') UI.busyShow();
            LiveWallpaper.takeNext().then(function (w) {
                if (typeof done === 'function') UI.busyHide();
                if (!w) return finish(null);
                p.lastChange = Date.now();
                Prefs.save();
                if (!(window.Screensaver && Screensaver.isOpen())) apply();
                setTimeout(preloadAhead, 600);
                finish(w);
            }, function () {
                if (typeof done === 'function') UI.busyHide();
                finish(null);
            });
            return null;
        }
        var l = list();
        if (!l.length) return finish(null);
        var w = pickNext(l, currentKey(), !!p.random);
        if (!w) return finish(null);
        if (isLive()) p.liveKey = w.key;
        else p.photo = w.key;
        p.lastChange = Date.now();
        if (p.mode === 'off') p.mode = 'photo';
        Prefs.save();
        apply();
        setTimeout(preloadAhead, 600);
        return finish(w);
    }

    function due() {
        var p = Prefs.get().wallpaper;
        if (p.mode !== 'rotate' && p.mode !== 'live') return false;
        var ms = interval(p.interval).ms;
        return ms > 0 && Date.now() - p.lastChange >= ms;
    }

    function ensureLive(thenApply) {
        if (!isLive() || !window.LiveWallpaper) return Promise.resolve(false);
        // Busy only when there is nothing cached to show yet.
        var needBusy = !!thenApply && !LiveWallpaper.list().length;
        if (needBusy) UI.busyShow();
        return LiveWallpaper.ensureDaily().then(function (changed) {
            if (needBusy) UI.busyHide();
            var p = Prefs.get().wallpaper;
            var l = LiveWallpaper.list();
            if (l.length && (!p.liveKey || !LiveWallpaper.find(p.liveKey))) {
                p.liveKey = l[0].key;
                Prefs.save();
            }
            if (changed || thenApply) apply();
            if (!l.length && needBusy) UI.toast('Live wallpaper unavailable');
            return !!changed;
        }, function () {
            if (needBusy) UI.busyHide();
            return false;
        });
    }

    // Called when Home appears (launch or return from another app).
    function homeShown() {
        var p = Prefs.get().wallpaper;
        if (p.mode === 'live') {
            ensureLive(false).then(function () {
                if (p.interval === 'open' || due()) next();
            });
            return;
        }
        if (p.mode === 'rotate' && (p.interval === 'open' || due())) next();
    }

    function afterPaint(fn) {
        var run = function () { setTimeout(fn, 0); };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
        else setTimeout(fn, 40);
    }

    function start() {
        apply();
        // Only the pin currently on Home — full shelf waits for Background settings.
        hydrateCurrentPin();
        // Mix publishes each source as it lands; apply the liveKey it just selected.
        if (window.LiveWallpaper) {
            LiveWallpaper.onChange(function () {
                if (!isLive()) return;
                if (window.Screensaver && Screensaver.isOpen()) return;
                var p = Prefs.get().wallpaper;
                var l = list();
                if (!l.length) return;
                if (!p.liveKey || !LiveWallpaper.find(p.liveKey)) {
                    p.liveKey = l[0].key;
                    Prefs.save();
                }
                // Skip no-op applies (metadata polish used to reload the same Home wallpaper).
                var cur = find(p.liveKey);
                var prefer = cur && homeUrls(cur)[0];
                if (prefer && prefer === lastHomeUrl) return;
                apply();
            });
        }
        // Live fetch / Mix warm after first paint so UI and remote stay responsive.
        afterPaint(function () {
            if (isLive()) {
                ensureLive(true).then(function () {
                    var p = Prefs.get().wallpaper;
                    if (p.interval === 'open' || due()) next();
                });
            } else {
                homeShown();
            }
            setTimeout(preloadAhead, 1400);
        });
        // The screen saver owns the photo cycle while open; do not rotate Home underneath
        // (wasted decode). close() syncs the shown key then applies Home.
        setInterval(function () {
            if (window.Screensaver && Screensaver.isOpen()) return;
            if (!document.hidden && due()) next();
            if (!document.hidden && isLive()) ensureLive(false);
        }, 5 * 1000);
    }

    window.Wallpaper = {
        INTERVALS: INTERVALS,
        PIN_MAX: PIN_MAX,
        list: list,
        bundled: bundled,
        bundledVisible: bundledVisible,
        find: find,
        pinnedEntry: pinnedEntry,
        pinsList: pinsList,
        pinsBytes: pinsBytes,
        pinsStorageSummary: pinsStorageSummary,
        formatBytes: formatBytes,
        pinLive: pinLive,
        useTemporary: useTemporary,
        tempPhotoEntry: tempPhotoEntry,
        clearTempPhoto: clearTempPhoto,
        removePin: removePin,
        hideBundled: hideBundled,
        restoreBundled: restoreBundled,
        hiddenBundledCount: hiddenBundledCount,
        clearPins: clearPins,
        clearPinned: clearPinned,
        interval: interval,
        pickNext: pickNext,
        apply: apply,
        next: next,
        homeShown: homeShown,
        start: start,
        hydratePins: hydratePins,
        isLive: isLive,
        preloadAhead: preloadAhead,
        ensureLive: function () { return ensureLive(true); }
    };
})();

