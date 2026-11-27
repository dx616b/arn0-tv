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

test('clock follows photo displacement until its boundary and travels back on reversal', () => {
    const ctx = vm.createContext({
        CLOCK_DRIFT_MAX: 24,
        driftOf: layer => layer.drift
    });
    vm.runInContext(functionSource('clockXAt') + '\n' + functionSource('clockTravelMs'), ctx);
    const landscape = { drift: { coverX: 180 }, classList: { contains: () => false } };
    assert.equal(ctx.clockXAt(landscape, -1), -24);
    assert.equal(ctx.clockXAt(landscape, 0), 0);
    assert.equal(ctx.clockXAt(landscape, 0.5), 24);
    // Photo traverses 360px over 90 seconds; clock moves 48px in 12 seconds, then holds.
    assert.equal(ctx.clockTravelMs(landscape, -1, 1, -24, 24, 90000), 12000);
    assert.equal(ctx.clockTravelMs(landscape, 1, -1, 24, -24, 90000), 12000);
    assert.equal(ctx.clockXAt(landscape, 1), 24);
    const portrait = { drift: { containX: 300 }, classList: { contains: () => true } };
    assert.equal(ctx.clockXAt(portrait, -1), -24);
    assert.equal(ctx.clockXAt(portrait, 0), -24);
    assert.equal(ctx.clockTravelMs(portrait, -1, 1, -24, 0, 90000), 7200);
    assert.equal(ctx.clockXAt(portrait, 1) + 0, 0);
    landscape.drift.coverX = 10;
    assert.equal(ctx.clockXAt(landscape, 1), 10);
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
