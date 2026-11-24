/**
 * Minimal browser-ish sandbox so prefs.js / live-wallpaper.js load under node:test.
 * No network — XHR fails closed; logic under test does not need live fetches.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

var root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createLauncherSandbox(opts) {
    opts = opts || {};
    var store = new Map();
    if (opts.prefs) {
        store.set('arn0.prefs.v1', JSON.stringify(opts.prefs));
    }

    var sandbox = {
        console: console,
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        setInterval: setInterval,
        clearInterval: clearInterval,
        Promise: Promise,
        Date: Date,
        Math: Math,
        JSON: JSON,
        Array: Array,
        Object: Object,
        String: String,
        Number: Number,
        Boolean: Boolean,
        Error: Error,
        RegExp: RegExp,
        encodeURIComponent: encodeURIComponent,
        decodeURIComponent: decodeURIComponent,
        parseInt: parseInt,
        parseFloat: parseFloat,
        isFinite: isFinite,
        Infinity: Infinity,
        NaN: NaN,
        undefined: undefined
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    sandbox.localStorage = {
        getItem: function (k) { return store.has(k) ? store.get(k) : null; },
        setItem: function (k, v) { store.set(k, String(v)); },
        removeItem: function (k) { store.delete(k); },
        clear: function () { store.clear(); }
    };
    sandbox.document = {
        hidden: false,
        addEventListener: function () {},
        removeEventListener: function () {},
        querySelector: function () { return null; },
        querySelectorAll: function () { return []; },
        createElement: function () {
            return { style: {}, appendChild: function () {}, setAttribute: function () {} };
        }
    };
    sandbox.Image = function Image() {};
    sandbox.Image.prototype = {
        set src(v) { this._src = v; },
        get src() { return this._src; }
    };
    sandbox.XMLHttpRequest = function XMLHttpRequest() {};
    sandbox.XMLHttpRequest.prototype.open = function () {};
    sandbox.XMLHttpRequest.prototype.setRequestHeader = function () {};
    sandbox.XMLHttpRequest.prototype.send = function () {
        var self = this;
        this.status = 0;
        setTimeout(function () {
            if (typeof self.onerror === 'function') self.onerror();
        }, 0);
    };
    sandbox.addEventListener = function () {};
    sandbox.removeEventListener = function () {};

    var ctx = vm.createContext(sandbox);

    function load(rel) {
        var code = fs.readFileSync(path.join(root, rel), 'utf8');
        vm.runInContext(code, ctx, { filename: rel });
    }

    load('src/js/config.js');
    load('src/js/devlog.js');
    load('src/js/prefs.js');
    load('src/js/http.js');
    load('src/js/photo-util.js');
    load('src/js/live-core.js');
    load('src/js/live-parsers.js');
    load('src/js/live-state.js');
    load('src/js/live-events.js');
    load('src/js/live-source-bing.js');
    load('src/js/live-source-nasa.js');
    load('src/js/live-source-wiki.js');
    load('src/js/live-source-unsplash.js');
    load('src/js/live-source-wallhaven.js');
    load('src/js/live-source-immich.js');
    load('src/js/live-cache.js');
    load('src/js/live-picker.js');
    load('src/js/live-stores.js');
    load('src/js/live-roster.js');
    load('src/js/live-pool.js');
    load('src/js/live-history.js');
    load('src/js/live-fill.js');
    load('src/js/live-queue.js');
    load('src/js/live-wallpaper.js');

    return ctx;
}
