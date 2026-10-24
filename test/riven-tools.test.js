// Riven tools (docs/port-rivens.md 13): stat lists, positive sets, theoretical rivens, the setup's options, and Slot My
// Riven, Auto Riven, Rolls data and the compare on Braton Prime with a fake scorer (whose best answer is known), then a
// short real-engine run of each through the job. Tests that need the private core data skip without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as AS from '../src/shared/auto-build-settings.js';
import * as AB from '../src/shared/auto-build.js';
import * as RT from '../src/shared/riven-tools.js';
import { effectiveValue, rivenStatCatalogue, validateRiven } from '../src/shared/rivens.js';
import { buildAppState } from '../src/shared/engine-input.js';
import * as M from '../src/renderer/model.js';
import { runRivenToolJob } from '../src/renderer/riven-tool-job.js';

const coreDir = fileURLToPath(new URL('../core/', import.meta.url));
const hasCore = existsSync(coreDir + 'engine/dps_calculator.wasm') && existsSync(coreDir + 'data/data.json');
const skip = hasCore ? false : 'core submodule not checked out';

let cached = null;
function real() {
  if (!cached) {
    const data = JSON.parse(readFileSync(coreDir + 'data/data.json', 'utf8'));
    cached = { data, ctx: M.createContext(data) };
  }
  return cached;
}

const BASE_MODS = [{ name: 'Serration', rank: 10 }, { name: 'Split Chamber', rank: 5 }, { name: 'Point Strike', rank: 5 }, { name: 'Vital Sense', rank: 5 }, null, null, null, null, null];

function envFor({ mods = BASE_MODS, settings = {} } = {}) {
  const { data, ctx } = real();
  const weapon = ctx.weaponByName.get('Braton Prime');
  const build = { ...M.createBuild(ctx, { weaponName: 'Braton Prime' }), mods: mods.slice() };
  const enemy = M.resolveEnemy(ctx, build.enemy);
  const s = AS.normalizeAutoBuildSettings(settings, data);
  return { env: AB.createAutoBuildEnv({ data, weapon, reload: ctx.reloadByName.get(weapon.name), build, enemy, settings: s, index: ctx.index }), build, data, ctx, weapon };
}

const hash = s => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
/** How much a fake riven stat is worth per point of effective value: crit and multishot most, Zoom nothing. */
const WORTH = { 'Critical Chance': 900, Multishot: 800, 'Critical Damage': 500, BaseDamage: 400, ColdDamage: 5000, Zoom: 0 };

/** A deterministic engine stand-in: each mod adds a fixed amount by name, a riven its stats by WORTH (others 50, negatives cost 300 per point). */
function fakeScorer(log = []) {
  return async jobs => {
    log.push(...jobs.map(j => j.seeds.length));
    return jobs.map(j => j.mods.reduce((t, m) => {
      if (!m) return t;
      if (m.isRiven) {
        return t + m.stats.reduce((u, st) => {
          const v = effectiveValue(st, m);
          return u + (v >= 0 ? v * (WORTH[st.name] ?? 50) : st.name === 'Zoom' ? 0 : v * 300);
        }, 0);
      }
      return t + 100 + (hash(m.name) % 97);
    }, 1000));
  };
}

// ---------- pure parts ----------

test('positive sets: all 2s and 3s, forced stats in every one, the site\'s errors', () => {
  const four = ['a', 'b', 'c', 'd'];
  assert.equal(RT.positiveCombos(four).length, 6 + 4);
  const forced = RT.positiveCombos(four, ['a']);
  assert.equal(forced.length, 3 + 3);
  assert.ok(forced.every(c => c[0] === 'a'));
  assert.deepEqual(RT.positiveCombos(four, ['a', 'b']), [['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'd']]);
  assert.throws(() => RT.normalizeForcedPositives(['a', 'b', 'c']), /only force up to 2/);
  assert.throws(() => RT.normalizeForcedPositives(['ViralDamage', 'Status Damage']), /one spliced/);
  assert.throws(() => RT.positiveCombos(four, ['x']), /not available/);
  assert.deepEqual(RT.positiveCombos(['a']), []);
});

test('options are clamped and raw damage wins over status damage', () => {
  const o = RT.normalizeRivenToolOptions({ sampleCount: 999, simulationTimeSeconds: 0, statValue: 1, protectedSlots: [0, 8, '3', 3], optimization: { buildForRawDamage: true, buildForStatusDamage: true } });
  assert.equal(o.sampleCount, 200);
  assert.equal(o.simulationTimeSeconds, 1);
  assert.equal(o.statValue, 9000);
  assert.deepEqual(o.protectedSlots, [0, 3]);
  assert.equal(o.optimization.buildForStatusDamage, false);
  assert.equal(o.preserveElementalCombo, true);
  const d = RT.normalizeRivenToolOptions({});
  assert.equal(d.sampleCount, 50);
  assert.equal(d.simulationTimeSeconds, 5);
  assert.equal(d.statValue, 11000);
});

test('roll stat lists for a rifle: no element or Punch Through as a negative, Zoom first to try', { skip }, () => {
  const { data, weapon } = envFor();
  const pos = RT.rollPositiveStats(data, weapon);
  assert.equal(pos[0], 'BaseDamage');
  assert.ok(pos.includes('Critical Chance') && pos.includes('ViralDamage') && pos.includes('Damage vs.Grineer'));
  const neg = RT.rollNegativeStats(data, weapon);
  assert.ok(neg.includes('Zoom'));
  for (const no of ['Punch Through', 'HeatDamage', 'ViralDamage', 'Status Damage']) assert.ok(!neg.includes(no), no);
  assert.deepEqual(neg, neg.slice().sort((a, b) => a.localeCompare(b)));
});

test('a theoretical riven rolls each stat at the chosen share of its mid value and validates', { skip }, () => {
  const { data, weapon } = envFor();
  const cat = new Map(rivenStatCatalogue(data, weapon).map(e => [e.key, e]));
  const r = RT.theoreticalRiven(data, weapon, ['Critical Chance', 'Multishot'], 'Zoom', 1.1);
  assert.equal(r.family, 'Braton');
  assert.equal(r.stats.length, 3);
  assert.ok(Math.abs(r.stats[0].value - cat.get('Critical Chance').base * 1.2375 * 1.1) < 1e-12);
  assert.ok(Math.abs(r.stats[2].value - cat.get('Zoom').base * -0.495 * 1.1) < 1e-12);
  assert.ok(validateRiven(r, { data, weapon }).ok);
  const three = RT.theoreticalRiven(data, weapon, ['Critical Chance', 'Multishot', 'BaseDamage'], 'Zoom', 0.9);
  assert.ok(Math.abs(three.stats[1].value - cat.get('Multishot').base * 0.9375 * 0.9) < 1e-12);
  assert.equal(RT.theoreticalRiven(data, weapon, ['ViralDamage', 'Status Damage'], 'Zoom'), null);
  assert.equal(RT.theoreticalRiven(data, weapon, ['Critical Chance', 'Multishot'], 'Status Damage'), null);
  assert.equal(RT.theoreticalRiven(data, weapon, ['Critical Chance'], 'Zoom'), null);
});

test('the auto build cache tells rivens apart by their rolls', { skip }, () => {
  const { env, data, weapon } = envFor({ mods: Array(9).fill(null) });
  const heat = RT.theoreticalRiven(data, weapon, ['HeatDamage', 'Multishot'], 'Zoom');
  const cold = RT.theoreticalRiven(data, weapon, ['ColdDamage', 'Multishot'], 'Zoom');
  const at0 = r => [r, ...Array(8).fill(null)];
  assert.deepEqual(AB.elementSignature(env, at0(heat)), ['Heat']);
  assert.deepEqual(AB.elementSignature(env, at0(cold)), ['Cold']);
});

// ---------- the tools on a fake scorer ----------

test('Slot My Riven picks the best riven and slot, and the best that keeps the elements', { skip }, async () => {
  const { env, build, data, weapon } = envFor({ mods: [{ name: 'Serration', rank: 10 }, { name: 'Hellfire', rank: 5 }, { name: 'Infected Clip', rank: 5 }, null, null, null, null, null, null] });
  const crit = { ...RT.theoreticalRiven(data, weapon, ['Critical Chance', 'Multishot'], 'Zoom'), id: 'crit' };
  const cold = { ...RT.theoreticalRiven(data, weapon, ['ColdDamage', 'Critical Chance', 'Multishot'], 'Zoom'), id: 'cold' };
  const other = { ...RT.theoreticalRiven(data, weapon, ['Critical Chance', 'Multishot'], 'Zoom'), id: 'other', family: 'Lanka', name: 'Lanka Riven Mod' };
  const log = [];
  const r = await RT.slotMyRiven(env, { build, rivens: [crit, cold, other], options: { sampleCount: 7 }, score: fakeScorer(log) });
  assert.equal(log[0], RT.BASELINE_RUNS.slot);
  assert.ok(log.slice(1).every(n => n === 7));
  assert.equal(r.placements, 2 * 8, 'two Braton rivens in all eight general slots, filled or empty');
  assert.ok(r.best && r.best.score > r.baseline);
  assert.deepEqual(r.originalElements, ['Gas']);
  // The cold riven turns Gas into something else; the crit riven keeps Gas.
  assert.equal(r.bestSameElements.riven.id, 'crit');
  assert.equal(r.best.riven.id, 'cold');
  assert.equal(r.best.changesElements, true);
  assert.ok(r.best.slot >= 3, 'an empty slot beats replacing a mod');
  await assert.rejects(RT.slotMyRiven(env, { build, rivens: [crit], options: { excludedStats: ['Multishot'] }, score: fakeScorer() }), /No rivens remain/);
  await assert.rejects(RT.slotMyRiven(env, { build, rivens: [other], options: {}, score: fakeScorer() }), /no rivens for this weapon/);
  await assert.rejects(RT.slotMyRiven(env, { build: { ...build, mods: [crit, ...build.mods.slice(1)] }, rivens: [cold], options: {}, score: fakeScorer() }), /cannot run while a Riven/);
});

test('Auto Riven finds the fake engine\'s best roll, the forced negative, and keeps elements', { skip }, async () => {
  const { env, build } = envFor();
  const log = [];
  const r = await RT.autoRiven(env, { build, options: { sampleCount: 2 }, score: fakeScorer(log) });
  assert.equal(r.improved, true);
  assert.deepEqual(r.positives.slice().sort(), ['Critical Chance', 'Multishot']);
  assert.equal(r.negative, 'Zoom');
  assert.equal(r.riven.stats.length, 3);
  assert.ok(r.score > r.baseline);
  assert.ok(r.slot <= 3, 'replaces a filled slot (Auto Riven never uses an empty one)');
  assert.ok(log.includes(6) && log.includes(2) && log.includes(20), 'baseline 20, phase 1 at 2, phase 2 and 4 at 6');
  const forced = await RT.autoRiven(env, { build, options: { sampleCount: 1, negativeStat: 'Ammo Maximum', forcedPositiveStats: ['BaseDamage'], excludedStats: ['Critical Chance'] }, score: fakeScorer() });
  assert.equal(forced.negative, 'Ammo Maximum');
  assert.ok(forced.positives.includes('BaseDamage') && !forced.positives.includes('Critical Chance'));
  const protectedAll = RT.autoRiven(env, { build, options: { protectedSlots: [0, 1, 2, 3] }, score: fakeScorer() });
  await assert.rejects(protectedAll, /No eligible mods remain/);
});

test('Auto Riven with minor tweaks swaps a weak mod around the riven when it gains', { skip }, async () => {
  const { env, build } = envFor({ mods: [{ name: 'Serration', rank: 10 }, { name: 'Point Strike', rank: 5 }, { name: 'Vital Sense', rank: 5 }, { name: 'Split Chamber', rank: 5 }, { name: 'Speed Trigger', rank: 5 }, { name: 'Stormbringer', rank: 5 }, { name: 'Hellfire', rank: 5 }, { name: 'Infected Clip', rank: 5 }, null] });
  // Speed Trigger is worth least to the fake engine: a tweak replaces it with something worth more.
  const scorer = fakeScorer();
  const r = await RT.autoRiven(env, { build, options: { sampleCount: 1, allowMinorBuildTweaks: true, preserveElementalCombo: false }, score: scorer });
  assert.equal(r.improved, true);
  assert.ok(Array.isArray(r.tweaks));
  for (const t of r.tweaks) assert.notEqual(t.from, t.to);
  assert.equal(r.mods.filter(m => m?.isRiven).length, 1);
});

test('Rolls data: every set with the chosen negative in every slot, sorted, as the site\'s CSV', { skip }, async () => {
  const { env, build, data, weapon } = envFor();
  await assert.rejects(RT.rollsData(env, { build, options: {}, score: fakeScorer() }), /Select a negative stat/);
  const r = await RT.rollsData(env, { build, options: { sampleCount: 1, negativeStat: 'Zoom', excludedStats: RT.rollPositiveStats(data, weapon).filter(s => !['Critical Chance', 'Multishot', 'BaseDamage'].includes(s)) }, score: fakeScorer() });
  assert.equal(r.rows.length, 4 * 8, '3 pairs + 1 triple in 8 slots');
  const lines = r.csv.split('\n');
  assert.equal(lines[0], 'positives,replaced_mod,dps_delta_percent');
  assert.equal(lines.length, 33);
  assert.match(lines[1], /^Critical Chance \+ Multishot( \+ Damage)?,Slot [5-8],\+\d+\.\d\d%$/);
  assert.ok(lines.some(l => l.includes(',Serration,')));
  for (let i = 1; i < r.rows.length; i++) assert.ok(r.rows[i - 1].finalScore >= r.rows[i].finalScore);
  assert.equal(r.fileName, 'braton-prime-rolls-data.csv');
  const t = await RT.rollsData(env, { build, options: { sampleCount: 1, negativeStat: 'Zoom', allowMinorBuildTweaks: true, excludedStats: RT.rollPositiveStats(data, weapon).filter(s => !['Critical Chance', 'Multishot'].includes(s)) }, score: fakeScorer() });
  assert.equal(t.csv.split('\n')[0], 'positives,replaced_mod,dps_delta_percent,negative_stat,riven_replaced_mod,one_slot_dps_delta_percent,final_dps_delta_percent,tweak_count,extra_swaps,tweak_refined');
  assert.match(t.csv.split('\n')[1], /,Zoom,/);
});

test('CSV quoting and file names follow the site', () => {
  assert.equal(RT.rowsToCsv([['a,b', 'c"d', 'e\nf', null, 1]]), '"a,b","c""d","e\nf",,1');
  assert.equal(RT.slugify('Braton Prime  (Crit)'), 'braton-prime-crit');
  assert.equal(RT.slugify(''), 'build');
});

test('the compare scores each riven in every slot, or in the equipped riven\'s slot only', { skip }, async () => {
  const { env, build, data, weapon } = envFor();
  const a = { ...RT.theoreticalRiven(data, weapon, ['Critical Chance', 'Multishot'], 'Zoom'), id: 'a' };
  const b = { ...RT.theoreticalRiven(data, weapon, ['BaseDamage', 'Punch Through'], 'Zoom'), id: 'b' };
  const r = await RT.compareRivens(env, { build, rivens: [a, b], score: fakeScorer() });
  assert.equal(r.sides.length, 2);
  assert.ok(r.sides[0].best.score > r.sides[1].best.score);
  assert.equal(r.replacesEquipped, false);
  const withRiven = { ...build, mods: [a, ...build.mods.slice(1)] };
  const again = await RT.compareRivens(env, { build: withRiven, rivens: [a, b], score: fakeScorer() });
  assert.equal(again.replacesEquipped, true);
  assert.equal(again.sides[1].best.slot, 0);
});

// ---------- the real engine ----------

async function enginePool(appState) {
  const createDpsModule = createRequire(import.meta.url)(coreDir + 'engine/dps_calculator.js');
  const engine = await createDpsModule({ wasmBinary: readFileSync(coreDir + 'engine/dps_calculator.wasm') });
  engine.cache_app_state(1, appState);
  return {
    run: async tasks => tasks.map(t => {
      let sum = 0;
      let count = 0;
      for (const seed of t.seeds) {
        engine.seed_rng(seed);
        const r = JSON.parse(engine.calculate_dps_wasm(t.input));
        if (Number.isFinite(r[t.metric])) { sum += r[t.metric]; count++; }
      }
      return { sum, count, errors: t.seeds.length - count, error: null };
    }),
  };
}

test('real engine: Auto Riven and Rolls data on Braton Prime beat the build; Slot My Riven proposes', { skip }, async () => {
  const { ctx, data, weapon, build } = envFor();
  const full = { ...build, mods: BASE_MODS.slice() };
  const pool = await enginePool(JSON.stringify(buildAppState(data, weapon)));
  const settings = AS.defaultAutoBuildSettings(data);
  const only = RT.rollPositiveStats(data, weapon).filter(s => !['Critical Chance', 'Multishot', 'BaseDamage', 'Critical Damage'].includes(s));
  const auto = await runRivenToolJob({ ctx, build: full, tool: 'auto', options: { sampleCount: 1, excludedStats: only, negativeStat: 'Zoom', simulationTimeSeconds: 2 }, settings, pool });
  assert.equal(auto.improved, true);
  assert.ok(auto.readout.proposals.auto > auto.readout.before, `${auto.readout.before} -> ${auto.readout.proposals.auto}`);
  const rolls = await runRivenToolJob({ ctx, build: full, tool: 'rolls', options: { sampleCount: 1, excludedStats: only, negativeStat: 'Zoom', simulationTimeSeconds: 2 }, settings, pool });
  assert.equal(rolls.rows.length, 10 * 8, '6 pairs and 4 triples of 4 stats, in 8 slots');
  assert.ok(rolls.rows[0].gain > 0);
  assert.equal(rolls.readout, null);
  const mine = { ...auto.riven, id: 'mine' };
  const slot = await runRivenToolJob({ ctx, build: full, tool: 'slot', options: { sampleCount: 1, simulationTimeSeconds: 2 }, rivens: [mine], settings, pool });
  assert.ok(slot.best);
  assert.ok(slot.readout.proposals.best > slot.readout.before);
});

test('the Forma plan polarises a riven\'s slot (Omni halves in any polarity but Umbra)', { skip }, () => {
  const { data, ctx, weapon } = envFor();
  const riven = RT.theoreticalRiven(data, weapon, ['Critical Chance', 'Multishot'], 'Zoom');
  const build = { ...M.createBuild(ctx, { weaponName: 'Braton Prime' }), catalyst: false };
  const mods = [riven, { name: 'Serration', rank: 10 }, null, null, null, null, null, null, null];
  const s = AS.normalizeAutoBuildSettings({ costControlEnabled: true, maxForma: 1 }, data);
  const env = AB.createAutoBuildEnv({ data, weapon, reload: ctx.reloadByName.get(weapon.name), build: { ...build, mods }, enemy: M.resolveEnemy(ctx, build.enemy), settings: s, index: ctx.index });
  const plan = AB.capacityPlan(env, mods);
  assert.ok(plan, 'fits with one Forma');
  assert.equal(plan.polarities[0], AB.RIVEN_FORMA_POLARITY);
  assert.equal(plan.added, 1);
});
