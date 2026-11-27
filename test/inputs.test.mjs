import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('../src/js/inputs.js', import.meta.url), 'utf8');

function inputsFor(info) {
    const sandbox = {
        window: {},
        Apps: { withTimeout: function (promise) { return promise; } },
        tizen: {
            systeminfo: {
                getPropertyValue: function (_property, success) { success(info); }
            }
        }
    };
    vm.runInNewContext(source, sandbox, { filename: 'inputs.js' });
    return sandbox.window.Inputs;
}

test('HDMI discovery uses a device name when Samsung supplies one and otherwise keeps the port', async () => {
    const inputs = inputsFor({
        connected: [
            { type: 'HDMI', number: 2, deviceName: 'Nintendo Switch' },
            { type: 'HDMI', number: 4, name: 'HDMI 4' }
        ],
        disconnected: [{ type: 'HDMI', number: 1 }]
    });
    const found = await inputs.hdmiInputs();
    assert.deepEqual(JSON.parse(JSON.stringify(found)), [
        { hdmi: 1, name: '' },
        { hdmi: 2, name: 'Nintendo Switch' },
        { hdmi: 4, name: '' }
    ]);
});
