/*
 * Live wallpapers: Bing (no key), NASA APOD (no key), Wikimedia Picture of
 * the Day (no key), Wallhaven (no key, SFW), Unsplash (Access Key), Immich shared
 * album, or Mix (all ready sources).
 *
 * Metadata only in localStorage (url, title, credit, date key) — never image bytes.
 *
 * First photo shows as soon as one source returns; an upcoming playlist fills in the
 * background. Image bytes still load only when a photo's turn arrives. Each source is
 * fetched in order into its queue (Bing/NASA/Wiki/Unsplash day cursor, Wallhaven /
 * Immich pages). Photos are always taken in queue order. Shuffle only permutes the Mix
 * provider list; Mix then walks that list round-robin (never a random source per slot).
 * History, plan, offsets, queues, and a seen-key ring persist in localStorage.
 *
 * NASA APOD: science.nasa.gov WordPress image-article + media API (same path as v0.6.15).
 * Legacy apod.nasa.gov HTML shells / api.nasa.gov DEMO_KEY are not used.
 *
 * Unsplash Access Key: Settings → Background (saved on the TV). liveWallpaper.unsplashAccessKey
 * in config.local.js is used as a fallback when nothing has been saved. Stored separately so
 * Advanced → Export does not dump it. Image URLs are sized to 1920×1080 (fit=max); portraits skipped.
 *
 * Wallhaven: SFW only (purity=100). Exact resolutions=1920x1080 + ratios=16x9. Category in Settings.
 *
 * Browser preview (`npm run preview`) routes API calls through /api/live/* so Chrome
 * CORS does not block fetches; on the TV the real endpoints are used directly (as before).
 */
(function () {
    'use strict';

    var notify = LiveEvents.notify;

    var cfg = LiveCore.cfg;
    var shuffleOn = LiveCore.shuffleOn;
    var wallhavenCategoryMeta = LiveCore.wallhavenCategoryMeta;
    LiveHooks.notify = notify;
    LiveHooks.shuffleOn = shuffleOn;

    var resetPool = LiveQueue.resetPool;
    var emptyQueues = LiveQueue.emptyQueues;
    var clearCache = LiveQueue.clearCache;
    var rebuildPlan = LiveQueue.rebuildPlan;
    var loadOffsets = LiveQueue.loadOffsets;
    var nextOffset = LiveFill.nextOffset;
    var upcoming = LiveQueue.upcoming;
    var planCount = LiveQueue.planCount;
    var ensureOnDemand = LiveQueue.ensureOnDemand;
    var backgroundFill = LiveQueue.backgroundFill;
    var warmSources = LiveFill.warmSources;
    var padFromKnown = LiveFill.padFromKnown;
    var waitForPickCount = LiveFill.waitForPickCount;
    LiveHooks.notify = notify;

    var markSeen = LiveHistory.markSeen;
    var forgetSeenEntries = LiveHistory.forgetSeenEntries;
    var remember = LiveHistory.remember;
    var entryMatchesSource = LiveHistory.entryMatchesSource;
    var trim = LiveHistory.trim;
    LiveHooks.emptyQueues = emptyQueues;
    LiveHooks.notify = notify;

    var setMixMode = LiveRoster.setMixMode;
    var setMixSource = LiveRoster.setMixSource;
    var selectLiveProvider = LiveRoster.selectLiveProvider;
    var setSoloProvider = LiveRoster.setSoloProvider;
    var syncLiveProvider = LiveRoster.syncLiveProvider;
    var switchProvider = LiveRoster.switchProvider;
    var resetStream = LiveRoster.resetStream;
    var PROVIDERS = LiveCore.PROVIDERS;
    var mixSourceOn = LiveRoster.mixSourceOn;
    var unsplashConfigured = LiveRoster.unsplashConfigured;
    var immichConfigured = LiveRoster.immichConfigured;
    var provider = LiveRoster.provider;
    var providerMeta = LiveRoster.providerMeta;
    var providerLabelFor = LiveRoster.providerLabelFor;
    var mixSourceLabels = LiveRoster.mixSourceLabels;
    var switchableProviders = LiveRoster.switchableProviders;
    var mixModeOn = LiveRoster.mixModeOn;
    var needsSetup = LiveRoster.needsSetup;
    var deriveLiveProvider = LiveRoster.deriveLiveProvider;
    var migrateLiveMultiSelect = LiveRoster.migrateLiveMultiSelect;
    var WALLHAVEN_CATEGORIES = LiveCore.WALLHAVEN_CATEGORIES;
    LiveHooks.cfg = cfg;
    LiveHooks.wallhavenCategoryMeta = wallhavenCategoryMeta;

    var setUnsplashKey = LiveStores.setUnsplashKey;
    var setUnsplashCollection = LiveStores.setUnsplashCollection;
    var clearUnsplashKey = LiveStores.clearUnsplashKey;
    var applyUnsplashStore = LiveStores.applyUnsplashStore;
    var setWallhavenCategory = LiveStores.setWallhavenCategory;
    var setWallhavenTopics = LiveStores.setWallhavenTopics;
    var addWallhavenCustomTopic = LiveStores.addWallhavenCustomTopic;
    var removeWallhavenCustomTopic = LiveStores.removeWallhavenCustomTopic;
    var clearWallhavenSettings = LiveStores.clearWallhavenSettings;
    var applyWallhavenStore = LiveStores.applyWallhavenStore;
    var readImmichLink = LiveStores.readImmichLink;
    var setImmichLink = LiveStores.setImmichLink;
    var clearImmichLink = LiveStores.clearImmichLink;
    LiveHooks.backgroundFill = backgroundFill;
    LiveHooks.cfg = cfg;
    LiveHooks.ensureOnDemand = ensureOnDemand;
    LiveHooks.needsSetup = needsSetup;
    LiveHooks.provider = provider;
    LiveHooks.providerMeta = providerMeta;
    LiveHooks.resetPool = resetPool;

    var ensureDaily = LiveQueue.ensureDaily;
    LiveHooks.notify = notify;
    LiveHooks.provider = provider;
    LiveHooks.providerMeta = providerMeta;
    LiveHooks.remember = remember;

    var showEntry = LiveQueue.showEntry;
    var takeNext = LiveQueue.takeNext;
    LiveHooks.provider = provider;
    LiveHooks.warmSources = warmSources;

    LiveHooks.markSeen = markSeen;

    LiveHooks.forgetSeenEntries = forgetSeenEntries;
    LiveHooks.notify = notify;
    LiveHooks.padFromKnown = padFromKnown;
    LiveHooks.provider = provider;

    LiveHooks.nextOffset = nextOffset;

    LiveHooks.provider = provider;

    var sourceAhead = LivePool.sourceAhead;
    var planSize = LivePool.planSize;
    var pickBatch = LivePool.pickBatch;
    var effectiveAhead = LivePool.effectiveAhead;
    var LIVE_POOLS = LiveCore.LIVE_POOLS;
    var MIX_AHEAD_BOOT = LiveCore.MIX_AHEAD_BOOT;
    var MIX_AHEAD_FULL = LiveCore.MIX_AHEAD_FULL;
    var MIX_PLAN_BOOT = LiveCore.MIX_PLAN_BOOT;
    var MIX_PLAN_FULL = LiveCore.MIX_PLAN_FULL;
    LiveHooks.entryMatchesSource = entryMatchesSource;

    LiveHooks.provider = provider;

    var reshuffleMixOrder = LivePool.reshuffleMixOrder;
    var orderedMixKeys = LivePool.orderedMixKeys;
    var readyMixKeys = LivePool.readyMixKeys;
    var preloadPickThumbs = LiveSources.picker.preloadPickThumbs;
    var rememberPick = LiveSources.picker.rememberPick;
    var list = LiveSources.picker.list;
    var find = LiveSources.picker.find;
    var pickList = LiveSources.picker.pickList;
    var warmForPicker = LiveSources.picker.warmForPicker;
    var loadMorePicks = LiveSources.picker.loadMorePicks;
    var status = LiveSources.picker.status;

    var loadCache = LiveSources.cache.loadCache;
    var flushSaveCache = LiveSources.cache.flushSaveCache;
    var saveCache = LiveSources.cache.saveCache;
    var BING_WINDOW = LiveCore.BING_WINDOW;
    // Hooks for live-source-*.js and live-cache.js.
    LiveHooks.backgroundFill = backgroundFill;
    LiveHooks.cfg = cfg;
    LiveHooks.loadOffsets = loadOffsets;
    LiveHooks.markSeen = markSeen;
    LiveHooks.needsSetup = needsSetup;
    LiveHooks.notify = notify;
    LiveHooks.pickBatch = pickBatch;
    LiveHooks.provider = provider;
    LiveHooks.rememberPick = rememberPick;
    LiveHooks.resetPool = resetPool;
    LiveHooks.saveCache = saveCache;
    LiveHooks.sourceAhead = sourceAhead;
    LiveHooks.waitForPickCount = waitForPickCount;
    LiveRoster.configure({
        emptyQueues: emptyQueues
    });
    LiveHooks.wallhavenCategoryMeta = wallhavenCategoryMeta;

    // Planned upcoming + display history + long seen ring (dedup across days/restarts).
    // Tizen: keep catalog lean; browser preview can hold more.
    // Prefs.wallpaper.livePool → how many entries each source queue / plan aims for.
    // Bing’s public HP window is ~8; solo Bing cannot usefully target more.
    // Mix: tiny per-source buffers (round-robin does not need solo Queue depth).
    // Boot: 1 ahead / short plan; then grow slightly — never to full livePool ahead.
 // 'boot' | 'full'

    // Day/page cursors advance in order; span is only a soft upper bound for docs/wrap.
    // Bing’s public archive is ~8 days; NASA walks calendar days via image-article search.
    // Queue already has a fresh entry — do not wait the full cold timeout.
    // Immich is on the LAN but often colder on first hit (share + search); give it room.

    // Ring of { key, file } recently used — larger than history so days do not loop the same set.
    // Bumped whenever the pool is reset, so in-flight fetches for an old source are discarded.
    // Plan fill (no reuse) hit the unique pool ceiling — do not retry until a slot is consumed.
    // Bing HP window (~8 days): one network fetch per calendar day + market, then serve from RAM.

    // Coalesce UI refresh storms from queue/plan fills (Home/Settings listeners).
    // Mix provider walk order (Shuffle On = shuffled permutation; Off = SOURCE_NAMES order).

    resetStream();
    // After switching to Mix, skip the previous source for the first slot so Home does not
    // keep looking like Bing/NASA/… when that queue was already full.

    // True when loadCache dropped mis-tagged / oversize entries — rewrite later, not on the boot path.

    // Lasting catalog for Choose as static — queues are drained into the plan, so the
    // picker must not rely on buf.length alone. Also accumulates days past Bing’s API window.
    // Per-source how many catalog entries the picker should fetch/show (starts at pickBatch()).
    // Keep Image() handles so the HTTP cache stays warm for the Settings grid.

    /* ---------- Bing ---------- */

    /* ---------- NASA APOD (v0.6.15 image-article + media; proven on TV) ---------- */

    /* ---------- Wikimedia Picture of the Day ---------- */

    var normalize = LiveParsers.normalize;

    /* ---------- Unsplash ---------- */

    /* ---------- Wallhaven (SFW wallpapers) ---------- */

    /* ---------- Immich (shared album link) ---------- */

    /* ---------- On-demand (one photo at a time, all providers) ---------- */

    /* ---------- Daily refresh ---------- */

    applyUnsplashStore();
    applyWallhavenStore();
    LiveState.immichLink = readImmichLink();
    migrateLiveMultiSelect();
    syncLiveProvider();
    loadCache();
    trim();
    // Picks already restored in loadCache; seed from queues/items only when the picker opens.
    // Defer scrub rewrite so boot is not blocked on a large localStorage stringify.
    if (LiveState.cacheNeedsRewrite && LiveState.items.length) {
        setTimeout(function () { saveCache(LiveState.cachedProvider || provider(), true); }, 2500);
    }
    // Flush debounced cache if the page is leaving (TV app hide / preview refresh).
    window.addEventListener('pagehide', function () {
        if (LiveState.saveTimer) {
            clearTimeout(LiveState.saveTimer);
            LiveState.saveTimer = null;
            flushSaveCache();
        }
    });

    // Lab checks for photos: the addresses that would not load, and clearing them to try again.
    function photoActions() {
        return [
            { label: 'Photos: list addresses that will not load', run: function () {
                var keys = Object.keys(LiveState.failedFiles);
                DevLog.log('Photos: ' + keys.length + ' addresses will not load');
                keys.forEach(function (k) { DevLog.log('  ' + k); });
            } },
            { label: 'Photos: forget them and try again', run: function () {
                var n = Object.keys(LiveState.failedFiles).length;
                LiveState.failedFiles = {};
                DevLog.log('Photos: forgot ' + n + ' addresses');
            } }
        ];
    }

    window.LiveWallpaper = {
        PROVIDERS: PROVIDERS,
        actions: photoActions,
        list: list,
        pickList: pickList,
        warmForPicker: warmForPicker,
        loadMorePicks: loadMorePicks,
        pickBatch: pickBatch,
        planSize: planSize,
        effectiveAhead: effectiveAhead,
        LIVE_POOLS: LIVE_POOLS,
        BING_WINDOW: BING_WINDOW,
        MIX_AHEAD_BOOT: MIX_AHEAD_BOOT,
        MIX_AHEAD_FULL: MIX_AHEAD_FULL,
        MIX_PLAN_BOOT: MIX_PLAN_BOOT,
        MIX_PLAN_FULL: MIX_PLAN_FULL,
        preloadPickThumbs: preloadPickThumbs,
        find: find,
        ensureDaily: ensureDaily,
        clearCache: clearCache,
        switchProvider: switchProvider,
        rebuildPlan: rebuildPlan,
        fetchedDay: function () { return LiveState.fetchedDay; },
        provider: provider,
        providerLabel: function () { return providerMeta().label; },
        takeNext: takeNext,
        showPick: function (entry) {
            if (!entry || !entry.key || !entry.file) return null;
            return showEntry(normalize(entry));
        },
        upcoming: upcoming,
        planCount: planCount,
        mixSources: mixSourceLabels,
        freeSourceKeys: LiveRoster.freeSourceKeys,
        readyMixKeys: readyMixKeys,
        orderedMixKeys: orderedMixKeys,
        reshuffleMixOrder: reshuffleMixOrder,
        switchableProviders: switchableProviders,
        selectLiveProvider: selectLiveProvider,
        providerLabelFor: providerLabelFor,
        enabledSourceKeys: LiveRoster.enabledSourceKeys,
        mixSourceOn: mixSourceOn,
        setMixSource: setMixSource,
        setMixMode: setMixMode,
        setSoloProvider: setSoloProvider,
        mixModeOn: mixModeOn,
        deriveLiveProvider: deriveLiveProvider,
        syncLiveProvider: syncLiveProvider,
        status: status,
        needsSetup: needsSetup,
        onChange: function (fn) { LiveState.listeners.push(fn); },
        immichConfigured: immichConfigured,
        setImmichLink: setImmichLink,
        clearImmichLink: clearImmichLink,
        immichSummary: function () {
            return immichConfigured() ? 'Share link set' : 'Set share link';
        },
        unsplashConfigured: unsplashConfigured,
        setUnsplashKey: setUnsplashKey,
        clearUnsplashKey: clearUnsplashKey,
        unsplashCollection: function () { return LiveState.unsplashCollection; },
        setUnsplashCollection: setUnsplashCollection,
        unsplashKeySummary: function () {
            return unsplashConfigured() ? 'Access Key set' : 'Set Access Key';
        },
        unsplashCollectionSummary: function () {
            var id = LiveState.unsplashCollection;
            if (!id) return 'Popular photos';
            return id.length > 14 ? id.slice(0, 12) + '…' : id;
        },
        WALLHAVEN_CATEGORIES: WALLHAVEN_CATEGORIES,
        WALLHAVEN_TOPICS: LiveCore.WALLHAVEN_TOPICS,
        wallhavenCategory: function () { return LiveState.wallhavenCategory; },
        setWallhavenCategory: setWallhavenCategory,
        wallhavenTopics: function () { return LiveState.wallhavenTopics.slice(); },
        wallhavenCustomTopics: function () { return LiveState.wallhavenCustomTopics.slice(); },
        wallhavenTopicMeta: LiveCore.wallhavenTopicMeta,
        setWallhavenTopics: setWallhavenTopics,
        addWallhavenCustomTopic: addWallhavenCustomTopic,
        removeWallhavenCustomTopic: removeWallhavenCustomTopic,
        clearWallhavenSettings: clearWallhavenSettings,
        wallhavenCategorySummary: function () {
            return wallhavenCategoryMeta(LiveState.wallhavenCategory).label;
        },
        wallhavenTopicSummary: function () {
            var labels = LiveState.wallhavenTopics.map(function (key) {
                return LiveCore.wallhavenTopicMeta(key).label;
            });
            return labels.length ? labels.join(' + ') : 'Any topic';
        }
    };
})();
