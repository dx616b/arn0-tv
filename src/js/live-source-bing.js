/*
 * bing live wallpaper source: fetches and parses its pictures. Shared pool and queue state
 * lives in live-state.js; calls back into live-wallpaper.js go through LiveHooks.
 */
(function () {
    'use strict';

    var todayKey = LiveCore.todayKey;
    var xhrGet = LiveCore.xhrGet;
    var preview = LiveCore.preview;
    var BING = LiveCore.BING;
    var BING_WINDOW = LiveCore.BING_WINDOW;
    var normalize = LiveParsers.normalize;

    function cfg() { return LiveCore.cfg.apply(null, arguments); }

    function parseBingImage(img) {
        if (!img) return null;
        // urlbase is "/th?id=OHR.…"; do not strip at "?" from img.url (that yields "/th").
        var base = img.urlbase || '';
        if (!base && img.url) {
            var m = String(img.url).match(/^(\/th\?id=[^&_]+)/);
            base = m ? m[1] : '';
        }
        if (!base) return null;
        var hd = BING + base + '_1920x1080.jpg';
        var thumb = BING + base + '_320x180.jpg';
        var title = img.title || (img.copyright || '').split('(')[0].trim() || 'Bing daily';
        var credit = img.copyright || 'Bing';
        return normalize({
            key: String(img.startdate || title),
            title: title,
            file: hd,
            thumb: thumb,
            credit: credit,
            source: 'bing'
        });
    }

    function bingArchiveUrl(idx, n) {
        var query = 'idx=' + idx + '&n=' + n + '&mkt=' + encodeURIComponent(cfg().market);
        if (preview()) return '/api/live/bing?' + query;
        // Same TV URL as v0.6.15 — direct Bing (no CORS proxy).
        return BING + '/HPImageArchive.aspx?format=js&' + query;
    }

    function clearBingDay() {
        LiveState.bingDay = { day: '', market: '', entries: [], inflight: null };
    }

    // One HPImageArchive pull per day; further queue fills walk the cached list (no re-fetch).
    function ensureBingDayWindow() {
        var day = todayKey();
        var market = cfg().market;
        if (LiveState.bingDay.day === day && LiveState.bingDay.market === market && LiveState.bingDay.entries.length) {
            return Promise.resolve(LiveState.bingDay.entries);
        }
        if (LiveState.bingDay.inflight) return LiveState.bingDay.inflight;
        LiveState.bingDay.inflight = xhrGet(bingArchiveUrl(0, BING_WINDOW)).then(function (data) {
            var entries = (data.images || []).map(parseBingImage).filter(Boolean);
            LiveState.bingDay = { day: day, market: market, entries: entries, inflight: null };
            DevLog.log('Live wallpaper: bing day fetch ' + entries.length + ' (' + day + ', ' + market + ')');
            return entries;
        }, function (err) {
            LiveState.bingDay.inflight = null;
            throw err;
        });
        return LiveState.bingDay.inflight;
    }

    window.LiveSources = window.LiveSources || {};
    window.LiveSources.bing = {
        clearBingDay: clearBingDay,
        ensureBingDayWindow: ensureBingDayWindow,
    };
})();
