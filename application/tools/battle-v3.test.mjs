import assert from "node:assert/strict";
import {
  BATTLE_VERSION,
  createBattle,
  resolveBattleTurn,
  resolveTimingHit,
  TIMING_QUALITIES,
} from "../sandbox/battle-core.js";

const combat = { atk: 40, def: 20, maxHp: 200, skillPower: 62 };
const random = (value = 0.5) => () => value;
const freshBattle = () => ({
  ...createBattle(combat, 1),
  version: 3,
  breakGauge: 0,
  combo: 0,
  monsterHp: 1000,
  monsterMaxHp: 1000,
  monsterAtk: 30,
});

assert.equal(BATTLE_VERSION, 4);

{
  const battle = freshBattle();
  battle.intent = { id: "heavy", damage: 1.4 };
  const dodged = resolveBattleTurn(
    { ...battle, pendingCommand: "dodge" },
    combat,
    "dodge",
    TIMING_QUALITIES.perfect,
    undefined,
    random(0.5),
  );
  assert.equal(dodged.playerHp, battle.playerHp);
  assert.equal(dodged.monsterHp, battle.monsterHp - Math.round(combat.atk * 0.55));
  assert.equal(dodged.phase, "select");
  assert.equal(dodged.combatEffect, "perfect-dodge");
}

{
  const battle = freshBattle();
  battle.intent = { id: "strike", damage: 0.88 };
  const guarded = resolveBattleTurn(battle, combat, "defend", { label: "-", mult: 1 }, undefined, random(0.5));
  const attacked = resolveBattleTurn(battle, combat, "attack", TIMING_QUALITIES.miss, undefined, random(0.5));
  assert.ok(battle.playerHp - guarded.playerHp < battle.playerHp - attacked.playerHp);
  assert.equal(guarded.combatEffect, "guard");
}

{
  const battle = freshBattle();
  battle.breakGauge = 75;
  const broken = resolveBattleTurn(battle, combat, "attack", TIMING_QUALITIES.perfect, undefined, random(0));
  assert.equal(broken.phase, "select");
  assert.equal(broken.playerHp, battle.playerHp);
  assert.equal(broken.breakGauge, 0);
  assert.equal(broken.exposed, true);
  assert.equal(broken.combatEffect, "break");
  assert.match(broken.log.at(-1), /反撃のチャンス/);
}

{
  const battle = { ...freshBattle(), pendingCommand: "skill", phase: "timing", skillUsesLeft: 2 };
  const resolved = resolveTimingHit(battle, combat, TIMING_QUALITIES.good, random(0.5));
  assert.equal(resolved.skillUsesLeft, 1);
  assert.equal(resolved.combo, 1);
  assert.ok(resolved.breakGauge > 0);
}

console.log("Battle v3 tactical checks passed.");
