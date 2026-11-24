/*
 * Mutable state for the live wallpaper (provider pool, queue, cache bookkeeping). The providers
 * and the picker read and write it through window.LiveState; nothing else should hold a copy.
 */
(function () {
    'use strict';

    window.LiveState = {
        mixWarmPhase: 'boot',
        mixGrowTimer: null,
        items: [],
        seen: [],
        fetchedDay: '',
        cachedProvider: '',
        cachedMarket: '',
        fetching: false,
        lastFailure: 0,
        retryDelay: 5 * 60 * 1000,
        lastError: '',
        generation: 0,
        unsplashKey: '',
        unsplashCollection: '',
        wallhavenCategory: 'general',
        listeners: [],
        notifyTimer: null,
        saveTimer: null,
        pendingSaveProvider: '',
        planUniqueExhausted: false,
        bingDay: { day: '', market: '', entries: [], inflight: null },
        mixOrder: [],
        immichLink: '',
        stream: undefined,
        avoidSource: '',
        cacheNeedsRewrite: false,
        pickCatalog: {},
        pickTarget: {},
        thumbWarm: {},
    };
})();
