/*
 * Live wallpaper pool primitives: the per-source queues, duplicate checks, slot order, Mix order and
 * pool sizes. Both the plan (live-queue.js) and the fill (live-fill.js) layers build on these.
 * Shared state is in live-state.js; roster answers come from live-roster.js.
 */
(function () {
    'use strict';

    var LIVE_POOLS = LiveCore.LIVE_POOLS;
    var SOURCE_NAMES = LiveCore.SOURCE_NAMES;
    var BING_WINDOW = LiveCore.BING_WINDOW;
    var MIX_AHEAD_BOOT = LiveCore.MIX_AHEAD_BOOT;
    var MIX_AHEAD_FULL = LiveCore.MIX_AHEAD_FULL;
    var MIX_PLAN_BOOT = LiveCore.MIX_PLAN_BOOT;
    var MIX_PLAN_FULL = LiveCore.MIX_PLAN_FULL;
    var shuffleOn = LiveCore.shuffleOn;
    var provider = LiveRoster.provider;
    var enabledSourceKeys = LiveRoster.enabledSourceKeys;
    var freeSourceKeys = LiveRoster.freeSourceKeys;
    var sourceConfigured = LiveRoster.sourceConfigured;

    // Enabled chips that can actually fetch right now (stable SOURCE_NAMES order).
    function readyMixKeys() {
        var on = enabledSourceKeys().filter(sourceConfigured);
        // Nothing ready (e.g. only Unsplash/Immich on, no key yet) → use free in-app sources.
        var keys = on.length ? on : freeSourceKeys();
        return SOURCE_NAMES.filter(function (k) { return keys.indexOf(k) >= 0; });
    }

    function reshuffleMixOrder() {
        LiveState.mixOrder = readyMixKeys().slice();
        var i;
        for (i = LiveState.mixOrder.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = LiveState.mixOrder[i];
            LiveState.mixOrder[i] = LiveState.mixOrder[j];
            LiveState.mixOrder[j] = t;
        }
        LiveState.stream.sourceIndex = 0;
    }

    // Shuffle On: walk a permuted Mix roster; Off: fixed SOURCE_NAMES order. Always sequential.
    function orderedMixKeys() {
        var ready = readyMixKeys();
        if (!shuffleOn() || ready.length < 2) {
            LiveState.mixOrder = ready.slice();
            return ready;
        }
        var kept = LiveState.mixOrder.filter(function (k) { return ready.indexOf(k) >= 0; });
        ready.forEach(function (k) {
            if (kept.indexOf(k) < 0) kept.push(k);
        });
        if (!kept.length || kept.length !== ready.length) {
            reshuffleMixOrder();
            return LiveState.mixOrder.slice();
        }
        LiveState.mixOrder = kept;
        return LiveState.mixOrder.slice();
    }

    function streamKeys() {
        var p = provider();
        if (p === 'mix') return orderedMixKeys();
        // Solo focus always stays on that key. Unconfigured Immich/Unsplash → empty
        // stream (setup status), never silent free-source Mix.
        return sourceConfigured(p) ? [p] : [];
    }

    function knownKeys() {
        var map = {};
        LiveState.seen.forEach(function (e) { map[e.key] = true; });
        LiveState.items.forEach(function (w) { map[w.key] = true; });
        LiveState.stream.plan.forEach(function (w) { map[w.key] = true; });
        return map;
    }

    function isDuplicate(entry) {
        if (!entry) return true;
        var map = knownKeys();
        if (map[entry.key]) return true;
        if (!entry.file) return false;
        if (LiveState.seen.some(function (e) { return e.file === entry.file; })) return true;
        if (LiveState.items.some(function (w) { return w.file === entry.file; })) return true;
        return LiveState.stream.plan.some(function (w) { return w.file === entry.file; });
    }

    // A photo that failed to load is never queued again (reported as present).
    function queueHas(q, entry) {
        if (LiveHistory.isFailed(entry)) return true;
        return q.buf.some(function (w) {
            return w.key === entry.key || (entry.file && w.file === entry.file);
        });
    }

    // Drop at most `limit` already-seen entries — only after replacements were added.
    function dropStale(q, limit) {
        if (limit <= 0) return;
        var dropped = 0;
        q.buf = q.buf.filter(function (w) {
            if (dropped >= limit) return true;
            if (!isDuplicate(w)) return true;
            dropped++;
            return false;
        });
    }

    function freshInQueue(q) {
        return q.buf.filter(function (w) { return !isDuplicate(w); }).length;
    }

    function sourceQueue(name) {
        if (!LiveState.stream.queues[name]) LiveState.stream.queues[name] = { buf: [], filling: null };
        return LiveState.stream.queues[name];
    }

    function livePool() {
        var key = window.Prefs && Prefs.get().wallpaper && Prefs.get().wallpaper.livePool;
        return LIVE_POOLS[key] || LIVE_POOLS.small;
    }

    function sourceAhead() { return livePool().ahead; }

    function planSize() {
        var n = livePool().plan;
        // Mix: keep the upcoming list short so APIs are not all hit at once.
        if (provider() === 'mix') {
            n = Math.min(n, LiveState.mixWarmPhase === 'boot' ? MIX_PLAN_BOOT : MIX_PLAN_FULL);
        }
        if (provider() === 'bing') n = Math.min(n, BING_WINDOW);
        return n;
    }

    function pickBatch() {
        var n = livePool().pick;
        if (provider() === 'bing') n = Math.min(n, BING_WINDOW);
        return n;
    }

    // Effective per-source queue target (Mix stays shallow; solo uses livePool).
    function effectiveAhead() {
        var n;
        if (provider() !== 'mix') n = sourceAhead();
        else if (LiveState.mixWarmPhase === 'full') n = Math.min(MIX_AHEAD_FULL, sourceAhead());
        else n = Math.min(MIX_AHEAD_BOOT, sourceAhead());
        if (provider() === 'bing') n = Math.min(n, BING_WINDOW);
        return n;
    }

    function resetMixWarm() {
        LiveState.mixWarmPhase = 'boot';
        if (LiveState.mixGrowTimer) {
            clearTimeout(LiveState.mixGrowTimer);
            LiveState.mixGrowTimer = null;
        }
    }

    // Mix: strict round-robin over orderedMixKeys (Shuffle only changed that order).
    // Honour avoidSource so the first Mix frame after a switch is not the provider you left.
    function nextSlotStart(keys) {
        if (!keys.length) return 0;
        if (keys.length === 1) return 0;
        if (LiveState.avoidSource) {
            var a;
            for (a = 0; a < keys.length; a++) {
                if (keys[a] !== LiveState.avoidSource) return a;
            }
        }
        return ((LiveState.stream.sourceIndex % keys.length) + keys.length) % keys.length;
    }

    window.LivePool = {
        sourceQueue: sourceQueue,
        knownKeys: knownKeys,
        isDuplicate: isDuplicate,
        queueHas: queueHas,
        dropStale: dropStale,
        freshInQueue: freshInQueue,
        nextSlotStart: nextSlotStart,
        readyMixKeys: readyMixKeys,
        reshuffleMixOrder: reshuffleMixOrder,
        orderedMixKeys: orderedMixKeys,
        streamKeys: streamKeys,
        livePool: livePool,
        sourceAhead: sourceAhead,
        planSize: planSize,
        pickBatch: pickBatch,
        effectiveAhead: effectiveAhead,
        resetMixWarm: resetMixWarm,
    };
})();
