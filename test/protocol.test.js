// app:// path mapping, traversal rejection, CSP and content types, and the request handler (plain node).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  IMAGE_CSP, PAGE_CSP, WORKER_CSP, cacheControlFor, contentTypeFor, createAppHandler, cspFor, isAppUrl, resolveAppPath,
} from '../src/main/protocol.js';
import { isAllowedExternal, checkUpstream } from '../src/main/external.js';

test('routes map onto the shipped directories', () => {
  // The renderer is served from its Vite build, never from the sources.
  assert.equal(resolveAppPath('/renderer/index.html'), 'build/renderer/index.html');
  assert.equal(resolveAppPath('/renderer/assets/index-abc123.js'), 'build/renderer/assets/index-abc123.js');
  assert.equal(resolveAppPath('/renderer/engine.worker.js'), 'build/renderer/engine.worker.js');
  assert.equal(resolveAppPath('/core/engine/dps_calculator.wasm'), 'core/engine/dps_calculator.wasm');
  assert.equal(resolveAppPath('/core/data/data.json'), 'core/data/data.json');
  assert.equal(resolveAppPath('/core/manifest.json'), 'core/manifest.json');
  assert.equal(resolveAppPath('/renderer/my%20file.css'), 'build/renderer/my file.css');
});

test('anything outside the routes is refused', () => {
  for (const p of ['/', '/renderer/', '/renderer', '/core/data/other.json', '/core/scripts/update.mjs', '/core/LICENSE',
    '/src/main/main.js', '/package.json', '/main/main.js', '/core/', 'renderer/index.html', '',
    // Sources are not served: shared logic is bundled into the renderer build.
    '/shared/mods.js', '/src/renderer/index.html', '/build/renderer/index.html']) {
    assert.equal(resolveAppPath(p), null, p);
  }
});

test('path traversal is refused, encoded or not', () => {
  for (const p of ['/renderer/../main/main.js', '/renderer/%2e%2e/main/main.js', '/renderer/..%2fmain%2fmain.js',
    '/renderer/..%5cmain%5cmain.js', '/renderer/a%00.js', '/renderer//etc/passwd', '/renderer/./index.html',
    '/shared/C:%5cWindows%5cwin.ini', '/renderer/%E0%A4%A.js', '/core/engine/../../package.json']) {
    assert.equal(resolveAppPath(p), null, p);
  }
});

test('only the engine worker gets eval rights', () => {
  assert.equal(cspFor('/renderer/engine.worker.js'), WORKER_CSP);
  assert.match(WORKER_CSP, /'unsafe-eval' 'wasm-unsafe-eval'/);
  for (const p of ['/renderer/index.html', '/renderer/assets/index.js', '/core/engine/dps_calculator.js']) {
    assert.equal(cspFor(p), PAGE_CSP, p);
  }
  assert.doesNotMatch(PAGE_CSP, /unsafe-eval/);
  assert.match(PAGE_CSP, /object-src 'none'/);
});

test('content types', () => {
  assert.match(contentTypeFor('a/index.html'), /^text\/html/);
  assert.match(contentTypeFor('a.js'), /^text\/javascript/);
  assert.match(contentTypeFor('a.mjs'), /^text\/javascript/);
  assert.match(contentTypeFor('a.css'), /^text\/css/);
  assert.match(contentTypeFor('a.json'), /^application\/json/);
  assert.equal(contentTypeFor('a.wasm'), 'application/wasm');
  assert.equal(contentTypeFor('a.svg'), 'image/svg+xml');
  assert.equal(contentTypeFor('A.PNG'), 'image/png');
  assert.equal(contentTypeFor('a.bin'), 'application/octet-stream');
  assert.equal(contentTypeFor('core/images/mods/full/serration.webp'), 'image/webp');
});

test('card images: read-only route with an extension allowlist', () => {
  assert.equal(resolveAppPath('/core/images/index.json'), 'core/images/index.json');
  assert.equal(resolveAppPath('/core/images/mods/full/serration.webp'), 'core/images/mods/full/serration.webp');
  assert.equal(resolveAppPath('/core/images/mods/compact/primed-cryo-rounds.webp'), 'core/images/mods/compact/primed-cryo-rounds.webp');
  assert.equal(resolveAppPath('/core/images/arcanes/primary-merciless.webp'), 'core/images/arcanes/primary-merciless.webp');
  assert.equal(resolveAppPath('/core/images/polarities/Madurai.svg'), 'core/images/polarities/Madurai.svg');
  assert.equal(resolveAppPath('/core/images/mods/full/SERRATION.WEBP'), 'core/images/mods/full/SERRATION.WEBP');
  for (const p of ['/core/images/', '/core/images', '/core/images/other.json', '/core/images/mods/full/x.js',
    '/core/images/mods/full/x.html', '/core/images/mods/full/x', '/core/images/../data/data.json',
    '/core/images/%2e%2e/data/data.json', '/core/images/..%2fdata%2fdata.json', '/core/images/mods/..%5c..%5cdata.json',
    '/core/images/mods/full/a%00.webp', '/core/images/C:%5cWindows%5cx.webp', '/core/images//etc/x.webp',
    '/core/images/../../package.json']) {
    assert.equal(resolveAppPath(p), null, p);
  }
});

test('card images: locked-down CSP and cache headers', () => {
  for (const p of ['/core/images/mods/full/serration.webp', '/core/images/polarities/Madurai.svg']) {
    assert.equal(cspFor(p), IMAGE_CSP, p);
    assert.match(cacheControlFor(p), /max-age=\d+/, p);
  }
  assert.match(IMAGE_CSP, /default-src 'none'/);
  assert.doesNotMatch(IMAGE_CSP, /script-src/);
  assert.equal(cspFor('/core/images/index.json'), PAGE_CSP);
  assert.equal(cacheControlFor('/core/images/index.json'), 'no-cache');
  assert.equal(cacheControlFor('/renderer/index.html'), 'no-cache');
  // The page may load them: img-src allows the app's own origin.
  assert.match(PAGE_CSP, /img-src 'self'/);
});

test('handler serves files with headers and 404s the rest', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'uf-proto-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'build', 'renderer', 'assets'), { recursive: true });
  await mkdir(path.join(root, 'src', 'main'), { recursive: true });
  await mkdir(path.join(root, 'src', 'renderer'), { recursive: true });
  await writeFile(path.join(root, 'build', 'renderer', 'index.html'), '<h1>hi</h1>');
  await writeFile(path.join(root, 'build', 'renderer', 'engine.worker.js'), 'self.x = 1;');
  await writeFile(path.join(root, 'build', 'renderer', 'assets', 'index-1.js'), 'export {};');
  await writeFile(path.join(root, 'src', 'main', 'main.js'), 'secret');
  await writeFile(path.join(root, 'src', 'renderer', 'index.html'), 'source page');
  const handler = createAppHandler({ root });

  const page = await handler(new Request('app://local/renderer/index.html'));
  assert.equal(page.status, 200);
  assert.equal(await page.text(), '<h1>hi</h1>');
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.equal(page.headers.get('content-security-policy'), PAGE_CSP);

  const worker = await handler(new Request('app://local/renderer/engine.worker.js'));
  assert.equal(worker.status, 200);
  assert.equal(worker.headers.get('content-security-policy'), WORKER_CSP);

  const bundle = await handler(new Request('app://local/renderer/assets/index-1.js'));
  assert.equal(bundle.status, 200);
  assert.match(bundle.headers.get('content-type'), /^text\/javascript/);
  assert.equal(bundle.headers.get('content-security-policy'), PAGE_CSP);

  await mkdir(path.join(root, 'core', 'images', 'mods', 'full'), { recursive: true });
  await mkdir(path.join(root, 'core', 'images', 'polarities'), { recursive: true });
  await mkdir(path.join(root, 'core', 'data'), { recursive: true });
  await writeFile(path.join(root, 'core', 'images', 'mods', 'full', 'serration.webp'), Buffer.from('RIFF0000WEBP'));
  await writeFile(path.join(root, 'core', 'images', 'polarities', 'Madurai.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(path.join(root, 'core', 'images', 'index.json'), '{"schema":1}');
  await writeFile(path.join(root, 'core', 'images', 'notes.txt'), 'secret');
  await writeFile(path.join(root, 'core', 'data', 'data.json'), '{}');

  const card = await handler(new Request('app://local/core/images/mods/full/serration.webp'));
  assert.equal(card.status, 200);
  assert.equal(card.headers.get('content-type'), 'image/webp');
  assert.equal(card.headers.get('content-security-policy'), IMAGE_CSP);
  assert.equal(card.headers.get('x-content-type-options'), 'nosniff');
  assert.match(card.headers.get('cache-control'), /max-age=/);
  assert.equal(Buffer.from(await card.arrayBuffer()).toString(), 'RIFF0000WEBP');

  const icon = await handler(new Request('app://local/core/images/polarities/Madurai.svg'));
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get('content-type'), 'image/svg+xml');
  assert.equal(icon.headers.get('content-security-policy'), IMAGE_CSP);
  const encoded = await handler(new Request('app://local/core/%69mages/polarities/Madurai.svg'));
  assert.equal(encoded.headers.get('content-security-policy'), IMAGE_CSP);

  const index = await handler(new Request('app://local/core/images/index.json'));
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /^application\/json/);

  const head = await handler(new Request('app://local/core/images/mods/full/serration.webp', { method: 'HEAD' }));
  assert.equal(head.status, 200);
  for (const method of ['PUT', 'POST', 'DELETE']) {
    const res = await handler(new Request('app://local/core/images/mods/full/serration.webp', { method, body: method === 'DELETE' ? null : 'x' }));
    assert.equal(res.status, 405, method);
  }

  for (const url of ['app://local/core/images/notes.txt', 'app://local/core/images/mods/full/missing.webp',
    'app://local/core/images/../../package.json', 'app://local/core/images/%2e%2e/%2e%2e/src/main/main.js',
    'app://local/core/images/..%2fdata%2fdata.json']) {
    const res = await handler(new Request(url));
    assert.equal(res.status, 404, url);
    assert.notEqual(await res.text(), 'secret', url);
  }

  for (const url of ['app://local/renderer/missing.js', 'app://local/main/main.js', 'app://other/renderer/index.html',
    'app://local/src/renderer/index.html', 'app://local/renderer/../src/renderer/index.html',
    'app://local/renderer/%2e%2e/main/main.js', 'app://local/renderer/..%2fmain%2fmain.js']) {
    const res = await handler(new Request(url));
    assert.equal(res.status, 404, url);
    assert.notEqual(await res.text(), 'secret', url);
  }
});

test('app origin check', () => {
  assert.ok(isAppUrl('app://local/renderer/index.html'));
  assert.ok(!isAppUrl('app://evil/renderer/index.html'));
  assert.ok(!isAppUrl('https://www.underframe.site/'));
  assert.ok(!isAppUrl('not a url'));
});

test('external links: https to allowlisted hosts only', () => {
  for (const u of ['https://www.underframe.site/builds', 'https://underframe.site', 'https://discord.gg/abc', 'https://github.com/x/y']) {
    assert.ok(isAllowedExternal(u), u);
  }
  for (const u of ['http://underframe.site', 'https://evil.com', 'https://github.com.evil.com/', 'https://user@github.com/',
    'https://github.com:8443/', 'file:///C:/Windows', 'javascript:alert(1)', 'app://local/renderer/index.html', '', null]) {
    assert.ok(!isAllowedExternal(u), String(u));
  }
});

test('upstream check compares versions and never throws', async () => {
  const reply = body => async () => new Response(JSON.stringify(body), { status: 200 });
  assert.deepEqual(await checkUpstream('abc', { fetch: reply({ version: 'abc' }) }), { local: 'abc', remote: 'abc', outdated: false });
  assert.deepEqual(await checkUpstream('abc', { fetch: reply({ version: 'def' }) }), { local: 'abc', remote: 'def', outdated: true });
  const failed = await checkUpstream('abc', { fetch: async () => { throw new Error('offline'); } });
  assert.equal(failed.outdated, false);
  assert.equal(failed.error, 'offline');
  const bad = await checkUpstream('abc', { fetch: async () => new Response('nope', { status: 500 }) });
  assert.equal(bad.error, 'HTTP 500');
  const noVersion = await checkUpstream('abc', { fetch: reply({}) });
  assert.ok(noVersion.error);
});
