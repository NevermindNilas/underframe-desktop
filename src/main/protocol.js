// The app:// protocol: maps app://local/<path> onto files shipped with the app and attaches the CSP.
// The pure parts (path mapping, CSP and content-type selection, the request handler) run in plain node.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const SCHEME = 'app';
export const HOST = 'local';
export const ORIGIN = `${SCHEME}://${HOST}`;
export const WORKER_PATH = '/renderer/engine.worker.js';

export const PAGE_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

export const WORKER_CSP = "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'self'";

/** Card images (core/images): nothing may load or run if an SVG is opened as a document. */
export const IMAGES_PREFIX = '/core/images/';
export const IMAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
const IMAGE_CACHE = 'public, max-age=86400';

/** Privileges for protocol.registerSchemesAsPrivileged (must run before app ready). */
export const SCHEME_PRIVILEGES = { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true };

/**
 * URL path prefix -> directory relative to the app root. Prefixes end in '/'.
 * /renderer/ is the Vite build of src/renderer (npm run build:renderer); src/shared is bundled into it.
 */
const DIR_ROUTES = [
  ['/renderer/', 'build/renderer'],
  ['/core/engine/', 'core/engine'],
  [IMAGES_PREFIX, 'core/images', new Set(['.webp', '.svg', '.png'])],
];

/** Exact URL path -> file relative to the app root. */
const FILE_ROUTES = new Map([
  ['/core/data/data.json', 'core/data/data.json'],
  ['/core/manifest.json', 'core/manifest.json'],
  ['/core/images/index.json', 'core/images/index.json'],
]);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Split a URL pathname into decoded segments, or null when any segment is unsafe. */
function safeSegments(pathname) {
  const raw = pathname.split('/').slice(1);
  const out = [];
  for (const seg of raw) {
    let s;
    try {
      s = decodeURIComponent(seg);
    } catch {
      return null;
    }
    if (s === '' || s === '.' || s === '..' || /[\\/\0:]/.test(s)) return null;
    out.push(s);
  }
  return out;
}

/**
 * Map a URL pathname ('/renderer/index.html') to a path relative to the app root ('build/renderer/index.html').
 * Returns null for anything outside the routes or any traversal attempt.
 */
export function resolveAppPath(pathname) {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return null;
  const segments = safeSegments(pathname);
  if (!segments || !segments.length) return null;
  const clean = '/' + segments.join('/');
  if (FILE_ROUTES.has(clean)) return FILE_ROUTES.get(clean);
  for (const [prefix, dir, extensions] of DIR_ROUTES) {
    if (clean.startsWith(prefix) && clean.length > prefix.length) {
      if (extensions && !extensions.has(path.extname(clean).toLowerCase())) return null;
      return dir + '/' + clean.slice(prefix.length);
    }
  }
  return null;
}

/** CSP header for a URL pathname: the engine worker gets eval rights, everything else the page policy. */
export function cspFor(pathname) {
  if (pathname === WORKER_PATH) return WORKER_CSP;
  return isImagePath(pathname) ? IMAGE_CSP : PAGE_CSP;
}

/** Card images change only with the app, so the renderer may cache them; everything else revalidates. */
export function cacheControlFor(pathname) {
  return isImagePath(pathname) ? IMAGE_CACHE : 'no-cache';
}

function isImagePath(pathname) {
  return pathname.startsWith(IMAGES_PREFIX) && !pathname.endsWith('.json');
}

export function contentTypeFor(file) {
  return CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

function textResponse(status, text) {
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Security-Policy': PAGE_CSP },
  });
}

/**
 * Build the protocol handler: (Request) => Promise<Response>.
 * `root` is the app root (app.getAppPath(), possibly inside an asar); `read` defaults to fs readFile,
 * which Electron patches to read from asar archives.
 */
export function createAppHandler({ root, read = readFile }) {
  return async request => {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return textResponse(400, 'Bad request');
    }
    if (url.protocol !== `${SCHEME}:` || url.host !== HOST) return textResponse(404, 'Not found');
    if (request.method && request.method !== 'GET' && request.method !== 'HEAD') return textResponse(405, 'Method not allowed');
    const rel = resolveAppPath(url.pathname);
    if (!rel) return textResponse(404, 'Not found');
    let body;
    try {
      body = await read(path.join(root, ...rel.split('/')));
    } catch {
      return textResponse(404, 'Not found');
    }
    // Headers follow the decoded path, so '/core/%69mages/x.svg' gets the image policy too.
    const clean = '/' + safeSegments(url.pathname).join('/');
    return new Response(request.method === 'HEAD' ? null : body, {
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(rel),
        'Content-Security-Policy': cspFor(clean),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': cacheControlFor(clean),
      },
    });
  };
}

/** Call before app ready. */
export function registerAppScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: SCHEME_PRIVILEGES }]);
}

/** Call after app ready. */
export function handleAppProtocol(protocol, root) {
  protocol.handle(SCHEME, createAppHandler({ root }));
}

/** True for URLs that belong to the app's own origin. */
export function isAppUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === `${SCHEME}:` && u.host === HOST;
  } catch {
    return false;
  }
}
