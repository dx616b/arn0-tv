import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'src/js/radio-plan.js'), 'utf8'), { window });
const P = window.RadioPlan;
const plain = (v) => JSON.parse(JSON.stringify(v));

const A = { id: 'a', title: 'A' };
const B = { id: 'b', title: 'B' };
const CUSTOM = { id: 'custom:1', title: 'Mine', custom: true };
const SOMA = { id: 'x', genres: ['ambient'], pls: { mp3: 'p1', aac: 'p2' }, title: 'X' };

test('all channels: stations, then SomaFM by group, then Your list', function () {
    const list = P.navList({
        mode: 'all', stations: [A, B], customs: [CUSTOM],
        somaGroups: [{ genre: 'ambient', channels: [SOMA] }]
    });
    assert.deepEqual(plain(list.map(function (it) { return it.key; })), ['a', 'b', 'somafm:x', 'custom:1']);
});

test('your list mode holds only Your list', function () {
    const list = P.navList({ mode: 'list', stations: [A], customs: [CUSTOM], somaGroups: [{ genre: 'g', channels: [SOMA] }] });
    assert.deepEqual(plain(list.map(function (it) { return it.key; })), ['custom:1']);
});

test('favourites mode keeps saved order and skips entries that no longer exist', function () {
    const list = P.navList({
        mode: 'favourites', stations: [A, B], customs: [CUSTOM],
        favourites: [
            { type: 'station', id: 'b' },
            { type: 'station', id: 'gone' },
            { type: 'custom', id: 'custom:1' },
            { type: 'soma', id: 'x', title: 'X', genre: 'ambient', pls: SOMA.pls },
            { type: 'playlist', id: 'pl9', title: 'Late night' }
        ]
    });
    assert.deepEqual(plain(list.map(function (it) { return it.key; })), ['b', 'custom:1', 'somafm:x', 'playlist:pl9']);
    assert.deepEqual(plain(list[2].soma.genres), ['ambient']);
    assert.equal(list[3].playlist.name, 'Late night');
});

test('Next moves to the following station and wraps round', function () {
    const list = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
    assert.equal(P.nextIndex(list, 'a'), 1);
    assert.equal(P.nextIndex(list, 'c'), 0);
    assert.equal(P.nextIndex(list, 'unknown'), 1, 'an unknown station starts from the first');
});

test('playing a station keeps it: the index is the current one', function () {
    assert.equal(P.indexOf([{ key: 'a' }, { key: 'b' }], 'b'), 1);
    assert.equal(P.indexOf([{ key: 'a' }], 'zzz'), 0);
});

test('a Next press may skip one pass over the list; a direct choice may skip none', function () {
    assert.equal(P.skipBudget(5, true), 4);
    assert.equal(P.skipBudget(5, false), 0);
    assert.equal(P.skipBudget(0, true), 0);
});

test('a failed mirror tries the next mirror while there are more', function () {
    assert.equal(P.afterFailure({ mirrorIndex: 1, mirrorCount: 3, skipLeft: 0 }), 'mirror');
    assert.equal(P.afterFailure({ mirrorIndex: 2, mirrorCount: 3, skipLeft: 0 }), 'mirror');
});

test('a directly chosen station that fails on every mirror stops', function () {
    assert.equal(P.afterFailure({ mirrorIndex: 3, mirrorCount: 3, skipLeft: 0 }), 'stop');
});

test('while Next is skipping, only the first mirrors are tried, then the next station', function () {
    assert.equal(P.afterFailure({ mirrorIndex: 1, mirrorCount: 8, skipLeft: 4 }), 'mirror');
    assert.equal(P.afterFailure({ mirrorIndex: 2, mirrorCount: 8, skipLeft: 4 }), 'skip');
    assert.equal(P.afterFailure({ mirrorIndex: 2, mirrorCount: 8, skipLeft: 0 }), 'mirror');
});

test('with no skips left, the last failure stops rather than moving on', function () {
    assert.equal(P.afterFailure({ mirrorIndex: 2, mirrorCount: 2, skipLeft: 0 }), 'stop');
});
