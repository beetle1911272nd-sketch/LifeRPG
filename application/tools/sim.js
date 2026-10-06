import {
  BATTLE_V2_ENABLED,
  BATTLE_SKILLS,
  ENEMY_PROFILES,
  availableBattleSkills,
  computeCombatStats,
  createBattle,
  resolveTimingHit,
  timingCycleMs,
  timingQuality,
  TIMING_QUALITIES,
} from "../sandbox/battle-core.js";

function readArguments(args) {
  const statIndex = args.indexOf("--stat");
  const stat = statIndex < 0 ? 50 : Number(args[statIndex + 1]);
  const countIndex = args.indexOf("--count");
  const count = countIndex < 0 ? 500 : Number(args[countIndex + 1]);
  if (!Number.isFinite(stat) || stat <= 0) throw new Error("--stat must be a positive number");
  if (!Number.isInteger(count) || count <= 0) throw new Error("--count must be a positive integer");
  return { stat, count };
}

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

function simulate(floor, stat, count, mode, seedOffset) {
  const combat = computeCombatStats({
    level: floor,
    stats: Object.fromEntries(["STR", "INT", "AGI", "VIT", "DEX", "CHA", "FIN", "WILL"].map((key) => [key, stat])),
    jobMod: () => 1,
    bonus: { atk: 0, def: 0, maxHp: 0, skillPower: 0 },
  });
  let wins = 0;
  let totalTurns = 0;
  let hpLostAfterWins = 0;

  for (let run = 0; run < count; run++) {
    const random = mulberry32(seedOffset + floor * 100000 + run);
    const stats = Object.fromEntries(["STR", "INT", "AGI", "VIT", "DEX", "CHA", "FIN", "WILL"].map((key) => [key, stat]));
    const availableSkills = availableBattleSkills(stats);
    const weakness = ENEMY_PROFILES[floor - 1]?.weakness;
    const weaknessSkill = availableSkills.find((skill) => skill.element === weakness && skill.power);
    const skillIds = ["power_strike", "mend", weaknessSkill?.id]
      .filter((id, index, list) => id && list.indexOf(id) === index && availableSkills.some((skill) => skill.id === id))
      .slice(0, 3);
    let battle = createBattle(combat, floor, true, { attributes: stats, skills: skillIds });
    let turns = 0;
    while (battle.phase !== "won" && battle.phase !== "lost" && turns < 100) {
      const readySkills = (battle.activeSkills || [])
        .map((id) => BATTLE_SKILLS.find((skill) => skill.id === id))
        .filter((skill) => skill && !(battle.cooldowns?.[skill.id] > 0) && battle.mp >= skill.mp && battle.energy >= skill.energy);
      const skill = readySkills.find((candidate) => candidate.effect === "heal" && battle.playerHp < battle.playerMaxHp * 0.45)
        || readySkills.find((candidate) => candidate.element === weakness && candidate.power)
        || readySkills.find((candidate) => candidate.power)
        || readySkills[0];
      const command = skill ? "skill" : "attack";
      const quality = mode === "random"
        ? timingQuality(Math.floor(random() * timingCycleMs(floor) * 2), floor)
        : TIMING_QUALITIES[mode];
      battle = resolveTimingHit(
        { ...battle, pendingCommand: command, pendingSkillId: skill?.id || null, phase: "timing" },
        combat,
        quality,
        random,
      );
      turns++;
    }
    if (battle.phase === "won") {
      wins++;
      hpLostAfterWins += (battle.playerMaxHp - battle.playerHp) / battle.playerMaxHp;
    }
    totalTurns += turns;
  }

  return {
    winRate: wins / count,
    averageTurns: totalTurns / count,
    averageHpLostOnWin: wins ? hpLostAfterWins / wins : null,
  };
}

const { stat, count } = readArguments(process.argv.slice(2));
console.log(`Battle V4 · V2 stat tuning ${BATTLE_V2_ENABLED ? "enabled" : "disabled"} · ${count} simulations per case · level = floor · stats = ${stat}`);
console.log("Band  Floor   GOOD win/turns/HP lost     MISS win/turns     Random win/turns");
for (let floor = 1; floor <= 10; floor++) {
  const good = simulate(floor, stat, count, "good", 1000);
  const miss = simulate(floor, stat, count, "miss", 2000);
  const random = simulate(floor, stat, count, "random", 3000);
  const goodLabel = `${(good.winRate * 100).toFixed(0)}% / ${good.averageTurns.toFixed(1)} / ${good.averageHpLostOnWin === null ? "—" : `${(good.averageHpLostOnWin * 100).toFixed(0)}%`}`;
  const missLabel = `${(miss.winRate * 100).toFixed(0)}% / ${miss.averageTurns.toFixed(1)}`;
  const randomLabel = `${(random.winRate * 100).toFixed(0)}% / ${random.averageTurns.toFixed(1)}`;
  console.log(`${floor <= 3 ? "Early" : floor <= 6 ? "Mid" : floor < 10 ? "Late" : "Boss "}  ${String(floor).padStart(2)}   ${goodLabel.padEnd(27)} ${missLabel.padEnd(16)} ${randomLabel}`);
}
