// Outbound policy: which links may open in the system browser, and the upstream data-version check.

export const EXTERNAL_HOSTS = new Set(['www.underframe.site', 'underframe.site', 'discord.gg', 'github.com']);
export const UPSTREAM_VERSION_URL = 'https://www.underframe.site/api/version';

/** Only plain https links to the allowlisted hosts (no credentials, default port). */
export function isAllowedExternal(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return false;
  }
  return u.protocol === 'https:' && !u.username && !u.password && u.port === '' && EXTERNAL_HOSTS.has(u.hostname);
}

/**
 * Compare the bundled data version with underframe.site's. Never throws:
 * failures come back as {local, remote: null, outdated: false, error}.
 */
export async function checkUpstream(local, { fetch = globalThis.fetch, timeoutMs = 8000 } = {}) {
  try {
    const res = await fetch(UPSTREAM_VERSION_URL, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const remote = typeof body?.version === 'string' ? body.version : null;
    if (!remote) throw new Error('response has no version');
    return { local: local ?? null, remote, outdated: Boolean(local) && remote !== local };
  } catch (e) {
    return { local: local ?? null, remote: null, outdated: false, error: String(e?.message ?? e) };
  }
}
