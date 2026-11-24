/*
 * Which live wallpaper sources are on, which can run now, what the Live picker shows for them, and the
 * functions that change the roster (switching provider, Mix sources, Mix mode). Shared state is in
 * live-state.js; queue order comes from live-queue.js.
 */
(function () {
    'use strict';

    var SOURCE_NAMES = LiveCore.SOURCE_NAMES;
    var PROVIDERS = LiveCore.PROVIDERS;
    var parseImmichLink = LiveParsers.parseImmichLink;
    var RETRY_MS = LiveCore.RETRY_MS;
    var CACHE_KEY = LiveCore.CACHE_KEY;

    var deps = {};

    function configure(d) {
        deps = d;
    }

    function orderedMixKeys() { return LivePool.orderedMixKeys.apply(null, arguments); }
    function resetMixWarm() { return LivePool.resetMixWarm.apply(null, arguments); }
    function sourceQueue() { return LivePool.sourceQueue.apply(null, arguments); }
    function emptyQueues() { return deps.emptyQueues.apply(null, arguments); }
    function notify() { return LiveEvents.notify.apply(null, arguments); }

    function provider() {
        var p = window.Prefs && Prefs.get().wallpaper;
        var key = (p && p.liveProvider) || 'bing';
        return PROVIDERS.some(function (x) { return x.key === key; }) ? key : 'bing';
    }

    function providerMeta() {
        return PROVIDERS.find(function (x) { return x.key === provider(); }) || PROVIDERS[0];
    }

    function immichConfigured() {
        return !!parseImmichLink(LiveState.immichLink);
    }

    function providerConfigured() {
        var p = provider();
        if (p === 'unsplash') return unsplashConfigured();
        if (p === 'immich') return immichConfigured();
        return true;
    }

    function needsSetup() {
        return providerMeta().needsKey && !providerConfigured();
    }

    function unsplashConfigured() {
        return !!LiveState.unsplashKey;
    }

    function mixEnabledMap() {
        var p = window.Prefs && Prefs.get().wallpaper;
        return (p && p.mixEnabled && typeof p.mixEnabled === 'object') ? p.mixEnabled : {};
    }

    function mixSourceOn(key) {
        return mixEnabledMap()[key] !== false;
    }

    function defaultMixEnabled() {
        // Wallhaven defaults off so existing Mix rosters do not suddenly include it.
        return {
            bing: true,
            nasa: true,
            wikimedia: true,
            wallhaven: false,
            unsplash: true,
            immich: true
        };
    }

    function ensureMixEnabledMap(p) {
        var def = defaultMixEnabled();
        if (!p.mixEnabled || typeof p.mixEnabled !== 'object') {
            p.mixEnabled = def;
            return p.mixEnabled;
        }
        Object.keys(def).forEach(function (k) {
            if (p.mixEnabled[k] === undefined) p.mixEnabled[k] = def[k];
        });
        return p.mixEnabled;
    }

    // Free providers shipped in-app (no key / share link).
    function freeSourceKeys() {
        return ['bing', 'nasa', 'wikimedia', 'wallhaven'];
    }

    function sourceConfigured(key) {
        if (key === 'unsplash') return unsplashConfigured();
        if (key === 'immich') return immichConfigured();
        return freeSourceKeys().indexOf(key) >= 0;
    }

    // Sources the user has toggled on (Settings multi-select) — Mix roster.
    function enabledSourceKeys() {
        return SOURCE_NAMES.filter(mixSourceOn);
    }

    function mixSourceLabels() {
        return orderedMixKeys().map(function (k) {
            var meta = PROVIDERS.find(function (x) { return x.key === k; });
            return meta ? meta.label : k;
        });
    }

    /*
     * Screen saver ↑↓: every configured provider, plus Mix when Settings has 2+
     * enabled usable chips. Mix always uses that Settings roster; solo never
     * rewrites the chips.
     */
    function switchableProviders() {
        var list = SOURCE_NAMES.filter(sourceConfigured);
        if (enabledSourceKeys().filter(sourceConfigured).length >= 2) {
            list = list.concat(['mix']);
        }
        return list;
    }

    function providerLabelFor(key) {
        var meta = PROVIDERS.find(function (x) { return x.key === key; });
        return meta ? meta.label : key;
    }

    function mixModeOn() {
        return provider() === 'mix';
    }

    // Kept for tests / callers: what Settings would use if Mix were derived from chips.
    function deriveLiveProvider() {
        var on = enabledSourceKeys();
        if (mixModeOn()) return on.length ? 'mix' : 'bing';
        if (on.length === 1) return on[0];
        var cur = provider();
        if (cur !== 'mix' && on.indexOf(cur) >= 0) return cur;
        return on[0] || 'bing';
    }

    // One-shot: old prefs had liveProvider=single with mixEnabled all-true. Collapse
    // the map to that single source so multi-select chips match what Live was using.
    function migrateLiveMultiSelect() {
        var p = window.Prefs && Prefs.get().wallpaper;
        if (!p || p.liveMultiSelect) return;
        ensureMixEnabledMap(p);
        var prov = p.liveProvider || 'bing';
        if (prov !== 'mix' && SOURCE_NAMES.indexOf(prov) >= 0) {
            SOURCE_NAMES.forEach(function (k) {
                p.mixEnabled[k] = (k === prov);
            });
        }
        p.liveMultiSelect = true;
        Prefs.save();
    }

    function resetStream() {
        LiveState.stream = {
            sourceIndex: 0,
            bing: 0,
            bingWrapped: false,
            nasa: 0,
            wiki: 0,
            wallhavenPage: 1,
            wallhavenSeed: '',
            wallhavenWrapped: false,
            unsplash: 0,
            immichPage: 1,
            immichAlbum: null,
            immichWrapped: false,
            queues: emptyQueues(),
            plan: [],
            filling: null
        };
    }

    // Screen saver / focus choice: only liveProvider changes; mixEnabled stays Settings-owned.
    function selectLiveProvider(key) {
        var p = window.Prefs && Prefs.get().wallpaper;
        if (!p) return null;
        ensureMixEnabledMap(p);
        var choices = switchableProviders();
        if (choices.indexOf(key) < 0) return null;
        if (key === p.liveProvider) return key;
        p.liveProvider = key;
        p.liveKey = '';
        p.lastChange = Date.now();
        Prefs.save();
        switchProvider();
        return key;
    }

    // Settings Mix toggle: On → liveProvider=mix (roster = mixEnabled).
    // Off → one radio source; mixEnabled keeps the Mix roster for later.
    function setMixMode(on) {
        var p = window.Prefs && Prefs.get().wallpaper;
        if (!p) return mixModeOn();
        ensureMixEnabledMap(p);
        var prev = p.liveProvider || 'bing';
        if (on) {
            if (!enabledSourceKeys().length) p.mixEnabled.bing = true;
            p.liveProvider = 'mix';
        } else {
            var onKeys = enabledSourceKeys();
            if (prev !== 'mix' && onKeys.indexOf(prev) >= 0) {
                p.liveProvider = prev;
            } else {
                p.liveProvider = onKeys[0] || 'bing';
                if (!onKeys.length) p.mixEnabled.bing = true;
            }
        }
        Prefs.save();
        return p.liveProvider === 'mix';
    }

    // Mix Off: pick the single source to browse / play (does not clear the Mix roster).
    function setSoloProvider(key) {
        var p = window.Prefs && Prefs.get().wallpaper;
        if (!p || SOURCE_NAMES.indexOf(key) < 0) return provider();
        ensureMixEnabledMap(p);
        p.mixEnabled[key] = true;
        p.liveProvider = key;
        Prefs.save();
        return key;
    }

    /*
     * Soft coerce only: empty roster → Bing; invalid solo → first enabled.
     * Does not force Mix from chip count — Mix On/Off is an explicit Settings toggle.
     */
    function syncLiveProvider() {
        var p = window.Prefs && Prefs.get().wallpaper;
        if (!p) return false;
        migrateLiveMultiSelect();
        ensureMixEnabledMap(p);
        var prev = p.liveProvider || 'bing';
        var on = enabledSourceKeys();
        if (!on.length) {
            p.mixEnabled.bing = true;
            if (prev === 'mix') p.liveProvider = 'mix';
            else p.liveProvider = 'bing';
        } else if (prev === 'mix') {
            // Mix On: keep mix even with one source.
            p.liveProvider = 'mix';
        } else if (SOURCE_NAMES.indexOf(prev) < 0 || on.indexOf(prev) < 0) {
            p.liveProvider = on[0];
        }
        var next = p.liveProvider || 'bing';
        if (next !== prev) Prefs.save();
        return next !== prev;
    }

    // Toggle a source in the Mix roster. Keeps at least one on. Returns the new on-state.
    function setMixSource(key, on) {
        var p = window.Prefs && Prefs.get().wallpaper;
        if (!p) return mixSourceOn(key);
        ensureMixEnabledMap(p);
        if (SOURCE_NAMES.indexOf(key) < 0) return mixSourceOn(key);
        if (!on) {
            var still = SOURCE_NAMES.filter(function (k) {
                return k !== key && p.mixEnabled[k] !== false;
            });
            if (!still.length) return true; // refuse to disable the last source
        }
        p.mixEnabled[key] = !!on;
        Prefs.save();
        // Caller (Settings) updates liveProvider and re-renders; avoid notify races.
        return !!on;
    }

    function setLiveKey(key) {
        if (!key || !window.Prefs) return;
        var w = Prefs.get().wallpaper;
        if (w.liveKey === key) return;
        w.liveKey = key;
        w.lastChange = Date.now();
        Prefs.save();
    }

    // Provider change (e.g. Bing → Mix): drop shown history + plan so Home/SS do not keep the
    // previous photo. Solo→solo can keep the target queue; entering Mix clears every queue so
    // the previous solo pile cannot monopolise warm picks. Settings calls ensureLive(true);
    // SS calls takeNext — both kick plan fill after the first frame.
    function switchProvider() {
        var prev = '';
        if (LiveState.items.length && LiveState.items[LiveState.items.length - 1].source) prev = LiveState.items[LiveState.items.length - 1].source;
        else if (LiveState.cachedProvider && LiveState.cachedProvider !== 'mix') prev = LiveState.cachedProvider;
        var toMix = provider() === 'mix';
        LiveState.generation++;
        LiveState.fetching = false;
        LiveState.lastFailure = 0;
        LiveState.retryDelay = RETRY_MS;
        LiveState.lastError = '';
        LiveState.items = [];
        LiveState.fetchedDay = '';
        LiveState.cachedProvider = provider();
        // Mix: avoid re-painting the source you just left on the first frame only.
        LiveState.avoidSource = (toMix && prev) ? prev : '';
        resetMixWarm();
        LiveState.stream.plan = [];
        LiveState.stream.filling = null;
        LiveState.planUniqueExhausted = false;
        // Always clear queues + pick catalog — Mix leftovers (or blank-tagged
        // orphans once re-labelled) must not ride into a solo Immich focus.
        SOURCE_NAMES.forEach(function (name) {
            var q = sourceQueue(name);
            q.filling = null;
            q.buf = [];
        });
        // Fresh cursors so a stuck Bing idx / NASA wrap cannot starve the new focus.
        LiveState.stream.bing = 0;
        LiveState.stream.bingWrapped = false;
        // Keep today's Bing window across focus changes — only market/day invalidates it.
        LiveState.stream.nasa = 0;
        LiveState.stream.wiki = 0;
        LiveState.stream.wallhavenPage = 1;
        LiveState.stream.wallhavenSeed = '';
        LiveState.stream.wallhavenWrapped = false;
        LiveState.stream.unsplash = 0;
        LiveState.stream.immichPage = 1;
        LiveState.stream.immichWrapped = false;
        LiveState.stream.sourceIndex = 0;
        LiveState.pickCatalog = {};
        LiveState.pickTarget = {};
        try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
        notify(true);
    }

    window.LiveRoster = {
        configure: configure,
        mixEnabledMap: mixEnabledMap,
        mixSourceOn: mixSourceOn,
        defaultMixEnabled: defaultMixEnabled,
        ensureMixEnabledMap: ensureMixEnabledMap,
        enabledSourceKeys: enabledSourceKeys,
        freeSourceKeys: freeSourceKeys,
        sourceConfigured: sourceConfigured,
        providerConfigured: providerConfigured,
        unsplashConfigured: unsplashConfigured,
        immichConfigured: immichConfigured,
        provider: provider,
        providerMeta: providerMeta,
        providerLabelFor: providerLabelFor,
        mixSourceLabels: mixSourceLabels,
        switchableProviders: switchableProviders,
        mixModeOn: mixModeOn,
        needsSetup: needsSetup,
        deriveLiveProvider: deriveLiveProvider,
        migrateLiveMultiSelect: migrateLiveMultiSelect,
        setMixMode: setMixMode,
        setMixSource: setMixSource,
        selectLiveProvider: selectLiveProvider,
        setSoloProvider: setSoloProvider,
        syncLiveProvider: syncLiveProvider,
        switchProvider: switchProvider,
        setLiveKey: setLiveKey,
        resetStream: resetStream,
    };
})();
