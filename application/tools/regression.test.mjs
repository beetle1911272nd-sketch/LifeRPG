// Compare the extracted battle core with the v1.0.9 implementation.
// Run with: node tools/regression.test.mjs
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const core = await import(pathToFileURL(path.join(here, "../sandbox/battle-core.js")).href);
const originalSrc = fs.readFileSync(path.join(here, "fixtures/app_generated.v1.0.9.jsx"), "utf8");
const patchedSrc = fs.readFileSync(path.join(here, "../app.generated.jsx"), "utf8");

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (src, from, to) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a < 0 || b < 0) throw new Error(`anchor not found: ${from} / ${to}`);
  return src.slice(a, b);
};

const deps = (src) => [
  between(src, "const EQUIPMENT_ITEMS = [", "const RARITY_META"),
  between(src, "const EQUIP_SLOTS", "const DUNGEON_DROP_TABLE"),
  between(src, "const JOB_STAT_MODIFIERS", "const DIFFICULTY_MULTIPLIERS"),
  "function jobStatModifier(job, stat) { return JOB_STAT_MODIFIERS[job?.name]?.[stat] || 1; }",
].join("\n");
const exportsList = "({ EQUIPMENT_ITEMS, EQUIP_SLOTS, JOB_STAT_MODIFIERS, playerCombatStats, createBattle, equipmentBonuses, monsterAt: typeof monsterAt === 'function' ? monsterAt : undefined, DUNGEON_FLOORS: typeof DUNGEON_FLOORS !== 'undefined' ? DUNGEON_FLOORS : undefined, dungeonTier: typeof dungeonTier === 'function' ? dungeonTier : undefined, timingCycleMs: typeof timingCycleMs === 'function' ? timingCycleMs : undefined, timingQuality: typeof timingQuality === 'function' ? timingQuality : undefined, resolveBattleTurn: typeof resolveBattleTurn === 'function' ? resolveBattleTurn : undefined, resolveTimingHit: typeof resolveTimingHit === 'function' ? resolveTimingHit : undefined })";

const original = (() => {
  const code = deps(originalSrc) + "\n" + between(originalSrc, "const DUNGEON_MONSTERS", "function levelExp") + "\n" + exportsList;
  const ctx = { Math: Object.create(Math), performance, console };
  ctx.Math.random = () => { throw new Error("unseeded Math.random in original"); };
  return { api: vm.runInNewContext(code, ctx), ctx };
})();

const patched = (() => {
  const wrapperRegion = between(patchedSrc, "function normalizeDungeonDaily", "function levelExp");
  const code = deps(patchedSrc) + "\n" + wrapperRegion + "\n" + exportsList;
  const ctx = {
    Math: Object.create(Math),
    console,
    computeCombatStats: core.computeCombatStats,
    createBattleCore: (combat, floor) => core.createBattle(combat, floor, false),
    monsterAt: core.monsterAt,
    dungeonTier: core.dungeonTier,
    DUNGEON_FLOORS: core.DUNGEON_FLOORS,
    timingCycleMs: core.timingCycleMs,
    timingQuality: core.timingQuality,
    resolveBattleTurn: (battle, combat, command, quality, itemEffect) =>
      core.resolveBattleTurn(battle, combat, command, quality, itemEffect, Math.random, false),
    resolveTimingHit: (battle, combat, quality) =>
      core.resolveTimingHit(battle, combat, quality, Math.random, false),
    createDungeonDefaults: () => ({}),
  };
  return { api: vm.runInNewContext(code, ctx), ctx };
})();

let checks = 0;
const failures = [];
const same = (label, a, b) => {
  checks++;
  const A = JSON.stringify(a);
  const B = JSON.stringify(b);
  if (A !== B && failures.length < 8) failures.push(`${label}\n   old: ${A}\n   new: ${B}`);
};

const JOB_NAMES = [null, "勇者", "賢者", "剣士", "狩人", "錬金術師", "王", "冒険者", "騎士", "商人", "吟遊詩人"];
const STAT_KEYS = ["STR", "INT", "AGI", "VIT", "DEX", "CHA", "FIN", "WILL"];
const equipIds = {
  weapon: [null, ...original.api.EQUIPMENT_ITEMS.filter((i) => i.slot === "weapon").map((i) => i.id)],
  armor: [null, ...original.api.EQUIPMENT_ITEMS.filter((i) => i.slot === "armor").map((i) => i.id)],
  accessory: [null, ...original.api.EQUIPMENT_ITEMS.filter((i) => i.slot === "accessory").map((i) => i.id)],
};
const pick = (random, values) => values[Math.floor(random() * values.length)];
const ITEM_EFFECTS = [
  { name: "回復薬", heal: 0.3 },
  { name: "簡易回復薬", heal: 0.15 },
  { name: "エリクサー", heal: 1 },
  { name: "力の粉薬", buff: 1.5 },
  { name: "狂戦士の秘薬", buff: 2.5 },
  undefined,
];

same("LEGACY_DUNGEON_FLOORS", original.api.DUNGEON_FLOORS, core.LEGACY_DUNGEON_FLOORS);
for (let floor = -1; floor <= 12; floor++) {
  same(`monsterAt(${floor})`, original.api.monsterAt(floor), core.monsterAt(floor, false));
  same(`dungeonTier(${floor})`, original.api.dungeonTier(floor), core.dungeonTier(floor));
  same(`timingCycleMs(${floor})`, original.api.timingCycleMs(floor), core.timingCycleMs(floor));
}
same("timingQualityAtPosition(50)", core.timingQualityAtPosition(50), { label: "PERFECT", mult: 1.7, tier: "perfect" });
same("timingQualityAtPosition(41)", core.timingQualityAtPosition(41), { label: "PERFECT", mult: 1.7, tier: "perfect" });
same("timingQualityAtPosition(40)", core.timingQualityAtPosition(40), { label: "GOOD", mult: 1.1, tier: "good" });
same("timingQualityAtPosition(28)", core.timingQualityAtPosition(28), { label: "GOOD", mult: 1.1, tier: "good" });
same("timingQualityAtPosition(27)", core.timingQualityAtPosition(27), { label: "MISS", mult: 0.55, tier: "miss" });
same("timingQualityAtPosition(59)", core.timingQualityAtPosition(59), { label: "PERFECT", mult: 1.7, tier: "perfect" });
same("timingQualityAtPosition(60)", core.timingQualityAtPosition(60), { label: "GOOD", mult: 1.1, tier: "good" });
same("timingQualityAtPosition(72)", core.timingQualityAtPosition(72), { label: "GOOD", mult: 1.1, tier: "good" });
same("timingQualityAtPosition(72.01)", core.timingQualityAtPosition(72.01), { label: "MISS", mult: 0.55, tier: "miss" });
same("battle v2 is enabled", core.BATTLE_V2_ENABLED, true);
same("v2 floor tuning", core.DUNGEON_FLOORS.map(({ hp, atk, def }) => [hp, atk, def]), [
  [390, 23, 4], [470, 24, 5], [500, 24, 7], [560, 27, 8], [600, 27, 10],
  [600, 28, 11], [780, 31, 13], [700, 28, 14], [760, 30, 16], [1250, 20, 20],
]);
{
  const battle = {
    monster: "test",
    monsterHp: 100,
    monsterAtk: 30,
    monsterDef: 0,
    playerHp: 200,
    playerMaxHp: 200,
    log: [],
  };
  const v2Battle = { ...battle, version: 2 };
  const combat = { atk: 0, skillPower: 0, def: 20 };
  const quality = { label: "MISS", mult: 0 };
  const legacyHit = core.resolveBattleTurn(battle, combat, "attack", quality, undefined, () => 0, false);
  const unversionedHit = core.resolveBattleTurn(battle, combat, "attack", quality, undefined, () => 0, true);
  const v2Hit = core.resolveBattleTurn(v2Battle, combat, "attack", quality, undefined, () => 0, true);
  same("legacy incoming damage remains selectable", battle.playerHp - legacyHit.playerHp, 16);
  same("unversioned saved battles stay legacy", battle.playerHp - unversionedHit.playerHp, 16);
  same("v2 percentage mitigation", battle.playerHp - v2Hit.playerHp, 20);
  same("new battle records version", core.createBattle({ maxHp: 100 }, 1).version, 4);
  same("legacy battle has no version marker", core.createBattle({ maxHp: 100 }, 1, false).version, undefined);
}
{
  const battleId = "reward-once";
  const state = {
    level: 1,
    exp: 190,
    currency: 10,
    ownedEquipment: [],
    equipment: { weapon: null },
    dungeon: {
      currentFloor: 1,
      bestFloor: 0,
      battle: {
        battleId,
        floor: 1,
        phase: "won",
        reward: { exp: 30, gold: 17, alreadyCleared: false, drop: { id: "test-sword", slot: "weapon", rarity: "rare", icon: "S", name: "Test Sword" } },
      },
    },
  };
  same("reward preview includes level-up currency", core.previewBattleReward(state, state.dungeon.battle.reward), {
    exp: 20,
    level: 2,
    levelsGained: 1,
    currency: 77,
  });
  const result = core.claimBattleReward(state, battleId, state.dungeon.battle);
  same("win reward can be claimed", result.claimed, true);
  same("reward crossing a level threshold", [result.state.level, result.state.exp, result.state.currency], [2, 20, 87]);
  same("reward equipment ownership", [result.state.ownedEquipment, result.state.equipment.weapon], [["test-sword"], "test-sword"]);
  same("claim leaves input unchanged", state.dungeon.battle.phase, "won");
  const duplicate = core.claimBattleReward(result.state, battleId, state.dungeon.battle);
  same("duplicate claim rejected", duplicate.claimed, false);
  same("duplicate claim has no reward", duplicate.reward, null);
  same("unrelated battle claim rejected", core.claimBattleReward(state, "another-battle", state.dungeon.battle).claimed, false);
}

{
  const random = mulberry32(1);
  for (let i = 0; i < 20000; i++) {
    const elapsed = Math.floor(random() * 6000) - 500;
    const floor = 1 + Math.floor(random() * 10);
    same(`timingQuality(${elapsed},${floor})`, original.api.timingQuality(elapsed, floor), core.timingQuality(elapsed, floor));
  }
}

const scenarios = 3000;
for (let n = 0; n < scenarios; n++) {
  const random = mulberry32(1000 + n);
  const stats = {};
  STAT_KEYS.forEach((key) => {
    if (random() > 0.1) stats[key] = 20 + Math.floor(random() * 81);
  });
  const state = {
    level: random() > 0.05 ? 1 + Math.floor(random() * 40) : undefined,
    stats: random() > 0.03 ? stats : undefined,
    job: { name: pick(random, JOB_NAMES) },
    equipment: {
      weapon: pick(random, equipIds.weapon),
      armor: pick(random, equipIds.armor),
      accessory: pick(random, equipIds.accessory),
    },
  };
  if (!state.job.name) state.job = null;
  const combatOld = original.api.playerCombatStats(state);
  const combatNew = patched.api.playerCombatStats(state);
  same(`combat#${n}`, combatOld, combatNew);
  const floor = 1 + Math.floor(random() * 10);
  let battleOld = original.api.createBattle(state, floor);
  const battleNew = patched.api.createBattle(state, floor);
  same(`createBattle#${n}`, battleOld, battleNew);

  for (let turn = 0; turn < 40 && battleOld.phase !== "won" && battleOld.phase !== "lost"; turn++) {
    const seed = Math.floor(random() * 1e9);
    const kind = pick(random, ["attack", "attack", "skill", "defend", "item"]);
    const quality = original.api.timingQuality(Math.floor(random() * 4000), floor);
    const effect = pick(random, ITEM_EFFECTS);
    original.ctx.Math.random = mulberry32(seed);
    let nextOld;
    let nextNew;
    if (kind === "attack" || kind === "skill") {
      const pending = {
        ...battleOld,
        pendingCommand: kind,
        phase: "timing",
        skillUsesLeft: kind === "skill" ? Math.max(1, battleOld.skillUsesLeft) : battleOld.skillUsesLeft,
      };
      nextOld = original.api.resolveTimingHit(pending, combatOld, quality);
      nextNew = core.resolveTimingHit({ ...pending }, combatNew, quality, mulberry32(seed), false);
      const savedRandom = Math.random;
      let viaDefault;
      try {
        Math.random = mulberry32(seed);
        viaDefault = core.resolveTimingHit({ ...pending }, combatNew, quality, undefined, false);
      } finally {
        Math.random = savedRandom;
      }
      same(`default-rng#${n}.${turn}`, nextNew, viaDefault);
    } else {
      const noTimingQuality = { label: "-", mult: 1 };
      const battle = kind === "item" ? { ...battleOld, itemUsesLeft: 1 } : battleOld;
      nextOld = original.api.resolveBattleTurn(battle, combatOld, kind, noTimingQuality, kind === "item" ? effect : undefined);
      nextNew = core.resolveBattleTurn(battle, combatNew, kind, noTimingQuality, kind === "item" ? effect : undefined, mulberry32(seed), false);
    }
    same(`turn#${n}.${turn}(${kind})`, nextOld, nextNew);
    battleOld = nextOld;
  }
}

if (failures.length) {
  console.error(`✗ Mismatches detected (${failures.length}+ / ${checks} checks)`);
  failures.forEach((failure) => console.error(` - ${failure}`));
  process.exit(1);
}
console.log(`✓ Regression passed: all ${checks.toLocaleString()} checks match.`);
