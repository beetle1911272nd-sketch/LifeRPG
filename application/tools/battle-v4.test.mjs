import assert from "node:assert/strict";
import {
  BATTLE_SKILLS,
  BATTLE_STATUS_EFFECTS,
  BATTLE_VERSION,
  availableBattleSkills,
  battleIntent,
  createBattle,
  defaultBattleSkillLoadout,
  resolveBattleTurn,
  resolveTimingHit,
  TIMING_QUALITIES,
} from "../sandbox/battle-core.js";

const combat = { atk: 42, def: 24, maxHp: 180, skillPower: 64 };
const attributes = { STR: 55, INT: 60, AGI: 50, VIT: 48, DEX: 45, WILL: 52 };
const random = (value = 0.5) => () => value;
const battleAt = (floor = 1, skills = ["power_strike", "ember", "mend"]) => createBattle(combat, floor, true, { attributes, skills });

assert.equal(BATTLE_VERSION, 4);
assert.ok(availableBattleSkills(attributes).some((skill) => skill.id === "ember"));
assert.equal(BATTLE_SKILLS.length, 10);
assert.equal(Object.keys(BATTLE_STATUS_EFFECTS).length, 10);
assert.deepEqual(defaultBattleSkillLoadout({ STR: 30, INT: 30, AGI: 30, WILL: 30 }), ["power_strike", "mend", "ember"]);

{
  const battle = battleAt(1);
  assert.equal(battle.version, 4);
  assert.equal(battle.mp, battle.maxMp);
  assert.equal(battle.intent.id, "strike");
  assert.ok(battleAt(3).intent.id === "evade");
  assert.equal(battleIntent({ floor: 10, enemyTurn: 2 }).id, "attack_up");
  const higherWill = createBattle(combat, 1, true, { attributes: { INT: 60, WILL: 60 }, skills: [] });
  assert.ok(higherWill.maxMp > battleAt(1, []).maxMp);
}

{
  const battle = { ...battleAt(), monsterHp: 1000, pendingCommand: "skill", pendingSkillId: "ember", phase: "timing" };
  const resolved = resolveTimingHit(battle, combat, TIMING_QUALITIES.good, random(0.5));
  assert.ok(resolved.log.some((line) => line.includes("WEAKNESS")));
  assert.ok(resolved.monsterHp < battle.monsterHp);
  assert.ok(resolved.breakGauge < battle.breakGauge);
  assert.equal(resolved.cooldowns.ember, 1);
  assert.ok(resolved.mp < battle.mp);
}

{
  const battle = { ...battleAt(), monsterHp: 1000, breakGauge: 25, pendingCommand: "skill", pendingSkillId: "ember", phase: "timing" };
  const resolved = resolveTimingHit(battle, combat, TIMING_QUALITIES.perfect, random(0));
  assert.equal(resolved.combatEffect, "break");
  assert.equal(resolved.breakGauge, 100);
  assert.equal(resolved.exposedTurns, 2);
  assert.equal(resolved.combatMetrics.breaks, 1);
  assert.ok(resolved.log.some((line) => line.includes("BREAK")));
}

{
  const battle = { ...battleAt(2), monsterHp: 1000, intent: { id: "charge", name: "強打", damage: 1.65 } };
  const guarded = resolveBattleTurn({ ...battle, pendingCommand: "defend" }, combat, "defend", TIMING_QUALITIES.perfect, undefined, random(0.5));
  const hit = resolveBattleTurn({ ...battle, pendingCommand: "attack" }, combat, "attack", TIMING_QUALITIES.good, undefined, random(0.5));
  assert.ok(guarded.playerHp > hit.playerHp);
  assert.equal(guarded.combatMetrics.perfectGuards, 1);
}

{
  const battle = { ...battleAt(4), monsterHp: 1000, intent: { id: "poison", name: "毒胞子", damage: 0.72 } };
  const resolved = resolveBattleTurn({ ...battle, pendingCommand: "attack" }, combat, "attack", TIMING_QUALITIES.good, undefined, random(0.5));
  assert.ok(resolved.playerStatuses.some((status) => status.id === "poison"));
}

{
  const battle = { ...battleAt(3), monsterHp: 1000, intent: { id: "freeze", name: "冷気の刃", damage: 0.72 } };
  const resolved = resolveBattleTurn({ ...battle, pendingCommand: "attack" }, combat, "attack", TIMING_QUALITIES.good, undefined, random(0.5));
  assert.ok(resolved.playerStatuses.some((status) => status.id === "freeze"));
}

console.log("Battle v4 tactical checks passed.");
