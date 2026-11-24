/*
 * cache live wallpaper source: fetches and parses its pictures. Shared pool and queue state
 * lives in live-state.js; calls back into live-wallpaper.js go through LiveHooks.
 */
(function () {
    'use strict';

    var CACHE_KEY = LiveCore.CACHE_KEY;
    var PICK_CATALOG_MAX = LiveCore.PICK_CATALOG_MAX;
    var HISTORY_MAX = LiveCore.HISTORY_MAX;
    var SEEN_MAX = LiveCore.SEEN_MAX;

    function markSeen() { return LiveHooks.markSeen.apply(null, arguments); }

    var todayKey = LiveCore.todayKey;
    var parseImmichLink = LiveParsers.parseImmichLink;
    var normalize = LiveParsers.normalize;

    function cfg() { return LiveCore.cfg.apply(null, arguments); }
    function entryMatchesSource() { return LiveHooks.entryMatchesSource.apply(null, arguments); }
    function loadOffsets() { return LiveHooks.loadOffsets.apply(null, arguments); }
    function provider() { return LiveHooks.provider.apply(null, arguments); }
    function rememberPick() { return LiveHooks.rememberPick.apply(null, arguments); }
    function resetPool() { return LiveHooks.resetPool.apply(null, arguments); }

    function loadCache() {
        LiveState.cacheNeedsRewrite = false;
        try {
            var raw = JSON.parse(localStorage.getItem(CACHE_KEY));
            if (!raw || !Array.isArray(raw.items)) return;
            if (raw.provider !== provider()) return;
            if (raw.provider === 'bing' && raw.market !== cfg().market) return;
            LiveState.fetchedDay = raw.fetchedDay || '';
            LiveState.cachedProvider = raw.provider;
            LiveState.cachedMarket = raw.market || '';
            if (raw.bingDay && raw.bingDay.day === todayKey() &&
                    raw.bingDay.market === cfg().market &&
                    Array.isArray(raw.bingDay.entries) && raw.bingDay.entries.length) {
                LiveState.bingDay = {
                    day: raw.bingDay.day,
                    market: raw.bingDay.market,
                    entries: raw.bingDay.entries.map(normalize).filter(Boolean),
                    inflight: null
                };
            }
            var beforeItems = raw.items.length;
            LiveState.items = raw.items.slice(-HISTORY_MAX).map(normalize).filter(function (w) {
                if (LiveState.cachedProvider === 'mix') return !!w.source;
                return entryMatchesSource(w, LiveState.cachedProvider);
            });
            if (LiveState.items.length !== Math.min(beforeItems, HISTORY_MAX)) LiveState.cacheNeedsRewrite = true;
            LiveState.seen = (Array.isArray(raw.seen) ? raw.seen : []).filter(function (e) {
                return e && e.key;
            }).slice(-SEEN_MAX).map(function (e) {
                return { key: String(e.key), file: e.file ? String(e.file) : '' };
            });
            // Seed seen from history if this is an upgraded cache without a seen ring.
            if (!LiveState.seen.length && LiveState.items.length) {
                LiveState.items.forEach(markSeen);
                LiveState.cacheNeedsRewrite = true;
            }
            loadOffsets(raw.offsets);
            if (raw.wallhavenPage != null) {
                var whp = Math.floor(Number(raw.wallhavenPage));
                if (whp >= 1 && isFinite(whp)) LiveState.stream.wallhavenPage = whp;
            }
            if (typeof raw.wallhavenSeed === 'string') LiveState.stream.wallhavenSeed = raw.wallhavenSeed;
            if (raw.unsplashPage != null) {
                var up = Math.floor(Number(raw.unsplashPage));
                if (up >= 1 && isFinite(up)) LiveState.stream.unsplashPage = up;
            }
            if (raw.unsplashIndex != null) {
                var ui = Math.floor(Number(raw.unsplashIndex));
                if (ui >= 0 && isFinite(ui)) LiveState.stream.unsplashIndex = ui;
            }
            if (raw.photosIndex != null) {
                var pi = Math.floor(Number(raw.photosIndex));
                if (pi >= 0 && isFinite(pi)) LiveState.stream.photosIndex = pi;
            }
            if (raw.immichIndex != null) {
                var ii = Math.floor(Number(raw.immichIndex));
                if (ii >= 0 && isFinite(ii)) LiveState.stream.immichIndex = ii;
            }
            if (raw.immichPage != null) {
                var ip = Math.floor(Number(raw.immichPage));
                if (ip >= 1 && isFinite(ip)) LiveState.stream.immichPage = ip;
            }
            if (raw.immichAlbum && raw.immichAlbum.id) {
                var s = parseImmichLink(LiveState.immichLink);
                if (s) {
                    LiveState.stream.immichAlbum = {
                        id: raw.immichAlbum.id,
                        name: raw.immichAlbum.name || '',
                        origin: s.origin,
                        query: s.query
                    };
                }
            }
            LiveQueue.restore(raw);
            // Restored catalog keeps days that have rolled off Bing’s ~8-day API window.
            if (Array.isArray(raw.picks)) {
                raw.picks.forEach(function (w) {
                    if (!w || !w.key || !w.file || !w.source) return;
                    if (!entryMatchesSource(w, w.source)) {
                        LiveState.cacheNeedsRewrite = true;
                        return;
                    }
                    rememberPick(normalize(w), w.source);
                });
            }
        } catch (e) {
            resetPool();
        }
    }

    function picksForCache() {
        return Object.keys(LiveState.pickCatalog).map(function (k) {
            return LiveState.pickCatalog[k];
        }).filter(function (w) {
            return w && w.key && w.file;
        }).slice(-PICK_CATALOG_MAX);
    }

    // `p` is the provider the items were fetched from, not the one currently selected.
    // Debounced by default — queue fills would otherwise JSON.stringify on every step.
    function flushSaveCache() {
        var p = LiveState.pendingSaveProvider || provider();
        LiveState.cachedProvider = p;
        LiveState.cachedMarket = cfg().market;
        var queue = LiveQueue.snapshot();
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                provider: p,
                fetchedDay: LiveState.fetchedDay,
                market: LiveState.cachedMarket,
                items: LiveState.items,
                seen: LiveState.seen,
                picks: picksForCache(),
                plan: queue.plan,
                queues: queue.queues,
                // Persist today's Bing window so a relaunch does not re-hit the API.
                bingDay: (LiveState.bingDay.day === todayKey() && LiveState.bingDay.entries && LiveState.bingDay.entries.length)
                    ? { day: LiveState.bingDay.day, market: LiveState.bingDay.market, entries: LiveState.bingDay.entries }
                    : null,
                wallhavenPage: LiveState.stream.wallhavenPage || 1,
                wallhavenSeed: LiveState.stream.wallhavenSeed || '',
                unsplashPage: LiveState.stream.unsplashPage || 1,
                unsplashIndex: LiveState.stream.unsplashIndex || 0,
                immichPage: LiveState.stream.immichPage || 1,
                immichIndex: LiveState.stream.immichIndex || 0,
                photosIndex: LiveState.stream.photosIndex || 0,
                immichAlbum: LiveState.stream.immichAlbum ? {
                    id: LiveState.stream.immichAlbum.id,
                    name: LiveState.stream.immichAlbum.name || ''
                } : null,
                offsets: {
                    bing: LiveState.stream.bing || 0,
                    nasa: LiveState.stream.nasa || 0,
                    wiki: LiveState.stream.wiki || 0,
                    unsplash: LiveState.stream.unsplash || 0,
                    sourceIndex: LiveState.stream.sourceIndex || 0
                },
                mixOrder: queue.mixOrder
            }));
        } catch (e) {
            DevLog.log('Live wallpaper: could not save cache');
        }
    }

    function saveCache(p, immediate) {
        LiveState.pendingSaveProvider = p || provider();
        if (immediate) {
            if (LiveState.saveTimer) {
                clearTimeout(LiveState.saveTimer);
                LiveState.saveTimer = null;
            }
            flushSaveCache();
            return;
        }
        if (LiveState.saveTimer) return;
        LiveState.saveTimer = setTimeout(function () {
            LiveState.saveTimer = null;
            flushSaveCache();
        }, 400);
    }

    window.LiveSources = window.LiveSources || {};
    window.LiveSources.cache = {
        loadCache: loadCache,
        flushSaveCache: flushSaveCache,
        saveCache: saveCache,
    };
})();
