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
    function wallhavenTopicMeta() { return LiveCore.wallhavenTopicMeta.apply(null, arguments); }

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
        var customTopics = (Array.isArray(raw.customTopics) ? raw.customTopics : [])
            .filter(function (q) { return typeof q === 'string' && q.trim(); })
            .map(function (q) { return q.trim().slice(0, 80); });
        var savedTopics = Array.isArray(raw.topics)
            ? raw.topics
            : (typeof raw.topic === 'string' && raw.topic !== 'any' ? [raw.topic] : []);
        var topics = [];
        savedTopics.forEach(function (value) {
            var topic = wallhavenTopicMeta(value);
            if (topic.custom && customTopics.indexOf(topic.query) < 0) customTopics.push(topic.query);
            if (topic.key !== 'any' && topics.indexOf(topic.key) < 0) topics.push(topic.key);
        });
        customTopics = customTopics.filter(function (q, i, list) { return list.indexOf(q) === i; });
        return { category: cat, topics: topics, customTopics: customTopics };
    }

    function saveWallhavenStore() {
        try {
            localStorage.setItem(WALLHAVEN_STORE, JSON.stringify({
                category: LiveState.wallhavenCategory,
                topics: LiveState.wallhavenTopics,
                customTopics: LiveState.wallhavenCustomTopics
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

    function setWallhavenTopics(values) {
        var topics = [];
        (Array.isArray(values) ? values : []).forEach(function (value) {
            var topic = wallhavenTopicMeta(value);
            if (topic.key === 'any') return;
            if (topic.custom && LiveState.wallhavenCustomTopics.indexOf(topic.query) < 0) return;
            if (topics.indexOf(topic.key) < 0) topics.push(topic.key);
        });
        if (topics.join('|') === LiveState.wallhavenTopics.join('|')) return;
        LiveState.wallhavenTopics = topics;
        saveWallhavenStore();
        resetWallhavenState();
    }

    function addWallhavenCustomTopic(query) {
        query = String(query || '').trim().slice(0, 80);
        if (!query) return '';
        if (LiveState.wallhavenCustomTopics.indexOf(query) < 0) {
            LiveState.wallhavenCustomTopics.push(query);
        }
        var key = 'custom:' + query;
        if (LiveState.wallhavenTopics.indexOf(key) < 0) LiveState.wallhavenTopics.push(key);
        saveWallhavenStore();
        resetWallhavenState();
        return key;
    }

    function removeWallhavenCustomTopic(query) {
        query = String(query || '').trim();
        var key = 'custom:' + query;
        var before = LiveState.wallhavenCustomTopics.length;
        LiveState.wallhavenCustomTopics = LiveState.wallhavenCustomTopics.filter(function (q) { return q !== query; });
        LiveState.wallhavenTopics = LiveState.wallhavenTopics.filter(function (topic) { return topic !== key; });
        if (before !== LiveState.wallhavenCustomTopics.length) {
            saveWallhavenStore();
            resetWallhavenState();
        }
    }

    function clearWallhavenSettings() {
        try { localStorage.removeItem(WALLHAVEN_STORE); } catch (e) { /* ignore */ }
        applyWallhavenStore();
        resetWallhavenState();
    }

    function resetWallhavenState() {
        // A search still running is for an old category/topic selection: discard it.
        LiveState.wallhavenInflight = null;
        Object.keys(LiveState.pickCatalog || {}).forEach(function (key) {
            if (LiveState.pickCatalog[key] && LiveState.pickCatalog[key].source === 'wallhaven') {
                delete LiveState.pickCatalog[key];
            }
        });
        if (LiveState.pickTarget) delete LiveState.pickTarget.wallhaven;
        Object.keys(LiveState.thumbWarm || {}).forEach(function (key) {
            if (key.indexOf('wallhaven:') === 0) delete LiveState.thumbWarm[key];
        });
        LiveState.items = (LiveState.items || []).filter(function (w) { return w.source !== 'wallhaven'; });
        if (!LiveState.stream) return;
        LiveState.stream.plan = LiveState.stream.plan.filter(function (w) { return w.source !== 'wallhaven'; });
        LiveState.stream.wallhavenPage = 1;
        LiveState.stream.wallhavenSeed = '';
        LiveState.stream.wallhavenWrapped = false;
        LiveState.stream.wallhavenTopicCursor = 0;
        LiveState.stream.wallhavenTopicSearches = {};
        if (LiveState.stream.queues && LiveState.stream.queues.wallhaven) {
            LiveState.stream.queues.wallhaven.buf = [];
            LiveState.stream.queues.wallhaven.filling = null;
        }
    }

    function applyWallhavenStore() {
        var saved = readWallhavenStore();
        LiveState.wallhavenCategory = saved.category;
        LiveState.wallhavenTopics = saved.topics;
        LiveState.wallhavenCustomTopics = saved.customTopics;
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
        LiveState.stream.immichIndex = 0;
        LiveState.stream.immichBatch = null;
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
        setWallhavenTopics: setWallhavenTopics,
        addWallhavenCustomTopic: addWallhavenCustomTopic,
        removeWallhavenCustomTopic: removeWallhavenCustomTopic,
        clearWallhavenSettings: clearWallhavenSettings,
        resetWallhavenState: resetWallhavenState,
        applyWallhavenStore: applyWallhavenStore,
        readImmichLink: readImmichLink,
        resetImmichState: resetImmichState,
        setImmichLink: setImmichLink,
        clearImmichLink: clearImmichLink,
    };
})();
