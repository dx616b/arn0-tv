/*
 * HTTP helpers shared by the live wallpaper providers, Subsonic and the Home wallpaper cache.
 * Nothing here reads app state.
 */
(function () {
    'use strict';

    var TIMEOUT_MS = 15000;

    function httpError(status) {
        var e = new Error('HTTP ' + status);
        e.status = status;
        return e;
    }

    // One XHR for every JSON/text call: resolves parsed JSON (or raw text when asText), rejects
    // with an Error carrying .status for HTTP failures.
    function request(method, url, opts) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open(method, url, true);
            xhr.timeout = opts.timeoutMs || TIMEOUT_MS;
            if (opts.headers) {
                Object.keys(opts.headers).forEach(function (h) {
                    xhr.setRequestHeader(h, opts.headers[h]);
                });
            }
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    if (opts.asText) {
                        resolve(xhr.responseText);
                        return;
                    }
                    try { resolve(JSON.parse(xhr.responseText)); }
                    catch (e) { reject(e); }
                } else {
                    reject(httpError(xhr.status));
                }
            };
            xhr.onerror = function () { reject(new Error('network')); };
            xhr.ontimeout = function () { reject(new Error('timeout')); };
            xhr.send(opts.body);
        });
    }

    function xhrGet(url, headers, asText, timeoutMs) {
        return request('GET', url, { headers: headers, asText: asText, timeoutMs: timeoutMs });
    }

    function xhrPostJson(url, body, timeoutMs) {
        return request('POST', url, {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            timeoutMs: timeoutMs
        });
    }

    // Full-size image bytes for the local wallpaper cache. Callers decide what a failure means.
    function getBlob(url) {
        return new Promise(function (resolve, reject) {
            if (!url) {
                reject(new Error('no url'));
                return;
            }
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.responseType = 'blob';
            xhr.timeout = 60000;
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300 && xhr.response) resolve(xhr.response);
                else reject(new Error('HTTP ' + xhr.status));
            };
            xhr.onerror = function () { reject(new Error('network')); };
            xhr.ontimeout = function () { reject(new Error('timeout')); };
            xhr.send();
        });
    }

    window.Http = {
        TIMEOUT_MS: TIMEOUT_MS,
        httpError: httpError,
        xhrGet: xhrGet,
        xhrPostJson: xhrPostJson,
        getBlob: getBlob
    };
})();
