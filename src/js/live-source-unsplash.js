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
    var UNSPLASH_PER_PAGE = LiveCore.UNSPLASH_PER_PAGE;
    var normalize = LiveParsers.normalize;


    function unsplashApi(path) {
        return preview() ? '/api/live/unsplash?path=' + encodeURIComponent(path) : UNSPLASH + path;
    }

    function unsplashGet(path) {
        return xhrGet(unsplashApi(path), { Authorization: 'Client-ID ' + LiveState.unsplashKey });
    }

    function unsplashPhotosPath(page) {
        var c = LiveState.unsplashCollection;
        var query = 'per_page=' + UNSPLASH_PER_PAGE + '&page=' + page;
        if (c) return '/collections/' + encodeURIComponent(c) + '/photos?' + query;
        return '/photos?order_by=popular&' + query;
    }

    // The next photo in order from the collection (or the popular feed). The position is kept in
    // LiveState.stream until the collection or key changes. When the list runs out, it starts again.
    function fetchUnsplashNext() {
        var st = LiveState.stream;
        function step(tries) {
            if (tries > 3) return Promise.resolve(null);
            var page = st.unsplashPage || 1;
            return unsplashGet(unsplashPhotosPath(page)).then(function (data) {
                var list = parseUnsplashList(data);
                if (!list.length) {
                    st.unsplashPage = 1;
                    st.unsplashIndex = 0;
                    return page === 1 ? null : step(tries + 1);
                }
                var i = st.unsplashIndex || 0;
                if (i >= list.length) {
                    st.unsplashPage = page + 1;
                    st.unsplashIndex = 0;
                    return step(tries + 1);
                }
                st.unsplashIndex = i + 1;
                if (st.unsplashIndex >= list.length) {
                    st.unsplashPage = page + 1;
                    st.unsplashIndex = 0;
                }
                DevLog.log('Live wallpaper: Unsplash page ' + page + ' photo ' + (i + 1) + ' of ' + list.length +
                    (LiveState.unsplashCollection ? ' (collection ' + LiveState.unsplashCollection + ')' : ''));
                return list[i];
            }, function (e) {
                DevLog.log('Live wallpaper: Unsplash page ' + page + ' failed: ' + DevLog.errorText(e));
                throw e;
            });
        }
        return step(0);
    }

    function parseUnsplashImage(img) {
        if (!img || !img.urls || !img.urls.raw) return null;
        // Prefer landscape for TV unless Background → Portrait photos is On.
        if (!PhotoUtil.allowPortrait() && img.width > 0 && img.height > 0 && img.width < img.height) {
            return null;
        }
        // Size the raw URL to 1080p; regular/full API URLs are fixed-size.
        var raw = img.urls.raw;
        var file = raw + (raw.indexOf('?') === -1 ? '?' : '&') +
            'w=' + DISPLAY_W +
            '&h=' + DISPLAY_H +
            '&fit=max&q=85&auto=format';
        // Full title — screensaver marquees long lines (no ellipsis).
        var title = img.alt_description || img.description || 'Unsplash';
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
        fetchUnsplashNext: fetchUnsplashNext,
        trackUnsplash: trackUnsplash,
        parseUnsplashImage: parseUnsplashImage,
    };
})();
