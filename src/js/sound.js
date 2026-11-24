/*
 * Navigation sound: a short synthesised click when focus moves.
 *
 * Synthesised rather than sampled, so there is no audio file to licence, bundle or decode, and
 * no question about which codecs this engine accepts. Each click is one oscillator and one gain
 * envelope, created and discarded per press; nothing is held open between keys.
 *
 * Tuning lives in config.js under `sound`. Everything here is wrapped so that a failure is
 * silent: a launcher that is someone's Home button must not break because audio did.
 *
 * EXPERIMENTAL. Latency is the open question — if the TV's audio path delays the click much past
 * ~60 ms it will feel detached from the remote and should be turned off. Measure it from the Lab
 * screen ("Sound: report audio latency") before deciding to keep this.
 *
 * Intermittent silence is almost always a suspended AudioContext (after another app, HDMI, or
 * idle). resume() is async; scheduling a tone before it finishes is silent. Play waits for
 * running, and visibility/pageshow wakes the context when the launcher returns.
 */
(function () {
    'use strict';

    var DEFAULTS = {
        enabled: true,
        preset: 'soft',
        volume: 0.08,           // gain for "normal"; quiet/loud scale from this
        minGapMs: 45,   // key repeat can fire faster than this; extra presses are dropped
        presets: {
            soft: { label: 'Soft', freq: 620, ms: 30, type: 'sine' },
            warm: { label: 'Warm', freq: 520, ms: 44, type: 'triangle' },
            bright: { label: 'Bright', freq: 1040, ms: 30, type: 'triangle' }
        },
        volumes: {
            quiet: { label: 'Quiet', scale: 0.5 },
            normal: { label: 'Normal', scale: 1 },
            loud: { label: 'Loud', scale: 2 }
        },
        move: { freq: 880, ms: 38, type: 'triangle' },
        edge: { freq: 200, ms: 70, type: 'sine' },
        select: { freq: 1320, ms: 55, type: 'triangle' }
    };

    var ctx = null;
    var broken = false;
    var lastPlay = 0;
    var resuming = false;
    var pending = null; // { name, force } — latest click waiting on resume()

    function cfg() {
        var c = (window.LAUNCHER_CONFIG && window.LAUNCHER_CONFIG.sound) || {};
        var out = {};
        Object.keys(DEFAULTS).forEach(function (k) {
            out[k] = c[k] !== undefined ? c[k] : DEFAULTS[k];
        });
        return out;
    }

    function enabled() {
        if (broken) return false;
        var c = cfg();
        // A saved preference wins over the config default once Settings exposes one.
        var prefs = window.Prefs && Prefs.get ? Prefs.get() : null;
        if (prefs && prefs.sound && prefs.sound.enabled !== undefined) return !!prefs.sound.enabled;
        return !!c.enabled;
    }

    function selectedPreset() {
        var c = cfg();
        var prefs = window.Prefs && Prefs.get ? Prefs.get() : null;
        var key = prefs && prefs.sound && prefs.sound.preset || c.preset;
        return c.presets[key] || c.presets[c.preset] || c.move;
    }

    function presetOptions() {
        var presets = cfg().presets;
        return Object.keys(presets).map(function (key) {
            return { key: key, label: presets[key].label || key };
        });
    }

    function volumeOptions() {
        var volumes = cfg().volumes;
        return Object.keys(volumes).map(function (key) {
            return { key: key, label: volumes[key].label || key };
        });
    }

    function selectedVolume() {
        var c = cfg();
        var prefs = window.Prefs && Prefs.get ? Prefs.get() : null;
        var key = prefs && prefs.sound && prefs.sound.volume || 'normal';
        return c.volumes[key] || c.volumes.normal;
    }

    function playLevel() {
        var c = cfg();
        var level = c.volume * (selectedVolume().scale || 1);
        // Duck nav clicks while Subsonic ambient music is audible.
        if (window.Music && Music.isPlaying()) level = Math.min(level, 0.03);
        return level;
    }

    /*
     * The context is created on the first key press rather than at boot: engines may refuse to
     * start audio without a user gesture, and on a TV the first remote press is that gesture.
     */
    function context() {
        if (ctx || broken) return ctx;
        try {
            var Ctor = window.AudioContext || window.webkitAudioContext;
            if (!Ctor) {
                broken = true;
                return null;
            }
            ctx = new Ctor();
        } catch (e) {
            broken = true;
            if (window.DevLog) DevLog.log('Sound unavailable: ' + DevLog.errorText(e));
            return null;
        }
        return ctx;
    }

    function emit(ac, name) {
        var c = cfg();
        var voice = name === 'move' ? selectedPreset() : (c[name] || c.move);
        var t = ac.currentTime;
        var seconds = voice.ms / 1000;
        var level = playLevel();

        var osc = ac.createOscillator();
        osc.type = voice.type;
        osc.frequency.value = voice.freq;

        var gain = ac.createGain();
        // Tiny attack keeps the start from clicking; exponential decay reads as a tick.
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(level, t + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);

        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start(t);
        osc.stop(t + seconds + 0.02);
        osc.onended = function () {
            try {
                gain.disconnect();
                osc.disconnect();
            } catch (e) {
                // Already torn down.
            }
        };
    }

    function flushPending() {
        var p = pending;
        pending = null;
        if (!p) return;
        if (!p.force && !enabled()) return;
        var ac = ctx;
        if (!ac || ac.state !== 'running') return;
        var now = Date.now();
        if (!p.force && now - lastPlay < cfg().minGapMs) return;
        try {
            emit(ac, p.name);
            lastPlay = now;
        } catch (e) {
            if (window.DevLog) DevLog.log('Sound failed: ' + DevLog.errorText(e));
        }
    }

    /*
     * Platforms suspend the context when another app / HDMI takes the foreground. resume() is
     * a promise; tones scheduled before it settles never sound. Keep one pending click and play
     * it once running.
     */
    function ensureRunning(then) {
        var ac = context();
        if (!ac) return;
        if (ac.state === 'running') {
            then(ac);
            return;
        }
        if (!ac.resume) return;
        if (resuming) return;
        resuming = true;
        Promise.resolve(ac.resume()).then(function () {
            resuming = false;
            if (ac.state === 'running') {
                then(ac);
                flushPending();
            }
        }, function (err) {
            resuming = false;
            if (window.DevLog) DevLog.log('Sound resume failed: ' + DevLog.errorText(err));
        });
    }

    function play(name, force) {
        if (!force && !enabled()) return;
        var c = cfg();
        var now = Date.now();
        if (!force && now - lastPlay < c.minGapMs) return;

        var ac = context();
        if (!ac) return;

        if (ac.state === 'running') {
            try {
                emit(ac, name);
                lastPlay = now;
            } catch (e) {
                // Transient graph errors must not permanently kill nav clicks.
                if (window.DevLog) DevLog.log('Sound failed: ' + DevLog.errorText(e));
            }
            return;
        }

        pending = { name: name, force: !!force };
        ensureRunning(function () {
            // flushPending handles the queued click after resume.
        });
    }

    function wake() {
        if (document.hidden) return;
        if (!ctx || broken) return;
        if (ctx.state === 'running') return;
        ensureRunning(function () { /* primed for the next key */ });
    }

    document.addEventListener('visibilitychange', wake);
    window.addEventListener('pageshow', wake);
    window.addEventListener('focus', wake);

    // ---------- Lab diagnostics

    function report() {
        var log = function (m) { DevLog.log(m); };
        var Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) {
            log('Web Audio: NOT AVAILABLE on this engine');
            return;
        }
        log('Web Audio: available (' +
            (window.AudioContext ? 'AudioContext' : 'webkitAudioContext') + ')');

        var ac = context();
        if (!ac) {
            log('Web Audio: context could not be created');
            return;
        }
        log('State on creation: ' + ac.state +
            (ac.state === 'suspended' ? '  (needs resume from a key press)' : ''));
        log('Sample rate: ' + ac.sampleRate + ' Hz');

        /*
         * These are what decide whether a navigation click is usable. baseLatency is the engine's
         * own buffering; outputLatency includes the path to the speakers, which on a TV can be
         * long. Either may be undefined on older engines, which is itself worth knowing.
         */
        var base = ac.baseLatency;
        var out = ac.outputLatency;
        log('baseLatency: ' + (base === undefined ? 'not reported' : (base * 1000).toFixed(1) + ' ms'));
        log('outputLatency: ' + (out === undefined ? 'not reported' : (out * 1000).toFixed(1) + ' ms'));

        var total = (base || 0) + (out || 0);
        if (base === undefined && out === undefined) {
            log('Verdict: engine reports no latency figures — judge it by ear instead');
        } else if (total * 1000 > 60) {
            log('Verdict: about ' + (total * 1000).toFixed(0) +
                ' ms before it reaches the speakers — likely to feel detached from the remote');
        } else {
            log('Verdict: about ' + (total * 1000).toFixed(0) + ' ms — should feel attached to the press');
        }

        if (ac.resume) {
            ac.resume().then(function () {
                log('After resume(): ' + ac.state);
            }, function (err) {
                log('resume() rejected: ' + DevLog.errorText(err));
            });
        }
    }

    // Evenly spaced clicks: is each one crisp, and are they all the same?
    function spaced() {
        DevLog.log('Sound: 10 clicks, 500 ms apart — listen for consistency');
        var n = 0;
        var timer = setInterval(function () {
            play('move');
            if (++n >= 10) clearInterval(timer);
        }, 500);
    }

    // What holding an arrow key down would sound like.
    function burst() {
        DevLog.log('Sound: 25 clicks as fast as minGapMs allows — listen for machine-gunning');
        var n = 0;
        var timer = setInterval(function () {
            play('move');
            if (++n >= 25) clearInterval(timer);
        }, 30);
    }

    function voices() {
        DevLog.log('Sound: move, then edge, then select');
        play('move');
        setTimeout(function () { play('edge'); }, 450);
        setTimeout(function () { play('select'); }, 900);
    }

    window.Sound = {
        play: play,
        defaults: function () { return JSON.parse(JSON.stringify(DEFAULTS)); },
        preview: function () { play('move', true); },
        enabled: enabled,
        presetOptions: presetOptions,
        volumeOptions: volumeOptions,
        presetLabel: function () { return selectedPreset().label || 'Custom'; },
        volumeLabel: function () { return selectedVolume().label || 'Normal'; },
        actions: function () {
            return [
                { label: 'Sound: report audio latency', run: report },
                { label: 'Sound: 10 clicks, 500 ms apart', run: spaced },
                { label: 'Sound: rapid burst (held key)', run: burst },
                { label: 'Sound: hear all three voices', run: voices }
            ];
        }
    };
})();
