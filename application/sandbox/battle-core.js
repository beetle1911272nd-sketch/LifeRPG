// LIFE RPG battle core: deterministic inputs make combat behavior testable without app state.

export const DUNGEON_MONSTERS = [
  { name: "スライム", icon: "●", image: "/monsters/1_slime.jpg" },
  { name: "野ネズミ", icon: "◌", image: "/monsters/2_rat.jpg" },
  { name: "森コウモリ", icon: "◍", image: "/monsters/3_bat.jpg" },
  { name: "毒キノコ", icon: "✿", image: "/monsters/4_mushroom.jpg" },
  { name: "野生の狼", icon: "◭", image: "/monsters/5_wolf.jpg" },
  { name: "ゴブリン", icon: "◮", image: "/monsters/6_goblin.jpg" },
  { name: "森トロル", icon: "◫", image: "/monsters/7_troll.jpg" },
  { name: "大蜘蛛", icon: "✷", image: "/monsters/8_spider.jpg" },
  { name: "森の番人", icon: "◈", image: "/monsters/9_treant.jpg" },
  { name: "森の主 グレイファング", icon: "☠", image: "/monsters/10_boss.jpg" },
];

export const BATTLE_V2_ENABLED = true;
export const BATTLE_VERSION = 4;
const TACTICAL_BATTLE_VERSION = 3;
const LEGACY_FLOOR_STATS = [
  { hp: 61, atk: 9, def: 4, exp: 39, gold: 17 },
  { hp: 80, atk: 11, def: 5, exp: 54, gold: 24 },
  { hp: 99, atk: 14, def: 7, exp: 69, gold: 31 },
  { hp: 118, atk: 16, def: 8, exp: 84, gold: 38 },
  { hp: 137, atk: 19, def: 10, exp: 99, gold: 45 },
  { hp: 156, atk: 21, def: 11, exp: 114, gold: 52 },
  { hp: 175, atk: 24, def: 13, exp: 129, gold: 59 },
  { hp: 194, atk: 26, def: 14, exp: 144, gold: 66 },
  { hp: 213, atk: 29, def: 16, exp: 159, gold: 73 },
  { hp: 240, atk: 24, def: 9, exp: 260, gold: 140 },
];
const V2_FLOOR_STATS = [
  { hp: 390, atk: 23, def: 4 },
  { hp: 470, atk: 24, def: 5 },
  { hp: 500, atk: 24, def: 7 },
  { hp: 560, atk: 27, def: 8 },
  { hp: 600, atk: 27, def: 10 },
  { hp: 600, atk: 28, def: 11 },
  { hp: 780, atk: 31, def: 13 },
  { hp: 700, atk: 28, def: 14 },
  { hp: 760, atk: 30, def: 16 },
  { hp: 1250, atk: 20, def: 20 },
];

function createDungeonFloors(stats) {
  return DUNGEON_MONSTERS.map((monster, index) => {
  const floor = index + 1;
  const boss = floor === 10;
  const values = stats[index];
  return {
    floor,
    boss,
    name: monster.name,
    icon: monster.icon,
    image: monster.image,
    hp: values.hp,
    atk: values.atk,
    def: values.def,
    exp: values.exp ?? (boss ? 260 : Math.round(24 + floor * 15)),
    gold: values.gold ?? (boss ? 140 : Math.round(10 + floor * 7)),
  };
});
}

export const LEGACY_DUNGEON_FLOORS = createDungeonFloors(LEGACY_FLOOR_STATS);
export const DUNGEON_FLOORS = BATTLE_V2_ENABLED
  ? createDungeonFloors(V2_FLOOR_STATS)
  : LEGACY_DUNGEON_FLOORS;

export function dungeonTier(floor) {
  if (floor >= 10) return "boss";
  if (floor >= 7) return "late";
  if (floor >= 4) return "mid";
  return "early";
}

export function monsterAt(floor, battleV2 = BATTLE_V2_ENABLED) {
  const floors = battleV2 ? DUNGEON_FLOORS : LEGACY_DUNGEON_FLOORS;
  return floors[Math.min(Math.max(floor, 1), floors.length) - 1];
}

export const TIMING_CYCLE_BY_TIER = { early: 2400, mid: 2100, late: 1850, boss: 1650 };

export function timingCycleMs(floor) {
  return TIMING_CYCLE_BY_TIER[dungeonTier(floor)] || 1400;
}

export function timingQuality(elapsedMs, floor) {
  const cycle = timingCycleMs(floor);
  const phase = (((elapsedMs % (cycle * 2)) + cycle * 2) % (cycle * 2)) / cycle;
  const pos = phase <= 1 ? phase * 100 : (2 - phase) * 100;
  return timingQualityAtPosition(pos);
}

export function timingQualityAtPosition(positionPercent) {
  const pos = Math.max(0, Math.min(100, Number(positionPercent) || 0));
  const distance = Math.abs(pos - 50);
  if (distance <= 9) return { label: "PERFECT", mult: 1.7, tier: "perfect" };
  if (distance <= 22) return { label: "GOOD", mult: 1.1, tier: "good" };
  return { label: "MISS", mult: 0.55, tier: "miss" };
}

export const ENEMY_INTENTS = [
  { id: "strike", name: "通常攻撃", tell: "踏み込んでくる！", damage: 0.88 },
  { id: "heavy", name: "大振り", tell: "大きく力を溜めている！", damage: 1.4 },
  { id: "feint", name: "フェイント", tell: "低く身構え、隙をうかがう…", damage: 0.65 },
];

export const BATTLE_SKILLS = [
  { id: "power_strike", name: "剛撃", stat: "STR", unlock: 30, element: "physical", mp: 0, energy: 45, cooldown: 2, power: 1.4, break: 18, desc: "STRを乗せた高威力の一撃。" },
  { id: "quick_step", name: "疾風歩法", stat: "AGI", unlock: 30, element: "wind", mp: 4, energy: 25, cooldown: 2, effect: "agility", desc: "回避と次の一撃を強化。" },
  { id: "mend", name: "生活の息吹", stat: "WILL", unlock: 30, element: "light", mp: 7, energy: 20, cooldown: 3, effect: "heal", desc: "意志の力でHPを回復。" },
  { id: "ember", name: "焔の刻印", stat: "INT", unlock: 30, element: "fire", mp: 7, energy: 35, cooldown: 2, power: 1.2, break: 32, desc: "炎弱点を狙う魔法攻撃。" },
  { id: "gale", name: "風裂き", stat: "AGI", unlock: 40, element: "wind", mp: 6, energy: 35, cooldown: 2, power: 1.2, break: 28, desc: "風をまとった連撃。素早い敵に有効。" },
  { id: "radiant", name: "光輪", stat: "INT", unlock: 40, element: "light", mp: 7, energy: 38, cooldown: 2, power: 1.2, break: 30, desc: "光属性の一撃。飛行する敵に有効。" },
  { id: "guard_break", name: "崩し", stat: "DEX", unlock: 40, element: "physical", mp: 5, energy: 35, cooldown: 3, power: 1.1, break: 36, effect: "defense_down", desc: "敵の守りを崩し、ブレイクを狙う。" },
  { id: "arcane_burst", name: "雷鳴", stat: "INT", unlock: 45, element: "thunder", mp: 10, energy: 50, cooldown: 3, power: 1.5, break: 30, desc: "雷属性の大魔法。" },
  { id: "counter_stance", name: "返しの構え", stat: "AGI", unlock: 45, element: "physical", mp: 5, energy: 25, cooldown: 3, effect: "counter", desc: "次に受ける攻撃をいなし反撃。" },
  { id: "berserk", name: "背水の陣", stat: "STR", unlock: 55, element: "physical", mp: 8, energy: 55, cooldown: 4, effect: "berserk", desc: "攻撃を高める代わりに防御が下がる。" },
];

export const BATTLE_STATUS_EFFECTS = {
  poison: { name: "毒", icon: "☠", kind: "damage-over-time" },
  burn: { name: "火傷", icon: "🔥", kind: "damage-over-time" },
  stun: { name: "気絶", icon: "✦", kind: "skip-action" },
  freeze: { name: "凍結", icon: "❄", kind: "skip-action" },
  bleed: { name: "出血", icon: "⌁", kind: "damage-over-time" },
  weak: { name: "弱体", icon: "◇", kind: "attack-down" },
  attack_up: { name: "攻撃上昇", icon: "⚔", kind: "attack-up" },
  defense_up: { name: "防御上昇", icon: "🛡", kind: "defense-up" },
  attack_down: { name: "攻撃低下", icon: "⚔", kind: "attack-down" },
  defense_down: { name: "防御低下", icon: "🛡", kind: "defense-down" },
};

export function availableBattleSkills(stats = {}) {
  return BATTLE_SKILLS.filter((skill) => {
    const value = Number(stats[skill.stat]);
    return (Number.isFinite(value) ? value : 30) >= skill.unlock;
  });
}

export function defaultBattleSkillLoadout(stats = {}) {
  const available = availableBattleSkills(stats);
  const preferred = ["power_strike", "mend", "ember"];
  return [
    ...preferred.filter((id) => available.some((skill) => skill.id === id)),
    ...available.filter((skill) => !preferred.includes(skill.id)).map((skill) => skill.id),
  ].slice(0, 3);
}

export const ENEMY_PROFILES = [
  { weakness: "fire", pattern: ["strike", "charge", "strike"] },
  { weakness: "wind", pattern: ["double", "guard", "strike"] },
  { weakness: "light", pattern: ["evade", "strike", "charge"] },
  { weakness: "fire", pattern: ["poison", "guard", "strike"] },
  { weakness: "fire", pattern: ["double", "strike", "charge"] },
  { weakness: "thunder", pattern: ["guard_break", "weaken", "strike"] },
  { weakness: "thunder", pattern: ["charge", "attack_down", "guard"] },
  { weakness: "fire", pattern: ["poison", "freeze", "strike"] },
  { weakness: "fire", pattern: ["guard", "charge", "stun"] },
  { weakness: "thunder", pattern: ["feint", "double", "attack_up", "guard_break", "charge", "bleed"] },
];

const INTENT_PROFILES = {
  strike: { id: "strike", name: "通常攻撃", tell: "敵の動きを見極めよう", damage: 0.86 },
  double: { id: "double", name: "連続攻撃", tell: "素早い連撃が来る！", damage: 0.62 },
  charge: { id: "charge", name: "力を溜める", tell: "次の一撃に備えよう。ガードが有効", damage: 1.65 },
  heavy: { id: "heavy", name: "強打", tell: "大きく振りかぶった！", damage: 1.45 },
  guard: { id: "guard", name: "守りの構え", tell: "敵の守りが固い。弱点を狙おう", damage: 0, guarded: true },
  poison: { id: "poison", name: "毒胞子", tell: "毒を含む攻撃。回避か速攻を", damage: 0.72 },
  burn: { id: "burn", name: "灼熱の樹液", tell: "火傷を伴う攻撃。弱点を突いて止めよう", damage: 0.88 },
  bleed: { id: "bleed", name: "裂傷", tell: "出血に注意。回復やガードも有効", damage: 0.95 },
  attack_down: { id: "attack_down", name: "威圧", tell: "意志を揺さぶる。状態異常への備えを", damage: 0.7 },
  guard_break: { id: "guard_break", name: "防御崩し", tell: "守りを崩す攻撃。回避が安全", damage: 1.1 },
  attack_up: { id: "attack_up", name: "鼓舞", tell: "敵の攻撃が強まった。防御・回避を", damage: 0 },
  weaken: { id: "weaken", name: "弱体の霧", tell: "攻撃力が下がる前に決着を", damage: 0.75 },
  freeze: { id: "freeze", name: "冷気の刃", tell: "凍結に注意。回避が有効", damage: 0.72 },
  stun: { id: "stun", name: "根縛り", tell: "動きを封じる攻撃。回避しよう", damage: 1.08 },
  evade: { id: "evade", name: "飛翔回避", tell: "敵が身軽に構えた。弱点攻撃の好機", damage: 0, evading: true },
  feint: { id: "feint", name: "フェイント", tell: "動きを読みにくい。ガード推奨", damage: 0.92 },
};

export function battleIntent(battle) {
  const profile = ENEMY_PROFILES[Math.min(Math.max((battle.floor || 1) - 1, 0), ENEMY_PROFILES.length - 1)];
  const pattern = profile.pattern;
  return INTENT_PROFILES[pattern[(battle.enemyTurn || 0) % pattern.length]] || INTENT_PROFILES.strike;
}

function statusHas(statuses, id) {
  return (statuses || []).some((status) => status.id === id && status.turns > 0);
}

function addStatus(statuses, id, turns = 2, power = 1) {
  return [...(statuses || []).filter((status) => status.id !== id), { id, turns, power }];
}

function tryAddPlayerStatus(statuses, id, turns, power, will, rng) {
  const value = Number(will);
  const willpower = Number.isFinite(value) ? value : 30;
  const resistance = Math.min(0.5, Math.max(0, (willpower - 30) / 180));
  return rng() < resistance ? statuses : addStatus(statuses, id, turns, power);
}

function tickStatuses(statuses) {
  return (statuses || []).map((status) => ({ ...status, turns: status.turns - 1 })).filter((status) => status.turns > 0);
}

function resolveBattleTurnV4(battle, combat, command, quality, itemEffect, rng) {
  let playerHp = battle.playerHp;
  let monsterHp = battle.monsterHp;
  let mp = battle.mp;
  let energy = battle.energy;
  let breakGauge = battle.breakGauge ?? 100;
  let enemyStatuses = [...(battle.enemyStatuses || [])];
  let playerStatuses = [...(battle.playerStatuses || [])];
  let cooldowns = { ...(battle.cooldowns || {}) };
  let combo = battle.combo || 0;
  let maxCombo = battle.maxCombo || 0;
  let atkBuffMult = battle.atkBuffMult || 1;
  let weak = false;
  let critical = false;
  const profile = battle.combatProfile || {};
  const stat = (key) => {
    const value = Number(profile[key]);
    return Number.isFinite(value) ? value : 30;
  };
  const skills = battle.activeSkills || [];
  const skill = command === "skill" ? BATTLE_SKILLS.find((entry) => entry.id === battle.pendingSkillId && skills.includes(entry.id)) : null;
  let log = battle.log.slice(-5);
  let effect = "idle";
  let breakPower = 0;
  let validAction = false;

  if (statusHas(playerStatuses, "stun") || statusHas(playerStatuses, "freeze")) {
    log.push("状態異常で動けない！");
    playerStatuses = tickStatuses(playerStatuses);
  } else if (command === "defend") {
    effect = quality?.tier === "perfect" ? "perfect-guard" : "guard";
    playerStatuses = addStatus(playerStatuses, "defense_up", 2);
    validAction = true;
    log.push(quality?.tier === "perfect" ? "PERFECT GUARD！ 攻撃を見切った！" : "敵の動きを読み、ガードの構えをとった。");
    if (quality?.tier === "perfect") {
      breakPower += 18;
      enemyStatuses = addStatus(enemyStatuses, "stun", 1);
    }
  } else if (command === "dodge") {
    effect = quality?.tier === "perfect" ? "perfect-dodge" : "dodge";
    if (quality?.tier === "perfect") breakPower = 18;
    validAction = quality?.tier !== "miss";
    log.push(quality?.tier === "perfect" ? "完全回避！ 反撃の好機！" : "攻撃の軌道を見極め、回避行動！");
  } else if (command === "item" && itemEffect?.buff) {
    effect = "buff";
    atkBuffMult = itemEffect.buff;
    validAction = true;
    log.push(`${itemEffect.name}を使い、次の一撃の威力が高まった！`);
  } else if (command === "item") {
    effect = "heal";
    const heal = Math.max(1, Math.round(battle.playerMaxHp * (itemEffect?.heal ?? 0.3)));
    playerHp = Math.min(battle.playerMaxHp, playerHp + heal);
    validAction = true;
    log.push(`${itemEffect?.name || "回復薬"}を使い、HPが${heal}回復した。`);
  } else if (command === "skill" && !skill) {
    log.push("そのスキルは装備されていません。");
  } else if (command === "skill" && ((cooldowns[skill.id] || 0) > 0 || mp < skill.mp || energy < skill.energy)) {
    log.push("MP・ENERGYまたはクールダウンを確認してください。");
  } else {
    const isSkill = command === "skill";
    breakPower = isSkill && !skill.power ? skill.break || 0 : quality?.tier === "perfect" ? 22 : quality?.tier === "good" ? 14 : 7;
    const element = isSkill ? skill.element : "physical";
    const power = isSkill ? (skill.power || 0) : 1;
    const base = isSkill && skill.effect === "heal"
      ? 0
      : isSkill && ["fire", "thunder", "light"].includes(element)
        ? (combat.skillPower + stat("int") * 0.45)
        : combat.atk;
    const statPower = isSkill ? 1 + Math.max(-10, stat("int") - 30) / 220 : 1 + Math.max(-10, stat("str") - 30) / 350;
    const critChance = Math.min(0.34, 0.04 + Math.max(0, stat("agi") - 30) / 300 + Math.max(0, stat("dex") - 30) / 350 + (statusHas(playerStatuses, "agility_up") ? 0.1 : 0));
    critical = command !== "skill" || skill.power ? rng() < critChance : false;
    const statusMultiplier = statusHas(playerStatuses, "attack_up") ? 1.2 : statusHas(playerStatuses, "attack_down") || statusHas(playerStatuses, "weak") ? 0.8 : 1;
    weak = (!isSkill || Boolean(skill.power)) && element !== "physical" && element === ENEMY_PROFILES[Math.min(Math.max((battle.floor || 1) - 1, 0), ENEMY_PROFILES.length - 1)]?.weakness;
    const qualityMult = quality?.tier === "perfect" ? 1.45 : quality?.mult || 1;
    const enemyDefense = battle.monsterDef * (statusHas(enemyStatuses, "defense_down") ? 0.72 : statusHas(enemyStatuses, "defense_up") ? 1.35 : 1);
    const comboMultiplier = 1 + Math.min(combo, 5) * 0.035;
    let damage = Math.max(1, Math.round(((base * (power || 1) * qualityMult * statPower * statusMultiplier * atkBuffMult * comboMultiplier) - enemyDefense * 0.48) * (weak ? 1.4 : statusHas(enemyStatuses, "weak") ? 1.2 : 1) * (critical ? 1.4 : 1) * (battle.exposedTurns > 0 ? 1.28 : 1)));
    if (battle.intent?.guarded) damage = Math.max(1, Math.round(damage * 0.58));
    if (battle.intent?.evading && !weak) damage = Math.max(1, Math.round(damage * 0.62));
    if (isSkill) {
      mp -= skill.mp;
      energy -= skill.energy;
      cooldowns[skill.id] = skill.cooldown;
    }
    if (isSkill && skill.effect === "heal") {
      const heal = Math.max(1, Math.round(battle.playerMaxHp * (0.18 + Math.max(0, stat("will") - 30) / 500)));
      playerHp = Math.min(battle.playerMaxHp, playerHp + heal);
      log.push(`${skill.name}！ HPが${heal}回復した。`);
      effect = "heal";
      validAction = true;
    } else if (isSkill && skill.effect === "agility") {
      playerStatuses = addStatus(playerStatuses, "agility_up", 2);
      damage = 0;
      log.push(`${skill.name}！ 身のこなしと次の攻撃が強化された。`);
      effect = "buff";
      validAction = true;
    } else if (isSkill && skill.effect === "counter") {
      playerStatuses = addStatus(playerStatuses, "counter", 2);
      damage = 0;
      log.push(`${skill.name}！ 敵の攻撃を待ち受ける。`);
      effect = "guard";
      validAction = true;
    } else if (isSkill && skill.effect === "berserk") {
      playerStatuses = addStatus(playerStatuses, "attack_up", 3);
      playerStatuses = addStatus(playerStatuses, "defense_down", 3);
      damage = 0;
      log.push(`${skill.name}！ 攻撃力上昇と引き換えに防御が下がった。`);
      effect = "buff";
      validAction = true;
    } else {
      monsterHp = Math.max(0, monsterHp - damage);
      if (isSkill && skill.effect === "defense_down") enemyStatuses = addStatus(enemyStatuses, "defense_down", 2);
      if (weak) {
        breakPower += 30;
        log.push("WEAKNESS！ 弱点を突いた！");
      }
      if (critical) log.push("CRITICAL！");
      log.push(`${quality?.label || "HIT"}！ ${isSkill ? skill.name : "攻撃"}で${damage}ダメージ！`);
      effect = weak ? "weak-hit" : critical ? "critical" : isSkill ? "skill-strike" : "player-strike";
      validAction = (quality?.tier || "good") !== "miss" || weak;
    }
    if (isSkill && (skill.power || skill.break)) breakPower += skill.break || 0;
    if (!isSkill || skill.power) atkBuffMult = 1;
    energy = Math.min(100, energy + (command === "attack" ? 32 + Math.floor(stat("agi") / 10) : 10));
  }

  if (validAction) {
    combo = Math.min(9, combo + 1);
    maxCombo = Math.max(maxCombo, combo);
  } else if (quality?.tier === "miss") combo = 0;
  if (monsterHp <= 0) {
    log = [...log, `${battle.monster}を倒した！`];
    return { ...battle, monsterHp, playerHp, mp, energy, enemyStatuses, playerStatuses, cooldowns, combo, maxCombo, log, phase: "won", combatEffect: effect, combatEffectId: (battle.combatEffectId || 0) + 1, combatMetrics: updateMetrics(battle.combatMetrics, { weak, critical, guarded: effect === "perfect-guard", dealtDamage: battle.monsterHp }) };
  }

  breakGauge = Math.max(0, breakGauge - breakPower);
  if (breakGauge <= 0) {
    log.push(`${battle.monster} BREAK！ 体勢を崩した！`);
    energy = Math.min(100, energy + 20);
    return finishV4Turn({ ...battle, monsterHp, playerHp, mp, energy, enemyStatuses, playerStatuses, cooldowns, combo, maxCombo, breakGauge: 100, exposedTurns: 2, enemyTurn: (battle.enemyTurn || 0) + 1, intent: battleIntent({ ...battle, enemyTurn: (battle.enemyTurn || 0) + 1 }), log, phase: "select", combatEffect: "break", combatEffectId: (battle.combatEffectId || 0) + 1, combatMetrics: updateMetrics(battle.combatMetrics, { weak, critical, guarded: effect === "perfect-guard", breaks: 1 }) });
  }

  const intent = battle.intent || INTENT_PROFILES.strike;
  let incoming = 0;
  const playerDef = Math.max(0, combat.def * (statusHas(playerStatuses, "defense_down") ? 0.72 : statusHas(playerStatuses, "defense_up") ? 1.2 : 1));
  if (!intent.guarded && !intent.evading && !statusHas(enemyStatuses, "stun")) {
    const variance = 0.9 + rng() * 0.2;
    const baseIncoming = Math.max(1, Math.round(battle.monsterAtk * variance * (statusHas(enemyStatuses, "attack_up") ? 1.25 : 1) * 100 / (100 + playerDef * 1.5)));
    incoming = Math.round(baseIncoming * (intent.damage || 0));
    if (intent.id === "double") incoming += Math.max(1, Math.round(baseIncoming * 0.42));
    if (command === "defend") {
      const guardMult = quality?.tier === "perfect" ? 0.08 : quality?.tier === "good" ? 0.28 : 0.48;
      incoming = Math.round(incoming * guardMult);
      if (quality?.tier === "perfect") {
        enemyStatuses = addStatus(enemyStatuses, "stun", 1);
        log.push("PERFECT GUARD！ 敵をひるませた！");
      }
    } else if (command === "dodge") {
      const dodgeChance = Math.min(0.5, 0.08 + Math.max(0, stat("agi") - 30) / 250 + (statusHas(playerStatuses, "agility_up") ? 0.15 : 0));
      const perfect = quality?.tier === "perfect" || rng() < dodgeChance;
      incoming = perfect ? 0 : Math.round(incoming * (quality?.tier === "good" ? 0.38 : 1));
      if (perfect) {
        const counter = Math.max(1, Math.round(combat.atk * 0.45));
        monsterHp = Math.max(0, monsterHp - counter);
        log.push(`回避成功！ カウンターで${counter}ダメージ！`);
      }
    }
    if (statusHas(playerStatuses, "counter") && incoming > 0) {
      const counter = Math.max(1, Math.round(combat.atk * 0.7));
      monsterHp = Math.max(0, monsterHp - counter);
      playerStatuses = playerStatuses.filter((status) => status.id !== "counter");
      log.push(`返しの構え！ ${counter}ダメージを返した！`);
    }
    if (intent.id === "poison" && incoming > 0) playerStatuses = tryAddPlayerStatus(playerStatuses, "poison", 3, Math.max(2, Math.round(battle.monsterAtk * 0.08)), stat("will"), rng);
    if (intent.id === "burn" && incoming > 0) playerStatuses = tryAddPlayerStatus(playerStatuses, "burn", 2, Math.max(2, Math.round(battle.monsterAtk * 0.07)), stat("will"), rng);
    if (intent.id === "bleed" && incoming > 0) playerStatuses = tryAddPlayerStatus(playerStatuses, "bleed", 3, Math.max(2, Math.round(battle.monsterAtk * 0.06)), stat("will"), rng);
    if (intent.id === "guard_break" && incoming > 0) playerStatuses = tryAddPlayerStatus(playerStatuses, "defense_down", 2, 1, stat("will"), rng);
    if (intent.id === "attack_down" && incoming > 0) playerStatuses = tryAddPlayerStatus(playerStatuses, "attack_down", 2, 1, stat("will"), rng);
    if (intent.id === "weaken" && incoming > 0) playerStatuses = tryAddPlayerStatus(playerStatuses, "weak", 2, 1, stat("will"), rng);
    if (intent.id === "freeze" && incoming > 0) playerStatuses = tryAddPlayerStatus(playerStatuses, "freeze", 2, 1, stat("will"), rng);
    if (intent.id === "stun" && incoming > 0) playerStatuses = tryAddPlayerStatus(playerStatuses, "stun", 2, 1, stat("will"), rng);
    if (intent.id === "feint" && command === "defend") incoming = Math.min(battle.playerHp, incoming + Math.round(baseIncoming * 0.18));
    playerHp = Math.max(0, playerHp - incoming);
    log.push(incoming ? `${intent.name}！ ${incoming}ダメージを受けた。` : `${intent.name}！ ダメージを受けなかった。`);
  } else if (intent.id === "guard") {
    enemyStatuses = addStatus(enemyStatuses, "defense_up", 2);
    log.push(`${battle.monster}は守りを固めている。`);
  } else if (intent.id === "attack_up") {
    enemyStatuses = addStatus(enemyStatuses, "attack_up", 2);
    log.push(`${battle.monster}は気勢を高めた。次の攻撃が強まる！`);
  } else if (intent.id === "evade") {
    log.push(`${battle.monster}は素早く身をかわした。`);
  } else if (intent.id === "charge") {
    log.push(`${battle.monster}は力を溜めている。`);
  }

  if (intent.id === "poison" && incoming === 0 && command !== "defend" && command !== "dodge") playerStatuses = tryAddPlayerStatus(playerStatuses, "poison", 2, 2, stat("will"), rng);
  if (playerStatuses.some((status) => ["poison", "burn", "bleed"].includes(status.id))) {
    for (const status of playerStatuses.filter((entry) => ["poison", "burn", "bleed"].includes(entry.id))) {
      playerHp = Math.max(0, playerHp - status.power);
      log.push(`${status.id === "poison" ? "毒" : status.id === "burn" ? "火傷" : "出血"}で${status.power}ダメージ。`);
    }
  }
  playerStatuses = tickStatuses(playerStatuses);
  enemyStatuses = tickStatuses(enemyStatuses);
  mp = Math.min(battle.maxMp, mp + 2 + Math.floor(stat("will") / 25));
  energy = Math.min(100, energy + 10);
  cooldowns = Object.fromEntries(Object.entries(cooldowns).map(([id, turns]) => [id, Math.max(0, turns - 1)]));
  const exposedTurns = Math.max(0, (battle.exposedTurns || 0) - 1);
  if (monsterHp <= 0) {
    log.push(`${battle.monster}を倒した！`);
    return finishV4Turn({ ...battle, monsterHp, playerHp, mp, energy, enemyStatuses, playerStatuses, cooldowns, combo, maxCombo, exposedTurns, log, phase: "won", combatEffect: "counter", combatEffectId: (battle.combatEffectId || 0) + 1, combatMetrics: updateMetrics(battle.combatMetrics, { weak, critical, guarded: effect === "perfect-guard", dealtDamage: battle.monsterHp - monsterHp }) });
  }
  if (playerHp <= 0) {
    log.push("倒れてしまった…");
    return finishV4Turn({ ...battle, monsterHp, playerHp, mp, energy, enemyStatuses, playerStatuses, cooldowns, combo, maxCombo, exposedTurns, log, phase: "lost", combatEffect: "enemy-strike", combatEffectId: (battle.combatEffectId || 0) + 1 });
  }
  const enemyTurn = (battle.enemyTurn || 0) + 1;
  return finishV4Turn({
    ...battle, monsterHp, playerHp, mp, energy, enemyStatuses, playerStatuses, cooldowns, combo, maxCombo, exposedTurns,
    enemyTurn, breakGauge, intent: battleIntent({ ...battle, enemyTurn }), log, phase: "select", pendingCommand: null,
    pendingSkillId: null, timingStart: null, atkBuffMult,
    combatEffect: effect === "idle" ? "enemy-strike" : effect, combatEffectId: (battle.combatEffectId || 0) + 1,
    combatMetrics: updateMetrics(battle.combatMetrics, { weak, critical, guarded: effect === "perfect-guard", damageTaken: incoming }),
  });
}

function updateMetrics(metrics = {}, update = {}) {
  return {
    weakHits: (metrics.weakHits || 0) + (update.weak ? 1 : 0),
    criticalHits: (metrics.criticalHits || 0) + (update.critical ? 1 : 0),
    perfectGuards: (metrics.perfectGuards || 0) + (update.guarded ? 1 : 0),
    breaks: (metrics.breaks || 0) + (update.breaks || 0),
    damageTaken: (metrics.damageTaken || 0) + (update.damageTaken || 0),
  };
}

function finishV4Turn(battle) {
  return { ...battle, pendingCommand: null, pendingSkillId: null, timingStart: null };
}

function nextEnemyIntent(rng, floor, previous) {
  const roll = rng();
  const available = ENEMY_INTENTS.filter((intent) => intent.id !== previous);
  const heavyChance = floor >= 8 ? 0.42 : floor >= 5 ? 0.32 : 0.23;
  const feintChance = 0.2;
  const selected = roll < heavyChance
    ? available.find((intent) => intent.id === "heavy")
    : roll < heavyChance + feintChance
      ? available.find((intent) => intent.id === "feint")
      : available.find((intent) => intent.id === "strike");
  return selected || ENEMY_INTENTS[0];
}

export function resolveBattleTurn(battle, combat, command, quality, itemEffect, rng = Math.random, battleV2 = BATTLE_V2_ENABLED) {
  if (battle.version >= BATTLE_VERSION) return resolveBattleTurnV4(battle, combat, command, quality, itemEffect, rng);
  const log = battle.log.slice(-5);
  const tacticalBattle = battle.version >= TACTICAL_BATTLE_VERSION;
  let monsterHp = battle.monsterHp;
  let playerHp = battle.playerHp;
  let defending = false;
  let dodging = false;
  let atkBuffMult = battle.atkBuffMult || 1;
  let breakGauge = battle.breakGauge || 0;
  let combo = battle.combo || 0;
  let combatEffect = "idle";
  if (command === "defend") {
    defending = true;
    combatEffect = "guard";
    log.push(tacticalBattle ? "敵の動きを読み、ガードの構えをとった。" : "身を守る構えをとった。");
  } else if (command === "dodge" && tacticalBattle) {
    dodging = true;
    combatEffect = quality?.tier === "perfect" ? "perfect-dodge" : "dodge";
    log.push("攻撃の軌道を見極め、回避行動！");
  } else if (command === "item" && itemEffect?.buff) {
    combatEffect = "buff";
    atkBuffMult = itemEffect.buff;
    log.push(`${itemEffect.name}を使い、次の一撃の威力が高まった！`);
  } else if (command === "item") {
    combatEffect = "heal";
    const heal = Math.round(battle.playerMaxHp * (itemEffect?.heal ?? 0.3));
    playerHp = Math.min(battle.playerMaxHp, playerHp + heal);
    log.push(`${itemEffect?.name || "回復薬"}を使い、HPが${heal}回復した。`);
  } else {
    combatEffect = command === "skill" ? "skill-strike" : "player-strike";
    const base = command === "skill" ? combat.skillPower : combat.atk;
    const comboMultiplier = tacticalBattle && command !== "skill" ? 1 + Math.min(combo, 3) * 0.055 : 1;
    const dmg = Math.max(1, Math.round((base * quality.mult * comboMultiplier * atkBuffMult - battle.monsterDef * 0.5) * (battle.exposed ? 1.25 : 1)));
    monsterHp = Math.max(0, monsterHp - dmg);
    if (tacticalBattle) {
      const qualityPoints = quality.tier === "perfect" ? 42 : quality.tier === "good" ? 26 : 12;
      breakGauge = Math.min(100, breakGauge + qualityPoints + (command === "skill" ? 18 : 0));
      combo = quality.tier === "miss" ? 0 : Math.min(5, combo + 1);
    }
    log.push(`${quality.label}！ ${command === "skill" ? "スキル" : "攻撃"}で${dmg}ダメージ！${tacticalBattle && combo >= 3 ? `（COMBO ${combo} · 威力上昇）` : ""}${atkBuffMult > 1 ? "（力の粉薬効果）" : ""}`);
    atkBuffMult = 1;
  }
  if (monsterHp <= 0) {
    log.push(`${battle.monster}を倒した！`);
    return {
      ...battle,
      monsterHp,
      playerHp,
      log,
      phase: "won",
      atkBuffMult,
      ...(tacticalBattle ? { combo, breakGauge, combatEffect, combatEffectId: (battle.combatEffectId || 0) + 1 } : {}),
    };
  }
  if (tacticalBattle && !defending && !dodging && breakGauge >= 100) {
    log.push(`${battle.monster}の体勢を崩した！ 反撃のチャンス！`);
    return {
      ...battle,
      monsterHp,
      playerHp,
      log,
      phase: "select",
      pendingCommand: null,
      timingStart: null,
      atkBuffMult,
      combo,
      breakGauge: 0,
      exposed: true,
      intent: nextEnemyIntent(rng, battle.floor, battle.intent?.id),
      combatEffect: "break",
      combatEffectId: (battle.combatEffectId || 0) + 1,
    };
  }
  const variance = 0.85 + rng() * 0.3;
  const intent = battle.intent || ENEMY_INTENTS[0];
  const intentDamage = tacticalBattle ? intent.damage : 1;
  const incoming = battleV2 && battle.version >= 2
    ? Math.max(1, Math.round(battle.monsterAtk * variance * (defending ? 0.45 : 1) * 100 / (100 + combat.def * 1.5)))
    : Math.max(1, Math.round(battle.monsterAtk * variance * (defending ? 0.45 : 1) - combat.def * 0.5));
  let actualIncoming = Math.max(1, Math.round(incoming * intentDamage));
  if (tacticalBattle && defending) {
    const guardMultiplier = intent.id === "heavy" ? 0.55 : intent.id === "feint" ? 1.2 : 0.3;
    actualIncoming = Math.max(0, Math.round(actualIncoming * guardMultiplier));
  } else if (tacticalBattle && dodging) {
    actualIncoming = quality.tier === "perfect"
      ? 0
      : Math.max(1, Math.round(actualIncoming * (quality.tier === "good" ? 0.3 : 1.2)));
    if (quality.tier === "perfect") {
      const counter = Math.max(1, Math.round(combat.atk * 0.55));
      monsterHp = Math.max(0, monsterHp - counter);
      log.push(`完全回避！ カウンターで${counter}ダメージ！`);
    } else if (quality.tier === "good") {
      log.push("攻撃をかわした！");
    } else {
      log.push("回避が遅れた！");
    }
  }
  playerHp = Math.max(0, playerHp - actualIncoming);
  if (tacticalBattle) {
    const intentLine = intent.id === "heavy" ? "大振り攻撃！" : intent.id === "feint" ? "フェイントからの攻撃！" : "敵の攻撃！";
    log.push(actualIncoming === 0 ? `${intentLine} ダメージを受けなかった。` : `${intentLine} ${actualIncoming}ダメージを受けた。${defending ? "（ガード）" : ""}`);
  } else {
    log.push(`${battle.monster}の攻撃！ ${actualIncoming}ダメージを受けた。${defending ? "（防御成功）" : ""}`);
  }
  if (monsterHp <= 0) {
    log.push(`${battle.monster}にカウンターを決めた！`);
    return {
      ...battle,
      monsterHp,
      playerHp,
      log,
      phase: "won",
      atkBuffMult,
      ...(tacticalBattle ? { combo, breakGauge, combatEffect: "counter", combatEffectId: (battle.combatEffectId || 0) + 1 } : {}),
    };
  }
  if (playerHp <= 0) {
    log.push("倒れてしまった…");
    return {
      ...battle,
      monsterHp,
      playerHp,
      log,
      phase: "lost",
      atkBuffMult,
      ...(tacticalBattle ? { combo, breakGauge, combatEffect: "enemy-strike", combatEffectId: (battle.combatEffectId || 0) + 1 } : {}),
    };
  }
  return {
    ...battle,
    monsterHp,
    playerHp,
    log,
    phase: "select",
    pendingCommand: null,
    timingStart: null,
    atkBuffMult,
    ...(tacticalBattle ? {
      combo,
      breakGauge,
      exposed: false,
      intent: nextEnemyIntent(rng, battle.floor, intent.id),
      combatEffect: !defending && !dodging
        ? (command === "attack" || command === "skill" ? "exchange" : "enemy-strike")
        : combatEffect,
      combatEffectId: (battle.combatEffectId || 0) + 1,
    } : {}),
  };
}

export function resolveTimingHit(battle, combat, quality, rng = Math.random, battleV2 = BATTLE_V2_ENABLED) {
  const command = battle.pendingCommand;
  const battleForTurn = command === "skill" ? { ...battle, skillUsesLeft: Math.max(0, battle.skillUsesLeft - 1) } : battle;
  return resolveBattleTurn(battleForTurn, combat, command, quality, undefined, rng, battleV2);
}

// 逃げる（ESCAPE）: AGIが高いほど、また浅いフロアほど成功しやすい。
// 失敗しても敵から1回分の軽い反撃を受けるのみで、データやHPを大きく損なう重いペナルティにはしない。
export function escapeChance(floor, agi) {
  const base = 0.72 - Math.max(0, (floor || 1) - 1) * 0.025;
  const agiValue = Number(agi);
  const agiBonus = Math.max(0, (Number.isFinite(agiValue) ? agiValue : 30) - 30) / 300;
  return Math.max(0.3, Math.min(0.92, base + agiBonus));
}

export function resolveEscape(battle, combat, rng = Math.random) {
  const agi = Number(battle.combatProfile?.agi);
  const chance = escapeChance(battle.floor, Number.isFinite(agi) ? agi : 30);
  const success = rng() < chance;
  if (success) {
    return {
      ...battle,
      phase: "fled",
      combatEffect: "flee",
      combatEffectId: (battle.combatEffectId || 0) + 1,
      log: [...battle.log.slice(-4), "うまく逃げ切った！"],
    };
  }
  const playerDef = Math.max(0, combat?.def || 0);
  const penalty = Math.max(1, Math.round((battle.monsterAtk || 10) * 0.55 * (100 / (100 + playerDef * 1.5))));
  const playerHp = Math.max(0, battle.playerHp - penalty);
  const log = [...battle.log.slice(-4), `逃げ切れなかった！ ${penalty}ダメージを受けた。`];
  if (playerHp <= 0) {
    return { ...battle, playerHp, phase: "lost", combatEffect: "enemy-strike", combatEffectId: (battle.combatEffectId || 0) + 1, log: [...log, "倒れてしまった…"] };
  }
  return { ...battle, playerHp, combatEffect: "enemy-strike", combatEffectId: (battle.combatEffectId || 0) + 1, log };
}

export function computeCombatStats({ level, stats, jobMod, bonus }) {
  const s = stats || {};
  const lv = level || 1;
  const atk = Math.round(9 + lv * 1.4 + (s.STR || 30) * 0.55 * jobMod("STR") + (s.DEX || 30) * 0.25 * jobMod("DEX") + bonus.atk);
  const def = Math.round(4 + lv * 0.7 + (s.VIT || 30) * 0.35 * jobMod("VIT") + (s.AGI || 30) * 0.2 * jobMod("AGI") + bonus.def);
  const maxHp = Math.round(70 + lv * 9 + (s.VIT || 30) * 1.6 * jobMod("VIT") + bonus.maxHp);
  const skillPower = Math.round(atk * 1.55 + (s.WILL || 30) * 0.3 * jobMod("WILL") + bonus.skillPower);
  return { atk, def, maxHp, skillPower };
}

function battleLevelExp(level) {
  return 200 + (level - 1) * 40;
}

export function previewBattleReward(state, reward) {
  let exp = (state.exp || 0) + reward.exp;
  let level = state.level || 1;
  while (exp >= battleLevelExp(level)) {
    exp -= battleLevelExp(level);
    level++;
  }
  const levelsGained = level - (state.level || 1);
  return {
    exp,
    level,
    levelsGained,
    currency: reward.gold + levelsGained * 60,
  };
}

export function claimBattleReward(state, battleId, expectedBattle, rewardOverride) {
  const dungeon = state.dungeon;
  const battle = dungeon?.battle;
  const sameBattle = battleId ? battle?.battleId === battleId : battle === expectedBattle;
  const reward = battle?.reward || rewardOverride;
  if (!battle || battle.phase !== "won" || !sameBattle || battle.rewardClaimed || !reward) {
    return { state, claimed: false, reward: null };
  }

  const progression = previewBattleReward(state, reward);
  const { exp, level, levelsGained } = progression;
  let ownedEquipment = state.ownedEquipment || [];
  let equipment = state.equipment || {};
  const drop = reward.drop;
  if (drop && !ownedEquipment.includes(drop.id)) {
    ownedEquipment = [...ownedEquipment, drop.id];
    if (!equipment[drop.slot]) equipment = { ...equipment, [drop.slot]: drop.id };
  }

  return {
    claimed: true,
    reward: { ...reward, levelsGained },
    state: {
      ...state,
      exp,
      level,
      currency: (state.currency || 0) + progression.currency,
      ownedEquipment,
      equipment,
      dungeon: {
        ...dungeon,
        battle: null,
        currentFloor: Math.max(dungeon.currentFloor || 1, Math.min(DUNGEON_FLOORS.length, battle.floor + 1)),
        bestFloor: Math.max(dungeon.bestFloor || 0, battle.floor),
      },
    },
  };
}

export function createBattle(combat, floor, battleV2 = BATTLE_V2_ENABLED, options = {}) {
  const monster = monsterAt(floor, battleV2);
  const version = battleV2 ? BATTLE_VERSION : undefined;
  const attributes = options.attributes || {};
  const activeSkills = (options.skills || []).slice(0, 3);
  const attribute = (key) => {
    const value = Number(attributes[key]);
    return Number.isFinite(value) ? value : 30;
  };
  const maxMp = Math.round(24 + attribute("INT") * 0.42 + attribute("WILL") * 0.22);
  return {
    ...(version ? { version } : {}),
    floor,
    monster: monster.name,
    icon: monster.icon,
    image: monster.image,
    boss: monster.boss,
    playerHp: combat.maxHp,
    playerMaxHp: combat.maxHp,
    monsterHp: monster.hp,
    monsterMaxHp: monster.hp,
    monsterAtk: monster.atk,
    monsterDef: monster.def,
    phase: "select",
    pendingCommand: null,
    timingStart: null,
    skillUsesLeft: 3,
    itemUsesLeft: 1,
    atkBuffMult: 1,
    log: [`${monster.name}が現れた！`],
    lastHit: null,
    ...(version && version < BATTLE_VERSION ? { intent: ENEMY_INTENTS[0], combo: 0, breakGauge: 0, exposed: false, combatEffectId: 0, combatEffect: "enter" } : {}),
    ...(version && version >= BATTLE_VERSION ? {
      intent: battleIntent({ floor, enemyTurn: 0 }),
      enemyTurn: 0,
      breakGauge: 100,
      exposedTurns: 0,
      combo: 0,
      maxCombo: 0,
      activeSkills,
      combatProfile: {
        str: attribute("STR"),
        int: attribute("INT"),
        agi: attribute("AGI"),
        vit: attribute("VIT"),
        dex: attribute("DEX"),
        will: attribute("WILL"),
      },
      mp: maxMp,
      maxMp,
      energy: 100,
      playerStatuses: [],
      enemyStatuses: [],
      cooldowns: {},
      combatMetrics: { weakHits: 0, criticalHits: 0, perfectGuards: 0, breaks: 0, damageTaken: 0 },
      combatEffectId: 0,
      combatEffect: "enter",
    } : {}),
  };
}

export const TIMING_QUALITIES = {
  perfect: { label: "PERFECT", mult: 1.7, tier: "perfect" },
  good: { label: "GOOD", mult: 1.1, tier: "good" },
  miss: { label: "MISS", mult: 0.55, tier: "miss" },
};
