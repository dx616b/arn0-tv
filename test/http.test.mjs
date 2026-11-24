import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal XMLHttpRequest: each test sets `reply` before calling the helper.
function loadHttp(reply) {
    const sent = [];
    class FakeXHR {
        constructor() { this.headers = {}; this.status = 0; }
        open(method, url) { this.method = method; this.url = url; }
        setRequestHeader(name, value) { this.headers[name] = value; }
        send(body) {
            sent.push({ method: this.method, url: this.url, headers: this.headers, body });
            this.status = reply.status;
            this.responseText = reply.text;
            this.response = reply.blob;
            if (reply.error) this.onerror();
            else this.onload();
        }
    }
    const window = {};
    vm.runInNewContext(fs.readFileSync(path.join(root, 'src/js/http.js'), 'utf8'),
        { window, XMLHttpRequest: FakeXHR });
    return { Http: window.Http, sent };
}

test('xhrGet resolves parsed JSON for a 2xx reply', async function () {
    const { Http, sent } = loadHttp({ status: 200, text: '{"ok":true}' });
    const data = await Http.xhrGet('https://example.test/a', { Accept: 'application/json' });
    assert.deepEqual(JSON.parse(JSON.stringify(data)), { ok: true });
    assert.equal(sent[0].method, 'GET');
    assert.equal(sent[0].headers.Accept, 'application/json');
});

test('xhrGet returns raw text when asked', async function () {
    const { Http } = loadHttp({ status: 200, text: '<html/>' });
    assert.equal(await Http.xhrGet('https://example.test/a', null, true), '<html/>');
});

test('HTTP failures reject with an Error that carries the status', async function () {
    const { Http } = loadHttp({ status: 404, text: '' });
    await assert.rejects(Http.xhrGet('https://example.test/missing'), function (e) {
        return e.message === 'HTTP 404' && e.status === 404;
    });
});

test('network errors and timeouts reject', async function () {
    const net = loadHttp({ status: 0, error: true });
    await assert.rejects(net.Http.xhrGet('https://example.test/a'), /network/);
});

test('xhrPostJson sends the body as JSON with the right content type', async function () {
    const { Http, sent } = loadHttp({ status: 200, text: '{"id":7}' });
    const data = await Http.xhrPostJson('https://example.test/post', { q: 1 });
    assert.equal(data.id, 7);
    assert.equal(sent[0].method, 'POST');
    assert.equal(sent[0].headers['Content-Type'], 'application/json');
    assert.equal(sent[0].body, '{"q":1}');
});

test('getBlob rejects without a URL and resolves the blob otherwise', async function () {
    const { Http } = loadHttp({ status: 200, blob: { size: 3 } });
    await assert.rejects(Http.getBlob(''), /no url/);
    const blob = await Http.getBlob('https://example.test/img.jpg');
    assert.equal(blob.size, 3);
});
