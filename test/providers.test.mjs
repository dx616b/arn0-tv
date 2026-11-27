import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createLauncherSandbox } from './harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Photo providers: what each one gives the screensaver and Home as the full picture and as a preview.
const ctx = createLauncherSandbox();
const plain = (v) => JSON.parse(JSON.stringify(v));
const BING = ctx.window.LiveSources.bing;
const WALL = ctx.window.LiveSources.wallhaven;
const PHOTO = ctx.window.PhotoUtil;

test('Bing: the full picture is the 1080p file and the preview is only a preview', function () {
    const entry = plain(BING.parseBingImage({ urlbase: '/th?id=OHR.Test_EN-GB1', title: 'Test', copyright: 'Someone (© Co)', startdate: '20260101' }));
    assert.equal(entry.file, 'https://www.bing.com/th?id=OHR.Test_EN-GB1_1920x1080.jpg');
    assert.equal(entry.thumb, 'https://www.bing.com/th?id=OHR.Test_EN-GB1_320x180.jpg');
    assert.notEqual(entry.file, entry.thumb);
    assert.equal(entry.source, 'bing');
});

test('Bing: an entry without a base picture is rejected', function () {
    assert.equal(BING.parseBingImage({ title: 'No base' }), null);
    assert.equal(BING.parseBingImage(null), null);
});

test('Wallhaven: the full picture is the file path, not the preview', function () {
    const entry = plain(WALL.parseWallhavenImage({
        id: 'abc123', path: 'https://w.wallhaven.cc/full/ab/wallhaven-abc123.jpg', category: 'general',
        dimension_x: 1920, dimension_y: 1080, file_size: 400000,
        thumbs: { large: 'https://th.wallhaven.cc/lg/ab/abc123.jpg', original: 'https://th.wallhaven.cc/orig/ab/abc123.jpg' }
    }));
    assert.equal(entry.file, 'https://w.wallhaven.cc/full/ab/wallhaven-abc123.jpg');
    assert.equal(entry.thumb, 'https://th.wallhaven.cc/lg/ab/abc123.jpg');
    assert.equal(entry.key, 'wallhaven:abc123');
});

test('Wallhaven: portrait pictures are left out', function () {
    assert.equal(WALL.parseWallhavenImage({ id: 'p1', path: 'https://w.wallhaven.cc/full/p1.jpg', dimension_x: 1080, dimension_y: 1920 }), null);
});

test('Wallhaven: pictures over 8 MB are left out (they decode poorly on the TV)', function () {
    assert.equal(WALL.parseWallhavenImage({ id: 'big', path: 'https://w.wallhaven.cc/full/b/big.png', dimension_x: 1920, dimension_y: 1080, file_size: 9 * 1024 * 1024 }), null);
    assert.notEqual(WALL.parseWallhavenImage({ id: 'ok', path: 'https://w.wallhaven.cc/full/o/ok.png', dimension_x: 1920, dimension_y: 1080, file_size: 7 * 1024 * 1024 }), null);
});

test('Wallhaven: pictures above 1080p are left out', function () {
    assert.equal(WALL.parseWallhavenImage({ id: 'uhd', path: 'https://w.wallhaven.cc/full/u/uhd.jpg', dimension_x: 3840, dimension_y: 2160 }), null);
});

test('Wallhaven: all site categories stay available under topic filtering', function () {
    ctx.window.LiveState.wallhavenCategory = 'general';
    assert.notEqual(WALL.parseWallhavenImage({ id: 'a1', path: 'https://w.wallhaven.cc/full/a/a1.jpg', category: 'anime', dimension_x: 1920, dimension_y: 1080 }), null);
});

test('Wallhaven: selected topics rotate as separate searches and custom topics persist', function () {
    try {
        ctx.window.LiveStores.setWallhavenTopics(['space', 'cars']);
        assert.ok(WALL.wallhavenSearchPath(1, '', 'space').includes('&q=space'));
        assert.ok(WALL.wallhavenSearchPath(1, '', 'cars').includes('&q=cars'));
        assert.equal(WALL.wallhavenTopicAllowed('space'), true);
        assert.equal(WALL.wallhavenTopicAllowed('nature'), false);
        ctx.window.LiveStores.addWallhavenCustomTopic('night sky');
        assert.ok(WALL.wallhavenSearchPath(1, '', 'custom:night sky').includes('&q=night%20sky'));
        assert.equal(WALL.wallhavenTopicAllowed('custom:night sky'), true);
        assert.deepEqual(Array.from(ctx.window.LiveStores.readWallhavenStore().topics), [
            'space', 'cars', 'custom:night sky'
        ]);
        ctx.window.LiveStores.removeWallhavenCustomTopic('night sky');
        assert.deepEqual(Array.from(ctx.window.LiveStores.readWallhavenStore().topics), ['space', 'cars']);
    } finally {
        ctx.window.LiveStores.setWallhavenTopics([]);
        ctx.window.LiveStores.removeWallhavenCustomTopic('night sky');
    }
});

test('Screensaver and Home try the full picture, then its fallbacks, and never the preview', function () {
    const urls = plain(PHOTO.photoUrls({
        file: 'full.jpg', fileFallback: 'fallback.jpg', fileFallbacks: ['second.jpg', 'full.jpg'], thumb: 'preview.jpg'
    }));
    assert.deepEqual(urls, ['full.jpg', 'fallback.jpg', 'second.jpg']);
    assert.ok(!urls.includes('preview.jpg'));
});

test('a photo that will not load is removed from the catalogue, plan and queues, for every provider', function () {
    const c = createLauncherSandbox();
    const H = c.window.LiveHistory;
    const S = c.window.LiveState;
    const bad = { key: 'wallhaven:bad', file: 'https://w.wallhaven.cc/full/b/bad.png', source: 'wallhaven' };
    const good = { key: 'bing:ok', file: 'https://www.bing.com/th?id=OK_1920x1080.jpg', source: 'bing' };
    S.pickCatalog[bad.key] = bad;
    S.pickCatalog[good.key] = good;
    S.stream = { plan: [bad, good], queues: { wallhaven: { buf: [bad] }, bing: { buf: [good] } } };
    H.markFailed(bad);
    assert.equal(H.isFailed(bad), true);
    assert.equal(H.isFailed(good), false);
    assert.equal(S.pickCatalog[bad.key], undefined);
    assert.deepEqual(plain(S.stream.plan.map(function (w) { return w.key; })), ['bing:ok']);
    assert.deepEqual(plain(S.stream.queues.wallhaven.buf), []);
    assert.deepEqual(plain(S.stream.queues.bing.buf.map(function (w) { return w.key; })), ['bing:ok']);
});

test('a failed photo is reported as already queued, so no provider adds it back', function () {
    const c = createLauncherSandbox();
    const H = c.window.LiveHistory;
    const bad = { key: 'nasa:x', file: 'https://apod.example/x.jpg', source: 'nasa' };
    H.markFailed(bad);
    const queue = { buf: [] };
    assert.equal(c.window.LivePool.queueHas(queue, { key: 'nasa:y', file: bad.file }), true);
    assert.equal(c.window.LivePool.queueHas(queue, { key: 'nasa:z', file: 'https://apod.example/z.jpg' }), false);
});

test('Lab: the photo checks are listed for the Lab screen', function () {
    const c = createLauncherSandbox();
    const labels = plain(c.window.LiveWallpaper.actions().map(function (a) { return a.label; }));
    assert.deepEqual(labels, ['Photos: list addresses that will not load', 'Photos: forget them and try again']);
});

test('Unsplash: the picture is sized to 1080p, the preview is separate, portraits are left out', function () {
    const c = createLauncherSandbox();
    const U = c.window.LiveSources.unsplash;
    const entry = plain(c.window.LiveParsers.normalize(U.parseUnsplashImage({
        id: 'u1', width: 4000, height: 2500, alt_description: 'Hills',
        urls: { raw: 'https://images.unsplash.com/photo-1?ixid=x', small: 'https://images.unsplash.com/photo-1?w=400' },
        user: { name: 'Ann' }, links: { download_location: 'https://api.unsplash.com/photos/u1/download' }
    })));
    assert.ok(entry.file.includes('w=1920') && entry.file.includes('h=1080'), 'file is sized to 1080p');
    assert.equal(entry.thumb, 'https://images.unsplash.com/photo-1?w=400');
    assert.equal(entry.credit, 'Ann on Unsplash');
    assert.equal(entry.source, 'unsplash');
    assert.equal(U.parseUnsplashImage({ id: 'p', width: 1000, height: 2000, urls: { raw: 'https://x.example/p' } }), null);
    assert.equal(U.parseUnsplashImage({ id: 'n', urls: {} }), null);
});

test('Immich: the picture is the fullsize derivative, the preview is the thumbnail, the original is last', function () {
    const c = createLauncherSandbox();
    const I = c.window.LiveSources.immich;
    const entry = plain(I.immichEntry({ id: 'a1', fileCreatedAt: '2025-01-02T10:00:00Z', exifInfo: { city: 'Tirana' } }, 'https://photos.example', 'key=K', 'Trip'));
    assert.equal(entry.key, 'immich:a1');
    assert.ok(entry.file.endsWith('/thumbnail?size=fullsize&key=K'), 'file is fullsize');
    assert.ok(entry.thumb.includes('size=thumbnail'), 'thumb is the small derivative');
    assert.ok(entry.fileFallbacks.some(function (u) { return u.includes('/original?'); }), 'original is a fallback');
    assert.equal(entry.fileFallbacks[entry.fileFallbacks.length - 1].includes('/original?'), true, 'original comes last');
});

test('Immich: caption subtitle includes available EXIF place, date and camera details', function () {
    const c = createLauncherSandbox();
    const I = c.window.LiveSources.immich;
    const entry = plain(I.immichEntry({
        id: 'a2',
        localDateTime: '2025-01-02T10:00:00',
        exifInfo: {
            city: 'Tirana', country: 'Albania', make: 'Canon', model: 'Canon EOS R6',
            lensModel: 'RF 50mm F1.8 STM', focalLength: 50, fNumber: 1.8,
            exposureTime: 0.004, iso: 400
        }
    }, 'https://photos.example', 'key=K', 'Trip'));
    assert.match(entry.title, /Tirana, Albania/);
    assert.match(entry.sub, /2025/);
    assert.match(entry.sub, /Canon EOS R6/);
    assert.match(entry.sub, /50 mm/);
    assert.match(entry.sub, /f\/1.8/);
    assert.match(entry.sub, /1\/250 s/);
    assert.match(entry.sub, /ISO 400/);
});

test('Wallhaven: concurrent fills share one search request', async function () {
    const c = createLauncherSandbox();
    const calls = [];
    c.window.LiveCore.xhrGet = function (url) { calls.push(url); return new Promise(function () {}); };
    vm.runInContext(fs.readFileSync(path.join(root, 'src/js/live-source-wallhaven.js'), 'utf8'), c, { filename: 'live-source-wallhaven.js' });
    const W = c.window.LiveSources.wallhaven;
    W.fetchWallhavenPage();
    W.fetchWallhavenPage();
    W.fetchWallhavenPage();
    assert.equal(calls.length, 1, 'one request for three callers');
});

test('Wallhaven: after a failed detail request, detail requests pause', async function () {
    const c = createLauncherSandbox();
    const calls = [];
    c.window.LiveCore.xhrGet = function (url) { calls.push(url); return Promise.reject(new Error('network')); };
    vm.runInContext(fs.readFileSync(path.join(root, 'src/js/live-source-wallhaven.js'), 'utf8'), c, { filename: 'live-source-wallhaven.js' });
    const W = c.window.LiveSources.wallhaven;
    assert.equal(await W.fetchWallhavenDetail('a'), null);
    assert.equal(await W.fetchWallhavenDetail('b'), null);
    assert.equal(calls.length, 1, 'second detail waits for the pause');
    assert.ok(c.window.LiveState.wallhavenDetailDownUntil > Date.now());
});

test('Wallhaven: changing topics drops the search still running for the old selection', function () {
    const c = createLauncherSandbox();
    const calls = [];
    c.window.LiveCore.xhrGet = function (url) { calls.push(url); return new Promise(function () {}); };
    vm.runInContext(fs.readFileSync(path.join(root, 'src/js/live-source-wallhaven.js'), 'utf8'), c, { filename: 'live-source-wallhaven.js' });
    const W = c.window.LiveSources.wallhaven;
    W.fetchWallhavenPage();
    assert.equal(calls.length, 1);
    c.window.LiveStores.setWallhavenTopics(['nature', 'space']);
    W.fetchWallhavenPage();
    assert.equal(calls.length, 2, 'the new topic selection starts a fresh search');
    assert.ok(calls[1].includes('q=nature'), 'the first selected topic starts the query cycle');
});

test('Wallhaven: requests and tags results from multiple topics in rotation', async function () {
    const c = createLauncherSandbox();
    const calls = [];
    c.window.LiveCore.xhrGet = function (url) {
        calls.push(url);
        const topic = new URL(url).searchParams.get('q');
        return Promise.resolve({
            data: [0, 1, 2].map(function (i) {
                return {
                    id: topic + i,
                    path: 'https://w.wallhaven.cc/full/' + topic + i + '.jpg',
                    category: 'general', dimension_x: 1920, dimension_y: 1080, file_size: 100000
                };
            }),
            meta: { seed: 'abc123' }
        });
    };
    vm.runInContext(fs.readFileSync(path.join(root, 'src/js/live-source-wallhaven.js'), 'utf8'), c, { filename: 'live-source-wallhaven.js' });
    const W = c.window.LiveSources.wallhaven;
    c.window.LiveStores.setWallhavenTopics(['nature', 'space']);

    const first = await W.fetchWallhavenPage();
    const second = await W.fetchWallhavenPage();
    const third = await W.fetchWallhavenPage();
    assert.equal(new URL(calls[0]).searchParams.get('q'), 'nature');
    assert.equal(new URL(calls[1]).searchParams.get('q'), 'space');
    assert.equal(calls.length, 2, 'cached results from the first topic do not need another request');
    assert.equal(first.entries[0].whTopic, 'nature');
    assert.equal(second.entries[0].whTopic, 'space');
    assert.equal(third.entries[0].whTopic, 'nature');
});

test('Unsplash: a position past a short collection falls back to its first page', async function () {
    const c = createLauncherSandbox();
    const calls = [];
    const photo = { id: 'c1', width: 4000, height: 2500, urls: { raw: 'https://images.unsplash.com/photo-c1', small: 'https://images.unsplash.com/photo-c1?w=400' } };
    c.window.LiveCore.xhrGet = function (url) {
        calls.push(url);
        return Promise.resolve(/page=1$/.test(url) ? [photo] : []);
    };
    vm.runInContext(fs.readFileSync(path.join(root, 'src/js/live-source-unsplash.js'), 'utf8'), c, { filename: 'live-source-unsplash.js' });
    c.window.LiveState.unsplashCollection = 'c1';
    c.window.LiveState.stream.unsplashPage = 43;
    const entry = plain(await c.window.LiveSources.unsplash.fetchUnsplashNext());
    assert.equal(entry.key, 'c1', 'the next photo still comes through');
    assert.ok(calls.some(function (u) { return /\/collections\/c1\/photos/.test(u) && /page=1$/.test(u); }), 'page 1 was requested');
});

test('Unsplash: photos come in order, one after another', async function () {
    const c = createLauncherSandbox();
    const photos = ['a', 'b', 'c'].map(function (k) {
        return { id: k, width: 4000, height: 2500, urls: { raw: 'https://images.unsplash.com/photo-' + k, small: 'https://images.unsplash.com/photo-' + k + '?w=400' } };
    });
    c.window.LiveCore.xhrGet = function (url) {
        return Promise.resolve(/page=1$/.test(url) ? photos : []);
    };
    vm.runInContext(fs.readFileSync(path.join(root, 'src/js/live-source-unsplash.js'), 'utf8'), c, { filename: 'live-source-unsplash.js' });
    c.window.LiveState.stream = { unsplashPage: 1, unsplashIndex: 0 };
    const U = c.window.LiveSources.unsplash;
    const got = [];
    for (let i = 0; i < 4; i++) got.push((await U.fetchUnsplashNext()).key);
    assert.deepEqual(got, ['a', 'b', 'c', 'a'], 'in order, then starts again');
});
