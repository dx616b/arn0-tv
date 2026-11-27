/*
 * immich live wallpaper source: fetches and parses its pictures. Shared pool and queue state
 * lives in live-state.js; calls back into live-wallpaper.js go through LiveHooks.
 */
(function () {
    'use strict';

    var xhrGet = LiveCore.xhrGet;
    var preview = LiveCore.preview;
    var IMMICH_XHR_MS = LiveCore.IMMICH_XHR_MS;
    var parseImmichLink = LiveParsers.parseImmichLink;
    var normalize = LiveParsers.normalize;


    function immichApi(path) {
        var s = parseImmichLink(LiveState.immichLink);
        var url = s.origin + '/api' + path;
        return preview() ? '/api/live/immich?url=' + encodeURIComponent(url) : url;
    }

    function fetchImmichLinkData() {
        var s = parseImmichLink(LiveState.immichLink);
        if (!s) return Promise.reject(new Error('Immich share link required'));
        return xhrGet(immichApi('/shared-links/me?' + s.query), null, false, IMMICH_XHR_MS);
    }

    // Camera roll dumps (IMG_1234, PXL_…, DSC…) are not useful captions.
    function isDumpFilename(name) {
        return /^(IMG[_-]?|DSC[_N]?|DCIM|PXL_|MVIMG_|VID_|Screenshot|PHOTO[_-]?|PIC[_-]?|image[_-]?|WA\d)/i.test(name) ||
            /^\d{8}[_-]\d{6}/.test(name);
    }

    function immichExif(a) {
        return (a && a.exifInfo) || {};
    }

    // Immich reverse-geocode fields; countryCode is a fallback on older/partial EXIF.
    function immichPlace(a) {
        var x = immichExif(a);
        return [x.city, x.state, x.country || x.countryCode].filter(Boolean).join(', ');
    }

    function immichTitle(a, album) {
        var x = immichExif(a);
        var desc = String(x.description || a.description || '').trim();
        // Full description — screen saver / Home marquees long lines (no ellipsis).
        if (desc) return desc;
        var place = immichPlace(a);
        if (place) return place;
        var name = String(a.originalFileName || '').split(/[/\\]/).pop() || '';
        name = name.replace(/\.[a-z0-9]+$/i, '');
        if (name && !isDumpFilename(name)) return name;
        if (album) return album;
        return 'Immich';
    }

    function immichDate(a) {
        // localDateTime is the wall-clock time where the photo was taken; reading its date part
        // avoids shifting the day through the TV's own timezone.
        var x = immichExif(a);
        var m = String(a.localDateTime || x.dateTimeOriginal || a.fileCreatedAt || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return '';
        var when = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function exifNumber(value) {
        var n = Number(value);
        return isFinite(n) && n > 0 ? String(Math.round(n * 10) / 10) : '';
    }

    function immichCamera(a) {
        var x = immichExif(a);
        var make = String(x.make || '').trim();
        var model = String(x.model || '').trim();
        var camera = model && make && model.toLowerCase().indexOf(make.toLowerCase()) !== 0
            ? make + ' ' + model
            : (model || make);
        var parts = [];
        if (camera) parts.push(camera);
        var lens = String(x.lensModel || '').trim();
        if (lens && lens !== model) parts.push(lens);
        var focal = exifNumber(x.focalLength);
        if (focal) parts.push(focal + ' mm');
        var aperture = exifNumber(x.fNumber);
        if (aperture) parts.push('f/' + aperture);
        var exposure = String(x.exposureTime || '').trim();
        if (/^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/.test(exposure)) {
            parts.push(exposure + ' s');
        } else {
            var seconds = Number(exposure);
            if (isFinite(seconds) && seconds > 0) {
                parts.push(seconds < 1
                    ? ('1/' + Math.round(1 / seconds) + ' s')
                    : (exifNumber(seconds) + ' s'));
            }
        }
        var iso = Number(x.iso);
        if (isFinite(iso) && iso > 0) parts.push('ISO ' + Math.round(iso));
        return parts.join(' · ');
    }

    function immichEntry(a, origin, query, album) {
        var base = origin + '/api/assets/' + encodeURIComponent(a.id);
        var q = '&' + query;
        var place = immichPlace(a);
        var title = immichTitle(a, album);
        var date = immichDate(a);
        var subParts = [];
        if (place && title !== place && title.indexOf(place) !== 0) subParts.push(place);
        if (date) subParts.push(date);
        var camera = immichCamera(a);
        if (camera) subParts.push(camera);
        var sub = subParts.join(' · ');
        // Skip known portraits / tiny stills before they enter the Live queue (respects Portrait photos).
        var x = immichExif(a);
        var ew = Number(x.exifImageWidth) || Number(a.width) || 0;
        var eh = Number(x.exifImageHeight) || Number(a.height) || 0;
        if (ew && eh && PhotoUtil.homeFitReason(ew, eh)) return null;
        var original = base + '/original?' + query;
        var fullsize = base + '/thumbnail?size=fullsize' + q;
        var preview = base + '/thumbnail?size=preview' + q;
        // Smallest Immich derivative for the Settings grid (preview is too heavy per tile).
        var thumb = base + '/thumbnail?size=thumbnail' + q;
        return normalize({
            key: 'immich:' + a.id,
            title: title,
            sub: sub,
            // TV SoC stalls on multi-MP /original decode. Prefer Immich web derivatives
            // sized for display; original is last resort (also often blocked without download).
            file: fullsize,
            fileFallback: preview,
            fileFallbacks: [preview, original],
            thumb: thumb,
            credit: album ? 'Immich · ' + album : 'Immich',
            source: 'immich'
        });
    }

    function fetchImmichAsset(id) {
        var s = parseImmichLink(LiveState.immichLink);
        return xhrGet(immichApi('/assets/' + encodeURIComponent(id) + '?' + s.query), null, false, IMMICH_XHR_MS);
    }

    // Search hits often omit reverse-geocoded place; the asset endpoint usually has full EXIF.
    function mergeImmichAsset(searchHit, full) {
        if (!full) return searchHit;
        var merged = {};
        Object.keys(searchHit || {}).forEach(function (k) { merged[k] = searchHit[k]; });
        Object.keys(full).forEach(function (k) { merged[k] = full[k]; });
        merged.exifInfo = Object.assign({}, immichExif(searchHit), immichExif(full));
        if (!merged.localDateTime && searchHit.localDateTime) merged.localDateTime = searchHit.localDateTime;
        return merged;
    }

    function ensureImmichAlbum() {
        if (LiveState.stream.immichAlbum) return Promise.resolve(LiveState.stream.immichAlbum);
        return fetchImmichLinkData().then(function (link) {
            var s = parseImmichLink(LiveState.immichLink);
            if (!link.album || !link.album.id) throw new Error('Immich link is not an album');
            LiveState.stream.immichAlbum = {
                id: link.album.id,
                name: (link.album && link.album.albumName) || '',
                origin: s.origin,
                query: s.query
            };
            return LiveState.stream.immichAlbum;
        });
    }

    // Enrich place/title from /assets. Search withExif usually has description already;
    // this fills reverse-geocode gaps. Coalesced so plan prefetch + show share one request.
    function polishImmich(entry) {
        if (!entry || !entry.key || !LiveState.stream.immichAlbum) return Promise.resolve(entry);
        if ((entry.credit || '').indexOf('Immich') !== 0) return Promise.resolve(entry);
        if (entry._immichPolished) return Promise.resolve(entry);
        if (entry._immichPolish) return entry._immichPolish;
        var album = LiveState.stream.immichAlbum;
        // Catalog keys are "immich:<uuid>"; the assets API wants the bare id.
        var id = String(entry.key).replace(/^immich:/, '');
        if (!id) return Promise.resolve(entry);
        entry._immichPolish = fetchImmichAsset(id).then(function (full) {
            entry._immichPolished = true;
            entry._immichPolish = null;
            if (!full) return entry;
            var merged = mergeImmichAsset({ id: id, exifInfo: {} }, full);
            var better = immichEntry(merged, album.origin, album.query, album.name);
            if (!better) return entry;
            entry.title = better.title;
            entry.sub = better.sub;
            entry.file = better.file;
            entry.fileFallback = better.fileFallback;
            entry.fileFallbacks = better.fileFallbacks;
            entry.thumb = better.thumb;
            return entry;
        }, function () {
            entry._immichPolish = null;
            return entry;
        });
        return entry._immichPolish;
    }

    window.LiveSources = window.LiveSources || {};
    window.LiveSources.immich = {
        immichApi: immichApi,
        immichEntry: immichEntry,
        ensureImmichAlbum: ensureImmichAlbum,
        polishImmich: polishImmich,
    };
})();
