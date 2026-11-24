import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'src/js/somafm.js'), 'utf8'), { window, localStorage: null });
const S = window.SomaFM;
const plain = (v) => JSON.parse(JSON.stringify(v));

const FEED = `<?xml version="1.0" encoding="ISO-8859-1"?>
<channels>
	<channel id="beatblender">
		<title><![CDATA[Beat Blender]]></title>
		<description><![CDATA[A late night blend of deep-house and downtempo chill.]]></description>
		<dj><![CDATA[DJ Shawn]]></dj>
		<genre>electronic</genre>
		<highestpls format="aac">https://somafm.com/beatblender130.pls</highestpls>
		<fastpls format="mp3">https://somafm.com/beatblender.pls</fastpls>
		<listeners>161</listeners>
	</channel>
	<channel id="groovesalad">
		<title><![CDATA[Groove Salad]]></title>
		<description><![CDATA[A nicely chilled plate of ambient/downtempo beats and grooves.]]></description>
		<dj><![CDATA[Rusty Hodge]]></dj>
		<genre>ambient|electronic</genre>
		<highestpls format="aac">https://somafm.com/groovesalad130.pls</highestpls>
		<fastpls format="mp3">https://somafm.com/groovesalad256.pls</fastpls>
		<listeners>1837</listeners>
	</channel>
	<channel id="dronezone">
		<title><![CDATA[Drone Zone]]></title>
		<description><![CDATA[Atmospheric textures with minimal beats.]]></description>
		<genre>ambient</genre>
		<highestpls format="aac">https://somafm.com/dronezone130.pls</highestpls>
		<fastpls format="mp3">https://somafm.com/dronezone256.pls</fastpls>
		<listeners>1074</listeners>
	</channel>
	<channel id="broken">
		<title><![CDATA[No Streams]]></title>
		<genre>ambient</genre>
		<listeners>1</listeners>
	</channel>
</channels>`;

test('channels parse with title, genres, listeners and both playlists', function () {
    const list = S.parseChannels(FEED);
    assert.equal(list.length, 3, 'channel without streams is dropped');
    const beat = list.find(function (c) { return c.id === 'beatblender'; });
    assert.equal(beat.title, 'Beat Blender');
    assert.equal(beat.dj, 'DJ Shawn');
    assert.deepEqual(plain(beat.genres), ['electronic']);
    assert.equal(beat.listeners, 161);
    assert.equal(beat.pls.mp3, 'https://somafm.com/beatblender.pls');
    assert.equal(beat.pls.aac, 'https://somafm.com/beatblender130.pls');
    const groove = list.find(function (c) { return c.id === 'groovesalad'; });
    assert.deepEqual(plain(groove.genres), ['ambient', 'electronic']);
});

test('playlist files give their stream mirrors in order', function () {
    const pls = '[playlist]\nnumberofentries=3\nFile1=https://ice6.somafm.com/beatblender-128-mp3\n' +
        'Title1=SomaFM: Beat Blender\nFile2=https://ice1.somafm.com/beatblender-128-mp3\nFile3=https://ice2.somafm.com/beatblender-128-mp3\n';
    assert.deepEqual(plain(S.parsePls(pls)), [
        'https://ice6.somafm.com/beatblender-128-mp3',
        'https://ice1.somafm.com/beatblender-128-mp3',
        'https://ice2.somafm.com/beatblender-128-mp3'
    ]);
    assert.deepEqual(plain(S.parsePls('')), []);
});

test('groups sort by channel count, and channels by listeners within a group', function () {
    const groups = S.groupByGenre(S.parseChannels(FEED));
    assert.deepEqual(plain(groups.map(function (g) { return g.genre; })), ['ambient', 'electronic']);
    assert.deepEqual(plain(groups[0].channels.map(function (c) { return c.id; })), ['groovesalad', 'dronezone']);
    assert.deepEqual(plain(groups[1].channels.map(function (c) { return c.id; })), ['beatblender']);
});
