// Serves src/ for desktop preview. Arrow keys + Enter navigate, Esc/Backspace = Back.
// Also proxies Bing / NASA APOD / Wikimedia / Unsplash / Immich so Live wallpapers
// can fetch despite browser CORS.
import { createServer } from 'node:http';
import { readFile, writeFile, access } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'src');

// index.html always loads the gitignored local overrides; make sure there is something to load.
const localConfig = join(root, 'js', 'config.local.js');
try {
    await access(localConfig);
} catch {
    await writeFile(localConfig, '/* No local overrides. See config.local.example.js. */\n');
}
const port = Number(process.env.PORT) || 8080;
const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.xml': 'application/xml'
};

const UNSPLASH_API = 'https://api.unsplash.com';

async function proxyJson(res, url, headers) {
    try {
        const upstream = await fetch(url, {
            headers: Object.assign({ Accept: 'application/json' }, headers || {}),
            signal: AbortSignal.timeout(15000)
        });
        const body = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(upstream.status, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        });
        res.end(body);
    } catch (e) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: String(e && e.message ? e.message : e) }));
    }
}

createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const path = decodeURIComponent(u.pathname);

    if (path === '/api/live/bing') {
        const idx = u.searchParams.get('idx') || '0';
        const n = u.searchParams.get('n') || '1';
        const mkt = u.searchParams.get('mkt') || 'en-GB';
        const url = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=' +
            encodeURIComponent(idx) + '&n=' + encodeURIComponent(n) +
            '&mkt=' + encodeURIComponent(mkt);
        await proxyJson(res, url);
        return;
    }

    if (path === '/api/live/apod') {
        // Preview: official apod-basic endpoint (hdurl). Legacy apod.nasa.gov image paths redirect to HTML.
        const date = u.searchParams.get('date') || '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            res.writeHead(400).end();
            return;
        }
        try {
            const basicUrl = 'https://science.nasa.gov/wp-json/wp/v2/apod-basic/?date=' +
                encodeURIComponent(date);
            const basicRes = await fetch(basicUrl, { signal: AbortSignal.timeout(15000) });
            const raw = await basicRes.json();
            const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
            const item = list.find((x) => x && x.date === date) || null;
            const hd = item && item.hdurl ? String(item.hdurl) : '';
            if (!item || item.media_type !== 'image' || !/^https?:\/\//i.test(hd) ||
                    /\/image-article\//i.test(hd)) {
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'not found' }));
                return;
            }
            const base = hd.split('?')[0];
            const file = /assets\.science\.nasa\.gov/i.test(base)
                ? base + '?w=1920&fit=clip'
                : hd;
            const thumb = /assets\.science\.nasa\.gov/i.test(base)
                ? base + '?w=480&fit=clip'
                : hd;
            const strip = (s) => String(s || '')
                .replace(/<[^>]+>/g, '')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#8211;/g, '–')
                .trim();
            const title = strip(item.title).replace(/\s*-\s*NASA Science\s*$/i, '').trim() ||
                'NASA APOD';
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            res.end(JSON.stringify({
                key: 'nasa:' + date,
                title,
                file,
                thumb,
                credit: strip(item.credit || item.copyright) || 'NASA APOD',
                remote: true
            }));
        } catch (e) {
            res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: String(e && e.message ? e.message : e) }));
        }
        return;
    }

    if (path === '/api/live/wikimedia') {
        const date = u.searchParams.get('date') || '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            res.writeHead(400).end();
            return;
        }
        const [y, m, d] = date.split('-');
        const feed = 'https://en.wikipedia.org/api/rest_v1/feed/featured/' + y + '/' + m + '/' + d;
        try {
            const upstream = await fetch(feed, {
                headers: {
                    Accept: 'application/json',
                    'Api-User-Agent': 'Arn0TV/0.6 (live wallpaper preview)'
                },
                signal: AbortSignal.timeout(15000)
            });
            const data = await upstream.json();
            const img = data && data.image;
            const thumb = img && img.thumbnail && img.thumbnail.source;
            if (!upstream.ok || !thumb) {
                res.writeHead(upstream.ok ? 404 : upstream.status, {
                    'Content-Type': 'application/json; charset=utf-8'
                });
                res.end(JSON.stringify({ error: 'not found' }));
                return;
            }
            const clean = String(thumb).split('?')[0];
            const sized = clean.match(/^(.*\/thumb\/.+\/)\d+px-([^/]+)$/);
            // Match live-wallpaper panelDisplayWidth cap (UHD) for browser preview.
            const file = sized ? sized[1] + '3840px-' + sized[2] : clean;
            const small = sized ? sized[1] + '480px-' + sized[2] : clean;
            const title = String(img.title || '')
                .replace(/^File:/, '')
                .replace(/\.[a-z0-9]+$/i, '')
                .replace(/_/g, ' ') || 'Picture of the day';
            const artist = (img.artist && img.artist.text) || '';
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            res.end(JSON.stringify({
                key: 'wikimedia:' + date,
                title,
                file,
                thumb: small,
                credit: 'Wikimedia Commons' + (artist ? ' · ' + artist : ''),
                remote: true
            }));
        } catch (e) {
            res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: String(e && e.message ? e.message : e) }));
        }
        return;
    }

    if (path === '/api/live/immich') {
        // Preview only: the Immich server is not CORS-enabled for the browser preview origin.
        const target = new URL(u.searchParams.get('url') || '');
        const pathOk = target.pathname.endsWith('/api/shared-links/me') ||
            target.pathname.endsWith('/api/search/metadata') ||
            /\/api\/assets\/[^/]+$/.test(target.pathname);
        if (!/^https?:$/.test(target.protocol) || !pathOk) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'url not allowed' }));
            return;
        }
        const post = req.method === 'POST';
        let body;
        if (post) {
            const chunks = [];
            for await (const c of req) chunks.push(c);
            body = Buffer.concat(chunks);
        }
        try {
            const upstream = await fetch(target.toString(), {
                method: post ? 'POST' : 'GET',
                headers: post ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
                body,
                signal: AbortSignal.timeout(15000)
            });
            res.writeHead(upstream.status, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            res.end(Buffer.from(await upstream.arrayBuffer()));
        } catch (e) {
            res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: String(e && e.message ? e.message : e) }));
        }
        return;
    }

    if (path === '/api/live/unsplash') {
        const auth = req.headers.authorization || '';
        if (!/^Client-ID\s+\S+/i.test(auth)) {
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'Unsplash Access Key required' }));
            return;
        }
        // Unsplash list + download-tracking paths (and collection lists when set).
        const target = new URL(u.searchParams.get('path') || '', UNSPLASH_API);
        const pathOk = target.pathname === '/photos' ||
            target.pathname.startsWith('/photos/') ||
            /^\/collections\/[^/]+\/photos$/.test(target.pathname);
        if (target.origin !== UNSPLASH_API || !pathOk) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'path not allowed' }));
            return;
        }
        await proxyJson(res, target.toString(), { Authorization: auth });
        return;
    }

    const file = normalize(join(root, path === '/' ? 'index.html' : path));
    if (!file.startsWith(root)) {
        res.writeHead(403).end();
        return;
    }
    try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        res.end(body);
    } catch {
        res.writeHead(404).end('Not found');
    }
}).listen(port, '127.0.0.1', () => {
    console.log(`Preview: http://localhost:${port}`);
});
