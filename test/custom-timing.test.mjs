import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createLauncherSandbox } from './harness.mjs';

function load(ctx, path) {
    vm.runInContext(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), ctx, { filename: path });
}

test('custom background and screen saver durations are resolved by runtime timers', () => {
    const ctx = createLauncherSandbox();
    load(ctx, '../src/js/wallpaper.js');

    const background = ctx.Wallpaper.interval('custom:300000');
    assert.equal(background.ms, 5 * 60 * 1000);
    assert.equal(background.label, '5 min');
    assert.equal(ctx.Wallpaper.interval('custom:30000').label, '30 s');
    assert.equal(ctx.Wallpaper.interval('custom:10000').key, '15m');

    ctx.UI = { $: function () { return null; } };
    ctx.PanMath = {
        VIEW_W: 1920,
        VIEW_H: 1080,
        FALLBACK_DRIFT: {},
        computeDrift: function () {},
        legU: function () {},
        poseTransform: function () {}
    };
    load(ctx, '../src/js/screensaver.js');

    const prefs = ctx.Prefs.get().screensaver;
    prefs.delay = 'custom:900000';
    prefs.photoEvery = 'custom:45000';
    prefs.dark = 'custom:7200000';
    prefs.chromeHide = 'custom:30000';

    assert.equal(ctx.Screensaver.delay().ms, 15 * 60 * 1000);
    assert.equal(ctx.Screensaver.photoEvery().ms, 45 * 1000);
    assert.equal(ctx.Screensaver.darkAfter().ms, 2 * 60 * 60 * 1000);
    assert.equal(ctx.Screensaver.chromeHide().ms, 30 * 1000);
});
