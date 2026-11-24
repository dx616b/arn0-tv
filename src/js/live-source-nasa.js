/*
 * nasa live wallpaper source: fetches and parses its pictures. Shared pool and queue state
 * lives in live-state.js; calls back into live-wallpaper.js go through LiveHooks.
 */
(function () {
    'use strict';

    var xhrGet = LiveCore.xhrGet;
    var preview = LiveCore.preview;
    var nasaFileOk = LiveParsers.nasaFileOk;
    var apodSearchQuery = LiveParsers.apodSearchQuery;
    var apodTitleOk = LiveParsers.apodTitleOk;
    var normalize = LiveParsers.normalize;
    var apodFromWp = LiveParsers.apodFromWp;


    function fetchNasaDayWp(ymd) {
        var search = 'https://science.nasa.gov/wp-json/wp/v2/image-article?search=' +
            encodeURIComponent(apodSearchQuery(ymd)) + '&per_page=5';
        return xhrGet(search).then(function (list) {
            var post = (Array.isArray(list) ? list : []).find(function (p) {
                return apodTitleOk(p.title && p.title.rendered, ymd);
            });
            if (!post || !post.featured_media) throw new Error('empty NASA');
            return xhrGet('https://science.nasa.gov/wp-json/wp/v2/media/' + post.featured_media)
                .then(function (media) {
                    var entry = apodFromWp(post, media, ymd);
                    if (!entry) throw new Error('empty NASA');
                    return entry;
                });
        });
    }

    function fetchNasaDay(ymd) {
        // Preview: one proxied call returns the normalized entry (Chrome CORS).
        if (preview()) {
            return xhrGet('/api/live/apod?date=' + encodeURIComponent(ymd)).then(function (data) {
                if (!data || !data.file || !nasaFileOk(data.file)) throw new Error('empty NASA');
                var n = normalize(data);
                n.source = 'nasa';
                return n;
            });
        }
        return fetchNasaDayWp(ymd);
    }

    window.LiveSources = window.LiveSources || {};
    window.LiveSources.nasa = {
        fetchNasaDay: fetchNasaDay,
    };
})();
