import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createLauncherSandbox } from './harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const plain = (v) => JSON.parse(JSON.stringify(v));

// The radio stack on top of the shared sandbox. UI and Subsonic are stubbed: the tests never play audio.
function radioSandbox(opts) {
    const ctx = createLauncherSandbox(opts);
    vm.runInContext(`
        window.UI = { toast: function () {}, busy: function (p) { return p; }, menu: function () {}, refresh: function () {},
            renderBar: function () {}, isVisible: function () { return false; } };
        window.Subsonic = { configured: function () { return false; }, cfg: function () { return {}; } };
        window.Sound = { play: function () {} };
    `, ctx);
    for (const rel of ['src/js/radiorecord.js', 'src/js/somafm.js', 'src/js/radio-plan.js', 'src/js/music.js']) {
        vm.runInContext(fs.readFileSync(path.join(root, rel), 'utf8'), ctx, { filename: rel });
    }
    return ctx;
}

test('new music preferences are kept across a reload', function () {
    const saved = {
        music: {
            favourites: [{ type: 'station', id: 'rrdeep', title: 'Deep', genre: 'HOUSE' }],
            customList: [{ id: '1', title: 'ice2.somafm.com', url: 'https://ice2.somafm.com/x-128-mp3' }],
            radioNav: 'list',
            somaSelected: { id: 'groovesalad', title: 'Groove Salad', genre: 'ambient', urls: ['https://ice2.somafm.com/g'] }
        }
    };
    const ctx = radioSandbox({ prefs: saved });
    const m = vm.runInContext('Prefs.get().music', ctx);
    assert.equal(m.favourites.length, 1, 'favourites survive load');
    assert.equal(m.customList[0].title, 'ice2.somafm.com', 'Your list survives load');
    assert.equal(m.radioNav, 'list');
    assert.equal(m.somaSelected.id, 'groovesalad');
});

test('Your list: adds https streams only, names them from the address', function () {
    const ctx = radioSandbox();
    const ok = vm.runInContext(`Music.addCustomUrl('https://ice2.somafm.com/x-128-mp3')`, ctx);
    assert.equal(ok.title, 'ice2.somafm.com');
    assert.equal(ok.url, 'https://ice2.somafm.com/x-128-mp3');
    assert.equal(vm.runInContext(`Music.addCustomUrl('http://insecure.example/a.mp3')`, ctx), null);
    assert.equal(vm.runInContext(`Music.addCustomUrl('   ')`, ctx), null);
    assert.equal(vm.runInContext(`Music.customList().length`, ctx), 1);
    assert.equal(vm.runInContext(`Music.customStations()[0].id`, ctx), 'custom:' + ok.id);
});

test('Your list: entries added in the same millisecond keep distinct ids', function () {
    const ctx = radioSandbox();
    const ids = vm.runInContext(`[
        Music.addCustomUrl('https://a.example/1.mp3').id,
        Music.addCustomUrl('https://a.example/2.mp3').id,
        Music.addCustomUrl('https://a.example/3.mp3').id
    ]`, ctx);
    assert.equal(new Set(plain(ids)).size, 3);
});

test('Your list: removing one entry keeps the others', function () {
    const ctx = radioSandbox();
    const a = vm.runInContext(`Music.addCustomUrl('https://a.example/1.mp3')`, ctx);
    const b = vm.runInContext(`Music.addCustomUrl('https://b.example/2.mp3')`, ctx);
    vm.runInContext(`Music.removeCustomUrl('${a.id}')`, ctx);
    const left = vm.runInContext(`Music.customList()`, ctx);
    assert.deepEqual(plain(left.map(function (c) { return c.id; })), [b.id]);
});

test('Your list: removing the playing entry moves the selection to the first built-in station', function () {
    const ctx = radioSandbox();
    const a = vm.runInContext(`Music.addCustomUrl('https://a.example/1.mp3')`, ctx);
    vm.runInContext(`Prefs.get().music.radioId = 'custom:${a.id}'; Prefs.save();`, ctx);
    vm.runInContext(`Music.removeCustomUrl('${a.id}')`, ctx);
    const radioId = vm.runInContext(`Prefs.get().music.radioId`, ctx);
    assert.notEqual(radioId, 'custom:' + a.id);
    assert.equal(radioId, vm.runInContext(`Music.radioStations()[0].id`, ctx));
});

test('Next goes through: only the three choices are kept', function () {
    const ctx = radioSandbox();
    vm.runInContext(`Music.setRadioNav('favourites')`, ctx);
    assert.equal(vm.runInContext(`Prefs.get().music.radioNav`, ctx), 'favourites');
    vm.runInContext(`Music.setRadioNav('list')`, ctx);
    assert.equal(vm.runInContext(`Prefs.get().music.radioNav`, ctx), 'list');
    vm.runInContext(`Music.setRadioNav('everything')`, ctx);
    assert.equal(vm.runInContext(`Prefs.get().music.radioNav`, ctx), 'all');
});

test('Radio Record: the built-in six are used until the feed has been fetched', function () {
    const ctx = radioSandbox();
    const names = vm.runInContext(`Music.radioStations().map(function (s) { return s.id; })`, ctx);
    assert.deepEqual(plain(names), plain(vm.runInContext(`Music.STATIONS.map(function (s) { return s.id; })`, ctx)));
});

test('Radio Record: the feed replaces the built-in list once cached', function () {
    const feed = JSON.stringify({ arn0: 1, fetched: Date.now(), stations: [
        { id: 'rr:record', title: 'Record', genre: 'HOUSE', credit: 'Radio Record', urls: ['https://r.example/a.aacp'] }
    ] });
    const ctx = radioSandbox();
    vm.runInContext(`localStorage.setItem('arn0.radiorecord.v1', ${JSON.stringify(feed.replace(/"arn0":1,/, ''))})`, ctx);
    vm.runInContext(`RadioRecord.current()`, ctx);
    const names = vm.runInContext(`Music.radioStations().map(function (s) { return s.id; })`, ctx);
    assert.deepEqual(plain(names), ['rr:record']);
});
