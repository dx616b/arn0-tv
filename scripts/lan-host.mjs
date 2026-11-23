#!/usr/bin/env node
/*
 * LAN IPv4 for local-build devLogUrl (TV must reach the machine running `npm run devlog`).
 * Prefer DEV_LOG_HOST. Under WSL, ask Windows for its Wi‑Fi/LAN address (devlog runs there).
 */
import { networkInterfaces } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const forced = process.env.DEV_LOG_HOST && String(process.env.DEV_LOG_HOST).trim();
if (forced) {
    process.stdout.write(forced);
    process.exit(0);
}

function score(ip) {
    if (ip.startsWith('127.') || ip.startsWith('169.254.')) return -1;
    if (ip.startsWith('192.168.') || ip.startsWith('10.')) return 10;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return 5;
    // WSL2 / docker NAT — TV usually cannot route here
    if (ip.startsWith('172.')) return 1;
    return 2;
}

function bestOf(list) {
    const scored = list.map(function (ip) { return { ip: ip, score: score(ip) }; })
        .filter(function (x) { return x.score >= 0; })
        .sort(function (a, b) { return b.score - a.score; });
    return scored.length ? scored[0] : null;
}

function isWsl() {
    try {
        const v = readFileSync('/proc/version', 'utf8').toLowerCase();
        return v.includes('microsoft') || v.includes('wsl');
    } catch (e) {
        return false;
    }
}

function windowsLanIps() {
    const ps = existsSync('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe')
        ? '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'
        : 'powershell.exe';
    try {
        const out = execFileSync(ps, [
            '-NoProfile', '-Command',
            "(Get-NetIPAddress -AddressFamily IPv4 | " +
            "Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | " +
            "Sort-Object InterfaceMetric | Select-Object -ExpandProperty IPAddress)"
        ], { encoding: 'utf8', timeout: 8000 });
        return out.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    } catch (e) {
        return [];
    }
}

function nodeIps() {
    const found = [];
    const ifaces = networkInterfaces();
    Object.keys(ifaces).forEach(function (name) {
        (ifaces[name] || []).forEach(function (a) {
            if (a.family !== 'IPv4' && a.family !== 4) return;
            if (a.internal) return;
            found.push(a.address);
        });
    });
    return found;
}

let pick = null;
if (isWsl()) {
    pick = bestOf(windowsLanIps());
    if (pick && pick.score >= 5) {
        process.stderr.write('lan-host: WSL → using Windows LAN ' + pick.ip +
            ' (run npm run devlog on Windows)\n');
        process.stdout.write(pick.ip);
        process.exit(0);
    }
}

pick = bestOf(nodeIps());
if (!pick) {
    console.error('lan-host: no usable IPv4; set DEV_LOG_HOST to your Windows LAN IP');
    process.exit(1);
}
if (pick.score < 5) {
    console.error('lan-host: warning — ' + pick.ip +
        ' may be unreachable from the TV. Set DEV_LOG_HOST=<Windows LAN IP>.');
}
process.stdout.write(pick.ip);
