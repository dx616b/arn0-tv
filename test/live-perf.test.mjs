import test from 'node:test';
import assert from 'node:assert/strict';
import { createLauncherSandbox } from './harness.mjs';

test('fresh prefs default livePool to small (8)', function () {
    var ctx = createLauncherSandbox();
    assert.equal(ctx.Prefs.get().wallpaper.livePool, 'small');
    assert.equal(ctx.LiveWallpaper.LIVE_POOLS.small.ahead, 8);
    assert.equal(ctx.LiveWallpaper.LIVE_POOLS.small.plan, 5);
    assert.equal(ctx.LiveWallpaper.LIVE_POOLS.small.pick, 3);
    assert.equal(ctx.LiveWallpaper.LIVE_POOLS.small.label, '8');
});

test('LIVE_POOLS expose numeric labels and stepped sizes', function () {
    var ctx = createLauncherSandbox();
    var pools = ctx.LiveWallpaper.LIVE_POOLS;
    assert.equal(pools.normal.label, '20');
    assert.equal(pools.large.label, '40');
    assert.ok(pools.small.ahead < pools.normal.ahead);
    assert.ok(pools.normal.ahead < pools.large.ahead);
    assert.ok(pools.small.plan < pools.normal.plan);
    assert.ok(pools.normal.plan < pools.large.plan);
});

test('pickBatch is a function reflecting the current pool', function () {
    var ctx = createLauncherSandbox({
        prefs: {
            wallpaper: {
                mode: 'live',
                liveProvider: 'bing',
                mixEnabled: {
                    bing: true, nasa: false, wikimedia: false, unsplash: false, immich: false
                },
                liveMultiSelect: true,
                livePool: 'large',
                interval: '15m',
                random: true
            }
        }
    });
    assert.equal(typeof ctx.LiveWallpaper.pickBatch, 'function');
    assert.equal(ctx.LiveWallpaper.pickBatch(), 10);
    ctx.Prefs.get().wallpaper.livePool = 'small';
    ctx.Prefs.save();
    assert.equal(ctx.LiveWallpaper.pickBatch(), 3);
});

test('Mix stream keys follow enabled sources only', function () {
    var ctx = createLauncherSandbox({
        prefs: {
            wallpaper: {
                mode: 'live',
                liveProvider: 'mix',
                mixEnabled: {
                    bing: false, nasa: true, wikimedia: true, unsplash: false, immich: false
                },
                liveMultiSelect: true,
                livePool: 'small',
                interval: '15m',
                random: false
            }
        }
    });
    assert.equal(ctx.LiveWallpaper.provider(), 'mix');
    assert.equal(
        Array.prototype.slice.call(ctx.LiveWallpaper.orderedMixKeys()).join(','),
        'nasa,wikimedia'
    );
    assert.equal(
        Array.prototype.slice.call(ctx.LiveWallpaper.enabledSourceKeys()).sort().join(','),
        'nasa,wikimedia'
    );
});

test('Mix Shuffle permutes provider order only', function () {
    var ctx = createLauncherSandbox({
        prefs: {
            wallpaper: {
                mode: 'live',
                liveProvider: 'mix',
                mixEnabled: {
                    bing: true, nasa: true, wikimedia: true, unsplash: false, immich: false
                },
                liveMultiSelect: true,
                livePool: 'small',
                interval: '15m',
                random: false
            }
        }
    });
    function keys(list) {
        return Array.prototype.slice.call(list).join(',');
    }
    assert.equal(keys(ctx.LiveWallpaper.orderedMixKeys()), 'bing,nasa,wikimedia');
    ctx.Prefs.get().wallpaper.random = true;
    ctx.Prefs.save();
    ctx.LiveWallpaper.reshuffleMixOrder();
    var shuffled = keys(ctx.LiveWallpaper.orderedMixKeys()).split(',');
    assert.equal(shuffled.slice().sort().join(','), 'bing,nasa,wikimedia');
    assert.equal(shuffled.length, 3);
});
