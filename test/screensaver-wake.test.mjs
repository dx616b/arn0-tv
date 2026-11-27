import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/js/screensaver.js', import.meta.url), 'utf8');

function functionSource(name) {
    const start = source.indexOf('    function ' + name + '(');
    const end = source.indexOf('\n    }', start) + '\n    }'.length;
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
}

test('clock uses its own boundary and speed, sharing only photo direction', () => {
    const ctx = vm.createContext({
        CLOCK_DRIFT_MAX: 24, CLOCK_DRIFT_PX_PER_SECOND: 2,
        driftOf: layer => layer.drift
    });
    vm.runInContext(functionSource('clockTarget') + '\n' + functionSource('clockTravelMs'), ctx);
    const landscape = { drift: { coverX: 180 }, classList: { contains: () => false } };
    assert.equal(ctx.clockTarget(landscape, -1, 1, 0), 24);
    assert.equal(ctx.clockTarget(landscape, 1, -1, 24), -24);
    assert.equal(ctx.clockTravelMs(-24, 24), 24000);
    assert.equal(ctx.clockTravelMs(24, 24), 0);
    landscape.drift.coverX = 10;
    assert.equal(ctx.clockTarget(landscape, -1, 1, 0), 24);
    const portrait = { drift: { containX: 300 }, classList: { contains: () => true } };
    assert.equal(ctx.clockTarget(portrait, -1, 1, -24), 24);
    assert.equal(ctx.clockTarget(portrait, 1, -1, 24), -24);
    portrait.drift.containX = 0;
    assert.equal(ctx.clockTarget(portrait, -1, 1, 12), 12);
});

test('parked clock does not force layout or repeatedly rewrite its pose', () => {
    let writes = 0;
    const values = {};
    const style = new Proxy(values, {
        set(target, key, value) { writes++; target[key] = value; return true; }
    });
    const clock = {
        style,
        get offsetWidth() { throw new Error('parking the clock must not force layout'); }
    };
    const ctx = vm.createContext({ $: () => clock });
    vm.runInContext(functionSource('clockHome'), ctx);
    ctx.clockHome();
    assert.equal(writes, 2);
    ctx.clockHome();
    assert.equal(writes, 2);
});

test('clock starts at its own pose even while text is visible', () => {
    const writes = [];
    const clock = {
        style: new Proxy({}, {
            set(target, key, value) { writes.push([key, value]); target[key] = value; return true; }
        }),
        offsetWidth: 400
    };
    const layer = { drift: { coverX: 180 }, classList: { contains: () => false } };
    const ctx = vm.createContext({
        CLOCK_DRIFT_MAX: 24, CLOCK_DRIFT_PX_PER_SECOND: 2, clockLeg: null,
        open: true, chromeHidden: false, dark: false,
        layers: [layer], front: 0,
        $: () => clock, panOn: () => true,
        driftOf: item => item.drift,
        currentU: () => 0.5
    });
    ['clockPosition', 'clockHome', 'clockTarget', 'clockTravelMs', 'syncClockDrift'].forEach(name => {
        vm.runInContext(functionSource(name), ctx);
    });
    ctx.syncClockDrift({ fromU: 0.5, toU: 1, animMs: 22500 });
    assert.deepEqual(writes.filter(([key]) => key === 'transform'), [
        ['transform', 'translate3d(0px,0,0)'],
        ['transform', 'translate3d(24px,0,0)']
    ]);
    assert.equal(ctx.clockLeg.from, 0);
    assert.equal(ctx.clockLeg.dur, 12000);
});

test('showing and hiding text never resets or restarts clock movement', () => {
    const ctx = vm.createContext({
        open: true, dark: false, chromeHidden: false, lastChromeAt: 0,
        clearPeeks: () => {},
        $: () => ({ classList: { add: () => {}, remove: () => {} } }),
        clockHome: () => assert.fail('text visibility must not reset clock'),
        syncClockDrift: () => assert.fail('text visibility must not restart clock')
    });
    vm.runInContext(functionSource('hideChrome') + '\n' + functionSource('showChrome'), ctx);
    ctx.hideChrome();
    assert.equal(ctx.chromeHidden, true);
    ctx.showChrome();
    assert.equal(ctx.chromeHidden, false);
});

test('dark screensaver ticks do not update clock text or reset motion', () => {
    const ctx = vm.createContext({
        dark: true,
        updateClock: () => assert.fail('clock update behind black veil'),
        clockHome: () => assert.fail('clock reset behind black veil')
    });
    vm.runInContext(functionSource('tick'), ctx);
    ctx.tick();
});

test('waking from black explicitly restarts music marquee and updates clock', () => {
    const events = [];
    const ctx = vm.createContext({
        dark: true, openedAt: 0, layers: [], front: 0,
        $: () => null,
        showChrome: () => events.push('visible'),
        renderMusic: force => events.push(force === true ? 'restart music' : 'music'),
        updateClock: () => events.push('clock'),
        window: {}
    });
    vm.runInContext(functionSource('wakeFromDark'), ctx);
    assert.equal(ctx.wakeFromDark(), true);
    assert.equal(ctx.dark, false);
    assert.deepEqual(events, ['visible', 'restart music', 'clock']);
});
