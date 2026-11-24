/*
 * Saved settings for the live wallpaper sources: Unsplash key and collection, Wallhaven category,
 * and the Immich share link. Each store is read and written through localStorage and mirrored into
 * the shared state in live-state.js; the modules it depends on are called directly.
 */
(function () {
    'use strict';

    var IMMICH_STORE = LiveCore.IMMICH_STORE;
    var UNSPLASH_KEY_STORE = LiveCore.UNSPLASH_KEY_STORE;
    var WALLHAVEN_STORE = LiveCore.WALLHAVEN_STORE;
    var WALLHAVEN_CATEGORIES = LiveCore.WALLHAVEN_CATEGORIES;

    function cfg() { return LiveCore.cfg.apply(null, arguments); }
    function wallhavenCategoryMeta() { return LiveCore.wallhavenCategoryMeta.apply(null, arguments); }

    function readUnsplashStore() {
        var raw = null;
        try { raw = JSON.parse(localStorage.getItem(UNSPLASH_KEY_STORE)); } catch (e) { /* ignore */ }
        raw = raw || {};
        return {
            accessKey: typeof raw.accessKey === 'string' ? raw.accessKey : (cfg().unsplashAccessKey || ''),
            collection: typeof raw.collection === 'string' ? raw.collection : (cfg().unsplashCollection || '')
        };
    }

    function saveUnsplashStore() {
        try {
            localStorage.setItem(UNSPLASH_KEY_STORE, JSON.stringify({
                accessKey: LiveState.unsplashKey,
                collection: LiveState.unsplashCollection
            }));
        } catch (e) {
            DevLog.log('Live wallpaper: could not save Unsplash settings');
        }
    }

    function setUnsplashKey(key) {
        LiveState.unsplashKey = String(key || '').trim();
        saveUnsplashStore();
    }

    function setUnsplashCollection(id) {
        LiveState.unsplashCollection = String(id || '').trim();
        saveUnsplashStore();
    }

    function clearUnsplashKey() {
        try { localStorage.removeItem(UNSPLASH_KEY_STORE); } catch (e) { /* ignore */ }
        applyUnsplashStore();
    }

    function applyUnsplashStore() {
        var s = readUnsplashStore();
        LiveState.unsplashKey = s.accessKey;
        LiveState.unsplashCollection = s.collection;
    }

    function readWallhavenStore() {
        var raw = null;
        try { raw = JSON.parse(localStorage.getItem(WALLHAVEN_STORE)); } catch (e) { /* ignore */ }
        raw = raw || {};
        var cat = typeof raw.category === 'string' ? raw.category : 'general';
        if (!WALLHAVEN_CATEGORIES.some(function (x) { return x.key === cat; })) cat = 'general';
        return { category: cat };
    }

    function saveWallhavenStore() {
        try {
            localStorage.setItem(WALLHAVEN_STORE, JSON.stringify({
                category: LiveState.wallhavenCategory
            }));
        } catch (e) {
            DevLog.log('Live wallpaper: could not save Wallhaven settings');
        }
    }

    function setWallhavenCategory(key) {
        var meta = wallhavenCategoryMeta(key);
        LiveState.wallhavenCategory = meta.key;
        saveWallhavenStore();
        resetWallhavenState();
    }

    function clearWallhavenSettings() {
        try { localStorage.removeItem(WALLHAVEN_STORE); } catch (e) { /* ignore */ }
        applyWallhavenStore();
        resetWallhavenState();
    }

    function resetWallhavenState() {
        // A search still running is for the old category: forget it, so the new one starts fresh.
        LiveState.wallhavenInflight = null;
        if (!LiveState.stream) return;
        LiveState.stream.plan = LiveState.stream.plan.filter(function (w) { return w.source !== 'wallhaven'; });
        LiveState.stream.wallhavenPage = 1;
        LiveState.stream.wallhavenSeed = '';
        LiveState.stream.wallhavenWrapped = false;
        if (LiveState.stream.queues && LiveState.stream.queues.wallhaven) {
            LiveState.stream.queues.wallhaven.buf = [];
            LiveState.stream.queues.wallhaven.filling = null;
        }
    }

    function applyWallhavenStore() {
        LiveState.wallhavenCategory = readWallhavenStore().category;
    }

    function readImmichLink() {
        try {
            var raw = JSON.parse(localStorage.getItem(IMMICH_STORE));
            if (raw && typeof raw.link === 'string') return raw.link;
        } catch (e) { /* ignore */ }
        return cfg().immichLink || '';
    }

    function resetImmichState() {
        if (!LiveState.stream) return;
        LiveState.stream.immichPage = 1;
        LiveState.stream.immichAlbum = null;
        LiveState.stream.immichWrapped = false;
        if (LiveState.stream.queues && LiveState.stream.queues.immich) {
            LiveState.stream.queues.immich.buf = [];
            LiveState.stream.queues.immich.filling = null;
        }
    }

    function setImmichLink(link) {
        LiveState.immichLink = String(link || '').trim();
        resetImmichState();
        try {
            localStorage.setItem(IMMICH_STORE, JSON.stringify({ link: LiveState.immichLink }));
        } catch (e) {
            DevLog.log('Live wallpaper: could not save Immich link');
        }
    }

    function clearImmichLink() {
        try { localStorage.removeItem(IMMICH_STORE); } catch (e) { /* ignore */ }
        resetImmichState();
        LiveState.immichLink = readImmichLink();
    }

    window.LiveStores = {
        readUnsplashStore: readUnsplashStore,
        saveUnsplashStore: saveUnsplashStore,
        setUnsplashKey: setUnsplashKey,
        setUnsplashCollection: setUnsplashCollection,
        clearUnsplashKey: clearUnsplashKey,
        applyUnsplashStore: applyUnsplashStore,
        readWallhavenStore: readWallhavenStore,
        saveWallhavenStore: saveWallhavenStore,
        setWallhavenCategory: setWallhavenCategory,
        clearWallhavenSettings: clearWallhavenSettings,
        resetWallhavenState: resetWallhavenState,
        applyWallhavenStore: applyWallhavenStore,
        readImmichLink: readImmichLink,
        resetImmichState: resetImmichState,
        setImmichLink: setImmichLink,
        clearImmichLink: clearImmichLink,
    };
})();
