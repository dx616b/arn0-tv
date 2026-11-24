import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createLauncherSandbox } from './harness.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const plain = (v) => JSON.parse(JSON.stringify(v));

// Navidrome (Subsonic API) on the shared sandbox. Http.xhrGet is replaced so each request can be seen.
function navidromeSandbox(prefs) {
    const ctx = createLauncherSandbox(prefs ? { prefs } : undefined);
    vm.runInContext(fs.readFileSync(path.join(root, 'src/js/subsonic.js'), 'utf8'), ctx, { filename: 'src/js/subsonic.js' });
    vm.runInContext(`window.__calls = []; window.__replies = [];
        window.Http = { xhrGet: function (url) {
            __calls.push(url);
            var reply = __replies.length ? __replies.shift() : { 'subsonic-response': { status: 'ok' } };
            return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
        } };`, ctx);
    return ctx;
}

const SERVER = { baseUrl: 'https://navidrome.example', user: 'tv', password: 'secret' };

test('Navidrome: configured only with server, user and password', function () {
    const ctx = navidromeSandbox();
    assert.equal(vm.runInContext(`Subsonic.configured()`, ctx), false);
    vm.runInContext(`Subsonic.setCreds(${JSON.stringify(SERVER)})`, ctx);
    assert.equal(vm.runInContext(`Subsonic.configured()`, ctx), true);
    vm.runInContext(`Subsonic.setCreds({ password: '' })`, ctx);
    assert.equal(vm.runInContext(`Subsonic.configured()`, ctx), false);
});

test('Navidrome: the summary shows the server host and user, and "No server" when unset', function () {
    const ctx = navidromeSandbox();
    assert.equal(vm.runInContext(`Subsonic.summary()`, ctx), 'No server');
    vm.runInContext(`Subsonic.setCreds(${JSON.stringify(SERVER)})`, ctx);
    assert.equal(vm.runInContext(`Subsonic.summary()`, ctx), 'navidrome.example · tv');
});

test('Navidrome: stream addresses carry the song, the bitrate and the login', function () {
    const ctx = navidromeSandbox();
    vm.runInContext(`Subsonic.setCreds(${JSON.stringify(SERVER)})`, ctx);
    const url = vm.runInContext(`Subsonic.streamUrl('song-42')`, ctx);
    assert.ok(url.startsWith('https://navidrome.example/rest/stream.view?'));
    assert.ok(url.includes('id=song-42'));
    assert.ok(url.includes('u=tv'));
    assert.ok(/maxBitRate=\d+/.test(url));
    assert.ok(url.includes('format=mp3'));
});

test('Navidrome: the first request sends the password encoded, not in plain text', function () {
    const ctx = navidromeSandbox();
    vm.runInContext(`Subsonic.setCreds(${JSON.stringify(SERVER)})`, ctx);
    vm.runInContext(`Subsonic.ping()`, ctx);
    const first = plain(vm.runInContext(`__calls[0]`, ctx));
    assert.ok(first.includes('/rest/ping.view?'));
    assert.ok(first.includes('p=enc%3A'), 'password is hex-encoded (enc:…)');
    assert.ok(!first.includes('p=secret'));
});

test('Navidrome: a wrong-password answer is retried once with the plain password', async function () {
    const ctx = navidromeSandbox();
    vm.runInContext(`Subsonic.setCreds(${JSON.stringify(SERVER)})`, ctx);
    vm.runInContext(`__replies.push({ 'subsonic-response': { status: 'failed', error: { code: 40, message: 'Wrong username or password' } } }); __replies.push({ 'subsonic-response': { status: 'ok' } });`, ctx);
    const ok = await vm.runInContext(`Subsonic.ping()`, ctx);
    assert.equal(ok, true);
    const calls = plain(vm.runInContext(`__calls`, ctx));
    assert.equal(calls.length, 2);
    assert.ok(calls[1].includes('p=secret'), 'second try uses the plain password');
});

test('Navidrome: a server error other than a login failure is reported, not retried', async function () {
    const ctx = navidromeSandbox();
    vm.runInContext(`Subsonic.setCreds(${JSON.stringify(SERVER)})`, ctx);
    vm.runInContext(`__replies.push({ 'subsonic-response': { status: 'failed', error: { code: 70, message: 'Not found' } } });`, ctx);
    await assert.rejects(vm.runInContext(`Subsonic.ping()`, ctx), /Not found/);
    assert.equal(vm.runInContext(`__calls.length`, ctx), 1);
});

test('Navidrome: random songs map to id, title and artist', async function () {
    const ctx = navidromeSandbox();
    vm.runInContext(`Subsonic.setCreds(${JSON.stringify(SERVER)})`, ctx);
    vm.runInContext(`__replies.push({ 'subsonic-response': { status: 'ok', randomSongs: { song: [
        { id: 7, title: 'Track', artist: 'Band', album: 'Album' },
        { id: 8 }
    ] } } });`, ctx);
    const songs = plain(await vm.runInContext(`Subsonic.getRandomSongs(2)`, ctx));
    assert.deepEqual(songs, [
        { id: '7', title: 'Track', artist: 'Band', album: 'Album' },
        { id: '8', title: 'Unknown', artist: '', album: '' }
    ]);
});

test('Navidrome: a single playlist is still a list', async function () {
    const ctx = navidromeSandbox();
    vm.runInContext(`Subsonic.setCreds(${JSON.stringify(SERVER)})`, ctx);
    vm.runInContext(`__replies.push({ 'subsonic-response': { status: 'ok', playlists: { playlist: { id: 'p1', name: 'Mix', songCount: 3 } } } });`, ctx);
    const lists = plain(await vm.runInContext(`Subsonic.getPlaylists()`, ctx));
    assert.deepEqual(lists, [{ id: 'p1', name: 'Mix', songCount: 3 }]);
});

test('Lab: the Navidrome checks are listed for the Lab screen', function () {
    const ctx = navidromeSandbox();
    const labels = plain(vm.runInContext(`Subsonic.actions().map(function (a) { return a.label; })`, ctx));
    assert.deepEqual(labels, ['Navidrome: show server (no password)', 'Navidrome: test connection']);
});
