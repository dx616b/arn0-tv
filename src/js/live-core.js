/*
 * Helpers shared by the live wallpaper providers and the live wallpaper state (live-wallpaper.js):
 * request wrappers, date keys and the fixed TV display size. Nothing here reads or writes the
 * provider state.
 */
(function () {
    'use strict';

    var TIMEOUT_MS = Http.TIMEOUT_MS;
    var httpError = Http.httpError;
    var xhrGet = Http.xhrGet;
    var xhrPostJson = Http.xhrPostJson;

    function dayKey(d) {
        return d.getFullYear() + '-' +
            ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
            ('0' + d.getDate()).slice(-2);
    }

    function todayKey() { return dayKey(new Date()); }

    function daysAgoKey(n) {
        var d = new Date();
        d.setDate(d.getDate() - n);
        return dayKey(d);
    }

    function keys(list) {
        return list.map(function (w) { return w.key; }).join(',');
    }

    // Browser preview: same-origin proxy in scripts/serve.mjs (Chrome CORS blocks the APIs).
    function preview() { return !!window.__TIZEN_MOCK__; }

    // Fixed TV wallpaper size — avoid UHD downloads that stall decode on the SoC.
    var DISPLAY_W = 1920;
    var DISPLAY_H = 1080;
    var DISPLAY_ATLEAST = DISPLAY_W + 'x' + DISPLAY_H;

    var BING = 'https://www.bing.com';
    var BING_WINDOW = 8;
    var UNSPLASH = 'https://api.unsplash.com';
    var UNSPLASH_PAGES = 50;
    var UNSPLASH_PER_PAGE = 30;
    var WALLHAVEN = 'https://wallhaven.cc/api/v1';
    var IMMICH_XHR_MS = 40 * 1000;

    var LIVE_POOLS = {
        small: { label: '8', ahead: 8, plan: 5, pick: 3 },
        normal: { label: '20', ahead: 20, plan: 10, pick: 5 },
        large: { label: '40', ahead: 40, plan: 15, pick: 10 }
    };
    var MIX_AHEAD_BOOT = 1;
    var MIX_AHEAD_FULL = 2;
    var MIX_PLAN_BOOT = 2;
    var MIX_PLAN_FULL = 4;
    var MIX_GROW_MS = 8000;

    var WALLHAVEN_CATEGORIES = [
        { key: 'general', label: 'General', flags: '100' },
        { key: 'anime', label: 'Anime', flags: '010' },
        { key: 'people', label: 'People', flags: '001' },
        { key: 'all', label: 'All', flags: '111' }
    ];
    var WALLHAVEN_TOPICS = [
        { key: 'any', label: 'Any topic', query: '' },
        { key: 'nature', label: 'Nature', query: 'nature' },
        { key: 'space', label: 'Space', query: 'space' },
        { key: 'cars', label: 'Cars', query: 'cars' },
        { key: 'architecture', label: 'Architecture', query: 'architecture' },
        { key: 'animals', label: 'Animals', query: 'animals' }
    ];

    function wallhavenTopicMeta(value) {
        var key = String(value || 'any').trim();
        var preset = WALLHAVEN_TOPICS.find(function (topic) { return topic.key === key; });
        if (preset) return preset;
        if (key.indexOf('custom:') === 0) {
            var query = key.slice(7).trim();
            if (query) return { key: 'custom:' + query, label: query, query: query, custom: true };
        }
        return WALLHAVEN_TOPICS[0];
    }

    var PROVIDERS = [
        { key: 'bing', label: 'Bing', needsKey: false },
        { key: 'nasa', label: 'NASA APOD', needsKey: false },
        { key: 'wikimedia', label: 'Wikimedia POTD', needsKey: false },
        { key: 'wallhaven', label: 'Wallhaven', needsKey: false },
        { key: 'unsplash', label: 'Unsplash', needsKey: true },
        { key: 'immich', label: 'Immich album', needsKey: true },
        { key: 'photos', label: 'Photos', needsKey: false },
        { key: 'mix', label: 'Mix', needsKey: false }
    ];

    function cfg() {
        var c = (window.LAUNCHER_CONFIG && window.LAUNCHER_CONFIG.liveWallpaper) || {};
        return {
            market: c.market || 'en-GB',
            unsplashAccessKey: c.unsplashAccessKey || '',
            immichLink: c.immichLink || '',
            unsplashCollection: c.unsplashCollection || ''
        };
    }

    function shuffleOn() {
        return !!(window.Prefs && Prefs.get().wallpaper.random);
    }

    function wallhavenCategoryMeta(key) {
        return WALLHAVEN_CATEGORIES.find(function (x) { return x.key === key; }) || WALLHAVEN_CATEGORIES[0];
    }

    window.LiveHooks = {};

    var CACHE_KEY = 'arn0.liveWallpaper.v11';
    var SOURCE_NAMES = ['bing', 'nasa', 'wikimedia', 'wallhaven', 'unsplash', 'immich', 'photos'];
    var PICK_CATALOG_MAX = (typeof tizen !== 'undefined') ? 80 : 120;
    var IMMICH_STORE = 'arn0.immich.v1';
    var UNSPLASH_KEY_STORE = 'arn0.unsplash.v1';
    var WALLHAVEN_STORE = 'arn0.wallhaven.v1';

    var HISTORY_MAX = 120;
    var SEEN_MAX = 400;

    var SPAN_NASA = 60;
    var SPAN_WIKI = 400;
    var SPAN_UNSPLASH = 200;
    var IMMICH_PAGE = 100;

    var SOURCE_MS = 12 * 1000;
    var SOURCE_MS_WARM = 2500;
    var IMMICH_SOURCE_MS = 45 * 1000;
    var IMMICH_SOURCE_MS_WARM = 8000;

    var RETRY_MS = 5 * 60 * 1000;

    window.LiveCore = {
        cfg: cfg,
        shuffleOn: shuffleOn,
        wallhavenCategoryMeta: wallhavenCategoryMeta,
        wallhavenTopicMeta: wallhavenTopicMeta,
        WALLHAVEN_TOPICS: WALLHAVEN_TOPICS,
        RETRY_MS: RETRY_MS,
        PROVIDERS: PROVIDERS,
        WALLHAVEN_CATEGORIES: WALLHAVEN_CATEGORIES,
        SOURCE_MS: SOURCE_MS,
        SOURCE_MS_WARM: SOURCE_MS_WARM,
        IMMICH_SOURCE_MS: IMMICH_SOURCE_MS,
        IMMICH_SOURCE_MS_WARM: IMMICH_SOURCE_MS_WARM,
        SPAN_NASA: SPAN_NASA,
        SPAN_WIKI: SPAN_WIKI,
        SPAN_UNSPLASH: SPAN_UNSPLASH,
        IMMICH_PAGE: IMMICH_PAGE,
        LIVE_POOLS: LIVE_POOLS,
        MIX_AHEAD_BOOT: MIX_AHEAD_BOOT,
        MIX_AHEAD_FULL: MIX_AHEAD_FULL,
        MIX_PLAN_BOOT: MIX_PLAN_BOOT,
        MIX_PLAN_FULL: MIX_PLAN_FULL,
        MIX_GROW_MS: MIX_GROW_MS,
        HISTORY_MAX: HISTORY_MAX,
        SEEN_MAX: SEEN_MAX,
        CACHE_KEY: CACHE_KEY,
        SOURCE_NAMES: SOURCE_NAMES,
        PICK_CATALOG_MAX: PICK_CATALOG_MAX,
        IMMICH_STORE: IMMICH_STORE,
        UNSPLASH_KEY_STORE: UNSPLASH_KEY_STORE,
        WALLHAVEN_STORE: WALLHAVEN_STORE,
        BING: BING,
        BING_WINDOW: BING_WINDOW,
        UNSPLASH: UNSPLASH,
        UNSPLASH_PAGES: UNSPLASH_PAGES,
        UNSPLASH_PER_PAGE: UNSPLASH_PER_PAGE,
        WALLHAVEN: WALLHAVEN,
        IMMICH_XHR_MS: IMMICH_XHR_MS,
        TIMEOUT_MS: TIMEOUT_MS,
        DISPLAY_W: DISPLAY_W,
        DISPLAY_H: DISPLAY_H,
        DISPLAY_ATLEAST: DISPLAY_ATLEAST,
        dayKey: dayKey,
        todayKey: todayKey,
        daysAgoKey: daysAgoKey,
        keys: keys,
        httpError: httpError,
        xhrGet: xhrGet,
        xhrPostJson: xhrPostJson,
        preview: preview
    };
})();
