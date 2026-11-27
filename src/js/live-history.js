/*
 * Recently shown photos and what has been seen: keeps the history and seen lists, drops entries that
 * are no longer wanted, and checks that a photo really belongs to the source it came from. Everything it
 * needs from the other modules is called directly.
 */
(function () {
    'use strict';

    var HISTORY_MAX = LiveCore.HISTORY_MAX;
    var SEEN_MAX = LiveCore.SEEN_MAX;
    var todayKey = LiveCore.todayKey;
    var RETRY_MS = LiveCore.RETRY_MS;

    function notify() { return LiveEvents.notify.apply(null, arguments); }
    function provider() { return LiveRoster.provider.apply(null, arguments); }
    function rememberPick() { return LiveSources.picker.rememberPick.apply(null, arguments); }
    function saveCache() { return LiveSources.cache.saveCache.apply(null, arguments); }
    function setLiveKey() { return LiveRoster.setLiveKey.apply(null, arguments); }
    function trackUnsplash() { return LiveSources.unsplash.trackUnsplash.apply(null, arguments); }

    function markSeen(entry) {
        if (!entry || !entry.key) return;
        LiveState.seen = LiveState.seen.filter(function (e) {
            return e.key !== entry.key && (!entry.file || e.file !== entry.file);
        });
        LiveState.seen.push({ key: entry.key, file: entry.file || '' });
        if (LiveState.seen.length > SEEN_MAX) LiveState.seen = LiveState.seen.slice(LiveState.seen.length - SEEN_MAX);
    }

    // Free sources have tiny unique pools (Bing ~8, NASA ~25). Once every key is in
    // `seen`, fill would refuse to queue anything — forget this batch so it can cycle.
    function forgetSeenEntries(entries) {
        if (!entries || !entries.length) return;
        var dropKey = {};
        var dropFile = {};
        entries.forEach(function (e) {
            if (!e) return;
            if (e.key) dropKey[e.key] = true;
            if (e.file) dropFile[e.file] = true;
        });
        LiveState.seen = LiveState.seen.filter(function (e) {
            return !dropKey[e.key] && !(e.file && dropFile[e.file]);
        });
    }

    // Drop Mix orphans / mis-tagged cache rows (e.g. Bing URL saved as Immich).
    function entryMatchesSource(w, name) {
        if (!w || !w.file || !name) return false;
        if (w.source && w.source !== name) return false;
        var f = String(w.file);
        var key = String(w.key || '');
        if (name === 'immich') {
            return /\/api\/assets\//.test(f) || key.indexOf('immich:') === 0;
        }
        if (name === 'bing') {
            return /bing\.net|bing\.com|\/th\?id=/i.test(f);
        }
        if (name === 'nasa') {
            return key.indexOf('nasa:') === 0 || /nasa\.gov|apod/i.test(f);
        }
        if (name === 'wikimedia') {
            return key.indexOf('wikimedia:') === 0 || /wikimedia|wikipedia/i.test(f);
        }
        if (name === 'unsplash') {
            return /unsplash\.com|images\.unsplash/i.test(f);
        }
        if (name === 'wallhaven') {
            return /wallhaven\.cc|whvn\.cc/i.test(f) || key.indexOf('wallhaven:') === 0;
        }
        return w.source === name;
    }

    function trim() {
        if (LiveState.items.length > HISTORY_MAX) LiveState.items = LiveState.items.slice(LiveState.items.length - HISTORY_MAX);
    }

    function remember(entry) {
        LiveState.items = LiveState.items.filter(function (w) { return w.key !== entry.key; });
        LiveState.items.push(entry);
        if (LiveState.items.length > HISTORY_MAX) LiveState.items = LiveState.items.slice(LiveState.items.length - HISTORY_MAX);
        if (entry.source) {
            LiveState.lastShown = LiveState.lastShown || {};
            LiveState.lastShown[entry.source] = entry.key;
        }
        markSeen(entry);
        rememberPick(entry, entry.source);
        setLiveKey(entry.key);
        if (entry.trackUrl) trackUnsplash([entry]);
        LiveState.fetchedDay = todayKey();
        LiveState.lastFailure = 0;
        LiveState.retryDelay = RETRY_MS;
        LiveState.lastError = '';
        // Debounced — sync localStorage + immediate notify made every photo change hitch on TV.
        saveCache(provider());
        // First Mix frame landed — later slots may use every ready source again.
        LiveState.avoidSource = '';
        DevLog.log('Live wallpaper: showing ' + (entry.credit || entry.title || entry.key) +
            (entry.source ? ' [' + entry.source + ']' : ''));
        notify();
        return entry;
    }

    // A photo whose address will not load: forget it everywhere, so no provider queues it again.
    function markFailed(entry) {
        if (!entry || !entry.file) return;
        var f = entry.file;
        if (LiveState.failedFiles[f]) return;
        LiveState.failedFiles[f] = true;
        Object.keys(LiveState.pickCatalog).forEach(function (k) {
            if (LiveState.pickCatalog[k] && LiveState.pickCatalog[k].file === f) delete LiveState.pickCatalog[k];
        });
        LiveState.items = LiveState.items.filter(function (w) { return w.file !== f; });
        if (LiveState.stream) {
            LiveState.stream.plan = LiveState.stream.plan.filter(function (w) { return w.file !== f; });
            Object.keys(LiveState.stream.queues || {}).forEach(function (name) {
                var q = LiveState.stream.queues[name];
                q.buf = q.buf.filter(function (w) { return w.file !== f; });
            });
        }
        DevLog.log('Live wallpaper: will not load, skipping from now on: ' + f);
    }

    function isFailed(entry) {
        return !!(entry && entry.file && LiveState.failedFiles[entry.file]);
    }

    // Drop Mix orphans / mis-tagged cache rows (e.g. Bing URL saved as Immich).
    window.LiveHistory = {
        markFailed: markFailed,
        isFailed: isFailed,
        markSeen: markSeen,
        forgetSeenEntries: forgetSeenEntries,
        remember: remember,
        entryMatchesSource: entryMatchesSource,
        trim: trim,
    };
})();
