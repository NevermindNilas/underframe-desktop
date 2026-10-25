// App updates from GitHub Releases (electron-updater). Only the packaged app checks, never development, smoke or
// scene runs. The installed app downloads a newer release in the background and installs it on Restart to update
// or when the app quits; the portable exe can't replace itself, so it only says a newer version exists and points to
// the Releases page. Automatic checks fail silently (offline, rate limit, a release without latest.yml); a check the
// user asked for says what happened. Pure node apart from the updater it is handed, tested with a fake.

export const CHECK_DELAY_MS = 10_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const RELEASES_URL = 'https://github.com/NevermindNilas/underframe-desktop/releases/latest';
/** Testing only: a local update feed (electron-updater's generic provider) instead of GitHub. */
export const TEST_FEED_ENV = 'UF_UPDATE_FEED';

const OFF_TEXT = 'Updates are checked only in the installed app.';
const IDLE_TEXT = 'Not checked yet.';
const CHECKING_TEXT = 'Checking for updates…';
const UP_TO_DATE_TEXT = 'Underframe Desktop is up to date.';

/** 'install' (the installed app), 'notify' (the portable exe) or 'off' (development, automated runs, other systems). */
export function updateMode({ packaged, automated, platform = process.platform, env = process.env }) {
  if (!packaged || automated || env.UF_SMOKE === '1' || env.UF_SCENES || platform !== 'win32') return 'off';
  // electron-builder's portable launcher sets PORTABLE_EXECUTABLE_DIR.
  return env.PORTABLE_EXECUTABLE_DIR ? 'notify' : 'install';
}

/** The test feed from UF_UPDATE_FEED: plain http on 127.0.0.1 or localhost only, else null (GitHub). */
export function testFeedUrl(env = process.env) {
  const raw = env[TEST_FEED_ENV];
  if (!raw) return null;
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' || u.username || u.password || !['127.0.0.1', 'localhost'].includes(u.hostname)) return null;
  return u.href;
}

const OFFLINE = /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED|NETWORK_[A-Z_]+|CONNECTION_[A-Z_]+|ADDRESS_UNREACHABLE|TIMED_OUT|PROXY_[A-Z_]+|TUNNEL_CONNECTION_FAILED)|\b(ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH)\b/;
const RATE_LIMITED = /\bHTTP_ERROR_(403|429)\b|^(403|429) |\b(403|429) (Forbidden|Too Many Requests)\b|rate limit/i;
/** electron-updater's codes for a release it can't update from (no latest.yml, no release, a broken feed). */
const NO_UPDATE_INFO = new Set([
  'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND', 'ERR_UPDATER_NO_PUBLISHED_VERSIONS', 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
  'ERR_UPDATER_INVALID_UPDATE_INFO', 'ERR_UPDATER_NO_FILES_PROVIDED', 'ERR_UPDATER_INVALID_RELEASE_FEED',
  'ERR_UPDATER_INVALID_VERSION',
]);

/** What went wrong, in plain words: { text, releasePage } (releasePage: point the user to the Releases page). */
export function describeError(e, phase = 'check') {
  const message = String(e?.message ?? e ?? '');
  const status = Number(e?.statusCode);
  if (OFFLINE.test(message) || OFFLINE.test(String(e?.code ?? ''))) {
    return { text: "Couldn't reach GitHub to check for updates. Check your internet connection and try again.", releasePage: false };
  }
  if (status === 403 || status === 429 || RATE_LIMITED.test(message)) {
    return { text: 'GitHub is limiting update checks right now. Try again in an hour.', releasePage: false };
  }
  if (NO_UPDATE_INFO.has(e?.code)) {
    return { text: "The latest release can't be installed from here. Get it from the Releases page.", releasePage: true };
  }
  if (/sha512 checksum mismatch/i.test(message)) {
    return { text: 'The downloaded update was damaged. Try again later, or get it from the Releases page.', releasePage: true };
  }
  const first = message.split('\n')[0].slice(0, 160) || 'unknown error';
  return {
    text: phase === 'download' ? `Couldn't download the update: ${first}` : `Couldn't check for updates: ${first}`,
    releasePage: phase === 'download',
  };
}

/**
 * The updater. `mode` from updateMode(); `settings` a store with get() and set({ auto }); `loadUpdater()` resolves to
 * electron-updater's autoUpdater (loaded on the first check only); `onState(state)` receives every change;
 * `beforeRestart()` runs just before the app quits to install, and `restartFailed()` when the installer couldn't start
 * after all (the app keeps running). `restartWhenReady` (tests with a local feed) installs
 * as soon as the download is done. State: { mode, status, version, available, percent, message, releasePage, auto,
 * checkedAt, releaseUrl }, status one of off, idle, checking, up-to-date, available, downloading, ready, restarting,
 * error.
 */
export function createUpdater({
  mode, version, settings, loadUpdater, feedUrl = null, onState = () => {}, beforeRestart = () => {}, restartFailed = () => {},
  restartWhenReady = false, timers = globalThis, now = () => Date.now(), log = () => {},
}) {
  let state = {
    mode, status: mode === 'off' ? 'off' : 'idle', version, available: null, percent: null,
    message: mode === 'off' ? OFF_TEXT : IDLE_TEXT, releasePage: false, auto: true, checkedAt: null, releaseUrl: RELEASES_URL,
  };
  let updater = null;
  let running = null;
  let downloading = null;
  /** The check or download in progress was asked for by the user: its failure is reported. */
  let manualRun = false;
  let timeout = null;
  let interval = null;
  let stopped = false;

  const snapshot = () => ({ ...state });
  const set = patch => {
    state = { ...state, ...patch };
    onState(snapshot());
  };

  async function getUpdater() {
    if (updater) return updater;
    const u = await loadUpdater();
    // Downloads are started here (after the check), so a portable copy never downloads.
    u.autoDownload = false;
    u.autoInstallOnAppQuit = mode === 'install';
    u.allowPrerelease = false;
    u.allowDowngrade = false;
    // Releases carry the full installer, never electron-builder's web installer.
    u.disableWebInstaller = true;
    // electron-updater also emits its failures as 'error' events, which would throw without a listener.
    u.on('error', e => log(`updater: ${e?.message ?? e}`));
    u.on('download-progress', p => {
      const percent = Math.floor(Number(p?.percent) || 0);
      if (state.status === 'downloading' && percent !== state.percent) set({ percent });
    });
    if (feedUrl) u.setFeedURL({ provider: 'generic', url: feedUrl });
    updater = u;
    return u;
  }

  /** A failed check or download: reported when the user asked, else back to how it was, silently. */
  function fail(e, phase, before) {
    log(`update ${phase} failed: ${e?.message ?? e}`);
    if (manualRun) {
      const { text, releasePage } = describeError(e, phase);
      set({ status: 'error', percent: null, message: text, releasePage });
    } else {
      set({
        status: before.status, available: before.available, percent: before.percent, message: before.message,
        releasePage: before.releasePage, checkedAt: before.checkedAt,
      });
    }
    return snapshot();
  }

  async function run() {
    const before = snapshot();
    set({ status: 'checking', message: CHECKING_TEXT, releasePage: false });
    let result;
    try {
      result = await (await getUpdater()).checkForUpdates();
    } catch (e) {
      const out = fail(e, 'check', before);
      manualRun = false;
      return out;
    }
    const checkedAt = new Date(now()).toISOString();
    const latest = result?.isUpdateAvailable ? result.updateInfo?.version ?? null : null;
    if (!latest) {
      manualRun = false;
      set({ status: 'up-to-date', available: null, percent: null, checkedAt, message: UP_TO_DATE_TEXT });
      return snapshot();
    }
    if (mode === 'notify') {
      manualRun = false;
      set({
        status: 'available', available: latest, percent: null, checkedAt, releasePage: true,
        message: `Version ${latest} is available. The portable app doesn't update itself: get it from the Releases page.`,
      });
      return snapshot();
    }
    set({ status: 'downloading', available: latest, percent: 0, checkedAt, message: `Downloading version ${latest}…` });
    downloading = updater.downloadUpdate().then(
      () => {
        set({ status: 'ready', percent: null, message: `Version ${latest} is ready. Restart to update, or it installs when you quit.` });
        if (restartWhenReady) restart();
      },
      e => fail(e, 'download', before),
    ).finally(() => {
      downloading = null;
      manualRun = false;
    });
    return snapshot();
  }

  /** Check now. Resolves to the state once the check is done (a download goes on in the background). Never rejects. */
  function check({ manual = false } = {}) {
    if (mode === 'off') return Promise.resolve(snapshot());
    if (manual) manualRun = true;
    // A downloaded update waits for the restart; a download in progress reports when it ends.
    if (state.status === 'ready' || state.status === 'restarting' || downloading) return Promise.resolve(snapshot());
    if (!running) running = run().finally(() => { running = null; });
    return running;
  }

  /**
   * Quit and install the downloaded update, then start the new version. Once only: a second quitAndInstall would let
   * electron-updater start the installer again on quit. False when there is nothing to install or the installer
   * couldn't start (electron-updater reports that as an 'error' event during the call, and the app doesn't quit).
   */
  function restart() {
    if (mode !== 'install' || state.status !== 'ready' || !updater) return false;
    set({ status: 'restarting', message: 'Restarting to update…' });
    let failed = null;
    const onError = e => { failed = e ?? new Error('unknown error'); };
    updater.on('error', onError);
    beforeRestart();
    try {
      updater.quitAndInstall(true, true);
    } catch (e) {
      failed = e;
    } finally {
      updater.removeListener('error', onError);
    }
    if (!failed) return true;
    log(`update install failed: ${failed?.message ?? failed}`);
    restartFailed();
    set({ status: 'error', message: "Couldn't start the update installer. Get the update from the Releases page.", releasePage: true });
    return false;
  }

  function schedule() {
    timers.clearTimeout(timeout);
    timers.clearInterval(interval);
    timeout = interval = null;
    if (mode === 'off' || !state.auto || stopped) return;
    const auto = () => { check(); };
    timeout = timers.setTimeout(auto, CHECK_DELAY_MS);
    interval = timers.setInterval(auto, CHECK_INTERVAL_MS);
  }

  return {
    state: snapshot,
    check,
    restart,
    /** Read the setting and schedule the automatic checks (10 s after start, then every 6 hours). */
    async start() {
      try {
        state = { ...state, auto: (await settings.get()).auto };
      } catch (e) {
        log(`update settings: ${e?.message ?? e}`);
      }
      schedule();
      onState(snapshot());
      return snapshot();
    },
    /** Turn the automatic checks on or off; resolves to the state. */
    async setAuto(on) {
      const saved = await settings.set({ auto: on === true });
      set({ auto: saved.auto });
      schedule();
      return snapshot();
    },
    stop() {
      stopped = true;
      schedule();
    },
  };
}
