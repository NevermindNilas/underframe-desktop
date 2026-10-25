// Build a release and upload it to GitHub as a DRAFT (docs/releasing.md): `npm run dist` without publishing, then
// SHA256SUMS.txt for the two exes, then `gh release create --draft` with both exes, the .blockmap files, latest.yml
// (what installed copies update from) and SHA256SUMS.txt. Publishing the draft is left to a person, on GitHub.
//
//   npm run release -- <notes.md> [--dry-run]
//
// --dry-run runs the checks (version, notes, git, gh, the existing releases) and prints the plan; it builds nothing
// and creates nothing.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const { owner, repo } = pkg.build.publish.find(p => p.provider === 'github');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const notesArg = args.find(a => !a.startsWith('--'));

function run(cmd, cmdArgs, { inherit = false, shell = false } = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8', shell, stdio: inherit ? 'inherit' : 'pipe' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? r.error?.message ?? '').trim() };
}

/** YYYY.M.D (no leading zeros, a real date) as [y, m, d], else null. */
function parseVersion(v) {
  const m = /^(\d{4})\.([1-9]\d?)\.([1-9]\d?)$/.exec(String(v));
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? [y, mo, d] : null;
}

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');

const version = pkg.version;
const tag = `v${version}`;
const setup = `Underframe-Desktop-Setup-${version}.exe`;
const portable = `Underframe-Desktop-${version}-Portable.exe`;
const problems = [];
const warnings = [];

// Version: the release date, newer than every release (one release per day).
const parsed = parseVersion(version);
if (!parsed) problems.push(`package.json version ${version} is not a release date (YYYY.M.D, no leading zeros).`);
const now = new Date();
if (parsed && compare(parsed, [now.getFullYear(), now.getMonth() + 1, now.getDate()]) !== 0) {
  warnings.push(`version ${version} is not today's date.`);
}

// Notes.
let notes = '';
if (!notesArg) problems.push('No release notes file: npm run release -- <notes.md>.');
else if (!existsSync(notesArg)) problems.push(`Release notes file not found: ${notesArg}`);
else notes = readFileSync(notesArg, 'utf8').trim();

// Git: a clean tree whose commit is on GitHub, so the tag points at what was built.
const head = run('git', ['rev-parse', 'HEAD']).out;
if (run('git', ['status', '--porcelain']).out) problems.push('The working tree has uncommitted changes.');
if (!run('git', ['merge-base', '--is-ancestor', 'HEAD', 'origin/main']).ok) problems.push('HEAD is not on origin/main: push it first.');

// gh, and the releases already there.
if (!run('gh', ['auth', 'status']).ok) problems.push('gh is not installed or not signed in (gh auth login).');
else {
  const list = run('gh', ['release', 'list', '--repo', `${owner}/${repo}`, '--limit', '50', '--json', 'tagName,isDraft']);
  if (!list.ok) problems.push(`Couldn't list the releases: ${list.err}`);
  else {
    for (const r of JSON.parse(list.out || '[]')) {
      const v = parseVersion(String(r.tagName).replace(/^v/, ''));
      if (parsed && v && compare(v, parsed) >= 0) {
        problems.push(`${r.isDraft ? 'Draft release' : 'Release'} ${r.tagName} is not older than ${tag}: bump the version (one release per day).`);
      }
    }
  }
}

const assets = [setup, `${setup}.blockmap`, portable, `${portable}.blockmap`, 'latest.yml', 'SHA256SUMS.txt'];
console.log(`Release ${tag} of ${owner}/${repo}${dryRun ? ' (dry run)' : ''}`);
console.log(`  1. npm run dist -- --publish never`);
console.log(`  2. write dist/SHA256SUMS.txt for ${setup} and ${portable}`);
console.log(`  3. gh release create ${tag} --draft --target ${head || '<HEAD>'} --title "Underframe Desktop ${version}" --notes-file dist/release-notes.md`);
console.log(`     with ${assets.join(', ')} (a .blockmap only when electron-builder made one)`);
console.log(`  4. publish the draft on GitHub (docs/releasing.md)`);
for (const w of warnings) console.log(`Warning: ${w}`);
for (const p of problems) console.log(`${dryRun ? 'Would stop' : 'Stopped'}: ${p}`);
if (dryRun || problems.length) process.exit(problems.length ? 1 : 0);

// 1. Build.
if (!run('npm', ['run', 'dist', '--', '--publish', 'never'], { inherit: true, shell: true }).ok) {
  console.error('The build failed.');
  process.exit(1);
}
for (const name of [setup, portable, 'latest.yml']) {
  if (!existsSync(path.join(dist, name))) {
    console.error(`Missing dist/${name} after the build.`);
    process.exit(1);
  }
}
const latest = readFileSync(path.join(dist, 'latest.yml'), 'utf8');
if (!latest.includes(`version: ${version}`) || !latest.includes(`path: ${setup}`)) {
  console.error(`dist/latest.yml does not describe ${setup} ${version}.`);
  process.exit(1);
}

// 2. Checksums, also in the notes (as in the first release).
const sums = [setup, portable].map(name => `${sha256(path.join(dist, name))}  ${name}`).join('\n') + '\n';
writeFileSync(path.join(dist, 'SHA256SUMS.txt'), sums, 'utf8');
const body = notes.includes('SHA256SUMS') ? notes : `${notes}\n\n## Checksums (SHA-256)\n\nAlso attached as \`SHA256SUMS.txt\`.\n\n\`\`\`\n${sums}\`\`\`\n`;
writeFileSync(path.join(dist, 'release-notes.md'), body, 'utf8');

// 3. The draft.
const files = assets.map(name => path.join(dist, name)).filter(existsSync);
const created = run('gh', [
  'release', 'create', tag, '--repo', `${owner}/${repo}`, '--draft', '--target', head,
  '--title', `Underframe Desktop ${version}`, '--notes-file', path.join(dist, 'release-notes.md'), ...files,
], { inherit: true });
if (!created.ok) {
  console.error('gh release create failed.');
  process.exit(1);
}
console.log(`Draft ${tag} created with ${files.map(f => path.basename(f)).join(', ')}. Review and publish it on GitHub.`);
