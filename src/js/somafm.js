/*
 * SomaFM channel catalogue. The list comes from SomaFM's own channels.xml (CORS-enabled), is cached
 * for a day, and falls back to the last good copy when offline. A channel's stream URLs come from its
 * .pls playlist, resolved when the channel is chosen. Pure parsers are exposed for tests.
 */
(function () {
    'use strict';

    var FEED = 'https://somafm.com/channels.xml';
    var CACHE_KEY = 'arn0.somafm.v1';
    var MAX_AGE_MS = 24 * 60 * 60 * 1000;

    var channels = null;

    function unwrap(s) {
        return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/\s+/g, ' ').trim();
    }

    function tagText(block, tag) {
        var m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>'));
        return m ? unwrap(m[1]) : '';
    }

    // <highestpls format="aac">URL</highestpls>, <fastpls format="mp3">URL</fastpls> ...
    function plsFor(block, format) {
        var re = /<(?:highestpls|fastpls|slowpls)\s+format="([^"]+)">([^<]+)<\/(?:highestpls|fastpls|slowpls)>/g;
        var m;
        while ((m = re.exec(block))) {
            if (m[1] === format) return unwrap(m[2]);
        }
        return '';
    }

    function parseChannels(xml) {
        var out = [];
        var re = /<channel id="([^"]+)">([\s\S]*?)<\/channel>/g;
        var m;
        while ((m = re.exec(String(xml || '')))) {
            var block = m[2];
            var genres = tagText(block, 'genre').split('|').map(unwrap).filter(Boolean);
            out.push({
                id: m[1],
                title: tagText(block, 'title'),
                description: tagText(block, 'description'),
                dj: tagText(block, 'dj'),
                genres: genres,
                listeners: parseInt(tagText(block, 'listeners'), 10) || 0,
                pls: { mp3: plsFor(block, 'mp3'), aac: plsFor(block, 'aac') }
            });
        }
        return out.filter(function (c) { return c.id && c.title && (c.pls.mp3 || c.pls.aac); });
    }

    // A .pls file lists its stream mirrors as File1=..., File2=...
    function parsePls(text) {
        var urls = [];
        String(text || '').split(/\r?\n/).forEach(function (line) {
            var m = line.match(/^File\d+=(.+)$/);
            if (m && /^https?:\/\//.test(m[1].trim())) urls.push(m[1].trim());
        });
        return urls;
    }

    // Each channel is listed under its first genre. Genres with more channels come first; channels
    // inside a genre are ordered by listeners, so the busiest channels are at the top.
    function groupByGenre(list) {
        var groups = {};
        (list || []).forEach(function (c) {
            var g = c.genres[0] || 'Other';
            (groups[g] = groups[g] || []).push(c);
        });
        return Object.keys(groups).map(function (name) {
            var items = groups[name].slice().sort(function (a, b) {
                return b.listeners - a.listeners || a.title.localeCompare(b.title);
            });
            return { genre: name, channels: items };
        }).sort(function (a, b) {
            return b.channels.length - a.channels.length || a.genre.localeCompare(b.genre);
        });
    }

    function readCache() {
        try {
            var raw = JSON.parse(localStorage.getItem(CACHE_KEY));
            if (raw && Array.isArray(raw.channels) && raw.channels.length) return raw;
        } catch (e) { /* ignore */ }
        return null;
    }

    function writeCache(list) {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ fetched: Date.now(), channels: list }));
        } catch (e) { /* storage full or blocked: keep it in memory only */ }
    }

    // The list shown in the picker: memory, else the cached copy.
    function current() {
        if (channels) return channels;
        var cached = readCache();
        channels = cached ? cached.channels : [];
        return channels;
    }

    function isStale() {
        var cached = readCache();
        return !cached || Date.now() - cached.fetched > MAX_AGE_MS;
    }

    // Fetch the channel list if the cached copy is missing or a day old. Resolves to the list in use;
    // a failed fetch keeps the last good list.
    function refresh() {
        if (!isStale()) return Promise.resolve(current());
        return window.Http.xhrGet(FEED, null, true).then(function (xml) {
            var list = parseChannels(xml);
            if (list.length) {
                channels = list;
                writeCache(list);
            }
            return current();
        }, function () {
            return current();
        });
    }

    // Stream mirrors for one channel: MP3 playlist first, then AAC.
    function resolve(channel) {
        var jobs = [];
        if (channel.pls && channel.pls.mp3) jobs.push(channel.pls.mp3);
        if (channel.pls && channel.pls.aac) jobs.push(channel.pls.aac);
        return Promise.all(jobs.map(function (url) {
            return window.Http.xhrGet(url, null, true).then(parsePls, function () { return []; });
        })).then(function (lists) {
            var urls = [];
            lists.forEach(function (l) {
                l.forEach(function (u) { if (urls.indexOf(u) < 0) urls.push(u); });
            });
            return urls;
        });
    }

    window.SomaFM = {
        parseChannels: parseChannels,
        parsePls: parsePls,
        groupByGenre: groupByGenre,
        current: current,
        isStale: isStale,
        refresh: refresh,
        resolve: resolve
    };
})();
