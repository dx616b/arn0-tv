import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'src/js/pan-math.js'), 'utf8'), { window });
const PM = window.PanMath;

test('landscape drift stays inside the stage and never below the fallback travel', function () {
    const d = PM.computeDrift(1600, 1200, false);
    assert.equal(d.zoom, 1);
    assert.ok(d.coverX >= 96 && d.coverX <= 128, 'coverX ' + d.coverX);
    assert.ok(d.coverY >= 54 && d.coverY <= 72, 'coverY ' + d.coverY);
    assert.ok(d.padX >= d.coverX && d.padY >= d.coverY);
});

test('near-16:9 landscape gets the invented overscan', function () {
    const d = PM.computeDrift(1920, 1080, false);
    assert.equal(d.coverX, 96);
    assert.equal(d.coverY, 54);
});

test('portrait drift zooms within 1.15-2.15 and never nudges vertically', function () {
    const d = PM.computeDrift(3000, 4000, true);
    assert.ok(d.zoom >= 1.15 && d.zoom <= 2.15, 'zoom ' + d.zoom);
    assert.equal(d.containY, 0);
    assert.equal(d.coverX, 0);
    assert.equal(d.coverY, 0);
});

test('missing dimensions fall back to the default drift', function () {
    assert.equal(PM.computeDrift(0, 0, false), PM.FALLBACK_DRIFT);
    assert.equal(PM.computeDrift(undefined, 1080, true), PM.FALLBACK_DRIFT);
});

test('landscape pose: u=-1 and u=+1 are the two corners, u=0 is centred', function () {
    const d = { coverX: 200, coverY: 100, zoom: 1 };
    assert.equal(PM.poseTransform(d, false, -1), 'translate3d(-200px,-100px,0)');
    assert.equal(PM.poseTransform(d, false, 1), 'translate3d(200px,100px,0)');
    assert.equal(PM.poseTransform(d, false, 0), 'translate3d(0px,0px,0)');
});

test('portrait pose: mild animated zoom + horizontal translate', function () {
    const d = { containX: 40, zoom: 1.5 };
    // zoom 1.5 → zMax = 1.06; u=+1 out (scale 1), u=-1 in (scale 1.06).
    assert.equal(PM.poseTransform(d, true, 1), 'translate3d(0px,0,0) scale(1)');
    assert.equal(PM.poseTransform(d, true, -1), 'translate3d(-40px,0,0) scale(1.06)');
});

test('legU is linear across a leg and clamps outside it', function () {
    const leg = { from: -1, to: 1, start: 1000, dur: 4000 };
    assert.equal(PM.legU(leg, 1000), -1);
    assert.equal(PM.legU(leg, 3000), 0);
    assert.equal(PM.legU(leg, 5000), 1);
    assert.equal(PM.legU(leg, 500), -1);
    assert.equal(PM.legU(leg, 9000), 1);
});

test('freezing mid-leg and continuing with the remaining time reaches the same endpoint', function () {
    // Resume should land exactly where an uninterrupted leg would have ended.
    const leg = { from: 1, to: -1, start: 0, dur: 10000 };
    const frozenAt = 4000;
    const u = PM.legU(leg, frozenAt);
    const remaining = leg.dur - frozenAt;
    const resumed = { from: u, to: -1, start: 50000, dur: remaining };
    assert.ok(Math.abs(PM.legU(resumed, 50000) - u) < 1e-9, 'starts at frozen pose');
    assert.equal(PM.legU(resumed, 50000 + remaining), -1);
});
