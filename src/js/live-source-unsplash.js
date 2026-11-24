/*
 * unsplash live wallpaper source: fetches and parses its pictures. Shared pool and queue state
 * lives in live-state.js; calls back into live-wallpaper.js go through LiveHooks.
 */
(function () {
    'use strict';

    var DISPLAY_W = LiveCore.DISPLAY_W;
    var DISPLAY_H = LiveCore.DISPLAY_H;
    var xhrGet = LiveCore.xhrGet;
    var preview = LiveCore.preview;
    var UNSPLASH = LiveCore.UNSPLASH;
    var UNSPLASH_PAGES = LiveCore.UNSPLASH_PAGES;
    var UNSPLASH_PER_PAGE = LiveCore.UNSPLASH_PER_PAGE;
    var normalize = LiveParsers.normalize;


    function unsplashApi(path) {
        return preview() ? '/api/live/unsplash?path=' + encodeURIComponent(path) : UNSPLASH + path;
    }

    function unsplashGet(path) {
        return xhrGet(unsplashApi(path), { Authorization: 'Client-ID ' + LiveState.unsplashKey });
    }

    // Unsplash has no photo-of-the-day endpoint. Each local calendar day maps to a fixed
    // slot in a fixed ordering (a collection, or popular photos), so a day always shows the
    // same photo, also after a restart. Pages cycle after UNSPLASH_PAGES to stay in range.
    function dayNumber(d) {
        return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    }

    function unsplashPhotosPath(page) {
        var c = LiveState.unsplashCollection;
        var query = 'per_page=' + UNSPLASH_PER_PAGE + '&page=' + page;
        if (c) return '/collections/' + encodeURIComponent(c) + '/photos?' + query;
        return '/photos?order_by=popular&' + query;
    }

    function fetchUnsplashDays(offsets) {
        var today = dayNumber(new Date());
        var slots = offsets.map(function (o) {
            var g = today - o;
            return {
                page: Math.floor(g / UNSPLASH_PER_PAGE) % UNSPLASH_PAGES + 1,
                index: g % UNSPLASH_PER_PAGE
            };
        });
        var pages = {};
        slots.forEach(function (s) { pages[s.page] = []; });
        return Promise.all(Object.keys(pages).map(function (p) {
            return unsplashGet(unsplashPhotosPath(p)).then(function (data) {
                pages[p] = parseUnsplashList(data);
            });
        })).then(function () {
            return slots.map(function (s) {
                var list = pages[s.page];
                return list.length ? list[s.index % list.length] : null;
            }).filter(Boolean);
        });
    }

    function parseUnsplashImage(img) {
        if (!img || !img.urls || !img.urls.raw) return null;
        // Prefer landscape for TV; skip portraits when dimensions are known.
        if (img.width > 0 && img.height > 0 && img.width < img.height) return null;
        // Size the raw URL to 1080p; regular/full API URLs are fixed-size.
        var raw = img.urls.raw;
        var file = raw + (raw.indexOf('?') === -1 ? '?' : '&') +
            'w=' + DISPLAY_W +
            '&h=' + DISPLAY_H +
            '&fit=max&q=85&auto=format';
        var title = img.alt_description || img.description || 'Unsplash';
        if (title.length > 48) title = title.slice(0, 45) + '…';
        var credit = (img.user && img.user.name) ? (img.user.name + ' on Unsplash') : 'Unsplash';
        return normalize({
            key: String(img.id || title),
            title: title,
            file: file,
            thumb: img.urls.small || file,
            credit: credit,
            trackUrl: (img.links && img.links.download_location) || '',
            source: 'unsplash'
        });
    }

    function parseUnsplashList(data) {
        var list = Array.isArray(data) ? data : (data ? [data] : []);
        return list.map(parseUnsplashImage).filter(Boolean);
    }

    // Unsplash API guidelines: report each photo the app actually shows.
    function trackUnsplash(entries) {
        entries.forEach(function (entry) {
            if (!entry.trackUrl || entry.trackUrl.indexOf(UNSPLASH) !== 0) return;
            xhrGet(unsplashApi(entry.trackUrl.slice(UNSPLASH.length)), { Authorization: 'Client-ID ' + LiveState.unsplashKey })
                .catch(function (e) {
                    DevLog.log('Live wallpaper: Unsplash download ping failed: ' + e.message);
                });
        });
    }

    window.LiveSources = window.LiveSources || {};
    window.LiveSources.unsplash = {
        fetchUnsplashDays: fetchUnsplashDays,
        trackUnsplash: trackUnsplash,
        parseUnsplashImage: parseUnsplashImage,
    };
})();
