import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// config.js is the documented place to tune the navigation sound; sound.js keeps a fallback copy of
// the same values for when no config block is present. This keeps the two from drifting apart.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('sound.js fallback defaults match the documented defaults in config.js', function () {
    const window = {};
    vm.runInNewContext(fs.readFileSync(path.join(root, 'src/js/config.js'), 'utf8'), { window });
    const documented = window.LAUNCHER_CONFIG.sound;
    const sandbox = { window, document: { hidden: false, addEventListener: function () {} } };
    window.addEventListener = function () {};
    window.document = sandbox.document;
    vm.runInNewContext(fs.readFileSync(path.join(root, 'src/js/sound.js'), 'utf8'), sandbox);
    const fallback = JSON.parse(JSON.stringify(sandbox.window.Sound.defaults()));
    for (const key of Object.keys(documented)) {
        assert.ok(key in fallback, 'fallback is missing ' + key);
        assert.deepEqual(JSON.parse(JSON.stringify(documented[key])), fallback[key], key);
    }
});
