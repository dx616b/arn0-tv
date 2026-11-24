import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'src/js/radiorecord.js'), 'utf8'), { window, localStorage: null });
const R = window.RadioRecord;
const plain = (v) => JSON.parse(JSON.stringify(v));

const FEED = {
    result: {
        stations: [
            {
                prefix: 'record', title: 'Record', genre: [{ name: 'HOUSE' }, { name: 'POP' }],
                stream_128: 'https://radiorecord.hostingradio.ru/rr_main64.aacp',
                stream_64: 'https://radiorecord.hostingradio.ru/rr_main32.aacp'
            },
            {
                prefix: 'techno', title: 'Techno', genre: [{ name: 'TECHNO' }],
                stream_128: 'https://radiorecord.hostingradio.ru/techno64.aacp',
                stream_64: 'https://radiorecord.hostingradio.ru/techno32.aacp'
            },
            {
                prefix: 'deep', title: '  Deep\n house ', genre: [{ name: 'HOUSE' }],
                stream_128: 'https://radiorecord.hostingradio.ru/deep96.aacp',
                stream_64: 'https://radiorecord.hostingradio.ru/deep64.aacp'
            },
            { prefix: 'nostream', title: 'No streams', genre: [{ name: 'HOUSE' }], stream_128: '', stream_64: '' },
            { prefix: 'notitle', genre: [], stream_128: 'https://x.example/a.aacp' }
        ]
    }
};

test('stations parse with id, title, first genre and their stream addresses', function () {
    const list = R.parseStations(FEED);
    assert.equal(list.length, 3, 'stations without streams or titles are dropped');
    const rec = list.find(function (s) { return s.id === 'rr:record'; });
    assert.equal(rec.title, 'Record');
    assert.equal(rec.genre, 'HOUSE');
    assert.equal(rec.credit, 'Radio Record');
    assert.deepEqual(plain(rec.urls), [
        'https://radiorecord.hostingradio.ru/rr_main64.aacp',
        'https://radiorecord.hostingradio.ru/rr_main32.aacp'
    ]);
    assert.equal(list.find(function (s) { return s.id === 'rr:deep'; }).title, 'Deep house');
});

test('a bare station array parses too', function () {
    assert.equal(R.parseStations({ stations: FEED.result.stations }).length, 3);
    assert.deepEqual(plain(R.parseStations(null)), []);
});

test('groups sort by station count, and keep feed order inside a group', function () {
    const groups = R.groupByGenre(R.parseStations(FEED));
    assert.deepEqual(plain(groups.map(function (g) { return g.genre; })), ['HOUSE', 'TECHNO']);
    assert.deepEqual(plain(groups[0].channels.map(function (s) { return s.id; })), ['rr:record', 'rr:deep']);
});
