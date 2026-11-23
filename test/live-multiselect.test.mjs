import test from 'node:test';
import assert from 'node:assert/strict';
import { createLauncherSandbox } from './harness.mjs';

function wall(ctx) {
    return ctx.Prefs.get().wallpaper;
}

function keys(list) {
    // Arrays from the vm realm are not deepStrictEqual-compatible with host arrays.
    return Array.prototype.slice.call(list).join(',');
}

test('legacy single Bing + all mixEnabled migrates to Bing only', function () {
    var ctx = createLauncherSandbox({
        prefs: {
            wallpaper: {
                mode: 'live',
                liveProvider: 'bing',
                mixEnabled: {
                    bing: true, nasa: true, wikimedia: true, unsplash: true, immich: true
                },
                livePool: 'small',
                interval: '15m',
                random: true
            }
        }
    });
    assert.equal(wall(ctx).liveMultiSelect, true);
    assert.equal(ctx.LiveWallpaper.provider(), 'bing');
    assert.equal(keys(ctx.LiveWallpaper.enabledSourceKeys()), 'bing');
    assert.equal(ctx.LiveWallpaper.mixModeOn(), false);
});

test('Mix On keeps roster; toggling a second source stays Mix', function () {
    var ctx = createLauncherSandbox({
        prefs: {
            wallpaper: {
                mode: 'live',
                liveProvider: 'mix',
                mixEnabled: {
                    bing: true, nasa: false, wikimedia: false, unsplash: false, immich: false
                },
                liveMultiSelect: true,
                livePool: 'small',
                interval: '15m',
                random: true
            }
        }
    });
    assert.equal(ctx.LiveWallpaper.mixModeOn(), true);
    assert.equal(ctx.LiveWallpaper.setMixSource('nasa', true), true);
    assert.equal(ctx.LiveWallpaper.provider(), 'mix');
    assert.equal(keys(ctx.LiveWallpaper.enabledSourceKeys().slice().sort()), 'bing,nasa');
    assert.equal(keys(ctx.LiveWallpaper.mixSources()), 'Bing,NASA APOD');
});

test('Mix Off radio picks one source without clearing Mix roster', function () {
    var ctx = createLauncherSandbox({
        prefs: {
            wallpaper: {
                mode: 'live',
                liveProvider: 'mix',
                mixEnabled: {
                    bing: true, nasa: true, wikimedia: false, unsplash: false, immich: false
                },
                liveMultiSelect: true,
                livePool: 'small',
                interval: '15m',
                random: true
            }
        }
    });
    assert.equal(ctx.LiveWallpaper.setMixMode(false), false);
    assert.equal(ctx.LiveWallpaper.provider(), 'bing');
    assert.equal(ctx.LiveWallpaper.setSoloProvider('nasa'), 'nasa');
    assert.equal(ctx.LiveWallpaper.provider(), 'nasa');
    // Roster still has both for when Mix turns back on.
    assert.equal(keys(ctx.LiveWallpaper.enabledSourceKeys().slice().sort()), 'bing,nasa');
});

test('refuses to disable the last Mix source', function () {
    var ctx = createLauncherSandbox({
        prefs: {
            wallpaper: {
                mode: 'live',
                liveProvider: 'mix',
                mixEnabled: {
                    bing: false, nasa: true, wikimedia: false, unsplash: false, immich: false
                },
                liveMultiSelect: true,
                livePool: 'small',
                interval: '15m',
                random: true
            }
        }
    });
    assert.equal(ctx.LiveWallpaper.setMixSource('nasa', false), true); // still on
    assert.equal(ctx.LiveWallpaper.mixSourceOn('nasa'), true);
    assert.equal(keys(ctx.LiveWallpaper.enabledSourceKeys()), 'nasa');
});

test('PROVIDERS still includes mix for runtime; UI filters it', function () {
    var ctx = createLauncherSandbox();
    var list = Array.prototype.slice.call(ctx.LiveWallpaper.PROVIDERS);
    var keyList = list.map(function (p) { return p.key; }).join(',');
    assert.ok(keyList.indexOf('mix') >= 0);
    assert.ok(keyList.indexOf('bing') >= 0);
    assert.ok(keyList.indexOf('wallhaven') >= 0);
});

test('SS selectLiveProvider changes focus only; Settings Mix roster stays', function () {
    var ctx = createLauncherSandbox({
        prefs: {
            wallpaper: {
                mode: 'live',
                liveProvider: 'mix',
                mixEnabled: {
                    bing: true, nasa: true, wikimedia: false, unsplash: false, immich: false
                },
                liveMultiSelect: true,
                livePool: 'small',
                interval: '15m',
                random: true
            }
        }
    });
    var list = Array.prototype.slice.call(ctx.LiveWallpaper.switchableProviders());
    assert.equal(list.join(','), 'bing,nasa,wikimedia,wallhaven,mix');
    assert.equal(ctx.LiveWallpaper.selectLiveProvider('nasa'), 'nasa');
    assert.equal(ctx.LiveWallpaper.provider(), 'nasa');
    assert.equal(keys(ctx.LiveWallpaper.enabledSourceKeys().slice().sort()), 'bing,nasa');
    assert.equal(ctx.LiveWallpaper.selectLiveProvider('mix'), 'mix');
    assert.equal(ctx.LiveWallpaper.provider(), 'mix');
    assert.equal(keys(ctx.LiveWallpaper.enabledSourceKeys().slice().sort()), 'bing,nasa');
    assert.equal(keys(ctx.LiveWallpaper.readyMixKeys().slice().sort()), 'bing,nasa');
});

test('sync does not force Mix from chip count when Mix is Off', function () {
    var ctx = createLauncherSandbox({
        prefs: {
            wallpaper: {
                mode: 'live',
                liveProvider: 'bing',
                mixEnabled: {
                    bing: true, nasa: true, wikimedia: false, unsplash: false, immich: false
                },
                liveMultiSelect: true,
                livePool: 'small',
                interval: '15m',
                random: true
            }
        }
    });
    assert.equal(wall(ctx).liveProvider, 'bing');
    assert.equal(ctx.LiveWallpaper.mixModeOn(), false);
    assert.equal(ctx.LiveWallpaper.syncLiveProvider(), false);
    assert.equal(wall(ctx).liveProvider, 'bing');
    assert.equal(keys(ctx.LiveWallpaper.enabledSourceKeys().slice().sort()), 'bing,nasa');
});
