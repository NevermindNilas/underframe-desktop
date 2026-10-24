// app:// path mapping, traversal rejection, CSP and content types, and the request handler (plain node).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  PAGE_CSP, WORKER_CSP, contentTypeFor, createAppHandler, cspFor, isAppUrl, resolveAppPath,
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
