/*
 * picker live wallpaper source: fetches and parses its pictures. Shared pool and queue state
 * lives in live-state.js; calls back into live-wallpaper.js go through LiveHooks.
 */
(function () {
    'use strict';

    var SOURCE_NAMES = LiveCore.SOURCE_NAMES;
    var normalize = LiveParsers.normalize;

    function backgroundFill() { return LiveHooks.backgroundFill.apply(null, arguments); }
    function fillSourceQueue() { return LiveFill.fillSourceQueue.apply(null, arguments); }
    function needsSetup() { return LiveHooks.needsSetup.apply(null, arguments); }
    function notify() { return LiveHooks.notify.apply(null, arguments); }
    function pickBatch() { return LiveHooks.pickBatch.apply(null, arguments); }
    function provider() { return LiveHooks.provider.apply(null, arguments); }
    function sourceQueue() { return LivePool.sourceQueue.apply(null, arguments); }
    function waitForPickCount() { return LiveHooks.waitForPickCount.apply(null, arguments); }

    function pickCountFor(name) {
        var n = 0;
        Object.keys(LiveState.pickCatalog).forEach(function (k) {
            if (LiveState.pickCatalog[k].source === name) n++;
        });
        return n;
    }

    function ensurePickTarget(name) {
        if (!LiveState.pickTarget[name] || LiveState.pickTarget[name] < pickBatch()) LiveState.pickTarget[name] = pickBatch();
        return LiveState.pickTarget[name];
    }

    function preloadThumb(entry) {
        if (!entry || !entry.key) return;
        var url = entry.thumb || entry.file;
        if (!url || LiveState.thumbWarm[entry.key]) return;
        // Cap concurrent warm handles — Immich pages can flood otherwise.
        if (Object.keys(LiveState.thumbWarm).length > 24) return;
        var img = new Image();
        img.decoding = 'async';
        img.src = url;
        LiveState.thumbWarm[entry.key] = img;
    }

    function preloadPickThumbs() {
        pickList().forEach(preloadThumb);
    }

    // Catalog only — do not decode thumbs here (boot / queue fill). Settings warm calls preloadPickThumbs.
    function rememberPick(entry, source) {
        if (!entry || !entry.key) return;
        var n = normalize(entry);
        if (source) n.source = source;
        else if (entry.source) n.source = entry.source;
        var prev = LiveState.pickCatalog[entry.key];
        if (prev) {
            if (!n.thumb && prev.thumb) n.thumb = prev.thumb;
            if (!n.source && prev.source) n.source = prev.source;
            if (!n.fileFallback && prev.fileFallback) n.fileFallback = prev.fileFallback;
            if ((!n.fileFallbacks || !n.fileFallbacks.length) && prev.fileFallbacks) {
                n.fileFallbacks = prev.fileFallbacks;
            }
        }
        LiveState.pickCatalog[entry.key] = n;
    }

    function seedPickCatalog() {
        SOURCE_NAMES.forEach(function (name) {
            sourceQueue(name).buf.forEach(function (w) { rememberPick(w, name); });
        });
        LiveState.stream.plan.forEach(function (w) { rememberPick(w, w.source); });
        LiveState.items.forEach(function (w) { rememberPick(w, w.source); });
    }

    // Active catalog for Home / SS. Solo focus hides other sources' history so Next
    // cannot wander back into Mix leftovers.
    function list() {
        var p = provider();
        if (p === 'mix') return LiveState.items.slice();
        return LiveState.items.filter(function (w) { return w && w.source === p; });
    }

    function find(key) {
        if (!key) return null;
        return LiveState.items.find(function (w) { return w.key === key; }) || null;
    }

    // Choose as static (single providers only — Mix has no picker).
    // Catalog lasts while queues drain; show up to pickTarget (default PICK_BATCH).
    function pickList() {
        var p = provider();
        if (p === 'mix') return [];
        seedPickCatalog();
        var cap = ensurePickTarget(p);
        var out = [];
        Object.keys(LiveState.pickCatalog).forEach(function (k) {
            var w = LiveState.pickCatalog[k];
            if (!w || !w.file || w.source !== p) return;
            out.push(w);
        });
        out = out.slice(0, cap);
        // Picker follows catalog/fetch order (Shuffle only affects Mix provider walk).
        return out;
    }

    // Fetch the first PICK_BATCH for the current (non-Mix) provider, then keep filling
    // queues/plan/catalog in the background (SOURCE_AHEAD) without holding the busy spinner.
    function warmForPicker() {
        var p = provider();
        if (p === 'mix' || needsSetup()) return Promise.resolve();
        var want = ensurePickTarget(p);
        preloadPickThumbs();
        function ready() {
            preloadPickThumbs();
            notify();
            backgroundFill();
        }
        if (pickCountFor(p) >= want) {
            ready();
            return Promise.resolve();
        }
        fillSourceQueue(p, want).catch(function (e) {
            DevLog.log('Live wallpaper: ' + p + ' pick warm failed: ' +
                (e && e.message ? e.message : e));
        });
        return waitForPickCount(p, want, 25000).then(ready);
    }

    // Another PICK_BATCH for the current provider (catalog first, then fetch).
    function loadMorePicks() {
        var p = provider();
        if (p === 'mix' || needsSetup()) return Promise.resolve(0);
        var before = pickList().length;
        ensurePickTarget(p);
        LiveState.pickTarget[p] += pickBatch();
        var want = LiveState.pickTarget[p];
        function done() {
            preloadPickThumbs();
            notify();
            backgroundFill();
            return pickList().length - before;
        }
        if (pickCountFor(p) >= want) return Promise.resolve(done());
        fillSourceQueue(p, want).catch(function () {});
        return waitForPickCount(p, want, 25000).then(done);
    }

    function status() {
        if (needsSetup()) return provider() === 'immich' ? 'Set an Immich share link' : 'Set an Unsplash Access Key';
        return LiveState.lastError;
    }

    window.LiveSources = window.LiveSources || {};
    window.LiveSources.picker = {
        pickCountFor: pickCountFor,
        preloadPickThumbs: preloadPickThumbs,
        rememberPick: rememberPick,
        seedPickCatalog: seedPickCatalog,
        list: list,
        find: find,
        pickList: pickList,
        warmForPicker: warmForPicker,
        loadMorePicks: loadMorePicks,
        status: status,
    };
})();
