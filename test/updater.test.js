// App updates: when the updater may check, what the portable exe does, silent automatic failures, the messages of a
// check the user asked for, the timers, and the update settings on disk. electron-updater is replaced by a fake.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CHECK_DELAY_MS, CHECK_INTERVAL_MS, RELEASES_URL, createUpdater, describeError, testFeedUrl, updateMode,
} from '../src/main/updater.js';
import { UPDATE_SETTINGS_FILE, cleanUpdateSettings, createUpdateSettingsStore } from '../src/main/update-settings-store.js';

/** A stand-in for electron-updater's autoUpdater: answers checks with `latest` (or throws `fail`), records calls. */
function fakeAutoUpdater({ latest = null, fail = null, downloadFail = null } = {}) {
  const u = new EventEmitter();
  Object.assign(u, {
    latest, fail, downloadFail, checks: 0, downloads: 0, installs: [], feeds: [],
    async checkForUpdates() {
      u.checks++;
      if (u.fail) throw u.fail;
      return { isUpdateAvailable: Boolean(u.latest), updateInfo: { version: u.latest ?? '2026.10.25' } };
    },
    async downloadUpdate() {
      u.downloads++;
      u.emit('download-progress', { percent: 42.5 });
      if (u.downloadFail) throw u.downloadFail;
      return ['setup.exe'];
    },
    quitAndInstall(isSilent, isForceRunAfter) { u.installs.push([isSilent, isForceRunAfter]); },
    setFeedURL(options) { u.feeds.push(options); },
  });
  return u;
}

function memorySettings(auto = true) {
  const s = { doc: { version: 1, auto }, writes: 0 };
  s.get = async () => ({ ...s.doc });
  s.set = async patch => {
    s.writes++;
    s.doc = cleanUpdateSettings({ ...s.doc, ...patch });
    return { ...s.doc };
  };
  return s;
}

/** Timers that only fire when the test says so. */
function fakeTimers() {
  const t = { timeouts: [], intervals: [] };
  t.setTimeout = (fn, ms) => { const h = { fn, ms, live: true }; t.timeouts.push(h); return h; };
  t.setInterval = (fn, ms) => { const h = { fn, ms, live: true }; t.intervals.push(h); return h; };
  t.clearTimeout = h => { if (h) h.live = false; };
  t.clearInterval = h => { if (h) h.live = false; };
  t.live = () => [...t.timeouts, ...t.intervals].filter(h => h.live);
  return t;
}

function setup({ mode = 'install', updater = fakeAutoUpdater(), settings = memorySettings(), ...over } = {}) {
  const states = [];
  const timers = fakeTimers();
  let loads = 0;
  let restarts = 0;
  let restored = 0;
  const u = createUpdater({
    mode, version: '2026.10.25', settings, timers,
    loadUpdater: async () => { loads++; return updater; },
    onState: s => states.push(s),
    beforeRestart: () => { restarts++; },
    restartFailed: () => { restored++; },
    now: () => Date.parse('2026-10-26T12:00:00Z'),
    ...over,
  });
  return { u, updater, settings, states, timers, loads: () => loads, restarts: () => restarts, restored: () => restored };
}

const settle = () => new Promise(r => setImmediate(r));
const offline = () => new Error('net::ERR_INTERNET_DISCONNECTED');
const noLatestYml = () => Object.assign(new Error('Cannot find latest.yml in the latest release artifacts'), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' });

test('only the packaged, non-automated Windows app checks; the portable exe only notifies', () => {
  const env = {};
  assert.equal(updateMode({ packaged: true, automated: false, platform: 'win32', env }), 'install');
  assert.equal(updateMode({ packaged: false, automated: false, platform: 'win32', env }), 'off');
  assert.equal(updateMode({ packaged: true, automated: true, platform: 'win32', env }), 'off');
  assert.equal(updateMode({ packaged: true, automated: false, platform: 'win32', env: { UF_SMOKE: '1' } }), 'off');
  assert.equal(updateMode({ packaged: true, automated: false, platform: 'win32', env: { UF_SCENES: 'C:/shots' } }), 'off');
  assert.equal(updateMode({ packaged: true, automated: false, platform: 'linux', env }), 'off');
  assert.equal(updateMode({ packaged: true, automated: false, platform: 'win32', env: { PORTABLE_EXECUTABLE_DIR: 'D:/apps' } }), 'notify');
});

test('the test feed is only a plain http URL on this machine', () => {
  assert.equal(testFeedUrl({}), null);
  assert.equal(testFeedUrl({ UF_UPDATE_FEED: 'http://127.0.0.1:8123/feed/' }), 'http://127.0.0.1:8123/feed/');
  assert.equal(testFeedUrl({ UF_UPDATE_FEED: 'http://localhost:9000' }), 'http://localhost:9000/');
  assert.equal(testFeedUrl({ UF_UPDATE_FEED: 'https://127.0.0.1:8123/' }), null);
  assert.equal(testFeedUrl({ UF_UPDATE_FEED: 'http://example.com/' }), null);
  assert.equal(testFeedUrl({ UF_UPDATE_FEED: 'http://127.0.0.1.example.com/' }), null);
  assert.equal(testFeedUrl({ UF_UPDATE_FEED: 'http://user:pw@127.0.0.1/' }), null);
  assert.equal(testFeedUrl({ UF_UPDATE_FEED: 'not a url' }), null);
});

test('when off (development, automated runs) nothing is loaded, scheduled or checked', async () => {
  const t = setup({ mode: 'off' });
  const started = await t.u.start();
  assert.equal(started.status, 'off');
  assert.match(started.message, /installed app/);
  assert.equal(t.timers.live().length, 0);
  const checked = await t.u.check({ manual: true });
  assert.equal(checked.status, 'off');
  assert.equal(t.loads(), 0);
  assert.equal(t.updater.checks, 0);
  assert.equal(t.u.restart(), false);
});

test('automatic checks run 10 s after start and every 6 hours, and stop when turned off', async () => {
  const t = setup();
  await t.u.start();
  assert.deepEqual(t.timers.live().map(h => h.ms), [CHECK_DELAY_MS, CHECK_INTERVAL_MS]);
  assert.equal(CHECK_DELAY_MS, 10_000);
  assert.equal(CHECK_INTERVAL_MS, 6 * 3600_000);
  assert.equal(t.loads(), 0, 'electron-updater is only loaded for a check');
  t.timers.timeouts[0].fn();
  await settle();
  assert.equal(t.updater.checks, 1);
  assert.equal(t.u.state().status, 'up-to-date');

  const off = await t.u.setAuto(false);
  assert.equal(off.auto, false);
  assert.equal(t.settings.doc.auto, false);
  assert.equal(t.timers.live().length, 0);
  const on = await t.u.setAuto(true);
  assert.equal(on.auto, true);
  assert.equal(t.timers.live().length, 2);
  t.u.stop();
  assert.equal(t.timers.live().length, 0);
});

test('automatic checks stay off when the setting says so; a manual check still works', async () => {
  const t = setup({ settings: memorySettings(false) });
  const s = await t.u.start();
  assert.equal(s.auto, false);
  assert.equal(t.timers.live().length, 0);
  assert.equal((await t.u.check({ manual: true })).status, 'up-to-date');
});

test('the installed app downloads a newer version, then restarts to install it', async () => {
  const t = setup({ updater: fakeAutoUpdater({ latest: '2026.10.26' }) });
  await t.u.start();
  const after = await t.u.check();
  assert.equal(after.status, 'downloading');
  assert.equal(after.available, '2026.10.26');
  assert.equal(after.checkedAt, '2026-10-26T12:00:00.000Z');
  await settle();
  const s = t.u.state();
  assert.equal(s.status, 'ready');
  assert.match(s.message, /2026\.10\.26 is ready/);
  assert.ok(t.states.some(x => x.status === 'downloading' && x.percent === 42), 'progress is reported in whole percents');
  assert.equal(t.updater.autoDownload, false);
  assert.equal(t.updater.disableWebInstaller, true);
  assert.equal(t.updater.autoInstallOnAppQuit, true, 'installs on quit when not restarted');
  // A downloaded update waits for the restart: no further checks.
  await t.u.check();
  assert.equal(t.updater.checks, 1);
  assert.equal(t.u.restart(), true);
  assert.equal(t.restarts(), 1, 'the close guard is lifted first');
  assert.deepEqual(t.updater.installs, [[true, true]]);
  assert.equal(t.u.state().status, 'restarting');
  // A second click (About and the toast, or a double click) must not start the installer twice.
  assert.equal(t.u.restart(), false);
  assert.equal(t.restarts(), 1);
  assert.deepEqual(t.updater.installs, [[true, true]]);
  assert.equal(t.restored(), 0);
});

test("an installer that can't start puts the close guard back and says so", async () => {
  const updater = fakeAutoUpdater({ latest: '2026.10.26' });
  // electron-updater's install() reports a missing installer as an 'error' event during the call and doesn't quit.
  updater.quitAndInstall = () => updater.emit('error', new Error("No update filepath provided, can't quit and install"));
  const t = setup({ updater });
  await t.u.check();
  await settle();
  assert.equal(t.u.restart(), false);
  assert.equal(t.restarts(), 1);
  assert.equal(t.restored(), 1, 'closing asks about unsaved changes again');
  const s = t.u.state();
  assert.equal(s.status, 'error');
  assert.match(s.message, /Couldn't start the update installer/);
  assert.equal(s.releasePage, true);
  assert.equal(updater.listenerCount('error'), 1, 'only the permanent listener is left');
});

test('restartWhenReady (local test feed) installs as soon as the download is done', async () => {
  const t = setup({ updater: fakeAutoUpdater({ latest: '2026.10.26' }), restartWhenReady: true, feedUrl: 'http://127.0.0.1:8123/' });
  await t.u.check();
  await settle();
  assert.deepEqual(t.updater.feeds, [{ provider: 'generic', url: 'http://127.0.0.1:8123/' }]);
  assert.deepEqual(t.updater.installs, [[true, true]]);
});

test('the portable exe only notifies: no download, no install, the release page instead', async () => {
  const t = setup({ mode: 'notify', updater: fakeAutoUpdater({ latest: '2026.10.26' }) });
  const s = await t.u.check();
  await settle();
  assert.equal(s.status, 'available');
  assert.equal(s.available, '2026.10.26');
  assert.equal(s.releasePage, true);
  assert.equal(s.releaseUrl, RELEASES_URL);
  assert.match(s.message, /portable app doesn't update itself/);
  assert.equal(t.updater.downloads, 0);
  assert.equal(t.updater.autoInstallOnAppQuit, false);
  assert.equal(t.u.restart(), false);
  assert.deepEqual(t.updater.installs, []);
});

test('automatic checks fail silently: offline, rate limit, a release without latest.yml, a failed download', async () => {
  for (const fail of [offline(), Object.assign(new Error('403 Forbidden'), { statusCode: 403 }), noLatestYml()]) {
    const t = setup({ updater: fakeAutoUpdater({ fail }) });
    await t.u.start();
    const s = await t.u.check();
    assert.equal(s.status, 'idle', fail.message);
    assert.equal(s.message, 'Not checked yet.');
    assert.ok(!t.states.some(x => x.status === 'error'), fail.message);
  }
  const t = setup({ updater: fakeAutoUpdater({ latest: '2026.10.26', downloadFail: offline() }) });
  await t.u.check();
  await settle();
  assert.equal(t.u.state().status, 'idle');
  assert.equal(t.u.state().checkedAt, null, "a failed download doesn't count as a check");
  assert.ok(!t.states.some(x => x.status === 'error'));
  // After an earlier up-to-date check, a silent download failure keeps that check's time, not "up to date as of now".
  let hour = 0;
  const again = setup({
    updater: fakeAutoUpdater({ downloadFail: offline() }),
    now: () => Date.parse('2026-10-26T12:00:00Z') + (hour++) * 3600_000,
  });
  const first = await again.u.check();
  assert.equal(first.status, 'up-to-date');
  again.updater.latest = '2026.10.26';
  await again.u.check();
  await settle();
  assert.equal(again.u.state().status, 'up-to-date');
  assert.equal(again.u.state().checkedAt, first.checkedAt);
  // The updater's own 'error' events never throw (they have a listener).
  assert.doesNotThrow(() => t.updater.emit('error', new Error('boom')));
});

test('a manual check says what happened in plain words', async () => {
  const cases = [
    [offline(), /Couldn't reach GitHub/, false],
    [Object.assign(new Error('HttpError: 403 Forbidden\n...'), { statusCode: 403 }), /limiting update checks/, false],
    [new Error('Unable to find latest version on GitHub: HttpError: 429 Too Many Requests'), /limiting update checks/, false],
    [noLatestYml(), /can't be installed from here/, true],
    [new Error('something odd\nstack line'), /^Couldn't check for updates: something odd$/, false],
  ];
  for (const [fail, text, releasePage] of cases) {
    const t = setup({ updater: fakeAutoUpdater({ fail }) });
    const s = await t.u.check({ manual: true });
    assert.equal(s.status, 'error');
    assert.match(s.message, text);
    assert.equal(s.releasePage, releasePage, fail.message);
  }
  const up = setup();
  assert.equal((await up.u.check({ manual: true })).message, 'Underframe Desktop is up to date.');
});

test('a manual click during an automatic check reports its failure; download failures too', async () => {
  const updater = fakeAutoUpdater({ fail: offline() });
  let release;
  updater.checkForUpdates = () => new Promise((_res, rej) => { release = () => rej(offline()); });
  const t = setup({ updater });
  const auto = t.u.check();
  await settle();
  const manual = t.u.check({ manual: true });
  release();
  assert.equal((await auto).status, 'error');
  assert.equal(await manual, await auto);

  const d = setup({ updater: fakeAutoUpdater({ latest: '2026.10.26', downloadFail: new Error('sha512 checksum mismatch') }) });
  await d.u.check({ manual: true });
  await settle();
  assert.equal(d.u.state().status, 'error');
  assert.match(d.u.state().message, /damaged/);
});

test('describeError: download failures name the download', () => {
  assert.match(describeError(new Error('disk full'), 'download').text, /^Couldn't download the update: disk full$/);
  assert.equal(describeError(new Error('disk full'), 'download').releasePage, true);
});

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'uf-update-settings-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('update settings persist in userData, default on, and survive a corrupt file', async t => {
  const dir = await tempDir(t);
  const store = createUpdateSettingsStore(dir);
  assert.deepEqual(await store.get(), { version: 1, auto: true });
  assert.deepEqual(await store.set({ auto: false }), { version: 1, auto: false });
  assert.deepEqual(await createUpdateSettingsStore(dir).get(), { version: 1, auto: false });
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, UPDATE_SETTINGS_FILE), 'utf8')), { version: 1, auto: false });
  await writeFile(path.join(dir, UPDATE_SETTINGS_FILE), '{ not json', 'utf8');
  assert.deepEqual(await store.get(), { version: 1, auto: true });
  // Only a stored false turns the checks off.
  assert.deepEqual(cleanUpdateSettings({ auto: 'no' }), { version: 1, auto: true });
});

test('the updater starts from the stored setting', async t => {
  const dir = await tempDir(t);
  await createUpdateSettingsStore(dir).set({ auto: false });
  const s = setup({ settings: createUpdateSettingsStore(dir) });
  assert.equal((await s.u.start()).auto, false);
  assert.equal(s.timers.live().length, 0);
});
