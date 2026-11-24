/*
 * Pure parsing helpers for the live wallpaper providers (no state, no network). Kept apart from
 * live-wallpaper.js so they can be unit-tested under node:test.
 */
(function () {
    'use strict';

    var DISPLAY_W = LiveCore.DISPLAY_W;

    // Share link as pasted: https://host[/prefix]/s/SLUG or https://host[/prefix]/share/KEY.
    function parseImmichLink(link) {
        var m = String(link || '').trim().match(/^(https?:\/\/.+?)\/(s|share)\/([A-Za-z0-9_-]+)\/?$/);
        if (!m) return null;
        return { origin: m[1], query: (m[2] === 's' ? 'slug=' : 'key=') + encodeURIComponent(m[3]) };
    }

    function decodeEntities(s) {
        return String(s || '')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#8211;/g, '\u2013')
            .replace(/&#(\d+);/g, function (_, n) {
                return String.fromCharCode(Number(n));
            });
    }

    function nasaFileOk(file) {
        if (!file || file.length < 12) return false;
        return !/nasa-logo|favicon|themes\/nasa-child|editor-page-nasa-logo/i.test(file);
    }

    var APOD_MONTHS = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    // WP titles look like "APOD: 2026 November 9 – Title" (no leading zero on the day).
    function apodSearchQuery(ymd) {
        var p = ymd.split('-');
        return 'APOD: ' + p[0] + ' ' + APOD_MONTHS[Number(p[1]) - 1] + ' ' + String(Number(p[2]));
    }

    function apodTitleOk(rendered, ymd) {
        var t = decodeEntities(String(rendered || '')).toLowerCase();
        var want = apodSearchQuery(ymd).toLowerCase();
        return t.indexOf(want) === 0;
    }

    function apodCleanTitle(rendered) {
        var title = decodeEntities(String(rendered || ''));
        title = title.replace(/^APOD:\s*/i, '')
            .replace(/^\d{4} [A-Za-z]+ \d{1,2}\s*[–-]\s*/, '')
            .replace(/\s*-\s*NASA Science\s*$/i, '')
            .trim();
        return title || 'NASA APOD';
    }

    function apodImageFromMedia(media) {
        var sizes = (media && media.media_details && media.media_details.sizes) || {};
        var pick = sizes['2048x2048'] || sizes.large || sizes['1536x1536'] || sizes.medium_large;
        var file = (pick && pick.source_url) || (media && media.source_url) || '';
        var thumb = (sizes.medium && sizes.medium.source_url) ||
            (sizes.thumbnail && sizes.thumbnail.source_url) || file;
        return { file: file, thumb: thumb };
    }

    // Feed image: thumbnail is ~960px, the original can be 5000px+. Ask the thumbnail
    // service for a sized version of the same file instead.
    function wikimediaSized(src, width) {
        var clean = src.split('?')[0];
        var m = clean.match(/^(.*\/thumb\/.+\/)\d+px-([^/]+)$/);
        return m ? m[1] + width + 'px-' + m[2] : clean;
    }

    // Cached rows may still prefer /original — rewrite to fullsize→preview→original.
    function scrubImmichUrls(entry) {
        if (!entry || !entry.file) return entry;
        var isImmich = entry.source === 'immich' ||
            String(entry.key || '').indexOf('immich:') === 0 ||
            /\/api\/assets\//.test(String(entry.file));
        if (!isImmich) return entry;
        var file = String(entry.file);
        if (file.indexOf('/original?') < 0) return entry;
        // /api/assets/{id}/original?key=… → …/thumbnail?size=fullsize&key=…
        var fullsize = file.replace(/\/original\?/, '/thumbnail?size=fullsize&');
        var preview = fullsize.replace('size=fullsize', 'size=preview');
        var thumb = fullsize.replace('size=fullsize', 'size=thumbnail');
        entry.file = fullsize;
        entry.fileFallback = preview;
        entry.fileFallbacks = [preview, file];
        if (!entry.thumb || String(entry.thumb).indexOf('/original') >= 0) entry.thumb = thumb;
        entry.source = entry.source || 'immich';
        return entry;
    }

    function normalize(entry) {
        scrubImmichUrls(entry);
        var out = PhotoUtil.entryFields(entry, entry.title != null ? entry.title : 'Live wallpaper');
        out.trackUrl = entry.trackUrl || '';
        out.source = entry.source || '';
        out.remote = true;
        return out;
    }

    function apodFromWp(post, media, ymd) {
        if (!post || !apodTitleOk(post.title && post.title.rendered, ymd)) return null;
        var img = apodImageFromMedia(media);
        if (!nasaFileOk(img.file)) return null;
        return normalize({
            key: 'nasa:' + ymd,
            title: apodCleanTitle(post.title && post.title.rendered),
            file: img.file,
            thumb: img.thumb || img.file,
            credit: 'NASA APOD',
            source: 'nasa'
        });
    }

    function parseWikimediaPotd(data, ymd) {
        var img = data && data.image;
        if (!img || !img.thumbnail || !img.thumbnail.source) return null;
        var title = String(img.title || '')
            .replace(/^File:/, '')
            .replace(/\.[a-z0-9]+$/i, '')
            .replace(/_/g, ' ');
        var artist = (img.artist && img.artist.text) || '';
        return normalize({
            key: 'wikimedia:' + ymd,
            title: title || 'Picture of the day',
            file: wikimediaSized(img.thumbnail.source, DISPLAY_W),
            thumb: wikimediaSized(img.thumbnail.source, 480),
            credit: 'Wikimedia Commons' + (artist ? ' · ' + artist : ''),
            source: 'wikimedia'
        });
    }

    window.LiveParsers = {
        parseImmichLink: parseImmichLink,
        decodeEntities: decodeEntities,
        nasaFileOk: nasaFileOk,
        apodSearchQuery: apodSearchQuery,
        apodTitleOk: apodTitleOk,
        apodCleanTitle: apodCleanTitle,
        apodImageFromMedia: apodImageFromMedia,
        wikimediaSized: wikimediaSized,
        scrubImmichUrls: scrubImmichUrls,
        normalize: normalize,
        apodFromWp: apodFromWp,
        parseWikimediaPotd: parseWikimediaPotd
    };
})();
