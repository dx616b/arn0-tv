/*
 * wiki live wallpaper source: fetches and parses its pictures. Shared pool and queue state
 * lives in live-state.js; calls back into live-wallpaper.js go through LiveHooks.
 */
(function () {
    'use strict';

    var xhrGet = LiveCore.xhrGet;
    var preview = LiveCore.preview;
    var normalize = LiveParsers.normalize;
    var parseWikimediaPotd = LiveParsers.parseWikimediaPotd;


    function fetchWikimediaDay(ymd) {
        var p = ymd.split('-');
        var path = p[0] + '/' + p[1] + '/' + p[2];
        var url = preview()
            ? '/api/live/wikimedia?date=' + encodeURIComponent(ymd)
            : 'https://en.wikipedia.org/api/rest_v1/feed/featured/' + path;
        return xhrGet(url).then(function (data) {
            // Preview proxy returns a normalized entry; the TV gets the featured feed JSON.
            if (preview() && data && data.file) {
                var n = normalize(data);
                n.source = 'wikimedia';
                return n;
            }
            return parseWikimediaPotd(data, ymd);
        });
    }

    window.LiveSources = window.LiveSources || {};
    window.LiveSources.wiki = {
        fetchWikimediaDay: fetchWikimediaDay,
    };
})();
