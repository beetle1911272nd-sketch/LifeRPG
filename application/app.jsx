import React, { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from “react”;

/* ============================================================================
REAL LIFE RPG — 現実育成アプリ
ダークファンタジー × 洗練UI
============================================================================ */

/* —————————————————————————

1. データ定義・型・定数
   ————————————————————————— */

const STAT_KEYS = [“STR”, “INT”, “AGI”, “VIT”, “DEX”, “CHA”, “FIN”, “WILL”];

const STAT_META = {
STR: { label: “STR”, full: “筋力”, color: “#FF6B6B”, desc: “肉体の強さ。鍛錬によって育つ。” },
INT: { label: “INT”, full: “知力”, color: “#5B9DFF”, desc: “思考と学習の深さ。知識が力になる。” },
AGI: { label: “AGI”, full: “敏捷”, color: “#4ADE9E”, desc: “動きの速さと軽やかさ。” },
VIT: { label: “VIT”, full: “体力”, color: “#FF9B4A”, desc: “持久力と回復力。心身の土台。” },
DEX: { label: “DEX”, full: “技術”, color: “#C77DFF”, desc: “手先の器用さと創造の技。” },
CHA: { label: “CHA”, full: “魅力”, color: “#FF7DC4”, desc: “人を惹きつける力。関係を築く力。” },
FIN: { label: “FIN”, full: “財力”, color: “#FFD24A”, desc: “資産を築き、動かす力。” },
WILL: { label: “WILL”, full: “意志”, color: “#8B7BFF”, desc: “折れない心。継続する力。” },
};

const ACTIONS = [
{ id: “workout”, name: “筋トレ”, icon: “◆”, effects: { STR: 2 }, exp: 20 },
{ id: “running”, name: “ランニング”, icon: “◇”, effects: { VIT: 2 }, exp: 20 },
{ id: “reading”, name: “読書 30分”, icon: “▣”, effects: { INT: 1 }, exp: 15 },
{ id: “english”, name: “英語 30分”, icon: “▤”, effects: { INT: 1, CHA: 1 }, exp: 20 },
{ id: “design”, name: “デザイン制作”, icon: “◈”, effects: { DEX: 2 }, exp: 20 },
{ id: “work”, name: “仕事”, icon: “◉”, effects: { FIN: 2, WILL: 1 }, exp: 30 },
{ id: “sns”, name: “SNS投稿”, icon: “◐”, effects: { CHA: 1 }, exp: 10 },
{ id: “challenge”, name: “新しいことに挑戦”, icon: “★”, effects: { WILL: 2 }, exp: 20 },
];

const QUEST_DEFS = [
{ id: “q_exercise”, label: “運動する”, matchActions: [“workout”, “running”] },
{ id: “q_study”, label: “30分勉強する”, matchActions: [“reading”, “english”] },
{ id: “q_read”, label: “本を読む”, matchActions: [“reading”] },
{ id: “q_work”, label: “仕事をする”, matchActions: [“work”] },
{ id: “q_new”, label: “新しいことを1つやる”, matchActions: [“challenge”] },
];
const QUEST_BONUS_EXP = 100;

/* —————————————————————————
スキル自動生成システム（8ステータス × 10段階 × 13系統 = 1040種）
手作業でリストを書く代わりに、系統ごとの語彙テンプレートと
ステータス×段階のしきい値テーブルから自動組み立てする。
————————————————————————— */

// 各ステータスの「10段階」しきい値。診断直後の最大値は70程度だが、
// 行動やSTAT POINTでの成長を見据えて10〜100まで幅を持たせている。
const SKILL_TIERS = [10, 19, 28, 37, 46, 55, 64, 73, 82, 91];
const TIER_RANK_LABELS = [
“初心”, “見習い”, “熟達”, “精鋭”, “達人”,
“宗師”, “超越”, “神域”, “極致”, “伝説”,
];

// 系統：ステータスごとに異なる「役割イメージ」の語彙セットを持つ。
// name(段階, ステータス表記) と desc(段階ラベル, ステータス和名) を組み立てる。
const SKILL_SYSTEMS = [
{
id: “warrior”,
label: “闘士系統”,
color: “#FF6B6B”,
nounFor: (statFull) => `${statFull}の闘気`,
descTemplate: (rankLabel, statFull) => `${rankLabel}の域に達した${statFull}が、闘いの中で牙を剥く。`,
},
{
id: “sage”,
label: “賢者系統”,
color: “#5B9DFF”,
nounFor: (statFull) => `${statFull}の叡智`,
descTemplate: (rankLabel, statFull) => `${rankLabel}まで磨かれた${statFull}が、静かな洞察をもたらす。`,
},
{
id: “artisan”,
label: “工匠系統”,
color: “#C77DFF”,
nounFor: (statFull) => `${statFull}の匠技`,
descTemplate: (rankLabel, statFull) => `${rankLabel}の腕を持つ職人として、${statFull}が形になって現れる。`,
},
{
id: “shadow”,
label: “隠者系統”,
color: “#8B7BFF”,
nounFor: (statFull) => `${statFull}の隠奥義`,
descTemplate: (rankLabel, statFull) => `${rankLabel}に到達した${statFull}が、人知れず研ぎ澄まされている。`,
},
{
id: “sovereign”,
label: “王者系統”,
color: “#FFD24A”,
nounFor: (statFull) => `${statFull}の王威`,
descTemplate: (rankLabel, statFull) => `${rankLabel}の風格を纏い、${statFull}が周囲を圧倒する。`,
},
{
id: “wanderer”,
label: “旅人系統”,
color: “#4ADE9E”,
nounFor: (statFull) => `${statFull}の旅路`,
descTemplate: (rankLabel, statFull) => `${rankLabel}まで歩みを重ねた${statFull}が、確かな足跡を残す。`,
},
{
id: “guardian”,
label: “守護系統”,
color: “#FF9B4A”,
nounFor: (statFull) => `${statFull}の守護`,
descTemplate: (rankLabel, statFull) => `${rankLabel}の域で、${statFull}が何かを守る力へと変わる。`,
},
{
id: “oracle”,
label: “託宣系統”,
color: “#FF7DC4”,
nounFor: (statFull) => `${statFull}の託宣`,
descTemplate: (rankLabel, statFull) => `${rankLabel}に達し、${statFull}が未来を読む力を帯びる。`,
},
{
id: “forge”,
label: “鍛造系統”,
color: “#FF8C5B”,
nounFor: (statFull) => `${statFull}の鍛錬`,
descTemplate: (rankLabel, statFull) => `${rankLabel}まで鍛え上げた${statFull}が、揺るがぬ芯となる。`,
},
{
id: “phantom”,
label: “幻影系統”,
color: “#B98BFF”,
nounFor: (statFull) => `${statFull}の幻術`,
descTemplate: (rankLabel, statFull) => `${rankLabel}の境地で、${statFull}が捉えどころのない力を見せる。`,
},
{
id: “chronicle”,
label: “記録系統”,
color: “#6FE3D9”,
nounFor: (statFull) => `${statFull}の記憶`,
descTemplate: (rankLabel, statFull) => `${rankLabel}まで積み上げられた${statFull}が、歴史として刻まれる。`,
},
{
id: “star”,
label: “星辰系統”,
color: “#9DB8FF”,
nounFor: (statFull) => `${statFull}の星辰`,
descTemplate: (rankLabel, statFull) => `${rankLabel}の輝きを放ち、${statFull}が星のように導く。`,
},
{
id: “abyss”,
label: “深淵系統”,
color: “#7A6BFF”,
nounFor: (statFull) => `${statFull}の深淵`,
descTemplate: (rankLabel, statFull) => `${rankLabel}まで潜り抜けた${statFull}が、底知れぬ深みを見せる。`,
},
];

function generateSkillDefs() {
const defs = [];
for (const system of SKILL_SYSTEMS) {
for (const statKey of STAT_KEYS) {
const statFull = STAT_META[statKey].full;
for (let tier = 0; tier < SKILL_TIERS.length; tier++) {
const threshold = SKILL_TIERS[tier];
const rankLabel = TIER_RANK_LABELS[tier];
const id = `${system.id}_${statKey.toLowerCase()}_t${tier + 1}`;
const name = `${rankLabel}の${system.nounFor(statFull)}`;
const desc = system.descTemplate(rankLabel, statFull);
defs.push({
id,
name,
stat: statKey,
threshold,
desc,
system: system.id,
systemLabel: system.label,
color: system.color,
tier: tier + 1,
});
}
}
}
return defs;
}

const SKILL_DEFS = generateSkillDefs();

const RARITY = {
COMMON: { label: “COMMON”, color: “#9CA3AF” },
RARE: { label: “RARE”, color: “#5B9DFF” },
EPIC: { label: “EPIC”, color: “#C77DFF” },
LEGENDARY: { label: “LEGENDARY”, color: “#FFD24A” },
};

const TITLE_DEFS = [
{ id: “continuer”, name: “継続者”, rarity: “COMMON”, desc: “7日連続で行動を記録した者。”, check: (s) => s.bestStreak >= 7 },
{ id: “merchant”, name: “商人”, rarity: “RARE”, desc: “初めて商品を販売した者。”, check: (s) => s.flags.firstSale },
{ id: “unyielding”, name: “不屈の者”, rarity: “EPIC”, desc: “100日間、歩みを止めなかった者。”, check: (s) => s.bestStreak >= 100 },
{ id: “transcendent”, name: “上位存在”, rarity: “LEGENDARY”, desc: “全ステータス70以上に到達した者。”, check: (s) => STAT_KEYS.every((k) => s.stats[k] >= 70) },
{ id: “challenger”, name: “挑戦者”, rarity: “COMMON”, desc: “新しい挑戦を10回記録した者。”, check: (s) => s.actionCounts.challenge >= 10 },
];

const EXP_PER_LEVEL = (level) => 200 + (level - 1) * 40;
const STORAGE_KEY = “reallife_rpg_save_v1”;

/* —————————————————————————
1b. 診断（初期ステータス決定）
————————————————————————— */

// 各質問は1つ以上のステータスにスコアを与える。選択肢のscoreは0〜3。
// 最終ステータス = 30(ベース) + そのステータスに関する回答スコア合計 / スコア合計最大値 * 65
// これにより 30〜95 のレンジで個性が出るよう調整。
const DIAGNOSIS_QUESTIONS = [
{
id: “d1”,
text: “休日、気づくとやっていることは？”,
stat: “STR”,
options: [
{ label: “体を動かす・スポーツをする”, score: 3 },
{ label: “軽く散歩や運動をする”, score: 2 },
{ label: “家でゆっくり過ごす”, score: 1 },
{ label: “ほとんど動かない”, score: 0 },
],
},
{
id: “d1b”,
text: “重い荷物を運んだり、力仕事をするのは？”,
stat: “STR”,
options: [
{ label: “得意で、進んでやる”, score: 3 },
{ label: “普通にこなせる”, score: 2 },
{ label: “できればやりたくない”, score: 1 },
{ label: “かなり苦手”, score: 0 },
],
},
{
id: “d2”,
text: “新しい知識を得ることについて”,
stat: “INT”,
options: [
{ label: “毎日何かしら学んでいる”, score: 3 },
{ label: “気になった時に調べる程度”, score: 2 },
{ label: “たまに本や記事を読む”, score: 1 },
{ label: “ほとんど学ばない”, score: 0 },
],
},
{
id: “d2b”,
text: “複雑な問題を筋道立てて考えるのは？”,
stat: “INT”,
options: [
{ label: “得意で、むしろ楽しい”, score: 3 },
{ label: “時間をかければできる”, score: 2 },
{ label: “苦手意識がある”, score: 1 },
{ label: “できれば避けたい”, score: 0 },
],
},
{
id: “d3”,
text: “予定外の誘いや変化があったとき”,
stat: “AGI”,
options: [
{ label: “すぐに対応して動ける”, score: 3 },
{ label: “少し考えてから動く”, score: 2 },
{ label: “慎重に準備してから動く”, score: 1 },
{ label: “できれば避けたい”, score: 0 },
],
},
{
id: “d3b”,
text: “作業やタスクをこなすスピードは？”,
stat: “AGI”,
options: [
{ label: “人よりかなり速い方だと思う”, score: 3 },
{ label: “平均的なスピード”, score: 2 },
{ label: “やや時間がかかる方”, score: 1 },
{ label: “じっくり型で遅い”, score: 0 },
],
},
{
id: “d4”,
text: “睡眠と体調管理について”,
stat: “VIT”,
options: [
{ label: “しっかり管理できている”, score: 3 },
{ label: “だいたい規則正しい”, score: 2 },
{ label: “バラバラなことが多い”, score: 1 },
{ label: “かなり不規則”, score: 0 },
],
},
{
id: “d5”,
text: “手を動かして何かを作ること（作業・創作・制作）は？”,
stat: “DEX”,
options: [
{ label: “日常的にやっていて得意”, score: 3 },
{ label: “たまにやる、そこそこできる”, score: 2 },
{ label: “あまりやらない”, score: 1 },
{ label: “ほぼやったことがない”, score: 0 },
],
},
{
id: “d5b”,
text: “細かい作業やこだわりの仕上げについて”,
stat: “DEX”,
options: [
{ label: “納得いくまで丁寧に仕上げる”, score: 3 },
{ label: “ある程度こだわる”, score: 2 },
{ label: “早く終わらせたい方”, score: 1 },
{ label: “大雑把になりがち”, score: 0 },
],
},
{
id: “d6”,
text: “人との関わり方について”,
stat: “CHA”,
options: [
{ label: “初対面でも自然に話せる”, score: 3 },
{ label: “慣れれば普通に話せる”, score: 2 },
{ label: “親しい人とだけ話す”, score: 1 },
{ label: “人と話すのは苦手”, score: 0 },
],
},
{
id: “d6b”,
text: “人前で話したり、意見を発信するのは？”,
stat: “CHA”,
options: [
{ label: “積極的にやる、得意な方”, score: 3 },
{ label: “頼まれればできる”, score: 2 },
{ label: “できれば避けたい”, score: 1 },
{ label: “かなり苦手”, score: 0 },
],
},
{
id: “d7”,
text: “お金の管理・収入について”,
stat: “FIN”,
options: [
{ label: “収入源が複数あり管理もできている”, score: 3 },
{ label: “安定した収入があり管理できている”, score: 2 },
{ label: “収入はあるが管理は甘い”, score: 1 },
{ label: “特に意識していない”, score: 0 },
],
},
{
id: “d7b”,
text: “将来のお金の計画について”,
stat: “FIN”,
options: [
{ label: “具体的な目標と計画がある”, score: 3 },
{ label: “漠然とだが考えている”, score: 2 },
{ label: “あまり考えたことがない”, score: 1 },
{ label: “考えるのが苦手”, score: 0 },
],
},
{
id: “d8”,
text: “一度決めたことをやり抜く力は？”,
stat: “WILL”,
options: [
{ label: “何があっても最後までやる”, score: 3 },
{ label: “だいたいやり切れる”, score: 2 },
{ label: “途中で挫折することが多い”, score: 1 },
{ label: “三日坊主になりがち”, score: 0 },
],
},
{
id: “d9”,
text: “普段の生活リズムは？”,
stat: “VIT”,
options: [
{ label: “毎日ほぼ同じリズムで安定している”, score: 3 },
{ label: “だいたい安定している”, score: 2 },
{ label: “日によってバラバラ”, score: 1 },
{ label: “リズムというものがない”, score: 0 },
],
},
{
id: “d9b”,
text: “長時間の活動や作業を続ける持久力は？”,
stat: “VIT”,
options: [
{ label: “疲れにくく、長く続けられる”, score: