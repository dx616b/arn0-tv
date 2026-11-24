import test from 'node:test';
import assert from 'node:assert/strict';
import { createLauncherSandbox } from './harness.mjs';

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

test('Wallhaven: a category other than the chosen one is left out', function () {
    ctx.window.LiveState.wallhavenCategory = 'anime';
    try {
        assert.equal(WALL.parseWallhavenImage({ id: 'g1', path: 'https://w.wallhaven.cc/full/g/g1.jpg', category: 'general', dimension_x: 1920, dimension_y: 1080 }), null);
        assert.notEqual(WALL.parseWallhavenImage({ id: 'a1', path: 'https://w.wallhaven.cc/full/a/a1.jpg', category: 'anime', dimension_x: 1920, dimension_y: 1080 }), null);
    } finally {
        ctx.window.LiveState.wallhavenCategory = 'all';
    }
});

test('Screensaver and Home try the full picture, then its fallbacks, and never the preview', function () {
    const urls = plain(PHOTO.photoUrls({
        file: 'full.jpg', fileFallback: 'fallback.jpg', fileFallbacks: ['second.jpg', 'full.jpg'], thumb: 'preview.jpg'
    }));
    assert.deepEqual(urls, ['full.jpg', 'fallback.jpg', 'second.jpg']);
    assert.ok(!urls.includes('preview.jpg'));
});
