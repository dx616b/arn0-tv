import test from 'node:test';
import assert from 'node:assert/strict';
import { createLauncherSandbox } from './harness.mjs';

// Characterization tests: they pin down how the live queue behaves today, so the queue can be
// refactored with a check that nothing changed.

function soloBing(extra) {
    return createLauncherSandbox({
        prefs: {
            wallpaper: Object.assign({
                mode: 'live',
                liveProvider: 'bing',
                livePool: 'small',
                interval: '15m',
                random: true
            }, extra || {})
        }
    });
}

function remoteEntry(key) {
    return {
        key: 'bing:' + key,
        title: 'Title ' + key,
        file: 'https://example.test/' + key + '-long-enough-name.jpg',
        source: 'bing'
    };
}

test('fresh solo Bing queue is empty and reports its plan size', function () {
    var ctx = soloBing();
    var L = ctx.LiveWallpaper;
    assert.equal(L.provider(), 'bing');
    assert.equal(L.planCount(), 0);
    assert.equal(L.upcoming().length, 0);
    assert.equal(L.pickList().length, 0);
    assert.equal(L.planSize(), ctx.LiveWallpaper.LIVE_POOLS.small.plan);
    assert.equal(L.pickBatch(), ctx.LiveWallpaper.LIVE_POOLS.small.pick);
});

test('effective look-ahead follows the pool size for solo sources', function () {
    var ctx = soloBing();
    assert.equal(ctx.LiveWallpaper.effectiveAhead(), ctx.LiveWallpaper.LIVE_POOLS.small.ahead);
});

test('a shown pick is normalized and added to the picker catalogue', async function () {
    var ctx = soloBing();
    var L = ctx.LiveWallpaper;
    var out = await L.showPick(remoteEntry('alpha'));
    assert.ok(out, 'showPick resolves to the entry');
    assert.equal(out.key, 'bing:alpha');
    assert.equal(out.remote, true);
    assert.deepEqual(Array.from(L.pickList()).map(function (w) { return w.key; }), ['bing:alpha']);
});

test('picking the same photo twice keeps one catalogue entry', function () {
    var ctx = soloBing();
    var L = ctx.LiveWallpaper;
    L.showPick(remoteEntry('beta'));
    L.showPick(remoteEntry('beta'));
    assert.equal(L.pickList().length, 1);
});

test('entries without a key or a file are rejected', function () {
    var ctx = soloBing();
    var L = ctx.LiveWallpaper;
    assert.equal(L.showPick({ file: 'https://example.test/x-long-enough.jpg' }), null);
    assert.equal(L.showPick({ key: 'bing:nofile' }), null);
    assert.equal(L.pickList().length, 0);
});

test('solo sources do not enter Mix ordering', function () {
    var ctx = soloBing();
    var L = ctx.LiveWallpaper;
    assert.equal(L.mixModeOn(), false);
    assert.deepEqual(Array.from(L.enabledSourceKeys()), ['bing']);
    assert.equal(L.planCount(), 0);
});

test('status is empty when nothing is being fetched', function () {
    var ctx = soloBing();
    assert.equal(ctx.LiveWallpaper.status(), '');
});

function planEntry(key, source) {
    return {
        key: source + ':' + key,
        title: 'Plan ' + key,
        file: 'https://example.test/' + key + '-long-enough-name.jpg',
        source: source
    };
}

test('takeNext serves the planned photos in order', async function () {
    var ctx = soloBing();
    var L = ctx.LiveWallpaper;
    ctx.LiveState.stream.plan = [planEntry('one', 'bing'), planEntry('two', 'bing')];
    var first = await L.takeNext();
    assert.equal(first.key, 'bing:one');
    assert.equal(ctx.LiveState.stream.plan.length, 1);
    var second = await L.takeNext();
    assert.equal(second.key, 'bing:two');
    assert.equal(ctx.LiveState.stream.plan.length, 0);
});

test('solo focus skips planned photos from other sources', async function () {
    var ctx = soloBing();
    var L = ctx.LiveWallpaper;
    ctx.LiveState.stream.plan = [planEntry('nasa-day', 'nasa'), planEntry('bing-day', 'bing')];
    var got = await L.takeNext();
    assert.equal(got.key, 'bing:bing-day');
});

test('duplicate check matches on key or file, against plan and history', function () {
    var ctx = soloBing();
    var queued = planEntry('dup-check', 'bing');
    ctx.LiveState.stream.plan = [queued];
    assert.equal(ctx.LivePool.isDuplicate(queued), true);
    assert.equal(ctx.LivePool.isDuplicate({ key: 'bing:other', file: queued.file }), true);
    assert.equal(ctx.LivePool.isDuplicate(planEntry('fresh', 'bing')), false);
    assert.equal(ctx.LivePool.isDuplicate(null), true);
});

test('takeFromQueue returns the first fresh entry for that source and removes it', function () {
    var ctx = soloBing();
    var Q = ctx.LiveQueue;
    var a = { key: 'bing:q-a', title: 'A', file: 'https://www.bing.com/th?id=OHR.QA_1920x1080.jpg', source: 'bing' };
    var b = { key: 'bing:q-b', title: 'B', file: 'https://www.bing.com/th?id=OHR.QB_1920x1080.jpg', source: 'bing' };
    ctx.LivePool.sourceQueue('bing').buf = [a, b];
    var got = Q.takeFromQueue('bing', false);
    assert.equal(got.key, a.key);
    assert.equal(ctx.LivePool.sourceQueue('bing').buf.length, 1);
    assert.equal(Q.takeFromQueue('nasa', false), null);
});

test('planPause yields briefly and resolves', async function () {
    var ctx = soloBing();
    var started = Date.now();
    await ctx.LiveQueue.planPause();
    assert.ok(Date.now() - started < 1000);
});

test('next slot rotates through sources and skips the one to avoid', function () {
    var ctx = soloBing();
    ctx.LiveState.avoidSource = '';
    ctx.LiveState.stream.sourceIndex = 1;
    assert.equal(ctx.LivePool.nextSlotStart(['a', 'b', 'c']), 1);
    ctx.LiveState.avoidSource = 'b';
    assert.equal(ctx.LivePool.nextSlotStart(['a', 'b', 'c']), 0);
    assert.equal(ctx.LivePool.nextSlotStart(['only']), 0);
});

test('withTimeout passes a quick result through and rejects a slow one', async function () {
    var ctx = soloBing();
    var Q = ctx.LiveQueue;
    assert.equal(await Q.withTimeout(Promise.resolve('ok'), 1000), 'ok');
    await assert.rejects(Q.withTimeout(new Promise(function () {}), 20));
});

test('reseed refills an empty source queue from the picker catalogue, in key order', function () {
    var ctx = soloBing();
    var Q = ctx.LiveQueue;
    var b = { key: 'bing:cat-b', title: 'B', file: 'https://www.bing.com/th?id=OHR.B_1920x1080.jpg', source: 'bing' };
    var a = { key: 'bing:cat-a', title: 'A', file: 'https://www.bing.com/th?id=OHR.A_1920x1080.jpg', source: 'bing' };
    ctx.LiveState.pickCatalog = { 'bing:cat-b': b, 'bing:cat-a': a };
    Q.reseedQueueFromCatalog('bing');
    assert.deepEqual(Array.from(ctx.LivePool.sourceQueue('bing').buf).map(function (w) { return w.key; }), ['bing:cat-a', 'bing:cat-b']);
});

test('waitForFresh resolves at once when the queue already has enough fresh photos', async function () {
    var ctx = soloBing();
    var Q = ctx.LiveQueue;
    ctx.LivePool.sourceQueue('bing').buf = [
        { key: 'bing:wf-1', title: 'W1', file: 'https://www.bing.com/th?id=OHR.W1_1920x1080.jpg', source: 'bing' },
        { key: 'bing:wf-2', title: 'W2', file: 'https://www.bing.com/th?id=OHR.W2_1920x1080.jpg', source: 'bing' }
    ];
    var started = Date.now();
    await Q.waitForFresh('bing', 2, false);
    assert.ok(Date.now() - started < 1000);
});

test('queue snapshot carries the plan, every source queue and the Mix order', function () {
    var ctx = soloBing();
    var Q = ctx.LiveQueue;
    var planned = planEntry('snap', 'bing');
    ctx.LiveState.stream.plan = [planned];
    var snap = Q.snapshot();
    assert.equal(snap.plan.length, 1);
    assert.equal(snap.plan[0].key, planned.key);
    ['bing', 'nasa', 'wikimedia', 'wallhaven', 'unsplash', 'immich'].forEach(function (name) {
        assert.ok(Array.isArray(snap.queues[name].buf), name);
    });
    assert.ok(Array.isArray(snap.mixOrder));
});

test('restore loads saved source queues and Mix order, and never restores the plan', function () {
    var ctx = soloBing();
    var Q = ctx.LiveQueue;
    var saved = { key: 'bing:rs-1', title: 'R1', file: 'https://www.bing.com/th?id=OHR.R1_1920x1080.jpg', source: 'bing' };
    ctx.LiveState.stream.plan = [planEntry('stale', 'bing')];
    Q.restore({
        queues: { bing: { buf: [saved] } },
        plan: [planEntry('old-plan', 'bing')],
        mixOrder: ['bing', 'not-a-source']
    });
    assert.equal(ctx.LivePool.sourceQueue('bing').buf.length, 1);
    assert.equal(ctx.LivePool.sourceQueue('bing').buf[0].key, 'bing:rs-1');
    assert.equal(ctx.LiveState.stream.plan.length, 0);
    assert.deepEqual(Array.from(ctx.LiveState.mixOrder), ['bing']);
});

test('daily refresh does nothing while a fetch is already running', async function () {
    var ctx = soloBing();
    ctx.LiveState.fetching = true;
    assert.equal(await ctx.LiveQueue.ensureDaily(), false);
    ctx.LiveState.fetching = false;
});

test('Unsplash key store sets and clears the shared state', function () {
    var ctx = soloBing();
    var S = ctx.LiveStores;
    S.setUnsplashKey('test-key-123');
    assert.equal(ctx.LiveState.unsplashKey, 'test-key-123');
    S.clearUnsplashKey();
    assert.equal(ctx.LiveState.unsplashKey, '');
});

test('seen list records a photo once, and forgetting removes it', function () {
    var ctx = soloBing();
    var H = ctx.LiveHistory;
    var e = { key: 'bing:seen-1', title: 'S1', file: 'https://www.bing.com/th?id=OHR.S1_1920x1080.jpg', source: 'bing' };
    ctx.LiveState.seen = [];
    H.markSeen(e);
    H.markSeen(e);
    assert.equal(ctx.LiveState.seen.filter(function (x) { return x.key === e.key; }).length, 1);
    H.forgetSeenEntries([e]);
    assert.equal(ctx.LiveState.seen.filter(function (x) { return x.key === e.key; }).length, 0);
});
