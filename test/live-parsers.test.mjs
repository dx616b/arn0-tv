import test from 'node:test';
import assert from 'node:assert/strict';
import { createLauncherSandbox } from './harness.mjs';

const P = createLauncherSandbox().window.LiveParsers;
const plain = (v) => JSON.parse(JSON.stringify(v));

test('Immich share links parse to origin + query for both forms', function () {
    assert.deepEqual(plain(P.parseImmichLink('https://photos.example.com/s/AbC_1-2')),
        { origin: 'https://photos.example.com', query: 'slug=AbC_1-2' });
    assert.deepEqual(plain(P.parseImmichLink('https://host/immich/share/KEY123/')),
        { origin: 'https://host/immich', query: 'key=KEY123' });
    assert.equal(P.parseImmichLink('not a link'), null);
    assert.equal(P.parseImmichLink(''), null);
});

test('HTML entities decode, numeric ones too', function () {
    assert.equal(P.decodeEntities('A &amp; B &quot;C&quot; &#8211; D &#65;'), 'A & B "C" \u2013 D A');
    assert.equal(P.decodeEntities(null), '');
});

test('NASA file filter rejects logos and tiny names', function () {
    assert.equal(P.nasaFileOk('https://science.nasa.gov/wp-content/uploads/nasa-logo-web.png'), false);
    assert.equal(P.nasaFileOk('short.jpg'), false);
    assert.equal(P.nasaFileOk('https://science.nasa.gov/wp-content/uploads/2026/11/apod-moon.jpg'), true);
});

test('APOD search query matches the WordPress title form', function () {
    assert.equal(P.apodSearchQuery('2026-11-09'), 'APOD: 2026 November 9');
});

test('APOD title check requires the date prefix, case-insensitively', function () {
    assert.equal(P.apodTitleOk('APOD: 2026 November 9 – Comet', '2026-11-09'), true);
    assert.equal(P.apodTitleOk('apod: 2026 november 9 – Comet', '2026-11-09'), true);
    assert.equal(P.apodTitleOk('APOD: 2026 November 10 – Comet', '2026-11-09'), false);
});

test('APOD clean title strips the prefix, date and site suffix', function () {
    assert.equal(P.apodCleanTitle('APOD: 2026 November 9 – A Comet - NASA Science'), 'A Comet');
    assert.equal(P.apodCleanTitle(''), 'NASA APOD');
});

test('APOD image prefers the largest size and falls back gracefully', function () {
    const media = {
        source_url: 'orig.jpg',
        media_details: { sizes: {
            large: { source_url: 'large.jpg' },
            medium: { source_url: 'medium.jpg' }
        } }
    };
    assert.deepEqual(plain(P.apodImageFromMedia(media)), { file: 'large.jpg', thumb: 'medium.jpg' });
    assert.deepEqual(plain(P.apodImageFromMedia({ source_url: 'orig.jpg' })), { file: 'orig.jpg', thumb: 'orig.jpg' });
});

test('Wikimedia thumb URLs are rewritten to the requested width', function () {
    const src = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Pic.jpg/960px-Pic.jpg?x=1';
    assert.equal(P.wikimediaSized(src, 1920),
        'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Pic.jpg/1920px-Pic.jpg');
    const original = 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Pic.jpg';
    assert.equal(P.wikimediaSized(original, 1920), original);
});

test('Immich /original URLs are rewritten to a fullsize thumbnail with fallbacks', function () {
    const entry = P.scrubImmichUrls({
        key: 'immich:1', source: 'immich',
        file: 'https://photos.test/api/assets/abc/original?key=K'
    });
    assert.equal(entry.file, 'https://photos.test/api/assets/abc/thumbnail?size=fullsize&key=K');
    assert.equal(entry.fileFallback, 'https://photos.test/api/assets/abc/thumbnail?size=preview&key=K');
    assert.equal(entry.thumb, 'https://photos.test/api/assets/abc/thumbnail?size=thumbnail&key=K');
});

test('Wikimedia picture of the day becomes a normalized remote entry', function () {
    const entry = plain(P.parseWikimediaPotd({
        image: {
            title: 'File:Lake_at_dawn.jpg',
            thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Lake_at_dawn.jpg/960px-Lake_at_dawn.jpg' },
            artist: { text: 'Jane Doe' }
        }
    }, '2026-11-09'));
    assert.equal(entry.key, 'wikimedia:2026-11-09');
    assert.equal(entry.title, 'Lake at dawn');
    assert.equal(entry.credit, 'Wikimedia Commons · Jane Doe');
    assert.equal(entry.remote, true);
    assert.ok(entry.file.includes('/1920px-'), entry.file);
});

test('NASA APOD post is accepted only when its title matches the date', function () {
    const media = { source_url: 'https://science.nasa.gov/x/apod-moon-long-file-name.jpg' };
    const post = { title: { rendered: 'APOD: 2026 November 9 – Moon &amp; Stars' } };
    const hit = plain(P.apodFromWp(post, media, '2026-11-09'));
    assert.equal(hit.title, 'Moon & Stars');
    assert.equal(hit.source, 'nasa');
    assert.equal(P.apodFromWp(post, media, '2026-11-10'), null);
});
