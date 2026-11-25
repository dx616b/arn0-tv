// Serves src/ for desktop preview. Arrow keys + Enter navigate, Esc/Backspace = Back.
// Also proxies Bing / NASA APOD / Wikimedia / Wallhaven / Unsplash / Immich so Live
// wallpapers can fetch despite browser CORS.
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
const WALLHAVEN_API = 'https://wallhaven.cc/api/v1';

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
        // Preview: same path as the TV — image-article search + featured media (v0.6.15).
        const date = u.searchParams.get('date') || '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            res.writeHead(400).end();
            return;
        }
        const months = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        const parts = date.split('-');
        const query = `APOD: ${parts[0]} ${months[Number(parts[1]) - 1]} ${Number(parts[2])}`;
        try {
            const searchUrl = 'https://science.nasa.gov/wp-json/wp/v2/image-article?search=' +
                encodeURIComponent(query) + '&per_page=5';
            const search = await fetch(searchUrl, { signal: AbortSignal.timeout(15000) });
            const list = await search.json();
            const want = query.toLowerCase();
            const post = (Array.isArray(list) ? list : []).find((p) => {
                const t = String(p?.title?.rendered || '')
                    .replace(/&#8211;/g, '–')
                    .replace(/&amp;/g, '&')
                    .toLowerCase();
                return t.startsWith(want);
            });
            if (!post?.featured_media) {
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: 'not found' }));
                return;
            }
            const mediaRes = await fetch(
                'https://science.nasa.gov/wp-json/wp/v2/media/' + post.featured_media,
                { signal: AbortSignal.timeout(15000) }
            );
            const media = await mediaRes.json();
            const sizes = media?.media_details?.sizes || {};
            const pick = sizes['2048x2048'] || sizes.large || sizes['1536x1536'] || sizes.medium_large;
            const file = pick?.source_url || media?.source_url || '';
            const thumb = sizes.medium?.source_url || sizes.thumbnail?.source_url || file;
            let title = String(post.title?.rendered || '')
                .replace(/&#8211;/g, '–')
                .replace(/&amp;/g, '&')
                .replace(/^APOD:\s*/i, '')
                .replace(/^\d{4} [A-Za-z]+ \d{1,2}\s*[–-]\s*/, '')
                .replace(/\s*-\s*NASA Science\s*$/i, '')
                .trim() || 'NASA APOD';
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store'
            });
            res.end(JSON.stringify({
                key: 'nasa:' + date,
                title,
                file,
                thumb,
                credit: 'NASA APOD',
                remote: true,
                source: 'nasa'
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

    if (path === '/api/live/radiorecord') {
        await proxyJson(res, 'https://www.radiorecord.ru/api/stations/');
        return;
    }

    if (path === '/api/live/wallhaven') {
        // Relative to /api/v1/ so "/search" is not resolved as host-root /search.
        let raw = u.searchParams.get('path') || '';
        if (raw.startsWith('/')) raw = raw.slice(1);
        const target = new URL(raw, WALLHAVEN_API + '/');
        const pathOk = target.pathname === '/api/v1/search' ||
            /^\/api\/v1\/w\/[A-Za-z0-9]+$/.test(target.pathname);
        if (target.origin !== 'https://wallhaven.cc' || !pathOk) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'path not allowed' }));
            return;
        }
        // Hard-lock SFW on search; detail fetch is still SFW-only in-app.
        if (target.pathname === '/api/v1/search') target.searchParams.set('purity', '100');
        await proxyJson(res, target.toString());
        return;
    }

    const file = normalize(join(root, path === '/' ? 'index.html' : path));
    if (!file.startsWith(root)) {
        res.writeHead(403).end();
        return;
    }
    try {
        let body = await readFile(file);
        const headers = {
            'Content-Type': types[extname(file)] || 'application/octet-stream',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            Pragma: 'no-cache',
            Expires: '0'
        };
        // Preview has no live-reload: every HTML load gets fresh css/js query strings
        // so a normal Refresh always picks up edits (browsers still cache ?v= urls).
        if (extname(file) === '.html') {
            const v = String(Date.now());
            body = Buffer.from(
                body.toString('utf8').replace(
                    /(href|src)="((?:css|js)\/[^"?]+)(?:\?[^"]*)?"/g,
                    '$1="$2?v=' + v + '"'
                ),
                'utf8'
            );
        }
        res.writeHead(200, headers);
        res.end(body);
    } catch {
        res.writeHead(404).end('Not found');
    }
}).listen(port, '127.0.0.1', () => {
    console.log(`Preview: http://localhost:${port}  (manual refresh; assets cache-busted per load)`);
});
