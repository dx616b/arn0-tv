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
    function wallhavenTopicMeta() { return LiveCore.wallhavenTopicMeta.apply(null, arguments); }

    function wallhavenApi(pathQuery) {
        var path = pathQuery.indexOf('/') === 0 ? pathQuery : '/' + pathQuery;
        return preview()
            ? '/api/live/wallhaven?path=' + encodeURIComponent(path)
            : WALLHAVEN + path;
    }

    // Search all Wallhaven categories; user-selected topic queries provide the subject filter.
    function wallhavenCategoryFlags() { return '111'; }

    function wallhavenCategoryAllowed() { return true; }

    function wallhavenTopicKeys() {
        return LiveState.wallhavenTopics && LiveState.wallhavenTopics.length
            ? LiveState.wallhavenTopics.slice()
            : ['any'];
    }

    function wallhavenTopicSignature() { return JSON.stringify(wallhavenTopicKeys()); }

    function wallhavenTopicAllowed(entryTopic) {
        var selected = LiveState.wallhavenTopics || [];
        if (!selected.length) return true;
        return !!entryTopic && selected.indexOf(wallhavenTopicMeta(entryTopic).key) >= 0;
    }

    function wallhavenSearchPath(page, seed, topicKey) {
        var cat = wallhavenCategoryFlags();
        if (topicKey == null) topicKey = wallhavenTopicKeys()[0];
        var topic = wallhavenTopicMeta(topicKey);
        // Exact 1080p only — Wallhaven has no resize CDN; `atleast` would still return 4K originals.
        // purity=100 SFW only (sketchy/nsfw need an API key per docs).
        var q =
            'purity=100' +
            '&categories=' + cat +
            '&resolutions=' + encodeURIComponent(DISPLAY_ATLEAST) +
            '&ratios=16x9' +
            '&sorting=random' +
            '&page=' + page;
        if (topic.query) q += '&q=' + encodeURIComponent(topic.query);
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

    function wallhavenTitleFromTags(tags) {
        var names = (Array.isArray(tags) ? tags : []).map(function (t) {
            return t && t.name ? String(t.name).trim() : '';
        }).filter(Boolean);
        var rich = names.filter(function (n) {
            return !WALLHAVEN_SKIP_TAGS[n.toLowerCase()];
        });
        if (!rich.length) rich = names;
        if (!rich.length) return '';
        // Full tag line — screensaver marquees overflow (no ellipsis).
        return rich.join(' · ');
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

    function parseWallhavenImage(w, topicKey) {
        if (!w || !w.path || !w.id) return null;
        // Honour selected category even if the API ignores a bad flags string.
        if (!wallhavenCategoryAllowed(w.category)) return null;
        // Landscape preferred (API ratios=16x9); still drop portraits unless Portrait photos is On.
        if (!PhotoUtil.allowPortrait() && w.dimension_x > 0 && w.dimension_y > 0 &&
                w.dimension_x < w.dimension_y) {
            return null;
        }
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
        entry.whTopic = wallhavenTopicMeta(topicKey == null ? wallhavenTopicKeys()[0] : topicKey).key;
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

    function fetchWallhavenPageNow(tries) {
        var st = LiveState.stream;
        var topics = wallhavenTopicKeys();
        var signature = wallhavenTopicSignature();
        var slot = (Math.floor(Number(st.wallhavenTopicCursor) || 0) % topics.length);
        var topicKey = topics[slot];
        if (!st.wallhavenTopicSearches) st.wallhavenTopicSearches = {};
        var search = st.wallhavenTopicSearches[topicKey];
        if (!search) {
            search = st.wallhavenTopicSearches[topicKey] = { page: 1, seed: '', wrapped: false, pendingEntries: [] };
        }
        while (search.pendingEntries && search.pendingEntries.length) {
            var pending = search.pendingEntries.shift();
            if (!pending || !wallhavenTopicAllowed(pending.whTopic)) continue;
            st.wallhavenTopicCursor = (slot + 1) % topics.length;
            return Promise.resolve({ entries: [pending] });
        }
        var page = search.page || 1;
        var seed = search.seed || '';
        var path = wallhavenSearchPath(page, seed, topicKey);
        DevLog.log('Live wallpaper: Wallhaven ' + path.replace(/^\//, '') +
            ' (topic ' + wallhavenTopicMeta(topicKey).label + ')');
        return xhrGet(wallhavenApi(path)).then(function (res) {
            // Topics changed while this search ran: discard results for the old selection.
            if (signature !== wallhavenTopicSignature()) {
                return { entries: [], stale: true };
            }
            st.wallhavenTopicCursor = (slot + 1) % topics.length;
            var list = (res && Array.isArray(res.data)) ? res.data : [];
            var meta = (res && res.meta) || {};
            if (meta.seed && !search.seed) search.seed = String(meta.seed);
            var entries = list.map(function (w) {
                return parseWallhavenImage(w, topicKey);
            }).filter(Boolean);
            if (!entries.length) {
                if (page > 1 && !search.wrapped) {
                    search.page = 1;
                    search.seed = '';
                    search.wrapped = true;
                    return { entries: [], wrapped: true };
                }
                if (topics.length > 1 && (tries || 0) < topics.length - 1) {
                    return fetchWallhavenPageNow((tries || 0) + 1);
                }
                if (page <= 1) throw new Error('empty Wallhaven topic: ' + wallhavenTopicMeta(topicKey).label);
                return { entries: [], done: true };
            }
            search.page = page + 1;
            search.wrapped = false;
            search.pendingEntries = entries.slice(1);
            return { entries: [entries[0]] };
        });
    }

    window.LiveSources = window.LiveSources || {};
    window.LiveSources.wallhaven = {
        wallhavenCategoryAllowed: wallhavenCategoryAllowed,
        wallhavenTopicAllowed: wallhavenTopicAllowed,
        wallhavenSearchPath: wallhavenSearchPath,
        polishWallhaven: polishWallhaven,
        parseWallhavenImage: parseWallhavenImage,
        fetchWallhavenDetail: fetchWallhavenDetail,
        fetchWallhavenPage: fetchWallhavenPage,
    };
})();
