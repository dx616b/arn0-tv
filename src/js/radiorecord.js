/*
 * Radio Record station list. Fetched from Radio Record's own station feed, cached for a day, and
 * kept when offline. Each station's stream addresses come straight from the feed. Pure parsers
 * are exposed for tests.
 */
(function () {
    'use strict';

    var FEED = 'https://www.radiorecord.ru/api/stations/';
    var CACHE_KEY = 'arn0.radiorecord.v1';
    var MAX_AGE_MS = 24 * 60 * 60 * 1000;

    var stations = null;

    function feedUrl() {
        return window.__TIZEN_MOCK__ ? '/api/live/radiorecord' : FEED;
    }

    // Feed JSON: { result: { stations: [ { prefix, title, genre: [{ name }], stream_128, stream_64, ... } ] } }
    function parseStations(json) {
        var root = json && json.result ? json.result : json;
        var list = root && Array.isArray(root.stations) ? root.stations : [];
        var out = [];
        list.forEach(function (s) {
            if (!s || !s.prefix || !s.title) return;
            var urls = [];
            [s.stream_128, s.stream_64].forEach(function (u) {
                if (typeof u === 'string' && /^https:\/\/\S+$/.test(u) && urls.indexOf(u) < 0) urls.push(u);
            });
            if (!urls.length) return;
            var genres = Array.isArray(s.genre) ? s.genre.map(function (g) { return g && g.name ? String(g.name) : ''; }) : [];
            out.push({
                id: 'rr:' + s.prefix,
                title: String(s.title).replace(/\s+/g, ' ').trim(),
                genre: genres.filter(Boolean)[0] || 'Other',
                credit: 'Radio Record',
                urls: urls
            });
        });
        return out;
    }

    // Each station is listed under its first genre. Genres with more stations come first.
    function groupByGenre(list) {
        var groups = {};
        (list || []).forEach(function (st) {
            var g = st.genre || 'Other';
            (groups[g] = groups[g] || []).push(st);
        });
        return Object.keys(groups).map(function (name) {
            return { genre: name, channels: groups[name] };
        }).sort(function (a, b) {
            return b.channels.length - a.channels.length || a.genre.localeCompare(b.genre);
        });
    }

    function readCache() {
        try {
            var raw = JSON.parse(localStorage.getItem(CACHE_KEY));
            if (raw && Array.isArray(raw.stations) && raw.stations.length) return raw;
        } catch (e) { /* ignore */ }
        return null;
    }

    function writeCache(list) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ fetched: Date.now(), stations: list }));
        } catch (e) { /* storage full or blocked */ }
    }

    function current() {
        if (stations) return stations;
        var cached = readCache();
        stations = cached ? cached.stations : [];
        return stations;
    }

    function isStale() {
        var cached = readCache();
        return !cached || Date.now() - cached.fetched > MAX_AGE_MS;
    }

    // Fetch the station list if the cached copy is missing or a day old. A failed fetch keeps the last good list.
    function refresh() {
        if (!isStale()) return Promise.resolve(current());
        return window.Http.xhrGet(feedUrl(), null, false).then(function (json) {
            var list = parseStations(json);
            if (list.length) {
                stations = list;
                writeCache(list);
            }
            return current();
        }, function () {
            return current();
        });
    }

    window.RadioRecord = {
        parseStations: parseStations,
        groupByGenre: groupByGenre,
        current: current,
        isStale: isStale,
        refresh: refresh
    };
})();
