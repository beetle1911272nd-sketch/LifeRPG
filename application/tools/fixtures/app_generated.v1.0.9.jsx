// Regression fixture for the battle-related ranges from app.generated.jsx v1.0.9.
// Equipment keeps every field used by battle calculations; the legacy formulas/data remain unchanged.
const EQUIPMENT_ITEMS = [
  { id: "wood_sword", slot: "weapon", atk: 4 },
  { id: "bronze_dagger", slot: "weapon", atk: 7 },
  { id: "stone_axe", slot: "weapon", atk: 6 },
  { id: "iron_sword", slot: "weapon", atk: 10 },
  { id: "silver_rapier", slot: "weapon", atk: 13, skillPower: 3 },
  { id: "war_hammer", slot: "weapon", atk: 15 },
  { id: "twin_blades", slot: "weapon", atk: 12, skillPower: 5 },
  { id: "mythril_blade", slot: "weapon", atk: 18, skillPower: 6 },
  { id: "dragonfang_blade", slot: "weapon", atk: 24, skillPower: 10 },
  { id: "starlight_glaive", slot: "weapon", atk: 22, skillPower: 12 },
  { id: "leather_armor", slot: "armor", def: 4 },
  { id: "studded_leather", slot: "armor", def: 7, maxHp: 8 },
  { id: "cloth_robe", slot: "armor", def: 5, maxHp: 5 },
  { id: "chain_mail", slot: "armor", def: 10, maxHp: 15 },
  { id: "scale_armor", slot: "armor", def: 13, maxHp: 22 },
  { id: "knight_plate", slot: "armor", def: 14, maxHp: 18 },
  { id: "runed_hauberk", slot: "armor", def: 12, skillPower: 4 },
  { id: "aegis_plate", slot: "armor", def: 18, maxHp: 30 },
  { id: "titan_bulwark", slot: "armor", def: 24, maxHp: 45 },
  { id: "celestial_mantle", slot: "armor", def: 20, maxHp: 40, skillPower: 5 },
  { id: "lucky_charm", slot: "accessory", maxHp: 20 },
  { id: "swift_band", slot: "accessory", atk: 3, def: 3 },
  { id: "iron_bangle", slot: "accessory", def: 5 },
  { id: "sages_ring", slot: "accessory", skillPower: 10 },
  { id: "warriors_belt", slot: "accessory", atk: 8, def: 4 },
  { id: "guardian_brooch", slot: "accessory", def: 8, maxHp: 12 },
  { id: "hunters_earring", slot: "accessory", atk: 9, skillPower: 3 },
  { id: "dragon_amulet", slot: "accessory", atk: 6, def: 6, skillPower: 6 },
  { id: "phoenix_feather", slot: "accessory", maxHp: 50, skillPower: 8 },
  { id: "worldtree_seed", slot: "accessory", maxHp: 35, atk: 5, def: 5 },
];
const RARITY_META = {};
const EQUIP_SLOTS = [
  { id: "weapon", label: "武器" },
  { id: "armor", label: "防具" },
  { id: "accessory", label: "アクセサリー" },
];
const DUNGEON_DROP_TABLE = {};
const JOB_STAT_MODIFIERS = {
  勇者: { STR: 1.28, VIT: 1.1, DEX: 1.05, CHA: 1.05, INT: .82, WILL: 1.18 },
  賢者: { INT: 1.3, DEX: 1.1, FIN: 1.05, WILL: 1.02, STR: .82, VIT: .85 },
  剣士: { STR: 1.25, VIT: 1.2, WILL: 1.1, AGI: 1.02, INT: .85, CHA: .9 },
  狩人: { DEX: 1.25, AGI: 1.15, WILL: 1.05, STR: 1.02, VIT: .9, CHA: .88 },
  錬金術師: { DEX: 1.25, INT: 1.15, AGI: 1.05, WILL: 1.02, STR: .9, CHA: .85 },
  王: { CHA: 1.25, WILL: 1.12, FIN: 1.1, STR: 1.02, INT: .95, VIT: .92 },
  冒険者: { AGI: 1.22, STR: 1.08, DEX: 1.08, WILL: 1.08, VIT: .95, FIN: .92 },
  騎士: { VIT: 1.22, WILL: 1.12, STR: 1.1, CHA: 1.02, AGI: .94, DEX: .92 },
  商人: { FIN: 1.28, INT: 1.12, CHA: 1.05, DEX: 1.02, STR: .88, VIT: .9 },
  吟遊詩人: { CHA: 1.28, DEX: 1.1, AGI: 1.05, INT: .98, STR: .86, VIT: .9 },
};
const DIFFICULTY_MULTIPLIERS = {};
function jobStatModifier(job, stat) { return JOB_STAT_MODIFIERS[job?.name]?.[stat] || 1; }
const DUNGEON_MONSTERS = [
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
const DUNGEON_FLOORS = DUNGEON_MONSTERS.map((monster, index) => {
  const floor = index + 1;
  const boss = floor === 10;
  return {
    floor,
    boss,
    name: monster.name,
    icon: monster.icon,
    image: monster.image,
    hp: boss ? 240 : Math.round(42 + floor * 19),
    atk: boss ? 24 : Math.round(6 + floor * 2.5),
    def: boss ? 9 : Math.round(2 + floor * 1.5),
    exp: boss ? 260 : Math.round(24 + floor * 15),
    gold: boss ? 140 : Math.round(10 + floor * 7),
  };
});
function dungeonTier(floor) {
  if (floor >= 10) return "boss";
  if (floor >= 7) return "late";
  if (floor >= 4) return "mid";
  return "early";
}
function monsterAt(floor) { return DUNGEON_FLOORS[Math.min(Math.max(floor, 1), DUNGEON_FLOORS.length) - 1]; }
function normalizeDungeonDaily(dungeon, today) {
  const source = dungeon || createDungeonDefaults();
  return source.ticketDate === today ? source : { ...source, ticketDate: today, ticketsUsedToday: 0, bonusTickets: 0 };
}
function dungeonTicketLimit(dungeon) { return 3 + Math.min(3, dungeon?.bonusTickets || 0); }
function equipmentBonuses(state) {
  const equipment = state.equipment || {};
  const totals = { atk: 0, def: 0, maxHp: 0, skillPower: 0 };
  EQUIP_SLOTS.forEach((slot) => {
    const itemId = equipment[slot.id];
    const item = itemId && EQUIPMENT_ITEMS.find((entry) => entry.id === itemId);
    if (!item) return;
    totals.atk += item.atk || 0;
    totals.def += item.def || 0;
    totals.maxHp += item.maxHp || 0;
    totals.skillPower += item.skillPower || 0;
  });
  return totals;
}
function playerCombatStats(state) {
  const stats = state.stats || {};
  const level = state.level || 1;
  const job = state.job;
  const bonus = equipmentBonuses(state);
  const atk = Math.round(9 + level * 1.4 + (stats.STR || 30) * 0.55 * jobStatModifier(job, "STR") + (stats.DEX || 30) * 0.25 * jobStatModifier(job, "DEX") + bonus.atk);
  const def = Math.round(4 + level * 0.7 + (stats.VIT || 30) * 0.35 * jobStatModifier(job, "VIT") + (stats.AGI || 30) * 0.2 * jobStatModifier(job, "AGI") + bonus.def);
  const maxHp = Math.round(70 + level * 9 + (stats.VIT || 30) * 1.6 * jobStatModifier(job, "VIT") + bonus.maxHp);
  const skillPower = Math.round(atk * 1.55 + (stats.WILL || 30) * 0.3 * jobStatModifier(job, "WILL") + bonus.skillPower);
  return { atk, def, maxHp, skillPower };
}
function createBattle(state, floor) {
  const monster = monsterAt(floor);
  const combat = playerCombatStats(state);
  return { floor, monster: monster.name, icon: monster.icon, image: monster.image, boss: monster.boss, playerHp: combat.maxHp, playerMaxHp: combat.maxHp, monsterHp: monster.hp, monsterMaxHp: monster.hp, monsterAtk: monster.atk, monsterDef: monster.def, phase: "select", pendingCommand: null, timingStart: null, skillUsesLeft: 3, itemUsesLeft: 1, atkBuffMult: 1, log: [`${monster.name}が現れた！`], lastHit: null };
}
const TIMING_CYCLE_BY_TIER = { early: 1400, mid: 1150, late: 950, boss: 780 };
function timingCycleMs(floor) { return TIMING_CYCLE_BY_TIER[dungeonTier(floor)] || 1400; }
function timingQuality(elapsedMs, floor) {
  const cycle = timingCycleMs(floor);
  const phase = (((elapsedMs % (cycle * 2)) + cycle * 2) % (cycle * 2)) / cycle;
  const pos = phase <= 1 ? phase * 100 : (2 - phase) * 100;
  const distance = Math.abs(pos - 50);
  if (distance <= 9) return { label: "PERFECT", mult: 1.7, tier: "perfect" };
  if (distance <= 22) return { label: "GOOD", mult: 1.1, tier: "good" };
  return { label: "MISS", mult: 0.55, tier: "miss" };
}
function resolveBattleTurn(battle, combat, command, quality, itemEffect) {
  const log = battle.log.slice(-5);
  let monsterHp = battle.monsterHp;
  let playerHp = battle.playerHp;
  let defending = false;
  let atkBuffMult = battle.atkBuffMult || 1;
  if (command === "defend") { defending = true; log.push("身を守る構えをとった。"); }
  else if (command === "item" && itemEffect?.buff) { atkBuffMult = itemEffect.buff; log.push(`${itemEffect.name}を使い、次の一撃の威力が高まった！`); }
  else if (command === "item") { const heal = Math.round(battle.playerMaxHp * (itemEffect?.heal ?? 0.3)); playerHp = Math.min(battle.playerMaxHp, playerHp + heal); log.push(`${itemEffect?.name || "回復薬"}を使い、HPが${heal}回復した。`); }
  else { const base = command === "skill" ? combat.skillPower : combat.atk; const dmg = Math.max(1, Math.round(base * quality.mult * atkBuffMult - battle.monsterDef * 0.5)); monsterHp = Math.max(0, monsterHp - dmg); log.push(`${quality.label}！ ${command === "skill" ? "スキル" : "攻撃"}で${dmg}ダメージ！${atkBuffMult > 1 ? "（力の粉薬効果）" : ""}`); atkBuffMult = 1; }
  if (monsterHp <= 0) { log.push(`${battle.monster}を倒した！`); return { ...battle, monsterHp, playerHp, log, phase: "won", atkBuffMult }; }
  const variance = 0.85 + Math.random() * 0.3;
  const incoming = Math.max(1, Math.round(battle.monsterAtk * variance * (defending ? 0.45 : 1) - combat.def * 0.5));
  playerHp = Math.max(0, playerHp - incoming);
  log.push(`${battle.monster}の攻撃！ ${incoming}ダメージを受けた。${defending ? "（防御成功）" : ""}`);
  if (playerHp <= 0) { log.push("倒れてしまった…"); return { ...battle, monsterHp, playerHp, log, phase: "lost", atkBuffMult }; }
  return { ...battle, monsterHp, playerHp, log, phase: "select", pendingCommand: null, timingStart: null, atkBuffMult };
}
function resolveTimingHit(battle, combat, quality) {
  const command = battle.pendingCommand;
  const battleForTurn = command === "skill" ? { ...battle, skillUsesLeft: Math.max(0, battle.skillUsesLeft - 1) } : battle;
  return resolveBattleTurn(battleForTurn, combat, command, quality);
}
function levelExp(level) { return 200 + (level - 1) * 40; }
