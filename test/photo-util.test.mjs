import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(root, 'src/js/photo-util.js'), 'utf8'), { window, document: {} });
const { entryFields } = window.PhotoUtil;
const plain = (v) => JSON.parse(JSON.stringify(v));

test('entryFields maps the shared fields and uses the caller title', function () {
    const out = plain(entryFields({
        key: 'k1', sub: 'Sub', file: 'a.jpg', fileFallback: 'b.jpg', fileFallbacks: ['c.jpg'],
        thumb: 't.jpg', credit: 'Someone', title: 'ignored'
    }, 'Shown title'));
    assert.deepEqual(out, {
        key: 'k1', title: 'Shown title', sub: 'Sub', file: 'a.jpg', fileFallback: 'b.jpg',
        fileFallbacks: ['c.jpg'], thumb: 't.jpg', credit: 'Someone'
    });
});

test('entryFields fills defaults for optional fields', function () {
    const out = plain(entryFields({ key: 'k2', file: 'a.jpg' }, 'T'));
    assert.equal(out.sub, '');
    assert.equal(out.fileFallback, '');
    assert.deepEqual(out.fileFallbacks, []);
    assert.equal(out.thumb, 'a.jpg');
    assert.equal(out.credit, '');
});
