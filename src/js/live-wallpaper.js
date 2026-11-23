/*
 * Live wallpapers: Bing (no key), NASA APOD (no key), Wikimedia Picture of
 * the Day (no key), Unsplash (Access Key), Immich shared album, or Mix (all ready sources).
 *
 * Metadata only in localStorage (url, title, credit, date key) — never image bytes.
 *
 * First photo shows as soon as one source returns; an upcoming playlist fills in the
 * background. Image bytes still load only when a photo's turn arrives. Each source is
 * fetched in order into its queue (Bing/NASA/Wiki/Unsplash day cursor, Immich pages).
 * Photos are always taken in queue order. Shuffle only permutes the Mix provider list;
 * Mix then walks that list round-robin (never a random source per slot). History, plan,
 * offsets, queues, and a seen-key ring persist in localStorage.
 *
 * NASA APOD: science.nasa.gov WordPress image-article + media API (same path as v0.6.15).
 * Legacy apod.nasa.gov HTML shells / api.nasa.gov DEMO_KEY are not used.
 *
 * Unsplash Access Key: Settings → Background (saved on the TV). liveWallpaper.unsplashAccessKey
 * in config.local.js is used as a fallback when nothing has been saved. Stored separately so
 * Advanced → Export does not dump it.
 *
 * Browser preview (`npm run preview`) routes API calls through /api/live/* so Chrome
 * CORS does not block fetches; on the TV the real endpoints are used directly (as before).
 */
(function () {
    'use strict';

    var CACHE_KEY = 'arn0.liveWallpaper.v11';
    var IMMICH_STORE = 'arn0.immich.v1';
    var UNSPLASH_KEY_STORE = 'arn0.unsplash.v1';
    var TIMEOUT_MS = 15000;
    var BING = 'https://www.bing.com';
    var UNSPLASH = 'https://api.unsplash.com';
    var UNSPLASH_PER_PAGE = 30;
    var UNSPLASH_PAGES = 50;
    // Planned upcoming + display history + long seen ring (dedup across days/restarts).
    var HISTORY_MAX = 120;
    var SEEN_MAX = 400;
    // Tizen: keep catalog lean; browser preview can hold more.
    var PICK_CATALOG_MAX = (typeof tizen !== 'undefined') ? 80 : 120;
    // Prefs.wallpaper.livePool → how many entries each source queue / plan aims for.
    var LIVE_POOLS = {
        small: { label: '8', ahead: 8, plan: 5, pick: 3 },
        normal: { label: '20', ahead: 20, plan: 10, pick: 5 },
        large: { label: '40', ahead: 40, plan: 15, pick: 10 }
    };
    // Mix: fill one ahead first so the first frame wins; grow later.
    var MIX_AHEAD_BOOT = 1;
    var MIX_GROW_MS = 5000;
    var mixWarmPhase = 'boot'; // 'boot' | 'full'
    var mixGrowTimer = null;

    function livePool() {
        var key = window.Prefs && Prefs.get().wallpaper && Prefs.get().wallpaper.livePool;
        return LIVE_POOLS[key] || LIVE_POOLS.small;
    }

    function sourceAhead() { return livePool().ahead; }
    function planSize() {
        var n = livePool().plan;
        // Mix boot: shorter upcoming list until queues catch up.
        if (provider() === 'mix' && mixWarmPhase === 'boot') return Math.min(n, 3);
        return n;
    }
    function pickBatch() { return livePool().pick; }
    // Effective per-source queue target (Mix boots small, then grows to sourceAhead).
    function effectiveAhead() {
        if (provider() !== 'mix') return sourceAhead();
        if (mixWarmPhase === 'full') return sourceAhead();
        return Math.min(MIX_AHEAD_BOOT, sourceAhead());
    }
    function resetMixWarm() {
        mixWarmPhase = 'boot';
        if (mixGrowTimer) {
            clearTimeout(mixGrowTimer);
            mixGrowTimer = null;
        }
    }
    // Day/page cursors advance in order; span is only a soft upper bound for docs/wrap.
    // Bing’s public archive is ~8 days; NASA walks calendar days via image-article search.
    var SPAN_BING = 16;
    var SPAN_NASA = 60;
    var SPAN_WIKI = 400;
    var SPAN_UNSPLASH = 200;
    var SOURCE_MS = 12 * 1000;
    // Queue already has a fresh entry — do not wait the full cold timeout.
    var SOURCE_MS_WARM = 2500;
    // Immich is on the LAN but often colder on first hit (share + search); give it room.
    var IMMICH_SOURCE_MS = 45 * 1000;
    var IMMICH_SOURCE_MS_WARM = 8000;
    var IMMICH_XHR_MS = 40 * 1000;
    var IMMICH_PAGE = 100;
    var RETRY_MS = 5 * 60 * 1000;
    var SOURCE_NAMES = ['bing', 'nasa', 'wikimedia', 'unsplash', 'immich'];

    var PROVIDERS = [
        { key: 'bing', label: 'Bing', needsKey: false },
        { key: 'nasa', label: 'NASA APOD', needsKey: false },
        { key: 'wikimedia', label: 'Wikimedia POTD', needsKey: false },
        { key: 'unsplash', label: 'Unsplash', needsKey: true },
        { key: 'immich', label: 'Immich album', needsKey: true },
        { key: 'mix', label: 'Mix', needsKey: false }
    ];

    var items = [];
    // Ring of { key, file } recently used — larger than history so days do not loop the same set.
    var seen = [];
    var fetchedDay = '';
    var cachedProvider = '';
    var cachedMarket = '';
    var fetching = false;
    var lastFailure = 0;
    var retryDelay = RETRY_MS;
    var lastError = '';
    // Bumped whenever the pool is reset, so in-flight fetches for an old source are discarded.
    var generation = 0;
    var unsplashKey = '';
    var unsplashCollection = '';
    var listeners = [];
    var notifyTimer = null;
    var saveTimer = null;
    var pendingSaveProvider = '';

    // Coalesce UI refresh storms from queue/plan fills (Home/Settings listeners).
    function notify(immediate) {
        if (immediate) {
            if (notifyTimer) {
                clearTimeout(notifyTimer);
                notifyTimer = null;
            }
            listeners.forEach(function (fn) { fn(); });
            return;
        }
        if (notifyTimer) return;
        notifyTimer = setTimeout(function () {
            notifyTimer = null;
            listeners.forEach(function (fn) { fn(); });
        }, 120);
    }

    function cfg() {
        var c = (window.LAUNCHER_CONFIG && window.LAUNCHER_CONFIG.liveWallpaper) || {};
        return {
            market: c.market || 'en-GB',
            unsplashAccessKey: c.unsplashAccessKey || '',
            immichLink: c.immichLink || '',
            unsplashCollection: c.unsplashCollection || ''
        };
    }

    function shuffleOn() {
        return !!(window.Prefs && Prefs.get().wallpaper.random);
    }

    // Mix provider walk order (Shuffle On = shuffled permutation; Off = SOURCE_NAMES order).
    var mixOrder = [];

    // Growing cursor (persisted). Always +1 in line — never a random server offset.
    function nextOffset(name, span) {
        var off = stream[name] || 0;
        var next = off + 1;
        stream[name] = span > 0 ? next % span : next;
        return off;
    }

    function provider() {
        var p = window.Prefs && Prefs.get().wallpaper;
        var key = (p && p.liveProvider) || 'bing';
        return PROVIDERS.some(function (x) { return x.key === key; }) ? key : 'bing';
    }

    function providerMeta() {
        return PROVIDERS.find(function (x) { return x.key === provider(); }) || PROVIDERS[0];
    }

    function dayKey(d) {
        return d.getFullYear() + '-' +
            ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
            ('0' + d.getDate()).slice(-2);
    }

    function todayKey() { return dayKey(new Date()); }

    function daysAgoKey(n) {
        var d = new Date();
        d.setDate(d.getDate() - n);
        return dayKey(d);
    }

    function readUnsplashStore() {
        var raw = null;
        try { raw = JSON.parse(localStorage.getItem(UNSPLASH_KEY_STORE)); } catch (e) { /* ignore */ }
        raw = raw || {};
        return {
            accessKey: typeof raw.accessKey === 'string' ? raw.accessKey : (cfg().unsplashAccessKey || ''),
            collection: typeof raw.collection === 'string' ? raw.collection : (cfg().unsplashCollection || '')
        };
    }

    function saveUnsplashStore() {
        try {
            localStorage.setItem(UNSPLASH_KEY_STORE, JSON.stringify({
                accessKey: unsplashKey,
                collection: unsplashCollection
            }));
        } catch (e) {
            DevLog.log('Live wallpaper: could not save Unsplash settings');
        }
    }

    function setUnsplashKey(key) {
        unsplashKey = String(key || '').trim();
        saveUnsplashStore();
    }

    function setUnsplashCollection(id) {
        unsplashCollection = String(id || '').trim();
        saveUnsplashStore();
    }

    function clearUnsplashKey() {
        try { localStorage.removeItem(UNSPLASH_KEY_STORE); } catch (e) { /* ignore */ }
        applyUnsplashStore();
    }

    function applyUnsplashStore() {
        var s = readUnsplashStore();
        unsplashKey = s.accessKey;
        unsplashCollection = s.collection;
    }

    var immichLink = '';

    // Share link as pasted: https://host[/prefix]/s/SLUG or https://host[/prefix]/share/KEY.
    function parseImmichLink(link) {
        var m = String(link || '').trim().match(/^(https?:\/\/.+?)\/(s|share)\/([A-Za-z0-9_-]+)\/?$/);
        if (!m) return null;
        return { origin: m[1], query: (m[2] === 's' ? 'slug=' : 'key=') + encodeURIComponent(m[3]) };
    }

    function readImmichLink() {
        try {
            var raw = JSON.parse(localStorage.getItem(IMMICH_STORE));
            if (raw && typeof raw.link === 'string') return raw.link;
        } catch (e) { /* ignore */ }
        return cfg().immichLink || '';
    }

    function resetImmichState() {
        if (!stream) return;
        stream.immichPage = 1;
        stream.immichAlbum = null;
        stream.immichWrapped = false;
        if (stream.queues && stream.queues.immich) {
            stream.queues.immich.buf = [];
            stream.queues.immich.filling = null;
        }
    }

    function setImmichLink(link) {
        immichLink = String(link || '').trim();
        resetImmichState();
        try {
            localStorage.setItem(IMMICH_STORE, JSON.stringify({ link: immichLink }));
        } catch (e) {
            DevLog.log('Live wallpaper: could not save Immich link');
        }
    }

    function clearImmichLink() {
        try { localStorage.removeItem(IMMICH_STORE); } catch (e) { /* ignore */ }
        resetImmichState();
        immichLink = readImmichLink();
    }

    function immichConfigured() {
        return !!parseImmichLink(immichLink);
    }

    function providerConfigured() {
        var p = provider();
        if (p === 'unsplash') return unsplashConfigured();
        if (p === 'immich') return immichConfigured();
        return true;
    }

    function needsSetup() {
        return providerMeta().needsKey && !providerConfigured();
    }

    function unsplashConfigured() {
        return !!unsplashKey;
    }

    function emptyQueues() {
        var q = {};
        SOURCE_NAMES.forEach(function (name) {
            q[name] = { buf: [], filling: null };
        });
        return q;
    }

    function resetStream() {
        stream = {
            sourceIndex: 0,
            bing: 0,
            bingWrapped: false,
            nasa: 0,
            wiki: 0,
            unsplash: 0,
            immichPage: 1,
            immichAlbum: null,
            immichWrapped: false,
            queues: emptyQueues(),
            plan: [],
            filling: null
        };
    }

    function sourceQueue(name) {
        if (!stream.queues[name]) stream.queues[name] = { buf: [], filling: null };
        return stream.queues[name];
    }

    var stream;
    resetStream();
    // After switching to Mix, skip the previous source for the first slot so Home does not
    // keep looking like Bing/NASA/… when that queue was already full.
    var avoidSource = '';

    function resetPool() {
        items = [];
        seen = [];
        pickCatalog = {};
        pickOrderSig = '';
        pickOrderKeys = [];
        pickTarget = {};
        thumbWarm = {};
        fetchedDay = '';
        cachedProvider = '';
        cachedMarket = '';
        avoidSource = '';
        mixOrder = [];
        resetMixWarm();
        resetStream();
    }

    function markSeen(entry) {
        if (!entry || !entry.key) return;
        seen = seen.filter(function (e) {
            return e.key !== entry.key && (!entry.file || e.file !== entry.file);
        });
        seen.push({ key: entry.key, file: entry.file || '' });
        if (seen.length > SEEN_MAX) seen = seen.slice(seen.length - SEEN_MAX);
    }

    // Free sources have tiny unique pools (Bing ~8, NASA ~25). Once every key is in
    // `seen`, fill would refuse to queue anything — forget this batch so it can cycle.
    function forgetSeenEntries(entries) {
        if (!entries || !entries.length) return;
        var dropKey = {};
        var dropFile = {};
        entries.forEach(function (e) {
            if (!e) return;
            if (e.key) dropKey[e.key] = true;
            if (e.file) dropFile[e.file] = true;
        });
        seen = seen.filter(function (e) {
            return !dropKey[e.key] && !(e.file && dropFile[e.file]);
        });
    }

    function loadOffsets(raw) {
        if (!raw || typeof raw !== 'object') return;
        ['bing', 'nasa', 'wiki', 'unsplash', 'sourceIndex'].forEach(function (k) {
            var n = Number(raw[k]);
            if (n >= 0 && isFinite(n)) stream[k] = Math.floor(n);
        });
    }

    // Drop Mix orphans / mis-tagged cache rows (e.g. Bing URL saved as Immich).
    function entryMatchesSource(w, name) {
        if (!w || !w.file || !name) return false;
        if (w.source && w.source !== name) return false;
        var f = String(w.file);
        var key = String(w.key || '');
        if (name === 'immich') {
            return /\/api\/assets\//.test(f) || key.indexOf('immich:') === 0;
        }
        if (name === 'bing') {
            return /bing\.net|bing\.com|\/th\?id=/i.test(f);
        }
        if (name === 'nasa') {
            return key.indexOf('nasa:') === 0 || /nasa\.gov|apod/i.test(f);
        }
        if (name === 'wikimedia') {
            return key.indexOf('wikimedia:') === 0 || /wikimedia|wikipedia/i.test(f);
        }
        if (name === 'unsplash') {
            return /unsplash\.com|images\.unsplash/i.test(f);
        }
        return w.source === name;
    }

    // True when loadCache dropped mis-tagged / oversize entries — rewrite later, not on the boot path.
    var cacheNeedsRewrite = false;

    function loadCache() {
        cacheNeedsRewrite = false;
        try {
            var raw = JSON.parse(localStorage.getItem(CACHE_KEY));
            if (!raw || !Array.isArray(raw.items)) return;
            if (raw.provider !== provider()) return;
            if (raw.provider === 'bing' && raw.market !== cfg().market) return;
            fetchedDay = raw.fetchedDay || '';
            cachedProvider = raw.provider;
            cachedMarket = raw.market || '';
            var beforeItems = raw.items.length;
            items = raw.items.slice(-HISTORY_MAX).map(normalize).filter(function (w) {
                if (cachedProvider === 'mix') return !!w.source;
                return entryMatchesSource(w, cachedProvider);
            });
            if (items.length !== Math.min(beforeItems, HISTORY_MAX)) cacheNeedsRewrite = true;
            seen = (Array.isArray(raw.seen) ? raw.seen : []).filter(function (e) {
                return e && e.key;
            }).slice(-SEEN_MAX).map(function (e) {
                return { key: String(e.key), file: e.file ? String(e.file) : '' };
            });
            // Seed seen from history if this is an upgraded cache without a seen ring.
            if (!seen.length && items.length) {
                items.forEach(markSeen);
                cacheNeedsRewrite = true;
            }
            loadOffsets(raw.offsets);
            if (raw.immichPage != null) {
                var ip = Math.floor(Number(raw.immichPage));
                if (ip >= 1 && isFinite(ip)) stream.immichPage = ip;
            }
            if (raw.immichAlbum && raw.immichAlbum.id) {
                var s = parseImmichLink(immichLink);
                if (s) {
                    stream.immichAlbum = {
                        id: raw.immichAlbum.id,
                        name: raw.immichAlbum.name || '',
                        origin: s.origin,
                        query: s.query
                    };
                }
            }
            if (raw.queues && typeof raw.queues === 'object') {
                SOURCE_NAMES.forEach(function (name) {
                    var saved = raw.queues[name];
                    if (!saved || !Array.isArray(saved.buf)) return;
                    var beforeQ = saved.buf.length;
                    sourceQueue(name).buf = saved.buf.map(normalize).filter(function (w) {
                        return entryMatchesSource(w, name);
                    }).map(function (w) {
                        w.source = name;
                        return w;
                    }).slice(0, sourceAhead());
                    if (sourceQueue(name).buf.length !== Math.min(beforeQ, sourceAhead())) {
                        cacheNeedsRewrite = true;
                    }
                });
            }
            // Do not restore `plan` — legacy caches may still hold randomly picked slots.
            // Refill under current Mix roster rules (sequential per source, round-robin Mix).
            stream.plan = [];
            // Restored catalog keeps days that have rolled off Bing’s ~8-day API window.
            if (Array.isArray(raw.picks)) {
                raw.picks.forEach(function (w) {
                    if (!w || !w.key || !w.file || !w.source) return;
                    if (!entryMatchesSource(w, w.source)) {
                        cacheNeedsRewrite = true;
                        return;
                    }
                    rememberPick(normalize(w), w.source);
                });
            }
            if (Array.isArray(raw.mixOrder)) {
                mixOrder = raw.mixOrder.filter(function (k) {
                    return SOURCE_NAMES.indexOf(k) >= 0;
                });
            }
        } catch (e) {
            resetPool();
        }
    }

    function queuesForCache() {
        var out = {};
        SOURCE_NAMES.forEach(function (name) {
            out[name] = { buf: sourceQueue(name).buf.slice(0, sourceAhead()) };
        });
        return out;
    }

    function picksForCache() {
        return Object.keys(pickCatalog).map(function (k) {
            return pickCatalog[k];
        }).filter(function (w) {
            return w && w.key && w.file;
        }).slice(-PICK_CATALOG_MAX);
    }

    // `p` is the provider the items were fetched from, not the one currently selected.
    // Debounced by default — queue fills would otherwise JSON.stringify on every step.
    function flushSaveCache() {
        var p = pendingSaveProvider || provider();
        cachedProvider = p;
        cachedMarket = cfg().market;
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                provider: p,
                fetchedDay: fetchedDay,
                market: cachedMarket,
                items: items,
                seen: seen,
                picks: picksForCache(),
                plan: stream.plan,
                queues: queuesForCache(),
                immichPage: stream.immichPage || 1,
                immichAlbum: stream.immichAlbum ? {
                    id: stream.immichAlbum.id,
                    name: stream.immichAlbum.name || ''
                } : null,
                offsets: {
                    bing: stream.bing || 0,
                    nasa: stream.nasa || 0,
                    wiki: stream.wiki || 0,
                    unsplash: stream.unsplash || 0,
                    sourceIndex: stream.sourceIndex || 0
                },
                mixOrder: mixOrder.slice()
            }));
        } catch (e) {
            DevLog.log('Live wallpaper: could not save cache');
        }
    }

    function saveCache(p, immediate) {
        pendingSaveProvider = p || provider();
        if (immediate) {
            if (saveTimer) {
                clearTimeout(saveTimer);
                saveTimer = null;
            }
            flushSaveCache();
            return;
        }
        if (saveTimer) return;
        saveTimer = setTimeout(function () {
            saveTimer = null;
            flushSaveCache();
        }, 400);
    }

    function normalize(entry) {
        return {
            key: entry.key,
            title: entry.title != null ? entry.title : 'Live wallpaper',
            sub: entry.sub || '',
            file: entry.file,
            fileFallback: entry.fileFallback || '',
            fileFallbacks: entry.fileFallbacks || [],
            thumb: entry.thumb || entry.file,
            credit: entry.credit || '',
            trackUrl: entry.trackUrl || '',
            source: entry.source || '',
            remote: true
        };
    }

    // Lasting catalog for Choose as static — queues are drained into the plan, so the
    // picker must not rely on buf.length alone. Also accumulates days past Bing’s API window.
    var pickCatalog = {};
    var pickOrderSig = '';
    var pickOrderKeys = [];
    // Per-source how many catalog entries the picker should fetch/show (starts at pickBatch()).
    var pickTarget = {};
    // Keep Image() handles so the HTTP cache stays warm for the Settings grid.
    var thumbWarm = {};

    function pickCountFor(name) {
        var n = 0;
        Object.keys(pickCatalog).forEach(function (k) {
            if (pickCatalog[k].source === name) n++;
        });
        return n;
    }

    function ensurePickTarget(name) {
        if (!pickTarget[name] || pickTarget[name] < pickBatch()) pickTarget[name] = pickBatch();
        return pickTarget[name];
    }

    function preloadThumb(entry) {
        if (!entry || !entry.key) return;
        var url = entry.thumb || entry.file;
        if (!url || thumbWarm[entry.key]) return;
        // Cap concurrent warm handles — Immich pages can flood otherwise.
        if (Object.keys(thumbWarm).length > 24) return;
        var img = new Image();
        img.decoding = 'async';
        img.src = url;
        thumbWarm[entry.key] = img;
    }

    function preloadPickThumbs() {
        pickList().forEach(preloadThumb);
    }

    // Catalog only — do not decode thumbs here (boot / queue fill). Settings warm calls preloadPickThumbs.
    function rememberPick(entry, source) {
        if (!entry || !entry.key) return;
        var n = normalize(entry);
        if (source) n.source = source;
        else if (entry.source) n.source = entry.source;
        var prev = pickCatalog[entry.key];
        if (prev) {
            if (!n.thumb && prev.thumb) n.thumb = prev.thumb;
            if (!n.source && prev.source) n.source = prev.source;
            if (!n.fileFallback && prev.fileFallback) n.fileFallback = prev.fileFallback;
            if ((!n.fileFallbacks || !n.fileFallbacks.length) && prev.fileFallbacks) {
                n.fileFallbacks = prev.fileFallbacks;
            }
        }
        pickCatalog[entry.key] = n;
    }

    function seedPickCatalog() {
        SOURCE_NAMES.forEach(function (name) {
            sourceQueue(name).buf.forEach(function (w) { rememberPick(w, name); });
        });
        stream.plan.forEach(function (w) { rememberPick(w, w.source); });
        items.forEach(function (w) { rememberPick(w, w.source); });
    }

    function keys(list) {
        return list.map(function (w) { return w.key; }).join(',');
    }

    function trim() {
        if (items.length > HISTORY_MAX) items = items.slice(items.length - HISTORY_MAX);
    }

    function httpError(status) {
        var e = new Error('HTTP ' + status);
        e.status = status;
        return e;
    }

    function xhrGet(url, headers, asText, timeoutMs) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.timeout = timeoutMs || TIMEOUT_MS;
            if (headers) {
                Object.keys(headers).forEach(function (h) {
                    xhr.setRequestHeader(h, headers[h]);
                });
            }
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    if (asText) {
                        resolve(xhr.responseText);
                        return;
                    }
                    try { resolve(JSON.parse(xhr.responseText)); }
                    catch (e) { reject(e); }
                } else {
                    reject(httpError(xhr.status));
                }
            };
            xhr.onerror = function () { reject(new Error('network')); };
            xhr.ontimeout = function () { reject(new Error('timeout')); };
            xhr.send();
        });
    }

    // Browser preview: same-origin proxy in scripts/serve.mjs (Chrome CORS blocks the APIs).
    function preview() { return !!window.__TIZEN_MOCK__; }

    // Target width for remote photos: at least 1080p, up to UHD when the panel reports it.
    function panelDisplayWidth() {
        var w = 0;
        try {
            w = Math.max(
                window.screen && screen.width || 0,
                window.innerWidth || 0,
                document.documentElement && document.documentElement.clientWidth || 0
            );
        } catch (e) {
            w = 0;
        }
        if (!w || w < 1920) w = 1920;
        if (w > 3840) w = 3840;
        return w;
    }

    /* ---------- Bing ---------- */

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
        var uhd = BING + base + '_UHD.jpg';
        var thumb = BING + base + '_320x180.jpg';
        // Prefer 1080p: UHD is ~3–4MB and often fails to decode on TV / slow preview.
        // Only try UHD first on wide panels; always keep 1080p as fallback.
        var preferUhd = panelDisplayWidth() >= 2560;
        var title = img.title || (img.copyright || '').split('(')[0].trim() || 'Bing daily';
        var credit = img.copyright || 'Bing';
        return normalize({
            key: String(img.startdate || title),
            title: title,
            file: preferUhd ? uhd : hd,
            fileFallback: preferUhd ? hd : '',
            fileFallbacks: preferUhd ? [hd] : [],
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

    /* ---------- NASA APOD (v0.6.15 image-article + media; proven on TV) ---------- */

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
            .replace(/^\d{4} [A-Za-z]+ \d{1,2}\s*[–\-]\s*/, '')
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

    /* ---------- Wikimedia Picture of the Day ---------- */

    // Feed image: thumbnail is ~960px, the original can be 5000px+. Ask the thumbnail
    // service for a sized version of the same file instead.
    function wikimediaSized(src, width) {
        var clean = src.split('?')[0];
        var m = clean.match(/^(.*\/thumb\/.+\/)\d+px-([^/]+)$/);
        return m ? m[1] + width + 'px-' + m[2] : clean;
    }

    function parseWikimediaPotd(data, ymd) {
        var img = data && data.image;
        if (!img || !img.thumbnail || !img.thumbnail.source) return null;
        var title = String(img.title || '')
            .replace(/^File:/, '')
            .replace(/\.[a-z0-9]+$/i, '')
            .replace(/_/g, ' ');
        var artist = (img.artist && img.artist.text) || '';
        var target = panelDisplayWidth();
        return normalize({
            key: 'wikimedia:' + ymd,
            title: title || 'Picture of the day',
            file: wikimediaSized(img.thumbnail.source, target),
            thumb: wikimediaSized(img.thumbnail.source, 480),
            credit: 'Wikimedia Commons' + (artist ? ' · ' + artist : ''),
            source: 'wikimedia'
        });
    }

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

    /* ---------- Unsplash ---------- */

    function unsplashApi(path) {
        return preview() ? '/api/live/unsplash?path=' + encodeURIComponent(path) : UNSPLASH + path;
    }

    function unsplashGet(path) {
        return xhrGet(unsplashApi(path), { Authorization: 'Client-ID ' + unsplashKey });
    }

    // Unsplash has no photo-of-the-day endpoint. Each local calendar day maps to a fixed
    // slot in a fixed ordering (a collection, or popular photos), so a day always shows the
    // same photo, also after a restart. Pages cycle after UNSPLASH_PAGES to stay in range.
    function dayNumber(d) {
        return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
    }

    function unsplashPhotosPath(page) {
        var c = unsplashCollection;
        var query = 'per_page=' + UNSPLASH_PER_PAGE + '&page=' + page;
        if (c) return '/collections/' + encodeURIComponent(c) + '/photos?' + query;
        return '/photos?order_by=popular&' + query;
    }

    function fetchUnsplashDays(offsets) {
        var today = dayNumber(new Date());
        var slots = offsets.map(function (o) {
            var g = today - o;
            return {
                page: Math.floor(g / UNSPLASH_PER_PAGE) % UNSPLASH_PAGES + 1,
                index: g % UNSPLASH_PER_PAGE
            };
        });
        var pages = {};
        slots.forEach(function (s) { pages[s.page] = []; });
        return Promise.all(Object.keys(pages).map(function (p) {
            return unsplashGet(unsplashPhotosPath(p)).then(function (data) {
                pages[p] = parseUnsplashList(data);
            });
        })).then(function () {
            return slots.map(function (s) {
                var list = pages[s.page];
                return list.length ? list[s.index % list.length] : null;
            }).filter(Boolean);
        });
    }

    function parseUnsplashImage(img) {
        if (!img || !img.urls || !img.urls.raw) return null;
        // Size the raw URL to the panel (1080p–UHD); regular/full API URLs are fixed-size.
        var raw = img.urls.raw;
        var file = raw + (raw.indexOf('?') === -1 ? '?' : '&') +
            'w=' + panelDisplayWidth() + '&fit=max&q=85&auto=format';
        var title = img.alt_description || img.description || 'Unsplash';
        if (title.length > 48) title = title.slice(0, 45) + '…';
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
            xhrGet(unsplashApi(entry.trackUrl.slice(UNSPLASH.length)), { Authorization: 'Client-ID ' + unsplashKey })
                .catch(function (e) {
                    DevLog.log('Live wallpaper: Unsplash download ping failed: ' + e.message);
                });
        });
    }

    /* ---------- Immich (shared album link) ---------- */

    function immichApi(path) {
        var s = parseImmichLink(immichLink);
        var url = s.origin + '/api' + path;
        return preview() ? '/api/live/immich?url=' + encodeURIComponent(url) : url;
    }

    function xhrPostJson(url, body, timeoutMs) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', url, true);
            xhr.timeout = timeoutMs || TIMEOUT_MS;
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    try { resolve(JSON.parse(xhr.responseText)); }
                    catch (e) { reject(e); }
                } else {
                    reject(httpError(xhr.status));
                }
            };
            xhr.onerror = function () { reject(new Error('network')); };
            xhr.ontimeout = function () { reject(new Error('timeout')); };
            xhr.send(JSON.stringify(body));
        });
    }

    function fetchImmichLinkData() {
        var s = parseImmichLink(immichLink);
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
        if (desc) return desc.length > 120 ? desc.slice(0, 117) + '…' : desc;
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

    function immichEntry(a, origin, query, album) {
        var base = origin + '/api/assets/' + encodeURIComponent(a.id);
        var q = '&' + query;
        var place = immichPlace(a);
        var title = immichTitle(a, album);
        var date = immichDate(a);
        // Prefer place on the title line; keep date (+ album via credit) underneath.
        var sub = date;
        if (place && title !== place && title.indexOf(place) !== 0) {
            sub = place + (date ? ' · ' + date : '');
        }
        var original = base + '/original?' + query;
        var fullsize = base + '/thumbnail?size=fullsize' + q;
        var preview = base + '/thumbnail?size=preview' + q;
        // Smallest Immich derivative for the Settings grid (preview is too heavy per tile).
        var thumb = base + '/thumbnail?size=thumbnail' + q;
        return normalize({
            key: 'immich:' + a.id,
            title: title,
            sub: sub,
            // Share links often block /original unless "Allow download" is on; fullsize may be
            // unpublished. Display probes original → fullsize → preview.
            file: original,
            fileFallback: fullsize,
            fileFallbacks: [fullsize, preview],
            thumb: thumb,
            credit: album ? 'Immich · ' + album : 'Immich',
            source: 'immich'
        });
    }

    function fetchImmichAsset(id) {
        var s = parseImmichLink(immichLink);
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

    /* ---------- On-demand (one photo at a time, all providers) ---------- */

    function mixEnabledMap() {
        var p = window.Prefs && Prefs.get().wallpaper;
        return (p && p.mixEnabled && typeof p.mixEnabled === 'object') ? p.mixEnabled : {};
    }

    function mixSourceOn(key) {
        return mixEnabledMap()[key] !== false;
    }

    function ensureMixEnabledMap(p) {
        if (!p.mixEnabled || typeof p.mixEnabled !== 'object') {
            p.mixEnabled = {
                bing: true, nasa: true, wikimedia: true, unsplash: true, immich: true
            };
        }
        return p.mixEnabled;
    }

    // Free providers shipped in-app (no key / share link).
    function freeSourceKeys() {
        return ['bing', 'nasa', 'wikimedia'];
    }

    function sourceConfigured(key) {
        if (key === 'unsplash') return unsplashConfigured();
        if (key === 'immich') return immichConfigured();
        return freeSourceKeys().indexOf(key) >= 0;
    }

    // Sources the user has toggled on (Settings multi-select) — Mix roster.
    function enabledSourceKeys() {
        return SOURCE_NAMES.filter(mixSourceOn);
    }

    // Enabled chips that can actually fetch right now (stable SOURCE_NAMES order).
    function readyMixKeys() {
        var on = enabledSourceKeys().filter(sourceConfigured);
        // Nothing ready (e.g. only Unsplash/Immich on, no key yet) → use free in-app sources.
        var keys = on.length ? on : freeSourceKeys();
        return SOURCE_NAMES.filter(function (k) { return keys.indexOf(k) >= 0; });
    }

    function reshuffleMixOrder() {
        mixOrder = readyMixKeys().slice();
        var i;
        for (i = mixOrder.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = mixOrder[i];
            mixOrder[i] = mixOrder[j];
            mixOrder[j] = t;
        }
        stream.sourceIndex = 0;
    }

    // Shuffle On: walk a permuted Mix roster; Off: fixed SOURCE_NAMES order. Always sequential.
    function orderedMixKeys() {
        var ready = readyMixKeys();
        if (!shuffleOn() || ready.length < 2) {
            mixOrder = ready.slice();
            return ready;
        }
        var kept = mixOrder.filter(function (k) { return ready.indexOf(k) >= 0; });
        ready.forEach(function (k) {
            if (kept.indexOf(k) < 0) kept.push(k);
        });
        if (!kept.length || kept.length !== ready.length) {
            reshuffleMixOrder();
            return mixOrder.slice();
        }
        mixOrder = kept;
        return mixOrder.slice();
    }

    function streamKeys() {
        var p = provider();
        if (p === 'mix') return orderedMixKeys();
        // Solo focus always stays on that key. Unconfigured Immich/Unsplash → empty
        // stream (setup status), never silent free-source Mix.
        return sourceConfigured(p) ? [p] : [];
    }

    function mixSourceLabels() {
        return orderedMixKeys().map(function (k) {
            var meta = PROVIDERS.find(function (x) { return x.key === k; });
            return meta ? meta.label : k;
        });
    }

    /*
     * Screen saver ↑↓: every configured provider, plus Mix when Settings has 2+
     * enabled usable chips. Mix always uses that Settings roster; solo never
     * rewrites the chips.
     */
    function switchableProviders() {
        var list = SOURCE_NAMES.filter(sourceConfigured);
        if (enabledSourceKeys().filter(sourceConfigured).length >= 2) {
            list = list.concat(['mix']);
        }
        return list;
    }

    function providerLabelFor(key) {
        var meta = PROVIDERS.find(function (x) { return x.key === key; });
        return meta ? meta.label : key;
    }

    // Screen saver / focus choice: only liveProvider changes; mixEnabled stays Settings-owned.
    function selectLiveProvider(key) {
        var p = window.Prefs && Prefs.get().wallpaper;
        if (!p) return null;
        ensureMixEnabledMap(p);
        var choices = switchableProviders();
        if (choices.indexOf(key) < 0) return null;
        if (key === p.liveProvider) return key;
        p.liveProvider = key;
        p.liveKey = '';
        p.lastChange = Date.now();
        Prefs.save();
        switchProvider();
        return key;
    }

    function mixModeOn() {
        return provider() === 'mix';
    }

    // Settings Mix toggle: On → liveProvider=mix (roster = mixEnabled).
    // Off → one radio source; mixEnabled keeps the Mix roster for later.
    function setMixMode(on) {
        var p = window.Prefs && Prefs.get().wallpaper;
        if (!p) return mixModeOn();
        ensureMixEnabledMap(p);
        var prev = p.liveProvider || 'bing';
        if (on) {
            if (!enabledSourceKeys().length) p.mixEnabled.bing = true;
            p.liveProvider = 'mix';
        } else {
            var onKeys = enabledSourceKeys();
            if (prev !== 'mix' && onKeys.indexOf(prev) >= 0) {
                p.liveProvider = prev;
            } else {
                p.liveProvider = onKeys[0] || 'bing';
                if (!onKeys.length) p.mixEnabled.bing = true;
            }
        }
        Prefs.save();
        return p.liveProvider === 'mix';
    }

    // Mix Off: pick the single source to browse / play (does not clear the Mix roster).
    function setSoloProvider(key) {
        var p = window.Prefs && Prefs.get().wallpaper;
        if (!p || SOURCE_NAMES.indexOf(key) < 0) return provider();
        ensureMixEnabledMap(p);
        p.mixEnabled[key] = true;
        p.liveProvider = key;
        Prefs.save();
        return key;
    }

    // Kept for tests / callers: what Settings would use if Mix were derived from chips.
    function deriveLiveProvider() {
        var on = enabledSourceKeys();
        if (mixModeOn()) return on.length ? 'mix' : 'bing';
        if (on.length === 1) return on[0];
        var cur = provider();
        if (cur !== 'mix' && on.indexOf(cur) >= 0) return cur;
        return on[0] || 'bing';
    }

    // One-shot: old prefs had liveProvider=single with mixEnabled all-true. Collapse
    // the map to that single source so multi-select chips match what Live was using.
    function migrateLiveMultiSelect() {
        var p = window.Prefs && Prefs.get().wallpaper;
        if (!p || p.liveMultiSelect) return;
        ensureMixEnabledMap(p);
        var prov = p.liveProvider || 'bing';
        if (prov !== 'mix' && SOURCE_NAMES.indexOf(prov) >= 0) {
            SOURCE_NAMES.forEach(function (k) {
                p.mixEnabled[k] = (k === prov);
            });
        }
        p.liveMultiSelect = true;
        Prefs.save();
    }

    /*
     * Soft coerce only: empty roster → Bing; invalid solo → first enabled.
     * Does not force Mix from chip count — Mix On/Off is an explicit Settings toggle.
     */
    function syncLiveProvider() {
        var p = window.Prefs && Prefs.get().wallpaper;
        if (!p) return false;
        migrateLiveMultiSelect();
        ensureMixEnabledMap(p);
        var prev = p.liveProvider || 'bing';
        var on = enabledSourceKeys();
        if (!on.length) {
            p.mixEnabled.bing = true;
            if (prev === 'mix') p.liveProvider = 'mix';
            else p.liveProvider = 'bing';
        } else if (prev === 'mix') {
            // Mix On: keep mix even with one source.
            p.liveProvider = 'mix';
        } else if (SOURCE_NAMES.indexOf(prev) < 0 || on.indexOf(prev) < 0) {
            p.liveProvider = on[0];
        }
        var next = p.liveProvider || 'bing';
        if (next !== prev) Prefs.save();
        return next !== prev;
    }

    // Toggle a source in the Mix roster. Keeps at least one on. Returns the new on-state.
    function setMixSource(key, on) {
        var p = window.Prefs && Prefs.get().wallpaper;
        if (!p) return mixSourceOn(key);
        ensureMixEnabledMap(p);
        if (SOURCE_NAMES.indexOf(key) < 0) return mixSourceOn(key);
        if (!on) {
            var still = SOURCE_NAMES.filter(function (k) {
                return k !== key && p.mixEnabled[k] !== false;
            });
            if (!still.length) return true; // refuse to disable the last source
        }
        p.mixEnabled[key] = !!on;
        Prefs.save();
        // Caller (Settings) updates liveProvider and re-renders; avoid notify races.
        return !!on;
    }

    function withTimeout(promise, ms) {
        return new Promise(function (resolve, reject) {
            var settled = false;
            var timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                reject(new Error('timeout'));
            }, ms);
            promise.then(function (value) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(value);
            }, function (err) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(err);
            });
        });
    }

    function setLiveKey(key) {
        if (!key || !window.Prefs) return;
        var w = Prefs.get().wallpaper;
        if (w.liveKey === key) return;
        w.liveKey = key;
        w.lastChange = Date.now();
        Prefs.save();
    }

    function ensureImmichAlbum() {
        if (stream.immichAlbum) return Promise.resolve(stream.immichAlbum);
        return fetchImmichLinkData().then(function (link) {
            var s = parseImmichLink(immichLink);
            if (!link.album || !link.album.id) throw new Error('Immich link is not an album');
            stream.immichAlbum = {
                id: link.album.id,
                name: (link.album && link.album.albumName) || '',
                origin: s.origin,
                query: s.query
            };
            return stream.immichAlbum;
        });
    }

    // Enrich place/title when showing; never block plan fill on /assets round-trips.
    function polishImmich(entry) {
        if (!entry || !entry.key || !stream.immichAlbum) return Promise.resolve(entry);
        if ((entry.credit || '').indexOf('Immich') !== 0) return Promise.resolve(entry);
        var album = stream.immichAlbum;
        return fetchImmichAsset(entry.key).then(function (full) {
            if (!full) return entry;
            var merged = mergeImmichAsset({ id: entry.key, exifInfo: {} }, full);
            var better = immichEntry(merged, album.origin, album.query, album.name);
            entry.title = better.title;
            entry.sub = better.sub;
            entry.file = better.file;
            entry.fileFallback = better.fileFallback;
            entry.fileFallbacks = better.fileFallbacks;
            entry.thumb = better.thumb;
            return entry;
        }, function () { return entry; });
    }

    function knownKeys() {
        var map = {};
        seen.forEach(function (e) { map[e.key] = true; });
        items.forEach(function (w) { map[w.key] = true; });
        stream.plan.forEach(function (w) { map[w.key] = true; });
        return map;
    }

    function isDuplicate(entry) {
        if (!entry) return true;
        var map = knownKeys();
        if (map[entry.key]) return true;
        if (!entry.file) return false;
        if (seen.some(function (e) { return e.file === entry.file; })) return true;
        if (items.some(function (w) { return w.file === entry.file; })) return true;
        return stream.plan.some(function (w) { return w.file === entry.file; });
    }

    function queueHas(q, entry) {
        return q.buf.some(function (w) {
            return w.key === entry.key || (entry.file && w.file === entry.file);
        });
    }

    // Drop at most `limit` already-seen entries — only after replacements were added.
    function dropStale(q, limit) {
        if (limit <= 0) return;
        var dropped = 0;
        q.buf = q.buf.filter(function (w) {
            if (dropped >= limit) return true;
            if (!isDuplicate(w)) return true;
            dropped++;
            return false;
        });
    }

    function freshInQueue(q) {
        return q.buf.filter(function (w) { return !isDuplicate(w); }).length;
    }

    // One server pull → zero or more fresh entries (Immich/Bing return a page; others one).
    function pullFresh(name) {
        if (name === 'bing') {
            // Live API window is ~8 days; older days stay in picks/history and pad the lists.
            var idx = stream.bing || 0;
            var n = 8;
            return xhrGet(bingArchiveUrl(idx, n)).then(function (data) {
                var imgs = data.images || [];
                if (!imgs.length) {
                    if (idx === 0) throw new Error('empty Bing');
                    if (!stream.bingWrapped) {
                        stream.bingWrapped = true;
                        stream.bing = 0;
                        return { entries: [], wrapped: true };
                    }
                    return { entries: [], done: true };
                }
                stream.bing = idx + imgs.length;
                stream.bingWrapped = false;
                return {
                    entries: imgs.map(parseBingImage).filter(Boolean),
                    done: imgs.length < n
                };
            });
        }
        if (name === 'nasa') {
            var day = nextOffset('nasa', SPAN_NASA);
            return fetchNasaDay(daysAgoKey(day)).then(function (entry) {
                if (!entry) throw new Error('empty NASA');
                return { entries: [entry] };
            });
        }
        if (name === 'wikimedia') {
            var wday = nextOffset('wiki', SPAN_WIKI);
            return fetchWikimediaDay(daysAgoKey(wday)).then(function (entry) {
                if (!entry) throw new Error('empty Wikimedia');
                return { entries: [entry] };
            });
        }
        if (name === 'unsplash') {
            var off = nextOffset('unsplash', SPAN_UNSPLASH);
            return fetchUnsplashDays([off]).then(function (list) {
                if (!list[0]) throw new Error('empty Unsplash');
                return { entries: [list[0]] };
            });
        }
        if (name === 'immich') {
            return ensureImmichAlbum().then(function (album) {
                var pageNum = stream.immichPage || 1;
                return xhrPostJson(immichApi('/search/metadata?' + album.query), {
                    albumIds: [album.id],
                    type: 'IMAGE',
                    size: IMMICH_PAGE,
                    page: pageNum,
                    withExif: false
                }, IMMICH_XHR_MS).then(function (res) {
                    var batch = ((res.assets && res.assets.items) || []).filter(function (a) {
                        return a && a.type === 'IMAGE' && a.id;
                    });
                    if (!batch.length) {
                        if (pageNum <= 1) throw new Error('empty Immich album');
                        if (!stream.immichWrapped) {
                            stream.immichWrapped = true;
                            stream.immichPage = 1;
                            return { entries: [], wrapped: true };
                        }
                        return { entries: [], done: true };
                    }
                    stream.immichPage = pageNum + 1;
                    stream.immichWrapped = false;
                    return {
                        entries: batch.map(function (a) {
                            return immichEntry(a, album.origin, album.query, album.name);
                        })
                    };
                });
            });
        }
        return Promise.reject(new Error('unknown source'));
    }

    // Keep the queue topped up. `limit` caps how far to fill (picker uses pickBatch);
    // Live rotation omits it and fills to effectiveAhead() (Mix boots small).
    function fillSourceQueue(name, limit) {
        var q = sourceQueue(name);
        var cap = typeof limit === 'number' && limit > 0 ? limit : effectiveAhead();
        if (q.filling) {
            // Picker must not wait for a full Live ahead fill — resolve once we
            // already have enough catalogued, otherwise continue after the current fill.
            if (limit && pickCountFor(name) >= cap) return Promise.resolve();
            return q.filling.then(function () {
                if (limit && pickCountFor(name) >= cap) return;
                if (!limit && freshInQueue(q) >= effectiveAhead()) return;
                return fillSourceQueue(name, limit);
            });
        }

        q.filling = Promise.resolve().then(function () {
            var guard = 0;
            var dirty = false;

            function reached() {
                return limit ? pickCountFor(name) >= cap : freshInQueue(q) >= cap;
            }

            function step() {
                if (reached()) return;
                if (guard++ > 80) return;
                return pullFresh(name).then(function (res) {
                    var batch = res.entries || [];
                    var added = 0;
                    var cataloged = 0;

                    function absorb(entry, force) {
                        if (!entry || queueHas(q, entry)) return;
                        if (!force && isDuplicate(entry)) return;
                        entry.source = name;
                        // Always remember for the picker; Immich pages are large — Load more
                        // can reveal catalogued thumbs without another round trip.
                        var before = pickCountFor(name);
                        rememberPick(entry, name);
                        if (pickCountFor(name) > before) cataloged++;
                        if (limit && before >= cap) return;
                        if (!limit && freshInQueue(q) >= cap) return;
                        q.buf.push(entry);
                        added++;
                    }

                    batch.forEach(function (entry) { absorb(entry, false); });
                    // Bing/NASA pools are tiny — once every photo is "seen", recycle the batch.
                    if (!added && batch.length && batch.every(isDuplicate)) {
                        forgetSeenEntries(batch);
                        if (name === 'bing') stream.bingWrapped = false;
                        batch.forEach(function (entry) { absorb(entry, true); });
                        DevLog.log('Live wallpaper: ' + name + ' recycled ' + batch.length);
                    }
                    if (added) {
                        dropStale(q, added);
                        // Keep fetch order in the queue.
                        DevLog.log('Live wallpaper: ' + name + ' queue ' + q.buf.length +
                            '/' + cap + ' (+' + added + ')');
                        dirty = true;
                    } else if (cataloged) {
                        dirty = true;
                    }
                    if (reached()) return;
                    if (res.done) {
                        padFromKnown(name, cap);
                        if (!q.buf.length && !pickCountFor(name)) throw new Error(name + ' exhausted');
                        return;
                    }
                    // No progress this pull (all duplicates) but queue still has entries: stop
                    // rather than spinning; keep existing items (and pad from older days).
                    if (!added && !cataloged && (q.buf.length || pickCountFor(name)) && !res.wrapped) {
                        padFromKnown(name, cap);
                        return;
                    }
                    if (!added && cataloged && limit && pickCountFor(name) >= cap) return;
                    return new Promise(function (resolve) { setTimeout(resolve, 40); }).then(step);
                });
            }

            return step().then(function () {
                if (dirty) notify();
            });
        }).then(function () {
            q.filling = null;
            saveCache(provider());
        }, function (err) {
            q.filling = null;
            // Keep whatever is already queued when the provider fails.
            if (q.buf.length || pickCountFor(name)) return;
            throw err;
        });

        return q.filling;
    }

    // Resolve as soon as the picker has `want` catalog entries (do not wait for Live ahead).
    function waitForPickCount(name, want, timeoutMs) {
        return new Promise(function (resolve) {
            var ticks = 0;
            var max = Math.ceil((timeoutMs || 20000) / 50);
            function check() {
                if (pickCountFor(name) >= want || ticks++ >= max) {
                    resolve(pickCountFor(name));
                    return;
                }
                setTimeout(check, 50);
            }
            check();
        });
    }

    function reseedQueueFromCatalog(name) {
        var q = sourceQueue(name);
        // Stable order by key; only this source (exact tag — no blank-source orphans).
        Object.keys(pickCatalog).sort().forEach(function (k) {
            var w = pickCatalog[k];
            if (!w || w.source !== name || !w.file || queueHas(q, w)) return;
            q.buf.push(w);
        });
    }

    // After the live API window is exhausted, keep lists topped up from catalog + history
    // (Bing days that rolled off HPImageArchive, prior Immich pages, etc.).
    function padFromKnown(name, cap) {
        seedPickCatalog();
        var q = sourceQueue(name);
        var want = typeof cap === 'number' && cap > 0 ? cap : sourceAhead();
        function absorb(w) {
            if (!w || !w.key || !w.file) return;
            // Exact source + URL shape — never relabel Bing/NASA/… as Immich.
            if (!entryMatchesSource(w, name)) return;
            var n = normalize(w);
            n.source = name;
            rememberPick(n, name);
            if (queueHas(q, n)) return;
            if (q.buf.length >= want) return;
            q.buf.push(n);
        }
        Object.keys(pickCatalog).sort().forEach(function (k) { absorb(pickCatalog[k]); });
        items.forEach(absorb);
        stream.plan.forEach(absorb);
    }

    // Prefer unseen; if none and allowReuse, return a queued entry rather than empty.
    // Always queue order (front of fresh list) — Shuffle only reorders Mix providers.
    function takeFromQueue(name, allowReuse) {
        var q = sourceQueue(name);
        // Drop mis-tagged leftovers before serving (legacy cache / Mix bleed).
        q.buf = q.buf.filter(function (w) { return entryMatchesSource(w, name); });
        if (!q.buf.length) reseedQueueFromCatalog(name);
        if (!q.buf.length) return null;
        var i;
        for (i = 0; i < q.buf.length; i++) {
            if (!isDuplicate(q.buf[i])) {
                var hit = q.buf.splice(i, 1)[0];
                hit.source = name;
                return hit;
            }
        }
        if (!allowReuse) return null;
        var reuse = q.buf.shift();
        if (reuse) reuse.source = name;
        return reuse;
    }

    // Wait until the in-order queue has at least `min` fresh entries (or fill gave up).
    // Do not block the first photo on a full SOURCE_AHEAD buffer — NASA/Wiki add one
    // entry per request, so waiting for 40 would always blow the Mix timeout.
    function waitForFresh(name, min, allowReuse) {
        var q = sourceQueue(name);
        if (freshInQueue(q) >= min) return Promise.resolve();
        fillSourceQueue(name);
        return new Promise(function (resolve, reject) {
            var ticks = 0;
            function tick() {
                if (freshInQueue(q) >= min) {
                    resolve();
                    return;
                }
                if (!q.filling) {
                    if (freshInQueue(q) >= min) {
                        resolve();
                        return;
                    }
                    reseedQueueFromCatalog(name);
                    if (freshInQueue(q) >= min || (allowReuse && q.buf.length)) {
                        resolve();
                        return;
                    }
                    reject(new Error('empty ' + name));
                    return;
                }
                if (ticks++ > 400) {
                    reject(new Error('timeout'));
                    return;
                }
                setTimeout(tick, 50);
            }
            tick();
        });
    }

    // Take one from the list as soon as anything is ready; top up the queue in the background.
    // allowReuse=false for plan fill (stop when the unique pool is exhausted).
    function fetchOne(name, allowReuse) {
        return waitForFresh(name, 1, !!allowReuse).then(function () {
            var entry = takeFromQueue(name, !!allowReuse);
            if (!entry) throw new Error('empty ' + name);
            fillSourceQueue(name);
            return entry;
        });
    }

    function warmOne(name) {
        return fillSourceQueue(name).catch(function (e) {
            DevLog.log('Live wallpaper: ' + name + ' warm failed: ' +
                (e && e.message ? e.message : e));
        });
    }

    function warmSources() {
        var keys = streamKeys();
        if (!keys.length) return Promise.resolve();
        // Mix boot: one source at a time (next slot first) so Home keeps the decoder free.
        if (provider() === 'mix' && mixWarmPhase === 'boot') {
            var ordered = orderedMixKeys();
            var start = nextSlotStart(ordered);
            var seq = [];
            var i;
            for (i = 0; i < ordered.length; i++) {
                seq.push(ordered[(start + i) % ordered.length]);
            }
            var chain = Promise.resolve();
            seq.forEach(function (name) {
                chain = chain.then(function () { return warmOne(name); });
            });
            return chain;
        }
        // fillSourceQueue with no limit uses effectiveAhead().
        return Promise.all(keys.map(warmOne));
    }

    // Top up queues + plan without blocking UI (after the first few are ready).
    // Mix: boot with a small ahead, then grow to the full Queue size.
    function backgroundFill() {
        if (needsSetup()) return;
        warmSources();
        if (provider() === 'mix' && mixWarmPhase === 'boot' && !mixGrowTimer) {
            mixGrowTimer = setTimeout(function () {
                mixGrowTimer = null;
                mixWarmPhase = 'full';
                warmSources();
                if (stream.plan.length < planSize()) fillPlan(80);
            }, MIX_GROW_MS);
        }
        if (stream.plan.length < planSize()) fillPlan(120);
    }

    // Mix: strict round-robin over orderedMixKeys (Shuffle only changed that order).
    // Honour avoidSource so the first Mix frame after a switch is not the provider you left.
    function nextSlotStart(keys) {
        if (!keys.length) return 0;
        if (keys.length === 1) return 0;
        if (avoidSource) {
            var a;
            for (a = 0; a < keys.length; a++) {
                if (keys[a] !== avoidSource) return a;
            }
        }
        return ((stream.sourceIndex % keys.length) + keys.length) % keys.length;
    }

    // Short timeout per try; Immich gets longer. Mix walks the roster in order on failure.
    // allowReuse: plan fill uses false so a small unique pool stops cleanly; takeNext may reuse.
    function advanceOne(g, allowReuse) {
        var keys = streamKeys();
        if (!keys.length) return Promise.reject(new Error('no sources'));
        var start = nextSlotStart(keys);
        var tries = 0;
        var maxTries = keys.length === 1 ? 2 : keys.length * 2;
        var reuse = !!allowReuse;

        function attempt() {
            if (g !== generation) return Promise.reject(new Error('stale'));
            if (tries >= maxTries) return Promise.reject(new Error('all sources failed'));
            var slot = (start + tries) % keys.length;
            var k = keys[slot];
            tries++;
            var warm = freshInQueue(sourceQueue(k)) > 0;
            var ms = k === 'immich'
                ? (warm ? IMMICH_SOURCE_MS_WARM : IMMICH_SOURCE_MS)
                : (warm ? SOURCE_MS_WARM : SOURCE_MS);
            DevLog.log('Live wallpaper: plan ' + k + (warm ? ' (warm)' : ''));
            return withTimeout(fetchOne(k, reuse), ms).then(function (entry) {
                if (!entry) return attempt();
                if (isDuplicate(entry)) {
                    entry.source = k;
                    sourceQueue(k).buf.push(entry);
                    rememberPick(entry, k);
                    if (keys.length > 1 && tries < maxTries) return attempt();
                    if (!reuse) return Promise.reject(new Error('no fresh photos'));
                }
                markSeen(entry);
                // Next Mix slot follows this one in roster order.
                if (keys.length > 1) {
                    stream.sourceIndex = (slot + 1) % keys.length;
                }
                return entry;
            }, function (e) {
                DevLog.log('Live wallpaper: skip ' + k + ': ' + (e && e.message ? e.message : e));
                return attempt();
            });
        }

        return attempt();
    }

    function remember(entry) {
        items = items.filter(function (w) { return w.key !== entry.key; });
        items.push(entry);
        if (items.length > HISTORY_MAX) items = items.slice(items.length - HISTORY_MAX);
        markSeen(entry);
        rememberPick(entry, entry.source);
        setLiveKey(entry.key);
        if (entry.trackUrl) trackUnsplash([entry]);
        fetchedDay = todayKey();
        lastFailure = 0;
        retryDelay = RETRY_MS;
        lastError = '';
        // Debounced — sync localStorage + immediate notify made every photo change hitch on TV.
        saveCache(provider());
        // First Mix frame landed — later slots may use every ready source again.
        avoidSource = '';
        DevLog.log('Live wallpaper: showing ' + (entry.credit || entry.title || entry.key) +
            (entry.source ? ' [' + entry.source + ']' : ''));
        notify();
        return entry;
    }

    // Yield so Home/input stay responsive while the upcoming list builds.
    function planPause() {
        var ms = stream.plan.length < 2 ? 0 : 150;
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    // Fill upcoming slots in the background; never notify (that re-applied wallpaper each slot).
    function fillPlan(delayMs) {
        if (stream.filling) return stream.filling;
        var g = generation;
        var wait = delayMs > 0 ? delayMs : 0;

        function step() {
            if (g !== generation) return Promise.resolve();
            if (stream.plan.length >= planSize()) return Promise.resolve();
            // Plan fill never reuses — stop when the unique pool is exhausted.
            return advanceOne(g, false).then(function (entry) {
                if (g !== generation || !entry) return;
                stream.plan.push(entry);
                saveCache(provider());
                // Only warm the next decode when the plan was empty / just started.
                if (stream.plan.length <= 2 && window.Wallpaper && Wallpaper.preloadAhead) {
                    Wallpaper.preloadAhead();
                }
                DevLog.log('Live wallpaper: planned ' + stream.plan.length + '/' + planSize() +
                    ' (' + (entry.credit || entry.key) + ')');
                return planPause().then(step);
            }, function (e) {
                DevLog.log('Live wallpaper: plan fill stopped: ' + (e && e.message ? e.message : e) +
                    (stream.plan.length ? ' (' + stream.plan.length + ' ready)' : ''));
            });
        }

        stream.filling = new Promise(function (resolve) {
            setTimeout(resolve, wait);
        }).then(function () {
            if (g !== generation) return;
            // Queue top-up is background — do not block plan slots on a full ahead fill.
            warmSources();
            return step();
        }).then(function () {
            if (g === generation) {
                stream.filling = null;
                if (window.Wallpaper && Wallpaper.preloadAhead) Wallpaper.preloadAhead();
            }
        }, function () {
            if (g === generation) stream.filling = null;
        });
        return stream.filling;
    }

    // Paint now with search metadata; polish place/title in the background and notify
    // so the screen saver can refresh the caption without delaying the photo swap.
    function showEntry(entry) {
        remember(entry);
        polishImmich(entry).then(function () { notify(); });
        return Promise.resolve(entry);
    }

    // Next photo from the planned list (or fetch one if the plan is empty).
    function takeNext() {
        var g = generation;
        var want = provider();
        // Solo focus: only that source (never blank-tagged Mix leftovers).
        while (stream.plan.length) {
            var ready = stream.plan.shift();
            if (want === 'mix' || (ready && ready.source === want)) {
                // Defer plan top-up so the new photo can decode without competing for network/CPU.
                fillPlan(700);
                return showEntry(ready);
            }
        }
        return advanceOne(g, true).then(function (entry) {
            if (g !== generation || !entry) return null;
            fillPlan(700);
            return showEntry(entry);
        }, function (e) {
            if (!list().length) {
                lastFailure = Date.now();
                lastError = providerMeta().label + ' unavailable';
                notify();
            }
            DevLog.log('Live wallpaper: takeNext failed: ' + (e && e.message ? e.message : e));
            fillPlan(700);
            return null;
        });
    }

    // Show one photo as soon as it is ready; top up the plan later so cold start stays snappy.
    function ensureOnDemand(g, beforeKeys) {
        function kickBackground() {
            fetchedDay = todayKey();
            // First wallpaper paints; queues + plan keep filling in the background.
            setTimeout(backgroundFill, 1600);
            return beforeKeys !== keys(items);
        }

        if (list().length) {
            fillPlan(0);
            return Promise.resolve(false);
        }
        while (stream.plan.length) {
            var ready = stream.plan.shift();
            if (provider() === 'mix' || (ready && ready.source === provider())) {
                return showEntry(ready).then(kickBackground);
            }
        }
        return advanceOne(g, true).then(function (entry) {
            if (g !== generation || !entry) {
                setTimeout(backgroundFill, 1600);
                return false;
            }
            return showEntry(entry).then(kickBackground);
        }, function () {
            setTimeout(backgroundFill, 1600);
            return false;
        });
    }

    function upcoming() {
        var p = provider();
        if (p === 'mix') return stream.plan.slice();
        return stream.plan.filter(function (w) { return w && w.source === p; });
    }

    function planCount() {
        return stream.plan.length;
    }

    /* ---------- Daily refresh ---------- */

    /*
     * Ensures a current photo quickly; the upcoming plan fills in the background.
     */
    function ensureDaily() {
        if (fetching) return Promise.resolve(false);
        if (Date.now() - lastFailure < retryDelay) return Promise.resolve(false);

        var p = provider();
        var meta = providerMeta();
        if (needsSetup()) return Promise.resolve(false);

        if (list().length && p === 'bing' && cachedMarket !== cfg().market) resetPool();

        // New calendar day: let Bing restart from today.
        if (fetchedDay && fetchedDay !== todayKey()) {
            stream.bingWrapped = false;
            stream.bing = 0;
        }

        var g = generation;
        var before = keys(list());

        // Solo focus: ignore Mix leftovers still sitting in `items`.
        // Defer top-up so first Home paint / key presses are not fighting queue fills.
        if (list().length) {
            setTimeout(backgroundFill, 1600);
            return Promise.resolve(false);
        }

        fetching = true;
        DevLog.log('Live wallpaper: first photo (' + meta.label + ')');
        return ensureOnDemand(g, before).then(function (changed) {
            if (g !== generation) return false;
            fetching = false;
            return changed;
        }, function () {
            if (g !== generation) return false;
            fetching = false;
            return false;
        });
    }

    // Active catalog for Home / SS. Solo focus hides other sources' history so Next
    // cannot wander back into Mix leftovers.
    function list() {
        var p = provider();
        if (p === 'mix') return items.slice();
        return items.filter(function (w) { return w && w.source === p; });
    }

    function find(key) {
        var hit = items.find(function (w) { return w.key === key; });
        if (hit) return hit;
        var visible = list();
        return visible[0] || null;
    }

    // Choose as static (single providers only — Mix has no picker).
    // Catalog lasts while queues drain; show up to pickTarget (default PICK_BATCH).
    function pickList() {
        var p = provider();
        if (p === 'mix') return [];
        seedPickCatalog();
        var cap = ensurePickTarget(p);
        var out = [];
        Object.keys(pickCatalog).forEach(function (k) {
            var w = pickCatalog[k];
            if (!w || !w.file || w.source !== p) return;
            out.push(w);
        });
        out = out.slice(0, cap);
        // Picker follows catalog/fetch order (Shuffle only affects Mix provider walk).
        pickOrderSig = '';
        pickOrderKeys = [];
        return out;
    }

    // Fetch the first PICK_BATCH for the current (non-Mix) provider, then keep filling
    // queues/plan/catalog in the background (SOURCE_AHEAD) without holding the busy spinner.
    function warmForPicker() {
        var p = provider();
        if (p === 'mix' || needsSetup()) return Promise.resolve();
        var want = ensurePickTarget(p);
        preloadPickThumbs();
        function ready() {
            preloadPickThumbs();
            notify();
            backgroundFill();
        }
        if (pickCountFor(p) >= want) {
            ready();
            return Promise.resolve();
        }
        fillSourceQueue(p, want).catch(function (e) {
            DevLog.log('Live wallpaper: ' + p + ' pick warm failed: ' +
                (e && e.message ? e.message : e));
        });
        return waitForPickCount(p, want, 25000).then(ready);
    }

    // Another PICK_BATCH for the current provider (catalog first, then fetch).
    function loadMorePicks() {
        var p = provider();
        if (p === 'mix' || needsSetup()) return Promise.resolve(0);
        var before = pickList().length;
        ensurePickTarget(p);
        pickTarget[p] += pickBatch();
        var want = pickTarget[p];
        pickOrderSig = '';
        function done() {
            preloadPickThumbs();
            notify();
            backgroundFill();
            return pickList().length - before;
        }
        if (pickCountFor(p) >= want) return Promise.resolve(done());
        fillSourceQueue(p, want).catch(function () {});
        return waitForPickCount(p, want, 25000).then(done);
    }

    function status() {
        if (needsSetup()) return provider() === 'immich' ? 'Set an Immich share link' : 'Set an Unsplash Access Key';
        return lastError;
    }

    function clearCache() {
        generation++;
        fetching = false;
        lastFailure = 0;
        retryDelay = RETRY_MS;
        lastError = '';
        try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
        resetImmichState();
        resetPool();
    }

    // Provider change (e.g. Bing → Mix): drop shown history + plan so Home/SS do not keep the
    // previous photo. Solo→solo can keep the target queue; entering Mix clears every queue so
    // the previous solo pile cannot monopolise warm picks. Settings calls ensureLive(true);
    // SS calls takeNext — both kick plan fill after the first frame.
    function switchProvider() {
        var prev = '';
        if (items.length && items[items.length - 1].source) prev = items[items.length - 1].source;
        else if (cachedProvider && cachedProvider !== 'mix') prev = cachedProvider;
        var toMix = provider() === 'mix';
        generation++;
        fetching = false;
        lastFailure = 0;
        retryDelay = RETRY_MS;
        lastError = '';
        items = [];
        fetchedDay = '';
        cachedProvider = provider();
        // Mix: avoid re-painting the source you just left on the first frame only.
        avoidSource = (toMix && prev) ? prev : '';
        resetMixWarm();
        stream.plan = [];
        stream.filling = null;
        // Always clear queues + pick catalog — Mix leftovers (or blank-tagged
        // orphans once re-labelled) must not ride into a solo Immich focus.
        SOURCE_NAMES.forEach(function (name) {
            var q = sourceQueue(name);
            q.filling = null;
            q.buf = [];
        });
        // Fresh cursors so a stuck Bing idx / NASA wrap cannot starve the new focus.
        stream.bing = 0;
        stream.bingWrapped = false;
        stream.nasa = 0;
        stream.wiki = 0;
        stream.unsplash = 0;
        stream.immichPage = 1;
        stream.immichWrapped = false;
        stream.sourceIndex = 0;
        pickCatalog = {};
        pickOrderSig = '';
        pickOrderKeys = [];
        pickTarget = {};
        try { localStorage.removeItem(CACHE_KEY); } catch (e) { /* ignore */ }
        notify(true);
    }

    // Drop upcoming slots only (keep the current photo); used when Shuffle toggles.
    // Shuffle On reshuffles the Mix provider list; playback stays round-robin after that.
    function rebuildPlan() {
        generation++;
        stream.plan = [];
        stream.filling = null;
        if (provider() === 'mix' && shuffleOn()) reshuffleMixOrder();
        else {
            mixOrder = readyMixKeys().slice();
            stream.sourceIndex = 0;
        }
        fillPlan();
        notify();
    }

    applyUnsplashStore();
    immichLink = readImmichLink();
    migrateLiveMultiSelect();
    syncLiveProvider();
    loadCache();
    trim();
    // Picks already restored in loadCache; seed from queues/items only when the picker opens.
    // Defer scrub rewrite so boot is not blocked on a large localStorage stringify.
    if (cacheNeedsRewrite && items.length) {
        setTimeout(function () { saveCache(cachedProvider || provider(), true); }, 2500);
    }
    // Flush debounced cache if the page is leaving (TV app hide / preview refresh).
    window.addEventListener('pagehide', function () {
        if (saveTimer) {
            clearTimeout(saveTimer);
            saveTimer = null;
            flushSaveCache();
        }
    });

    window.LiveWallpaper = {
        PROVIDERS: PROVIDERS,
        list: list,
        pickList: pickList,
        warmForPicker: warmForPicker,
        loadMorePicks: loadMorePicks,
        pickBatch: pickBatch,
        LIVE_POOLS: LIVE_POOLS,
        preloadPickThumbs: preloadPickThumbs,
        find: find,
        ensureDaily: ensureDaily,
        clearCache: clearCache,
        switchProvider: switchProvider,
        rebuildPlan: rebuildPlan,
        fetchedDay: function () { return fetchedDay; },
        provider: provider,
        providerLabel: function () { return providerMeta().label; },
        takeNext: takeNext,
        upcoming: upcoming,
        planCount: planCount,
        mixSources: mixSourceLabels,
        freeSourceKeys: freeSourceKeys,
        readyMixKeys: readyMixKeys,
        orderedMixKeys: orderedMixKeys,
        reshuffleMixOrder: reshuffleMixOrder,
        switchableProviders: switchableProviders,
        selectLiveProvider: selectLiveProvider,
        providerLabelFor: providerLabelFor,
        enabledSourceKeys: enabledSourceKeys,
        mixSourceOn: mixSourceOn,
        setMixSource: setMixSource,
        setMixMode: setMixMode,
        setSoloProvider: setSoloProvider,
        mixModeOn: mixModeOn,
        deriveLiveProvider: deriveLiveProvider,
        syncLiveProvider: syncLiveProvider,
        status: status,
        needsSetup: needsSetup,
        onChange: function (fn) { listeners.push(fn); },
        immichConfigured: immichConfigured,
        setImmichLink: setImmichLink,
        clearImmichLink: clearImmichLink,
        immichSummary: function () {
            return immichConfigured() ? 'Share link set' : 'Set share link';
        },
        unsplashConfigured: unsplashConfigured,
        setUnsplashKey: setUnsplashKey,
        clearUnsplashKey: clearUnsplashKey,
        unsplashCollection: function () { return unsplashCollection; },
        setUnsplashCollection: setUnsplashCollection,
        unsplashKeySummary: function () {
            return unsplashConfigured() ? 'Access Key set' : 'Set Access Key';
        },
        unsplashCollectionSummary: function () {
            var id = unsplashCollection;
            if (!id) return 'Popular photos';
            return id.length > 14 ? id.slice(0, 12) + '…' : id;
        }
    };
})();
