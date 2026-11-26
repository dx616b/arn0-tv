/*
 * Live wallpaper queue: decides which sources feed the Mix rotation. State lives in live-state.js.
 * The modules it depends on (pool, fill, history, roster, sources) are called directly.
 */
(function () {
    'use strict';

    var takeFromQueue = LiveFill.takeFromQueue;
    var reseedQueueFromCatalog = LiveFill.reseedQueueFromCatalog;
    var waitForFresh = LiveFill.waitForFresh;
    var fetchOne = LiveFill.fetchOne;
    var warmOne = LiveFill.warmOne;
    var pullFresh = LiveFill.pullFresh;
    var fillSourceQueue = LiveFill.fillSourceQueue;
    var padFromKnown = LiveFill.padFromKnown;
    var waitForPickCount = LiveFill.waitForPickCount;
    var warmSources = LiveFill.warmSources;
    var withTimeout = LiveFill.withTimeout;
    var nextOffset = LiveFill.nextOffset;

    var sourceQueue = LivePool.sourceQueue;
    var isDuplicate = LivePool.isDuplicate;
    var freshInQueue = LivePool.freshInQueue;
    var nextSlotStart = LivePool.nextSlotStart;
    var readyMixKeys = LivePool.readyMixKeys;
    var reshuffleMixOrder = LivePool.reshuffleMixOrder;
    var streamKeys = LivePool.streamKeys;
    var sourceAhead = LivePool.sourceAhead;
    var planSize = LivePool.planSize;
    var resetMixWarm = LivePool.resetMixWarm;

    var SOURCE_NAMES = LiveCore.SOURCE_NAMES;
    var normalize = LiveParsers.normalize;
    var keys = LiveCore.keys;
    var todayKey = LiveCore.todayKey;
    var CACHE_KEY = LiveCore.CACHE_KEY;
    var RETRY_MS = LiveCore.RETRY_MS;
    var MIX_GROW_MS = LiveCore.MIX_GROW_MS;
    var SOURCE_MS = LiveCore.SOURCE_MS;
    var SOURCE_MS_WARM = LiveCore.SOURCE_MS_WARM;
    var IMMICH_SOURCE_MS = LiveCore.IMMICH_SOURCE_MS;
    var IMMICH_SOURCE_MS_WARM = LiveCore.IMMICH_SOURCE_MS_WARM;

    function entryMatchesSource() { return LiveHistory.entryMatchesSource.apply(null, arguments); }
    function notify() { return LiveEvents.notify.apply(null, arguments); }
    function markSeen() { return LiveHistory.markSeen.apply(null, arguments); }
    function resetImmichState() { return LiveStores.resetImmichState.apply(null, arguments); }
    function resetStream() { return LiveRoster.resetStream.apply(null, arguments); }
    function wallhavenCategoryAllowed() { return LiveSources.wallhaven.wallhavenCategoryAllowed.apply(null, arguments); }
    function cfg() { return LiveCore.cfg.apply(null, arguments); }
    function needsSetup() { return LiveRoster.needsSetup.apply(null, arguments); }
    function clearBingDay() { return LiveSources.bing.clearBingDay.apply(null, arguments); }
    function list() { return LiveSources.picker.list.apply(null, arguments); }
    function providerMeta() { return LiveRoster.providerMeta.apply(null, arguments); }
    function remember() { return LiveHistory.remember.apply(null, arguments); }
    function polishImmich() { return LiveSources.immich.polishImmich.apply(null, arguments); }
    function polishWallhaven() { return LiveSources.wallhaven.polishWallhaven.apply(null, arguments); }
    function rememberPick() { return LiveSources.picker.rememberPick.apply(null, arguments); }
    function saveCache() { return LiveSources.cache.saveCache.apply(null, arguments); }

    function provider() { return LiveRoster.provider.apply(null, arguments); }
    function shuffleOn() { return LiveCore.shuffleOn.apply(null, arguments); }

    window.LiveSources = window.LiveSources || {};

    window.LiveSources = window.LiveSources || {};

    window.LiveSources = window.LiveSources || {};

    // Yield so Home/input stay responsive while the upcoming list builds.
    function planPause() {
        var ms = LiveState.stream.plan.length < 2 ? 0 : 150;
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    // Short timeout per try; Immich gets longer. Mix walks the roster in order on failure.
    // allowReuse: plan fill uses false so a small unique pool stops cleanly; takeNext may reuse.
    function advanceOne(g, allowReuse) {
        var keys = streamKeys();
        if (!keys.length) return Promise.reject(new Error('no sources'));
        var start = nextSlotStart(keys);
        var tries = 0;
        var maxTries = keys.length === 1 ? 2 : keys.length * 2;
        var reuse = !!allowReuse;

        function attempt() {
            if (g !== LiveState.generation) return Promise.reject(new Error('stale'));
            if (tries >= maxTries) return Promise.reject(new Error('all sources failed'));
            var slot = (start + tries) % keys.length;
            var k = keys[slot];
            tries++;
            var warm = freshInQueue(sourceQueue(k)) > 0;
            var ms = k === 'immich'
                ? (warm ? IMMICH_SOURCE_MS_WARM : IMMICH_SOURCE_MS)
                : (warm ? SOURCE_MS_WARM : SOURCE_MS);
            DevLog.log('Live wallpaper: plan ' + k + (warm ? ' (warm)' : ''));
            return withTimeout(fetchOne(k, reuse), ms).then(function (entry) {
                if (!entry || LiveHistory.isFailed(entry)) return attempt();
                if (k !== 'photos' && isDuplicate(entry)) {
                    entry.source = k;
                    sourceQueue(k).buf.push(entry);
                    rememberPick(entry, k);
                    if (keys.length > 1 && tries < maxTries) return attempt();
                    if (!reuse) return Promise.reject(new Error('no fresh photos'));
                }
                markSeen(entry);
                // Next Mix slot follows this one in roster order.
                if (keys.length > 1) {
                    LiveState.stream.sourceIndex = (slot + 1) % keys.length;
                }
                return entry;
            }, function (e) {
                DevLog.log('Live wallpaper: skip ' + k + ': ' + (e && e.message ? e.message : e));
                // Saved photos are a fixed list: when nothing is left to plan, stop at once.
                if (k === 'photos') return Promise.reject(e);
                return attempt();
            });
        }

        return attempt();
    }

    // Fill upcoming slots in the background; never notify (that re-applied wallpaper each slot).
    function fillPlan(delayMs) {
        if (LiveState.stream.filling) return LiveState.stream.filling;
        if (LiveState.planUniqueExhausted && LiveState.stream.plan.length > 0) return Promise.resolve();
        var g = LiveState.generation;
        var wait = delayMs > 0 ? delayMs : 0;

        function step() {
            if (g !== LiveState.generation) return Promise.resolve();
            if (document.hidden) return Promise.resolve();
            if (LiveState.stream.plan.length >= planSize()) {
                LiveState.planUniqueExhausted = false;
                return Promise.resolve();
            }
            // Plan fill never reuses — stop when the unique pool is exhausted.
            return advanceOne(g, false).then(function (entry) {
                if (g !== LiveState.generation || !entry) return;
                LiveState.stream.plan.push(entry);
                LiveState.planUniqueExhausted = false;
                // Prefetch Immich captions while the photo waits in the plan (not after show).
                if ((entry.credit || '').indexOf('Immich') === 0) polishImmich(entry);
                saveCache(provider());
                // Only warm the next decode when the plan was empty / just started.
                if (LiveState.stream.plan.length <= 2 && window.Wallpaper && Wallpaper.preloadAhead) {
                    Wallpaper.preloadAhead();
                }
                DevLog.log('Live wallpaper: planned ' + LiveState.stream.plan.length + '/' + planSize() +
                    ' (' + (entry.credit || entry.key) + ')');
                return planPause().then(step);
            }, function (e) {
                LiveState.planUniqueExhausted = true;
                DevLog.log('Live wallpaper: plan fill stopped: ' + (e && e.message ? e.message : e) +
                    (LiveState.stream.plan.length ? ' (' + LiveState.stream.plan.length + ' ready)' : ''));
            });
        }

        LiveState.stream.filling = new Promise(function (resolve) {
            setTimeout(resolve, wait);
        }).then(function () {
            if (g !== LiveState.generation || document.hidden) return;
            // Queue top-up is background — do not block plan slots on a full ahead fill.
            warmSources();
            return step();
        }).then(function () {
            if (g === LiveState.generation) {
                LiveState.stream.filling = null;
                if (window.Wallpaper && Wallpaper.preloadAhead) Wallpaper.preloadAhead();
            }
        }, function () {
            if (g === LiveState.generation) LiveState.stream.filling = null;
        });
        return LiveState.stream.filling;
    }

    // Paint now with search metadata; polish place/title in the background and notify
    // so the screen saver can refresh the caption without delaying the photo swap.
    function showEntry(entry) {
        remember(entry);
        Promise.resolve(entry)
            .then(polishImmich)
            .then(polishWallhaven)
            .then(function () {
                // Immediate — debounced notify can drop the polish update.
                notify(true);
            });
        return Promise.resolve(entry);
    }

    // Next photo from the planned list (or fetch one if the plan is empty).
    function takeNext() {
        var g = LiveState.generation;
        var want = provider();
        // Solo focus: only that source (never blank-tagged Mix leftovers).
        while (LiveState.stream.plan.length) {
            var ready = LiveState.stream.plan.shift();
            if (LiveHistory.isFailed(ready)) continue;
            if (want === 'mix' || (ready && ready.source === want)) {
                // Slot freed — unique pool may have room again.
                LiveState.planUniqueExhausted = false;
                // Defer plan top-up so the new photo can decode without competing for network/CPU.
                fillPlan(700);
                return showEntry(ready);
            }
        }
        LiveState.planUniqueExhausted = false;
        return advanceOne(g, true).then(function (entry) {
            if (g !== LiveState.generation || !entry) return null;
            fillPlan(700);
            return showEntry(entry);
        }, function (e) {
            if (!list().length) {
                LiveState.lastFailure = Date.now();
                LiveState.lastError = providerMeta().label + ' unavailable';
                notify();
            }
            DevLog.log('Live wallpaper: takeNext failed: ' + (e && e.message ? e.message : e));
            fillPlan(700);
            return null;
        });
    }

    // What the picker cache keeps from the queue: the plan, each source queue (capped to the
    // look-ahead) and the Mix order.
    function queuesSnapshot() {
        var out = {};
        SOURCE_NAMES.forEach(function (name) {
            // Every queued photo is saved: the source position already moved past them.
            out[name] = { buf: sourceQueue(name).buf.slice() };
        });
        return out;
    }

    function snapshot() {
        return {
            plan: LiveState.stream.plan,
            queues: queuesSnapshot(),
            mixOrder: LiveState.mixOrder.slice()
        };
    }

    // Restores what the picker cache saved for the queue. Legacy caches never restore the plan.
    function restore(raw) {
        if (raw.queues && typeof raw.queues === 'object') {
            SOURCE_NAMES.forEach(function (name) {
                var saved = raw.queues[name];
                if (!saved || !Array.isArray(saved.buf)) return;
                var beforeQ = saved.buf.length;
                sourceQueue(name).buf = saved.buf.map(normalize).filter(function (w) {
                    if (!entryMatchesSource(w, name)) return false;
                    // Drop Wallhaven rows from another category after a settings change.
                    if (name === 'wallhaven' && w.whCat && !wallhavenCategoryAllowed(w.whCat)) {
                        return false;
                    }
                    return true;
                }).map(function (w) {
                    w.source = name;
                    return w;
                });
                if (sourceQueue(name).buf.length !== Math.min(beforeQ, sourceAhead())) {
                    LiveState.cacheNeedsRewrite = true;
                }
            });
        }
        // Do not restore `plan` — legacy caches may still hold randomly picked slots.
        // Refill under current Mix roster rules (sequential per source, round-robin Mix).
        LiveState.stream.plan = [];
        if (Array.isArray(raw.mixOrder)) {
            LiveState.mixOrder = raw.mixOrder.filter(function (k) {
                return SOURCE_NAMES.indexOf(k) >= 0;
            });
        }
    }

    /*
     * Ensures a current photo quickly; the upcoming plan fills in the background.
     */
    function ensureDaily() {
        if (LiveState.fetching) return Promise.resolve(false);
        if (Date.now() - LiveState.lastFailure < LiveState.retryDelay) return Promise.resolve(false);

        var p = provider();
        var meta = providerMeta();
        if (needsSetup()) return Promise.resolve(false);

        if (list().length && p === 'bing' && LiveState.cachedMarket !== cfg().market) resetPool();

        // New calendar day: drop yesterday's Bing window so the next pull fetches today.
        if (LiveState.fetchedDay && LiveState.fetchedDay !== todayKey()) {
            LiveState.stream.bingWrapped = false;
            LiveState.stream.bing = 0;
            clearBingDay();
            LiveState.planUniqueExhausted = false;
        }

        var g = LiveState.generation;
        var before = keys(list());

        // Solo focus: ignore Mix leftovers still sitting in `items`.
        // Defer top-up so first Home paint / key presses are not fighting queue fills.
        if (list().length) {
            setTimeout(backgroundFill, 1600);
            return Promise.resolve(false);
        }

        LiveState.fetching = true;
        DevLog.log('Live wallpaper: first photo (' + meta.label + ')');
        return ensureOnDemand(g, before).then(function (changed) {
            if (g !== LiveState.generation) return false;
            LiveState.fetching = false;
            return changed;
        }, function () {
            if (g !== LiveState.generation) return false;
            LiveState.fetching = false;
            return false;
        });
    }

    // Top up queues + plan without blocking UI (after the first few are ready).
    // Mix: boot shallow, then grow slightly (still capped — not livePool ahead).
    function backgroundFill() {
        if (needsSetup()) return;
        // With background-support enabled the process stays alive behind other apps —
        // do not keep hitting Unsplash/Immich/… until Home is visible again.
        if (document.hidden) return;
        warmSources();
        if (provider() === 'mix' && LiveState.mixWarmPhase === 'boot' && !LiveState.mixGrowTimer) {
            LiveState.mixGrowTimer = setTimeout(function () {
                LiveState.mixGrowTimer = null;
                LiveState.mixWarmPhase = 'full';
                warmSources();
                if (!LiveState.planUniqueExhausted && LiveState.stream.plan.length < planSize()) fillPlan(80);
            }, MIX_GROW_MS);
        }
        if (!LiveState.planUniqueExhausted && LiveState.stream.plan.length < planSize()) fillPlan(120);
    }

    // Show one photo as soon as it is ready; top up the plan later so cold start stays snappy.
    function ensureOnDemand(g, beforeKeys) {
        function kickBackground() {
            LiveState.fetchedDay = todayKey();
            // First wallpaper paints; queues + plan keep filling in the background.
            setTimeout(backgroundFill, 1600);
            return beforeKeys !== keys(LiveState.items);
        }

        if (list().length) {
            fillPlan(0);
            return Promise.resolve(false);
        }
        while (LiveState.stream.plan.length) {
            var ready = LiveState.stream.plan.shift();
            if (provider() === 'mix' || (ready && ready.source === provider())) {
                return showEntry(ready).then(kickBackground);
            }
        }
        return advanceOne(g, true).then(function (entry) {
            if (g !== LiveState.generation || !entry) {
                setTimeout(backgroundFill, 1600);
                return false;
            }
            return showEntry(entry).then(kickBackground);
        }, function () {
            setTimeout(backgroundFill, 1600);
            return false;
        });
    }

    function emptyQueues() {
        var q = {};
        SOURCE_NAMES.forEach(function (name) {
            q[name] = { buf: [], filling: null };
        });
        return q;
    }

    function resetPool() {
        if (LiveState.stream) {
            LiveState.stream.unsplashPage = 1;
            LiveState.stream.unsplashIndex = 0;
        }
        LiveState.items = [];
        LiveState.seen = [];
        LiveState.pickCatalog = {};
        LiveState.pickTarget = {};
        LiveState.thumbWarm = {};
        LiveState.fetchedDay = '';
        LiveState.cachedProvider = '';
        LiveState.cachedMarket = '';
        LiveState.avoidSource = '';
        LiveState.mixOrder = [];
        clearBingDay();
        resetMixWarm();
        resetStream();
    }

    function loadOffsets(raw) {
        if (!raw || typeof raw !== 'object') return;
        ['bing', 'nasa', 'wiki', 'unsplash', 'sourceIndex'].forEach(function (k) {
            var n = Number(raw[k]);
            if (n >= 0 && isFinite(n)) LiveState.stream[k] = Math.floor(n);
        });
    }

    function upcoming() {
        var p = provider();
        if (p === 'mix') return LiveState.stream.plan.slice();
        return LiveState.stream.plan.filter(function (w) { return w && w.source === p; });
    }

    function planCount() {
        return LiveState.stream.plan.length;
    }

    function clearCache() {
        LiveState.generation++;
        LiveState.fetching = false;
        LiveState.lastFailure = 0;
        LiveState.retryDelay = RETRY_MS;
        LiveState.lastError = '';
        try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
        resetImmichState();
        resetPool();
    }

    // Drop upcoming slots only (keep the current photo); used when Shuffle toggles.
    // Shuffle On reshuffles the Mix provider list; playback stays round-robin after that.
    function rebuildPlan() {
        LiveState.generation++;
        LiveState.stream.plan = [];
        LiveState.stream.filling = null;
        LiveState.planUniqueExhausted = false;
        if (provider() === 'mix' && shuffleOn()) reshuffleMixOrder();
        else {
            LiveState.mixOrder = readyMixKeys().slice();
            LiveState.stream.sourceIndex = 0;
        }
        fillPlan();
        notify();
    }

    window.LiveQueue = {
        resetPool: resetPool,
        emptyQueues: emptyQueues,
        clearCache: clearCache,
        rebuildPlan: rebuildPlan,
        loadOffsets: loadOffsets,
        nextOffset: nextOffset,
        upcoming: upcoming,
        planCount: planCount,
        ensureOnDemand: ensureOnDemand,
        backgroundFill: backgroundFill,
        warmSources: warmSources,
        padFromKnown: padFromKnown,
        waitForPickCount: waitForPickCount,
        ensureDaily: ensureDaily,
        restore: restore,
        queuesSnapshot: queuesSnapshot,
        snapshot: snapshot,
        showEntry: showEntry,
        takeNext: takeNext,
        fillPlan: fillPlan,
        advanceOne: advanceOne,
        fillSourceQueue: fillSourceQueue,
        pullFresh: pullFresh,
        fetchOne: fetchOne,
        warmOne: warmOne,
        waitForFresh: waitForFresh,
        reseedQueueFromCatalog: reseedQueueFromCatalog,
        withTimeout: withTimeout,
        planPause: planPause,
        takeFromQueue: takeFromQueue,
    };
})();
