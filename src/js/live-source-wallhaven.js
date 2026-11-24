/*
 * wallhaven live wallpaper source: fetches and parses its pictures. Shared pool and queue state
 * lives in live-state.js; calls back into live-wallpaper.js go through LiveHooks.
 */
(function () {
    'use strict';

    var DISPLAY_W = LiveCore.DISPLAY_W;
    var DISPLAY_H = LiveCore.DISPLAY_H;
    var DISPLAY_ATLEAST = LiveCore.DISPLAY_ATLEAST;
    var xhrGet = LiveCore.xhrGet;
    var preview = LiveCore.preview;
    var WALLHAVEN = LiveCore.WALLHAVEN;
    var normalize = LiveParsers.normalize;

    function provider() { return LiveHooks.provider.apply(null, arguments); }
    function rememberPick() { return LiveHooks.rememberPick.apply(null, arguments); }
    function saveCache() { return LiveHooks.saveCache.apply(null, arguments); }
    function wallhavenCategoryMeta() { return LiveCore.wallhavenCategoryMeta.apply(null, arguments); }

    function wallhavenApi(pathQuery) {
        var path = pathQuery.indexOf('/') === 0 ? pathQuery : '/' + pathQuery;
        return preview()
            ? '/api/live/wallhaven?path=' + encodeURIComponent(path)
            : WALLHAVEN + path;
    }

    // Docs: categories bit flags — general=100, anime=010, people=001 (combine, e.g. 111=all).
    // Keep as a 3-char string; numeric coercion of "010" becomes 10 and breaks the filter.
    function wallhavenCategoryFlags() {
        var f = String(wallhavenCategoryMeta(LiveState.wallhavenCategory).flags || '100');
        if (!/^[01]{3}$/.test(f)) f = '100';
        return f;
    }

    function wallhavenCategoryAllowed(apiCategory) {
        if (LiveState.wallhavenCategory === 'all') return true;
        var c = String(apiCategory || '').toLowerCase();
        if (!c) return true;
        return c === LiveState.wallhavenCategory;
    }

    function wallhavenSearchPath(page, seed) {
        var cat = wallhavenCategoryFlags();
        // Exact 1080p only — Wallhaven has no resize CDN; `atleast` would still return 4K originals.
        // purity=100 SFW only (sketchy/nsfw need an API key per docs).
        var q =
            'purity=100' +
            '&categories=' + cat +
            '&resolutions=' + encodeURIComponent(DISPLAY_ATLEAST) +
            '&ratios=16x9' +
            '&sorting=random' +
            '&page=' + page;
        if (seed) q += '&seed=' + encodeURIComponent(seed);
        return '/search?' + q;
    }

    // Search hits omit tags/uploader; detail `/w/{id}` has them (polished on show).
    var WALLHAVEN_SKIP_TAGS = {
        'simple background': 1,
        'black background': 1,
        'white background': 1,
        'gradient': 1,
        'dark': 1,
        'light': 1,
        'artwork': 1,
        'digital art': 1
    };

    function wallhavenCap(s, n) {
        s = String(s || '').trim();
        if (!s) return '';
        return s.length > n ? s.slice(0, n - 1) + '…' : s;
    }

    function wallhavenTitleFromTags(tags) {
        var names = (Array.isArray(tags) ? tags : []).map(function (t) {
            return t && t.name ? String(t.name).trim() : '';
        }).filter(Boolean);
        var rich = names.filter(function (n) {
            return !WALLHAVEN_SKIP_TAGS[n.toLowerCase()];
        });
        if (!rich.length) rich = names;
        if (!rich.length) return '';
        return wallhavenCap(rich.slice(0, 2).join(' · '), 48);
    }

    // Caption fields only — never apply size filters here (detail polish must always run).
    function wallhavenCaptionFields(w) {
        var cat = w && w.category ? String(w.category) : '';
        var catLabel = cat ? (cat.charAt(0).toUpperCase() + cat.slice(1)) : '';
        var title = wallhavenTitleFromTags(w && w.tags) || catLabel || 'Wallhaven';
        var uploader = w && w.uploader && w.uploader.username ? String(w.uploader.username) : '';
        var credit = uploader
            ? (uploader + ' on Wallhaven')
            : ('Wallhaven' + (catLabel ? ' · ' + catLabel : ''));
        return {
            title: title,
            sub: '',
            credit: credit
        };
    }

    function parseWallhavenImage(w) {
        if (!w || !w.path || !w.id) return null;
        // Honour selected category even if the API ignores a bad flags string.
        if (!wallhavenCategoryAllowed(w.category)) return null;
        // Landscape only (ratios=16x9 already; double-check dimensions when present).
        if (w.dimension_x > 0 && w.dimension_y > 0 && w.dimension_x < w.dimension_y) return null;
        // Hard cap — no 1440p/UHD originals (Wallhaven serves the file as-is).
        if (w.dimension_x > DISPLAY_W || w.dimension_y > DISPLAY_H) return null;
        // 1080p PNG can be several MB; only skip extremes that decode poorly on TV.
        if (w.file_size && w.file_size > 8 * 1024 * 1024) return null;
        var cap = wallhavenCaptionFields(w);
        var entry = normalize({
            key: 'wallhaven:' + w.id,
            title: cap.title,
            sub: cap.sub,
            file: w.path,
            thumb: (w.thumbs && (w.thumbs.large || w.thumbs.small)) || w.path,
            credit: cap.credit,
            source: 'wallhaven'
        });
        entry.whCat = String(w.category || LiveState.wallhavenCategory || '').toLowerCase();
        return entry;
    }

    // After one failed detail request, stop asking for ten minutes; the photo still shows without its caption.
    function fetchWallhavenDetail(id) {
        if (!id || LiveState.wallhavenDetailDownUntil > Date.now()) return Promise.resolve(null);
        return xhrGet(wallhavenApi('/w/' + encodeURIComponent(id))).then(function (res) {
            return (res && res.data) || null;
        }, function (e) {
            LiveState.wallhavenDetailDownUntil = Date.now() + 10 * 60 * 1000;
            DevLog.log('Live wallpaper: Wallhaven detail failed (paused 10 min): ' +
                (e && e.message ? e.message : e));
            return null;
        });
    }

    // Like Immich polish: search rows lack tags/uploader; fill caption after paint.
    function polishWallhaven(entry) {
        if (!entry || !entry.key) return Promise.resolve(entry);
        if (entry.source !== 'wallhaven' && String(entry.key).indexOf('wallhaven:') !== 0) {
            return Promise.resolve(entry);
        }
        var id = String(entry.key).replace(/^wallhaven:/, '');
        if (!id) return Promise.resolve(entry);
        return fetchWallhavenDetail(id).then(function (full) {
            if (!full) return entry;
            var cap = wallhavenCaptionFields(full);
            entry.title = cap.title;
            entry.sub = cap.sub;
            entry.credit = cap.credit;
            entry.source = 'wallhaven';
            rememberPick(entry, 'wallhaven');
            // Keep Use-now snapshot in sync if this shot is frozen as Photo.
            try {
                var wp = Prefs.get().wallpaper;
                if (wp.tempPhoto && wp.tempPhoto.key === entry.key) {
                    wp.tempPhoto.title = entry.title;
                    wp.tempPhoto.sub = entry.sub;
                    wp.tempPhoto.credit = entry.credit;
                    Prefs.save();
                }
            } catch (e) { /* ignore */ }
            saveCache(provider());
            return entry;
        }, function () { return entry; });
    }

    // Several fills can ask for the same page at once; they share one request.
    function fetchWallhavenPage() {
        if (LiveState.wallhavenInflight) return LiveState.wallhavenInflight;
        var p = fetchWallhavenPageNow().then(function (r) {
            LiveState.wallhavenInflight = null;
            return r;
        }, function (e) {
            LiveState.wallhavenInflight = null;
            throw e;
        });
        LiveState.wallhavenInflight = p;
        return p;
    }

    function fetchWallhavenPageNow() {
        var page = LiveState.stream.wallhavenPage || 1;
        var seed = LiveState.stream.wallhavenSeed || '';
        var category = LiveState.wallhavenCategory;
        var path = wallhavenSearchPath(page, seed);
        DevLog.log('Live wallpaper: Wallhaven ' + path.replace(/^\//, '') +
            ' (want ' + category + ')');
        return xhrGet(wallhavenApi(path)).then(function (res) {
            // The category changed while this search ran: its results belong to the old category.
            if (category !== LiveState.wallhavenCategory) return { entries: [], stale: true };
            var list = (res && Array.isArray(res.data)) ? res.data : [];
            var meta = (res && res.meta) || {};
            if (meta.seed && !LiveState.stream.wallhavenSeed) LiveState.stream.wallhavenSeed = String(meta.seed);
            var entries = list.map(parseWallhavenImage).filter(Boolean);
            if (!entries.length) {
                if (page <= 1) throw new Error('empty Wallhaven');
                if (!LiveState.stream.wallhavenWrapped) {
                    LiveState.stream.wallhavenWrapped = true;
                    LiveState.stream.wallhavenPage = 1;
                    LiveState.stream.wallhavenSeed = '';
                    return { entries: [], wrapped: true };
                }
                return { entries: [], done: true };
            }
            LiveState.stream.wallhavenPage = page + 1;
            LiveState.stream.wallhavenWrapped = false;
            return { entries: entries };
        });
    }

    window.LiveSources = window.LiveSources || {};
    window.LiveSources.wallhaven = {
        wallhavenCategoryAllowed: wallhavenCategoryAllowed,
        polishWallhaven: polishWallhaven,
        parseWallhavenImage: parseWallhavenImage,
        fetchWallhavenDetail: fetchWallhavenDetail,
        fetchWallhavenPage: fetchWallhavenPage,
    };
})();
