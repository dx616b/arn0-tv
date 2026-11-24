/*
 * Live wallpaper fill: pulls fresh photos from each source into its queue, waits for them, and warms
 * sources in the background. The plan (live-queue.js) decides when to call these; the pool
 * primitives live in live-pool.js. Change notifications come from live-events.js.
 */
(function () {
    'use strict';

    var BING_WINDOW = LiveCore.BING_WINDOW;
    var SPAN_NASA = LiveCore.SPAN_NASA;
    var SPAN_WIKI = LiveCore.SPAN_WIKI;
    var SPAN_UNSPLASH = LiveCore.SPAN_UNSPLASH;
    var IMMICH_PAGE = LiveCore.IMMICH_PAGE;
    var IMMICH_XHR_MS = LiveCore.IMMICH_XHR_MS;
    var daysAgoKey = LiveCore.daysAgoKey;
    var xhrPostJson = LiveCore.xhrPostJson;
    var normalize = LiveParsers.normalize;
    var provider = LiveRoster.provider;
    var orderedMixKeys = LivePool.orderedMixKeys;
    var sourceQueue = LivePool.sourceQueue;
    var isDuplicate = LivePool.isDuplicate;
    var queueHas = LivePool.queueHas;
    var dropStale = LivePool.dropStale;
    var freshInQueue = LivePool.freshInQueue;
    var nextSlotStart = LivePool.nextSlotStart;
    var streamKeys = LivePool.streamKeys;
    var sourceAhead = LivePool.sourceAhead;
    var effectiveAhead = LivePool.effectiveAhead;
    var entryMatchesSource = LiveHistory.entryMatchesSource;
    var forgetSeenEntries = LiveHistory.forgetSeenEntries;
    var rememberPick = LiveSources.picker.rememberPick;
    var pickCountFor = LiveSources.picker.pickCountFor;
    var seedPickCatalog = LiveSources.picker.seedPickCatalog;
    var saveCache = LiveSources.cache.saveCache;
    var ensureBingDayWindow = LiveSources.bing.ensureBingDayWindow;
    var ensureImmichAlbum = LiveSources.immich.ensureImmichAlbum;
    var immichApi = LiveSources.immich.immichApi;
    var immichEntry = LiveSources.immich.immichEntry;
    var fetchNasaDay = LiveSources.nasa.fetchNasaDay;
    var fetchUnsplashDays = LiveSources.unsplash.fetchUnsplashDays;
    var fetchWallhavenPage = LiveSources.wallhaven.fetchWallhavenPage;
    var fetchWikimediaDay = LiveSources.wiki.fetchWikimediaDay;

    function notify() { return LiveEvents.notify.apply(null, arguments); }

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

    function reseedQueueFromCatalog(name) {
        var q = sourceQueue(name);
        // Stable order by key; only this source (exact tag — no blank-source orphans).
        Object.keys(LiveState.pickCatalog).sort().forEach(function (k) {
            var w = LiveState.pickCatalog[k];
            if (!w || w.source !== name || !w.file || queueHas(q, w)) return;
            q.buf.push(w);
        });
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

    // One server pull → zero or more fresh entries (Immich/Bing return a page; others one).
    function pullFresh(name) {
        if (name === 'bing') {
            // Live API window is ~8 days — fetched once per calendar day (ensureBingDayWindow).
            return ensureBingDayWindow().then(function (all) {
                if (!all.length) throw new Error('empty Bing');
                var idx = LiveState.stream.bing || 0;
                if (idx >= all.length) {
                    if (!LiveState.stream.bingWrapped) {
                        LiveState.stream.bingWrapped = true;
                        LiveState.stream.bing = 0;
                        return { entries: [], wrapped: true };
                    }
                    return { entries: [], done: true };
                }
                // Hand the whole remaining window in one step; no further network this day.
                var batch = all.slice(idx);
                LiveState.stream.bing = all.length;
                LiveState.stream.bingWrapped = false;
                return { entries: batch, done: true };
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
        if (name === 'wallhaven') {
            return fetchWallhavenPage();
        }
        if (name === 'immich') {
            return ensureImmichAlbum().then(function (album) {
                var pageNum = LiveState.stream.immichPage || 1;
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
                        if (!LiveState.stream.immichWrapped) {
                            LiveState.stream.immichWrapped = true;
                            LiveState.stream.immichPage = 1;
                            return { entries: [], wrapped: true };
                        }
                        return { entries: [], done: true };
                    }
                    LiveState.stream.immichPage = pageNum + 1;
                    LiveState.stream.immichWrapped = false;
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
        if (name === 'bing') cap = Math.min(cap, BING_WINDOW);
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
                    /*
                     * Bing/NASA pools are tiny. Once every key is already known, force-requeue
                     * for playback reuse — but only when the upcoming *plan* does not already
                     * hold them. isDuplicate also checks plan/history; recycling those keys
                     * cannot make them "fresh" for plan fill, and dropStale would immediately
                     * remove the force-adds → empty-bing spin in the log.
                     */
                    if (!added && batch.length && batch.every(isDuplicate)) {
                        var heldInPlan = batch.every(function (e) {
                            return LiveState.stream.plan.some(function (w) {
                                return w.key === e.key || (e.file && w.file === e.file);
                            });
                        });
                        if (heldInPlan) {
                            padFromKnown(name, cap);
                            return;
                        }
                        forgetSeenEntries(batch);
                        if (name === 'bing') LiveState.stream.bingWrapped = false;
                        batch.forEach(function (entry) { absorb(entry, true); });
                        if (added) {
                            DevLog.log('Live wallpaper: ' + name + ' recycled ' + batch.length);
                            dirty = true;
                        }
                        // One recycle pass — do not dropStale the forced batch or step again.
                        return;
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
        Object.keys(LiveState.pickCatalog).sort().forEach(function (k) { absorb(LiveState.pickCatalog[k]); });
        LiveState.items.forEach(absorb);
        LiveState.stream.plan.forEach(absorb);
    }

    function warmSources() {
        var keys = streamKeys();
        if (!keys.length) return Promise.resolve();
        // Mix: never Promise.all every roster source — that storms the TV when Mix On
        // has Bing+NASA+Wiki+Wallhaven+…. Only warm the next slot (boot) or next two (full).
        if (provider() === 'mix') {
            var ordered = orderedMixKeys();
            if (!ordered.length) return Promise.resolve();
            var start = nextSlotStart(ordered);
            var want = LiveState.mixWarmPhase === 'boot' ? 1 : Math.min(2, ordered.length);
            var chain = Promise.resolve();
            var i;
            for (i = 0; i < want; i++) {
                (function (name) {
                    chain = chain.then(function () { return warmOne(name); });
                })(ordered[(start + i) % ordered.length]);
            }
            return chain;
        }
        // Solo: fillSourceQueue with no limit uses effectiveAhead().
        return Promise.all(keys.map(warmOne));
    }

    // Growing cursor (persisted). Always +1 in line — never a random server offset.
    function nextOffset(name, span) {
        var off = LiveState.stream[name] || 0;
        var next = off + 1;
        LiveState.stream[name] = span > 0 ? next % span : next;
        return off;
    }

    window.LiveFill = {
        takeFromQueue: takeFromQueue,
        reseedQueueFromCatalog: reseedQueueFromCatalog,
        waitForFresh: waitForFresh,
        fetchOne: fetchOne,
        warmOne: warmOne,
        pullFresh: pullFresh,
        fillSourceQueue: fillSourceQueue,
        padFromKnown: padFromKnown,
        waitForPickCount: waitForPickCount,
        warmSources: warmSources,
        withTimeout: withTimeout,
        nextOffset: nextOffset,
    };
})();
