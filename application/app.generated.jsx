import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  createGuild as createRemoteGuild,
  createOpenWorldPairingBundle,
  deleteAccount,
  flushQueuedActionContributions,
  getAuthStatus,
  isUsernameAvailable,
  joinGuild as joinRemoteGuild,
  linkAccount,
  loadGameState,
  loadOpenWorldProgress,
  loadConversation,
  loadSocialData,
  closeCoopBattleChannel,
  openCoopBattleChannel,
  recordActionContribution,
  removeFriend as removeRemoteFriend,
  respondToFriendRequest,
  searchPublicProfiles,
  sendMessage as sendRemoteMessage,
  sendFriendRequest,
  sendCoopBattleMessage,
  supabase,
  syncLifeRpgState,
  saveOpenWorldProgress,
  updateGuildIcon as updateRemoteGuildIcon,
} from "./sandbox/supabase.js";
import {
  BATTLE_SKILLS,
  BATTLE_STATUS_EFFECTS,
  ENEMY_INTENTS,
  DUNGEON_FLOORS,
  availableBattleSkills,
  claimBattleReward,
  computeCombatStats,
  createBattle as createBattleCore,
  defaultBattleSkillLoadout,
  dungeonTier,
  monsterAt,
  previewBattleReward,
  resolveBattleTurn,
  resolveEscape,
  resolveTimingHit,
  timingCycleMs,
  timingQuality,
  timingQualityAtPosition,
} from "./sandbox/battle-core.js";
import {
  DAILY_QUESTS,
  adventurerRankFor,
  adaptiveActionTarget,
  advanceDailyQuests,
  countNewSkillUnlocks,
  dailyQuestView,
} from "./sandbox/progression-core.js";

const APP_VERSION = "1.0.9";
const STORAGE_KEY = "reallife_rpg_save_v1";
const LOCAL_MODIFIED_KEY = "reallife_rpg_local_modified_at";
const OPEN_WORLD_LOCAL_MODIFIED_KEY = "reallife_rpg_open_world_modified_at";
const OPEN_WORLD_EQUIPMENT_MODIFIED_KEY = "reallife_rpg_open_world_equipment_modified_at";
const STORAGE_VERSION = 2;
const SOUND_DEFAULTS = { enabled: true, volume: 0.22, ui: true, musicEnabled: true, musicVolume: 0.2 };
// 演出（モーション）トーストの表示時間。種類ごとに読み取りやすさを優先して調整。
const MOTION_DURATIONS = { "action-complete": 900, "level-up": 2200, "skill-unlock": 1900, "dungeon-unlock": 1900, "onboarding-complete": 2600 };
function useTweenedNumber(value, duration = 650) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef(null);
  useEffect(() => {
    const prefersReduced = typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
    if (prefersReduced || value === fromRef.current) {
      fromRef.current = value;
      setDisplay(value);
      return undefined;
    }
    const start = performance.now();
    const from = fromRef.current;
    const delta = value - from;
    const step = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(from + delta * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        fromRef.current = value;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);
  return display;
}
const isImageIcon = (value) => typeof value === "string" && value.startsWith("data:image");
function isTransientFileReadError(error) {
  return error?.name === "NotReadableError" || error?.name === "NotFoundError" || (error?.name === "TypeError" && /fetch/i.test(error?.message || ""));
}
// Finder/Photosライブラリから選んだ写真が、まだサンドボックス側で完全に
// 実体化されていない場合（iCloud同期中など）、読み込みが読み込み方式に
// 関係なく一時的に失敗することがある。この環境ではblob: URLのfetchが
// CSP等でそもそも使えないため、File API系の読み込み方式のみを
// 少し待ちながら複数回リトライする。プロフィール画像・GUILDアイコンの
// 両方から共通で使う。
async function readFileBufferWithRetries(file, { onRetryNotice } = {}) {
  const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const methods = [
    () => file.arrayBuffer(),
    () => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
      reader.readAsArrayBuffer(file);
    }),
  ];
  const attempts = 8;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const method = methods[attempt % methods.length];
    try {
      return await method();
    } catch (error) {
      lastError = error;
      if (!isTransientFileReadError(error)) throw error;
      if (attempt === 0) onRetryNotice?.();
      await wait(500 * (attempt + 1));
    }
  }
  throw lastError;
}
let soundContext = null;
let soundLastPlayed = {};
function playSound(type, settings = SOUND_DEFAULTS) {
  if (!settings?.enabled || !settings?.ui || typeof window === "undefined") return;
  const now = performance.now();
  if (now - (soundLastPlayed[type] || 0) < (type === "tap" ? 90 : 180)) return;
  soundLastPlayed[type] = now;
  try {
    soundContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (soundContext.state === "suspended") soundContext.resume();
    const context = soundContext;
    const gain = context.createGain();
    const oscillator = context.createOscillator();
    const start = context.currentTime;
    const tones = {
      tap: [880, 0.045, "sine"],
      tab: [1280, 0.065, "triangle"],
      transition: [420, 0.13, "sine"],
      complete: [660, 0.12, "sine"],
      exp: [740, 0.18, "sine"],
      level: [330, 0.95, "sine"],
      job: [520, 0.42, "triangle"],
      achievement: [1040, 0.2, "sine"],
      notification: [620, 0.1, "triangle"],
      error: [180, 0.12, "sine"],
      reset: [240, 0.2, "triangle"],
      phase: [520, 0.16, "triangle"],
    };
    const [frequency, duration, wave] = tones[type] || tones.tap;
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (type === "exp" || type === "level") oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.65, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, settings.volume * 0.18), start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  } catch (error) {
    console.warn("UIサウンドを再生できませんでした。", error);
  }
}
const STAT_KEYS = ["STR", "INT", "AGI", "VIT", "DEX", "CHA", "FIN", "WILL"];
const SKILL_THRESHOLDS = [20, 40, 60, 80, 100];
const STAT_META = {
  STR: { name: "筋力", color: "#d9d9d4" }, INT: { name: "知力", color: "#b9c4d2" },
  AGI: { name: "敏捷", color: "#b9cdbf" }, VIT: { name: "体力", color: "#d0c0ab" },
  DEX: { name: "技術", color: "#c2b9ce" }, CHA: { name: "魅力", color: "#d1bac3" },
  FIN: { name: "財力", color: "#d0c8a8" }, WILL: { name: "意志", color: "#bdb9ce" },
};

const ACTIONS = [
  { id: "workout", name: "筋トレ", icon: "◆", effects: { STR: 2 }, exp: 20 },
  { id: "running", name: "ランニング", icon: "◇", effects: { VIT: 2 }, exp: 20 },
  { id: "reading", name: "読書 30分", icon: "▣", effects: { INT: 1 }, exp: 15 },
  { id: "english", name: "英語 30分", icon: "▤", effects: { INT: 1, CHA: 1 }, exp: 20 },
  { id: "design", name: "デザイン制作", icon: "◈", effects: { DEX: 2 }, exp: 20 },
  { id: "work", name: "仕事", icon: "◉", effects: { FIN: 2, WILL: 1 }, exp: 30 },
  { id: "sns", name: "SNS投稿", icon: "◐", effects: { CHA: 1 }, exp: 10 },
  { id: "challenge", name: "新しいことに挑戦", icon: "★", effects: { WILL: 2 }, exp: 20 },
];
const GOALS = ["お金を稼ぎたい", "身体を鍛えたい", "勉強したい", "仕事で成功したい", "起業したい", "人気者になりたい", "恋愛・人間関係", "趣味を極めたい", "新しいことに挑戦したい", "自分を変えたい", "自由な生活をしたい"];
const ACTION_CATEGORIES = ["BODY", "MIND", "WORK", "STUDY", "MONEY", "SOCIAL", "CREATIVE", "LIFESTYLE", "CHALLENGE"];
const GOAL_CATEGORY = {
  "お金を稼ぎたい": "MONEY", "身体を鍛えたい": "BODY", "勉強したい": "STUDY", "仕事で成功したい": "WORK",
  "起業したい": "MONEY", "人気者になりたい": "SOCIAL", "恋愛・人間関係": "SOCIAL", "趣味を極めたい": "CREATIVE",
  "新しいことに挑戦したい": "CHALLENGE", "自分を変えたい": "MIND", "自由な生活をしたい": "LIFESTYLE",
};
const ACTION_LIBRARY = [
  { id: "water", name: "水を1杯飲む", category: "BODY", difficulty: "EASY", exp: 5, effects: { VIT: 1 }, tags: ["身体を鍛えたい", "自分を変えたい"] },
  { id: "walk", name: "10分歩く", category: "BODY", difficulty: "EASY", exp: 10, effects: { VIT: 1, AGI: 1 }, tags: ["身体を鍛えたい", "自分を変えたい"] },
  { id: "run", name: "30分ランニングする", category: "BODY", difficulty: "NORMAL", exp: 40, effects: { VIT: 2, STR: 1 }, tags: ["身体を鍛えたい"] },
  { id: "journal", name: "今日の気づきを3行書く", category: "MIND", difficulty: "EASY", exp: 10, effects: { WILL: 1 }, tags: ["自分を変えたい", "自由な生活をしたい"] },
  { id: "focus", name: "25分、ひとつのことに集中する", category: "MIND", difficulty: "NORMAL", exp: 25, effects: { WILL: 1, INT: 1 }, tags: ["自分を変えたい", "勉強したい"] },
  { id: "work-priority", name: "今日の最重要タスクを完了する", category: "WORK", difficulty: "HARD", exp: 70, effects: { WILL: 2, FIN: 1 }, tags: ["仕事で成功したい"] },
  { id: "study", name: "学びたいテーマを20分調べる", category: "STUDY", difficulty: "NORMAL", exp: 30, effects: { INT: 2 }, tags: ["勉強したい", "仕事で成功したい"] },
  { id: "sales", name: "新しい相手に1件連絡する", category: "MONEY", difficulty: "HARD", exp: 80, effects: { CHA: 2, FIN: 1 }, tags: ["お金を稼ぎたい", "起業したい"] },
  { id: "budget", name: "今週のお金の使い道を15分整理する", category: "MONEY", difficulty: "NORMAL", exp: 35, effects: { FIN: 2 }, tags: ["お金を稼ぎたい", "自由な生活をしたい"] },
  { id: "connect", name: "大切な人に近況を伝える", category: "SOCIAL", difficulty: "EASY", exp: 15, effects: { CHA: 2 }, tags: ["人気者になりたい", "恋愛・人間関係"] },
  { id: "create", name: "作品やアイデアを30分形にする", category: "CREATIVE", difficulty: "NORMAL", exp: 45, effects: { DEX: 2, INT: 1 }, tags: ["趣味を極めたい", "自分を変えたい"] },
  { id: "challenge", name: "初めてのことをひとつ試す", category: "CHALLENGE", difficulty: "HARD", exp: 70, effects: { AGI: 1, WILL: 2 }, tags: ["新しいことに挑戦したい"] },
  { id: "sleep", name: "就寝前に明日の準備をする", category: "LIFESTYLE", difficulty: "EASY", exp: 10, effects: { VIT: 1, FIN: 1 }, tags: ["自由な生活をしたい", "自分を変えたい"] },
  { id: "stretch", name: "10分ストレッチする", category: "BODY", difficulty: "EASY", exp: 12, effects: { VIT: 1, AGI: 1 }, tags: ["身体を鍛えたい", "自分を変えたい"] },
  { id: "sport", name: "好きなスポーツを30分する", category: "BODY", difficulty: "NORMAL", exp: 35, effects: { STR: 1, AGI: 1, VIT: 1 }, tags: ["身体を鍛えたい", "趣味を極めたい"] },
  { id: "meal", name: "次の食事を整えて選ぶ", category: "BODY", difficulty: "EASY", exp: 12, effects: { VIT: 1, FIN: 1 }, tags: ["身体を鍛えたい", "自分を変えたい"] },
  { id: "sleep-routine", name: "決めた時間に就寝する", category: "BODY", difficulty: "HARD", exp: 55, effects: { VIT: 2, WILL: 1 }, tags: ["身体を鍛えたい", "自由な生活をしたい"] },
  { id: "certification", name: "資格・試験の範囲を25分学ぶ", category: "STUDY", difficulty: "NORMAL", exp: 35, effects: { INT: 2, WILL: 1 }, tags: ["勉強したい", "仕事で成功したい"] },
  { id: "coding", name: "コードを書く・読む30分", category: "STUDY", difficulty: "NORMAL", exp: 40, effects: { INT: 1, DEX: 2 }, tags: ["勉強したい", "仕事で成功したい"] },
  { id: "language", name: "語学を15分使う", category: "STUDY", difficulty: "EASY", exp: 20, effects: { INT: 1, CHA: 1 }, tags: ["勉強したい", "人気者になりたい"] },
  { id: "research", name: "気になるテーマを調査して3行まとめる", category: "STUDY", difficulty: "NORMAL", exp: 30, effects: { INT: 2, DEX: 1 }, tags: ["勉強したい", "新しいことに挑戦したい"] },
  { id: "talk", name: "大切な人と15分話す", category: "SOCIAL", difficulty: "EASY", exp: 15, effects: { CHA: 2 }, tags: ["恋愛・人間関係", "人気者になりたい"] },
  { id: "new-person", name: "初対面の人に挨拶する", category: "SOCIAL", difficulty: "HARD", exp: 55, effects: { CHA: 2, WILL: 1 }, tags: ["人気者になりたい", "新しいことに挑戦したい"] },
  { id: "help", name: "誰かの負担をひとつ減らす", category: "SOCIAL", difficulty: "NORMAL", exp: 30, effects: { CHA: 1, VIT: 1 }, tags: ["恋愛・人間関係", "人気者になりたい"] },
  { id: "presentation", name: "考えを3分で説明する", category: "SOCIAL", difficulty: "HARD", exp: 65, effects: { CHA: 2, WILL: 1 }, tags: ["仕事で成功したい", "人気者になりたい"] },
  { id: "video", name: "短い動画を編集・公開する", category: "CREATIVE", difficulty: "HARD", exp: 65, effects: { DEX: 2, CHA: 1 }, tags: ["趣味を極めたい", "人気者になりたい"] },
  { id: "music", name: "音楽を30分練習する", category: "CREATIVE", difficulty: "NORMAL", exp: 35, effects: { DEX: 2, WILL: 1 }, tags: ["趣味を極めたい"] },
  { id: "writing", name: "文章を400字書く", category: "CREATIVE", difficulty: "NORMAL", exp: 35, effects: { DEX: 1, INT: 1 }, tags: ["趣味を極めたい", "自分を変えたい"] },
  { id: "idea", name: "アイデアを10個書き出す", category: "CREATIVE", difficulty: "EASY", exp: 20, effects: { DEX: 1, AGI: 1 }, tags: ["起業したい", "新しいことに挑戦したい"] },
  { id: "tidy", name: "机・部屋を15分整える", category: "DISCIPLINE", difficulty: "EASY", exp: 15, effects: { FIN: 1, WILL: 1 }, tags: ["自分を変えたい", "自由な生活をしたい"] },
  { id: "early", name: "決めた時間に起きる", category: "DISCIPLINE", difficulty: "NORMAL", exp: 30, effects: { WILL: 2 }, tags: ["自分を変えたい", "自由な生活をしたい"] },
  { id: "focus-limit", name: "SNSを決めた時間だけ制限する", category: "DISCIPLINE", difficulty: "HARD", exp: 55, effects: { WILL: 2, INT: 1 }, tags: ["自分を変えたい", "勉強したい"] },
  { id: "plan", name: "明日の予定を3つに絞る", category: "DISCIPLINE", difficulty: "EASY", exp: 15, effects: { FIN: 1, INT: 1 }, tags: ["仕事で成功したい", "自由な生活をしたい"] },
  { id: "sidework", name: "副業の作業を30分進める", category: "CAREER", difficulty: "HARD", exp: 70, effects: { FIN: 2, WILL: 1 }, tags: ["お金を稼ぎたい", "起業したい"] },
  { id: "sales-call", name: "仕事の相手に1件提案する", category: "CAREER", difficulty: "HARD", exp: 75, effects: { CHA: 1, FIN: 2 }, tags: ["お金を稼ぎたい", "仕事で成功したい"] },
  { id: "career-plan", name: "キャリアの次の一手を20分考える", category: "CAREER", difficulty: "NORMAL", exp: 35, effects: { INT: 1, FIN: 1, WILL: 1 }, tags: ["仕事で成功したい", "起業したい"] },
  { id: "epic-project", name: "重要な成果物を90分完成に近づける", category: "CAREER", difficulty: "EPIC", exp: 105, effects: { FIN: 2, WILL: 2, DEX: 1 }, tags: ["仕事で成功したい", "起業したい"], minLevel: 8 },
  { id: "legendary-challenge", name: "人生を変える一歩を実行して記録する", category: "CHALLENGE", difficulty: "LEGENDARY", exp: 120, effects: { WILL: 3, AGI: 1, CHA: 1 }, tags: ["新しいことに挑戦したい", "自分を変えたい"], minLevel: 15 },
];
const QUESTS = [
  { id: "exercise", name: "運動する", actions: ["workout", "running"] },
  { id: "study", name: "30分勉強する", actions: ["reading", "english"] },
  { id: "read", name: "本を読む", actions: ["reading"] },
  { id: "work", name: "仕事をする", actions: ["work"] },
  { id: "challenge", name: "新しいことに挑戦する", actions: ["challenge"] },
];

const QUESTIONS = [
  ["新しいことを始めるとき、あなたは？", [["まず行動する", { STR: 2, WILL: 1 }], ["少し調べてから行動する", { INT: 1, DEX: 1 }], ["計画を立ててから行動する", { FIN: 1, WILL: 1 }], ["失敗しないか慎重に考える", { INT: 1, VIT: 1 }]]],
  ["チームで自然に担う役割は？", [["先頭に立つ", { STR: 1, CHA: 2 }], ["全体を整理する", { INT: 2, FIN: 1 }], ["雰囲気を支える", { CHA: 2, VIT: 1 }], ["一人で専門作業をする", { DEX: 2, WILL: 1 }]]],
  ["難しい問題に出会ったら？", [["何度も試す", { WILL: 2, STR: 1 }], ["原因を分解する", { INT: 2, DEX: 1 }], ["人に相談する", { CHA: 2 }], ["別の方法を探す", { AGI: 2, DEX: 1 }]]],
  ["予定外の変化への対応は？", [["すぐ切り替える", { AGI: 2, WILL: 1 }], ["情報を集めて判断する", { INT: 2 }], ["周囲と相談する", { CHA: 1, VIT: 1 }], ["できれば避けたい", { VIT: 1, FIN: 1 }]]],
  ["あなたの学び方に近いものは？", [["実践で覚える", { STR: 1, DEX: 1 }], ["本や講義で深める", { INT: 2 }], ["人と話しながら学ぶ", { CHA: 2 }], ["興味の対象を広く探す", { AGI: 1, DEX: 1 }]]],
  ["習慣を続けるために大切なものは？", [["気合いで続ける", { WILL: 2 }], ["予定に組み込む", { FIN: 2 }], ["誰かと一緒にする", { CHA: 1, VIT: 1 }], ["楽しさを見つける", { DEX: 1, AGI: 1 }]]],
  ["人前で話すときは？", [["堂々と伝える", { CHA: 2, WILL: 1 }], ["論理的に準備する", { INT: 2 }], ["聞き役に回る", { VIT: 1, CHA: 1 }], ["少人数なら話せる", { CHA: 1 }]]],
  ["休日の過ごし方は？", [["体を動かす", { STR: 1, VIT: 2 }], ["創作や趣味に没頭する", { DEX: 2 }], ["友人と出かける", { CHA: 2 }], ["静かに一人で過ごす", { WILL: 1, INT: 1 }]]],
  ["リスクのある機会が来たら？", [["迷わず挑戦する", { STR: 1, AGI: 2 }], ["成功確率を計算する", { INT: 2, FIN: 1 }], ["小さく試す", { DEX: 1, WILL: 1 }], ["安全を優先する", { VIT: 2 }]]],
  ["お金との付き合い方は？", [["成長のために投資する", { FIN: 2, WILL: 1 }], ["記録して管理する", { FIN: 2, INT: 1 }], ["体験に使う", { CHA: 1, AGI: 1 }], ["つい使ってしまう", { AGI: 1 }]]],
  ["目標を立てるときは？", [["大きな夢から逆算する", { WILL: 2 }], ["数字と期限を決める", { FIN: 2 }], ["まず今日の一歩を決める", { STR: 1, AGI: 1 }], ["成り行きを楽しむ", { DEX: 1, AGI: 1 }]]],
  ["競争についてどう感じる？", [["勝ちたい", { STR: 2, WILL: 1 }], ["成長できればよい", { INT: 1, WILL: 1 }], ["仲間と高め合いたい", { CHA: 2 }], ["競争は苦手", { VIT: 1 }]]],
  ["自分の感情を扱うのは？", [["すぐ切り替えられる", { AGI: 1, WILL: 2 }], ["冷静に分析する", { INT: 2 }], ["誰かに話して整理する", { CHA: 2 }], ["時間をかけて落ち着く", { VIT: 2 }]]],
  ["集中できる環境は？", [["短時間で一気に進める", { STR: 1, AGI: 1 }], ["静かな場所で深く集中する", { INT: 1, DEX: 2 }], ["締切があると強い", { FIN: 1, WILL: 1 }], ["気分に合わせて進める", { DEX: 1 }]]],
  ["体調管理について？", [["運動を習慣にしている", { STR: 1, VIT: 2 }], ["睡眠や食事を記録する", { FIN: 1, VIT: 2 }], ["無理をしてしまう", { WILL: 1 }], ["体調に合わせて柔軟に変える", { AGI: 2 }]]],
  ["創造性を使う場面は？", [["新しいアイデアを出す", { DEX: 2, AGI: 1 }], ["既存のものを改善する", { INT: 1, DEX: 2 }], ["人の魅力を引き出す", { CHA: 2 }], ["あまり必要としない", { FIN: 1 }]]],
  ["責任を任されたら？", [["最後まで背負う", { WILL: 2, VIT: 1 }], ["役割を分担する", { CHA: 1, FIN: 1 }], ["効率的な方法を考える", { INT: 2 }], ["まずやってみる", { STR: 2 }]]],
  ["知らない人との交流は？", [["自分から話しかける", { CHA: 2, STR: 1 }], ["共通点を探す", { INT: 1, CHA: 1 }], ["相手から話すのを待つ", { VIT: 1 }], ["一人の時間を好む", { WILL: 1, DEX: 1 }]]],
  ["失敗したときの反応は？", [["すぐ次を試す", { AGI: 2, WILL: 1 }], ["原因を分析する", { INT: 2 }], ["誰かの意見を聞く", { CHA: 1 }], ["慎重になり時間を置く", { VIT: 1, FIN: 1 }]]],
  ["自分の能力について？", [["まだ伸ばせると信じる", { WILL: 2 }], ["得意分野を深めたい", { INT: 1, DEX: 1 }], ["人との関係で活かしたい", { CHA: 2 }], ["安定した生活に活かしたい", { FIN: 2 }]]],
  ["旅行や外出では？", [["予定なしで冒険する", { AGI: 2, STR: 1 }], ["綿密に計画する", { FIN: 2, INT: 1 }], ["現地の人と交流する", { CHA: 2 }], ["自分のペースで探索する", { WILL: 1, DEX: 1 }]]],
  ["健康上の困難には？", [["鍛えて乗り越える", { STR: 2, VIT: 1 }], ["情報を調べ対策する", { INT: 2 }], ["周りに助けを求める", { CHA: 1, VIT: 1 }], ["無理せず調整する", { AGI: 1, VIT: 1 }]]],
  ["仕事で評価されたい点は？", [["成果と突破力", { STR: 2, WILL: 1 }], ["正確さと知識", { INT: 2, DEX: 1 }], ["信頼と人望", { CHA: 2 }], ["安定感と継続力", { VIT: 1, FIN: 1 }]]],
  ["新しい趣味を選ぶなら？", [["スポーツや身体活動", { STR: 1, VIT: 1 }], ["技術や知識の習得", { INT: 2 }], ["アートや制作", { DEX: 2 }], ["未知の体験", { AGI: 2 }]]],
  ["意見が対立したら？", [["自分の意見を貫く", { WILL: 2 }], ["根拠を示して説得する", { INT: 2 }], ["双方の案をまとめる", { CHA: 2 }], ["一度距離を置く", { VIT: 1, AGI: 1 }]]],
  ["人生で大切にしたいものは？", [["達成と勝利", { STR: 1, WILL: 2 }], ["知識と理解", { INT: 2 }], ["つながりと愛情", { CHA: 2 }], ["自由と探究", { AGI: 2, DEX: 1 }]]],
  ["日々の記録をつける？", [["数字で管理する", { FIN: 2 }], ["考えや気づきを書く", { INT: 1, DEX: 1 }], ["写真や作品を残す", { DEX: 2 }], ["記録より体験を重視する", { AGI: 1 }]]],
  ["プレッシャーの中では？", [["燃える", { STR: 1, WILL: 2 }], ["冷静に手順を作る", { INT: 2, FIN: 1 }], ["周囲を励ます", { CHA: 2 }], ["守りを固める", { VIT: 2 }]]],
  ["これから伸ばしたいものは？", [["行動力", { STR: 2, AGI: 1 }], ["知力・専門性", { INT: 2, DEX: 1 }], ["人を動かす力", { CHA: 2, WILL: 1 }], ["自分を整える力", { VIT: 1, FIN: 1 }]]],
];

const JOBS = [
  { name: "勇者", icon: "⚔", desc: "先頭に立ち、困難を突破する開拓者。", tags: ["行動力", "リーダーシップ", "精神力"], weights: { STR: 1.2, WILL: 1.2, CHA: .8, AGI: .9 }, action: "未知の課題にまず一歩踏み出す" },
  { name: "賢者", icon: "✧", desc: "知識と分析で最適な道を導く探究者。", tags: ["知力", "論理性", "学習意欲"], weights: { INT: 1.3, DEX: .9, FIN: .8, WILL: .8 }, action: "学びを深め、仕組みに変える" },
  { name: "剣士", icon: "†", desc: "鍛えた身体と意志で己の限界を越える戦士。", tags: ["身体能力", "競争心", "継続力"], weights: { STR: 1.3, VIT: 1.1, WILL: 1, AGI: .8 }, action: "身体を動かし、昨日の自分を越える" },
  { name: "狩人", icon: "⌁", desc: "観察と集中で機会を見抜く孤高の実践者。", tags: ["集中力", "判断力", "独立心"], weights: { DEX: 1.2, AGI: 1.1, WILL: .9, INT: .9 }, action: "静かに観察し、最適な瞬間に動く" },
  { name: "錬金術師", icon: "◇", desc: "好奇心と創造性で新しい価値を生み出す発明家。", tags: ["創造性", "好奇心", "問題解決"], weights: { DEX: 1.3, INT: 1, AGI: 1, CHA: .7 }, action: "小さな実験を積み重ねる" },
  { name: "王", icon: "♛", desc: "人を束ね、理想を現実にする統率者。", tags: ["統率力", "社交性", "野心"], weights: { CHA: 1.3, WILL: 1.1, FIN: 1, STR: .8 }, action: "仲間と目的を共有し、成果を生む" },
  { name: "冒険者", icon: "✦", desc: "未知を楽しみ、自由に人生を切り拓く旅人。", tags: ["好奇心", "挑戦心", "リスク許容度"], weights: { AGI: 1.3, STR: 1, DEX: 1, WILL: .9 }, action: "新しい場所・人・体験を選ぶ" },
  { name: "騎士", icon: "🛡", desc: "責任と協調を胸に、長い道を守り抜く守護者。", tags: ["責任感", "協調性", "継続力"], weights: { VIT: 1.2, WILL: 1, CHA: 1, FIN: .8 }, action: "約束を守り、継続を力に変える" },
  { name: "商人", icon: "◈", desc: "価値を見極め、資源を未来へ投じる戦略家。", tags: ["金銭感覚", "計画性", "判断力"], weights: { FIN: 1.3, INT: 1.1, CHA: .9, DEX: .8 }, action: "時間とお金の使い道を設計する" },
  { name: "吟遊詩人", icon: "♪", desc: "言葉と共感で人の心を動かす表現者。", tags: ["表現力", "社交性", "感情理解"], weights: { CHA: 1.3, DEX: 1, INT: .8, AGI: .9 }, action: "感じたことを言葉や作品で届ける" },
];

const CURRENCY_ICON = "◈";
const CURRENCY_NAME = "AURUM";
function formatCurrency(amount) { return `${CURRENCY_ICON} ${Math.max(0, Math.round(amount || 0)).toLocaleString()} ${CURRENCY_NAME}`; }
const LEVEL_UP_CURRENCY_BONUS = 60;
const QUEST_CURRENCY_BONUS = 40;
const RANK_UP_CURRENCY_BONUS = 150;
const STREAK_MILESTONE_BONUS = { 3: 30, 7: 80, 14: 150, 30: 300, 60: 600, 100: 1200 };
function skillCountFor(stats) {
  return STAT_KEYS.reduce((total, stat) => total + SKILL_THRESHOLDS.filter((threshold) => (stats?.[stat] || 0) >= threshold).length, 0);
}
const SHOP_ITEMS = [
  { id: "mini_potion", name: "簡易回復薬", desc: "HPを15%回復する。安価で気軽に持ち歩ける常備薬。", cost: 20, icon: "🩹", invKey: "miniPotions", heal: 0.15 },
  { id: "potion", name: "回復薬", desc: "HPを30%回復する。戦闘ごとに1回は無料で使え、在庫は次の挑戦にも持ち越せる。", cost: 45, icon: "🧪", invKey: "potions", heal: 0.3 },
  { id: "herb_tonic", name: "薬草茶", desc: "HPを22%回復する優しい味の薬湯。", cost: 32, icon: "🍵", invKey: "herbTonics", heal: 0.22 },
  { id: "hi_potion", name: "上級回復薬", desc: "HPを60%回復する上位アイテム。ここぞという場面に。", cost: 90, icon: "💊", invKey: "hiPotions", heal: 0.6 },
  { id: "sparkling_tonic", name: "煌めきの秘薬", desc: "HPを45%回復する上質な回復薬。", cost: 65, icon: "🥤", invKey: "sparklingTonics", heal: 0.45 },
  { id: "mega_potion", name: "エリクサー", desc: "HPを100%全回復する最高級の秘薬。", cost: 160, icon: "🧴", invKey: "megaPotions", heal: 1 },
  { id: "power_draught", name: "力の粉薬", desc: "次の一撃の威力が1.5倍になる戦闘用ブースト。", cost: 70, icon: "🧉", invKey: "powerDraughts", buff: 1.5 },
  { id: "fierce_draught", name: "猛襲の秘薬", desc: "次の一撃の威力が1.3倍になる手軽なブースト。", cost: 40, icon: "🌶", invKey: "fierceDraughts", buff: 1.3 },
  { id: "mega_draught", name: "剛力の秘薬", desc: "次の一撃の威力が2倍になる強力なブースト。", cost: 150, icon: "🍶", invKey: "megaDraughts", buff: 2 },
  { id: "berserker_draught", name: "狂戦士の秘薬", desc: "次の一撃の威力が2.5倍になる究極のブースト。", cost: 260, icon: "🔥", invKey: "berserkerDraughts", buff: 2.5 },
];
const EQUIPMENT_ITEMS = [
  { id: "wood_sword", slot: "weapon", name: "木の剣", desc: "駆け出し冒険者向けの一振り。", cost: 80, icon: "🗡", atk: 4, rarity: "common" },
  { id: "bronze_dagger", slot: "weapon", name: "青銅の短剣", desc: "取り回しの良い軽量武器。", cost: 140, icon: "🔪", atk: 7, rarity: "common" },
  { id: "stone_axe", slot: "weapon", name: "石斧", desc: "叩き付ける重さが魅力の武器。", cost: 100, icon: "🪓", atk: 6, rarity: "common" },
  { id: "iron_sword", slot: "weapon", name: "鉄の剣", desc: "しっかりとした重みの標準装備。", cost: 220, icon: "⚔", atk: 10, rarity: "rare" },
  { id: "silver_rapier", slot: "weapon", name: "銀のレイピア", desc: "鋭い突きでスキルの冴えを引き出す一振り。", cost: 320, icon: "🤺", atk: 13, skillPower: 3, rarity: "rare" },
  { id: "war_hammer", slot: "weapon", name: "戦鎚", desc: "一撃の重さで敵を圧倒する大型武器。", cost: 300, icon: "🔨", atk: 15, rarity: "rare" },
  { id: "twin_blades", slot: "weapon", name: "双刃剣", desc: "連撃を得意とする軽快な二刀。", cost: 340, icon: "🗡", atk: 12, skillPower: 5, rarity: "rare" },
  { id: "mythril_blade", slot: "weapon", name: "ミスリルブレード", desc: "軽く鋭い伝説級の刀身。スキル威力も高める。", cost: 480, icon: "🔱", atk: 18, skillPower: 6, rarity: "legendary" },
  { id: "dragonfang_blade", slot: "weapon", name: "竜牙の剣", desc: "竜の牙から鍛えられた至高の一振り。", cost: 650, icon: "🗡️", atk: 24, skillPower: 10, rarity: "legendary" },
  { id: "starlight_glaive", slot: "weapon", name: "星光の大薙刀", desc: "星の力を宿し全能力を高める神器。", cost: 720, icon: "🌠", atk: 22, skillPower: 12, rarity: "legendary" },
  { id: "leather_armor", slot: "armor", name: "レザーアーマー", desc: "身軽さを損なわない基本の防具。", cost: 80, icon: "🥋", def: 4, rarity: "common" },
  { id: "studded_leather", slot: "armor", name: "スタッズレザー", desc: "鋲を打った補強済みの軽装鎧。", cost: 140, icon: "🦺", def: 7, maxHp: 8, rarity: "common" },
  { id: "cloth_robe", slot: "armor", name: "布のローブ", desc: "軽さを活かした修行者向けの装い。", cost: 100, icon: "🧥", def: 5, maxHp: 5, rarity: "common" },
  { id: "chain_mail", slot: "armor", name: "チェインメイル", desc: "重厚な鎖帷子。耐久力も底上げする。", cost: 220, icon: "🛡", def: 10, maxHp: 15, rarity: "rare" },
  { id: "scale_armor", slot: "armor", name: "スケイルアーマー", desc: "鱗状の装甲板が衝撃を分散する。", cost: 320, icon: "🐲", def: 13, maxHp: 22, rarity: "rare" },
  { id: "knight_plate", slot: "armor", name: "騎士のプレート", desc: "実戦で磨かれた堅牢な鎧。", cost: 300, icon: "🎽", def: 14, maxHp: 18, rarity: "rare" },
  { id: "runed_hauberk", slot: "armor", name: "紋章の鎖帷子", desc: "護りの紋様が刻まれた特注の鎧。", cost: 340, icon: "🧿", def: 12, skillPower: 4, rarity: "rare" },
  { id: "aegis_plate", slot: "armor", name: "イージスプレート", desc: "最高峰の全身鎧。圧倒的な守りを誇る。", cost: 480, icon: "🏯", def: 18, maxHp: 30, rarity: "legendary" },
  { id: "titan_bulwark", slot: "armor", name: "タイタンバルワーク", desc: "巨人の加護を宿す不滅の鎧。", cost: 650, icon: "🏰", def: 24, maxHp: 45, rarity: "legendary" },
  { id: "celestial_mantle", slot: "armor", name: "天空の外套", desc: "天の加護を纏う伝説の外套。", cost: 720, icon: "🪽", def: 20, maxHp: 40, skillPower: 5, rarity: "legendary" },
  { id: "lucky_charm", slot: "accessory", name: "幸運のお守り", desc: "身を守る加護が宿るお守り。", cost: 120, icon: "🍀", maxHp: 20, rarity: "common" },
  { id: "swift_band", slot: "accessory", name: "俊足のバンド", desc: "身のこなしを軽くし攻守のバランスを整える。", cost: 160, icon: "🎗", atk: 3, def: 3, rarity: "common" },
  { id: "iron_bangle", slot: "accessory", name: "鉄の腕輪", desc: "鍛冶師手製の頑丈な腕輪。", cost: 100, icon: "⭕", def: 5, rarity: "common" },
  { id: "sages_ring", slot: "accessory", name: "賢者の指輪", desc: "魔力を高め、スキルの威力を引き上げる。", cost: 260, icon: "💍", skillPower: 10, rarity: "rare" },
  { id: "warriors_belt", slot: "accessory", name: "闘士のベルト", desc: "攻守を兼ね備えた歴戦の証。", cost: 300, icon: "🥊", atk: 8, def: 4, rarity: "rare" },
  { id: "guardian_brooch", slot: "accessory", name: "守護のブローチ", desc: "身に着ける者を静かに見守る護符。", cost: 280, icon: "🧷", def: 8, maxHp: 12, rarity: "rare" },
  { id: "hunters_earring", slot: "accessory", name: "狩人のイヤリング", desc: "研ぎ澄まされた感覚を呼び覚ます耳飾り。", cost: 320, icon: "💎", atk: 9, skillPower: 3, rarity: "rare" },
  { id: "dragon_amulet", slot: "accessory", name: "竜のアミュレット", desc: "竜の力を宿す至宝。全能力をわずかに底上げする。", cost: 520, icon: "🐉", atk: 6, def: 6, skillPower: 6, rarity: "legendary" },
  { id: "phoenix_feather", slot: "accessory", name: "不死鳥の羽", desc: "尽きぬ生命力とスキルの冴えをもたらす奇跡の羽。", cost: 700, icon: "🪶", maxHp: 50, skillPower: 8, rarity: "legendary" },
  { id: "worldtree_seed", slot: "accessory", name: "世界樹の種", desc: "生命の根源が宿る神秘の種。", cost: 750, icon: "🌱", maxHp: 35, atk: 5, def: 5, rarity: "legendary" },
  { id: "voidedge_blade", slot: "weapon", name: "虚空刃", desc: "闇を纏う紫光の刀身。レアと伝説の狭間の力を宿す。", cost: 420, icon: "🗡", atk: 16, skillPower: 7, rarity: "epic" },
  { id: "nightveil_armor", slot: "armor", name: "夜帷の鎧", desc: "紫紺の霧を纏う希少な鎧。", cost: 400, icon: "🛡", def: 16, maxHp: 26, rarity: "epic" },
  { id: "amethyst_signet", slot: "accessory", name: "紫水晶の印章", desc: "深紫の輝きを放つ稀少な指輪。", cost: 380, icon: "💍", atk: 5, skillPower: 7, rarity: "epic" },
];
const RARITY_META = {
  common: { label: "コモン", color: "#9fb0a6" },
  rare: { label: "レア", color: "#7fb4e0" },
  epic: { label: "エピック", color: "#b98fe0" },
  legendary: { label: "レジェンダリー", color: "#e8c76a" },
};
const EQUIP_SLOTS = [
  { id: "weapon", label: "武器" },
  { id: "armor", label: "防具" },
  { id: "accessory", label: "アクセサリー" },
];
const DUNGEON_DROP_TABLE = {
  early: { chance: 0.12, rarities: ["common"] },
  mid: { chance: 0.18, rarities: ["common", "rare"] },
  late: { chance: 0.24, rarities: ["rare"] },
  boss: { chance: 0.4, rarities: ["rare", "legendary"] },
};
// --- LIFE GACHA --------------------------------------------------------
// 確率・排出プールは定数化し、後からバランス調整しやすくしている。
const GACHA_RATES = { common: 0.6, rare: 0.28, epic: 0.1, legendary: 0.02 };
const GACHA_DUPLICATE_CONVERSION = { common: 25, rare: 70, epic: 160, legendary: 350 };
const GACHA_TICKET_COST = { single: 1, ten: 10 };
// AURUMでの直接購入にも対応。10連はまとめ買い割引(約10%オフ)を適用する。
const GACHA_AURUM_COST = { single: 120, ten: 1080 };
const GACHA_POOL = {
  common: [
    { kind: "consumable", itemId: "mini_potion", weight: 3 },
    { kind: "consumable", itemId: "herb_tonic", weight: 2 },
    { kind: "consumable", itemId: "potion", weight: 2 },
    { kind: "exp", amount: 40, weight: 3 },
    { kind: "currency", amount: 35, weight: 2 },
    { kind: "equipment", rarity: "common", weight: 2 },
  ],
  rare: [
    { kind: "equipment", rarity: "rare", weight: 3 },
    { kind: "exp", amount: 110, weight: 2 },
    { kind: "stat", amount: 2, weight: 2 },
    { kind: "consumable", itemId: "hi_potion", weight: 2 },
    { kind: "currency", amount: 90, weight: 1 },
  ],
  epic: [
    { kind: "equipment", rarity: "epic", weight: 3 },
    { kind: "stat", amount: 4, weight: 2 },
    { kind: "exp", amount: 220, weight: 2 },
    { kind: "currency", amount: 180, weight: 1 },
  ],
  legendary: [
    { kind: "equipment", rarity: "legendary", weight: 3 },
    { kind: "stat", amount: 8, weight: 2 },
    { kind: "exp", amount: 450, weight: 1 },
  ],
};
function rollGachaRarity() {
  const roll = Math.random();
  let cumulative = 0;
  const order = ["legendary", "epic", "rare", "common"];
  for (const rarity of order) {
    cumulative += GACHA_RATES[rarity];
    if (roll <= cumulative) return rarity;
  }
  return "common";
}
function pickWeighted(entries) {
  const total = entries.reduce((sum, entry) => sum + (entry.weight || 1), 0);
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= entry.weight || 1;
    if (roll <= 0) return entry;
  }
  return entries[entries.length - 1];
}
function addExpWithLevel(startExp, startLevel, amount) {
  let exp = startExp + amount;
  let level = startLevel;
  let levelsGained = 0;
  while (exp >= levelExp(level)) {
    exp -= levelExp(level);
    level += 1;
    levelsGained += 1;
  }
  return { exp, level, levelsGained };
}
function resolveGachaEntry(entry, rarity) {
  if (entry.kind === "consumable") {
    const item = SHOP_ITEMS.find((candidate) => candidate.id === entry.itemId);
    return { kind: "consumable", rarity, item };
  }
  if (entry.kind === "equipment") {
    const pool = EQUIPMENT_ITEMS.filter((candidate) => candidate.rarity === entry.rarity);
    const item = pool[Math.floor(Math.random() * pool.length)];
    return { kind: "equipment", rarity, item };
  }
  if (entry.kind === "exp") return { kind: "exp", rarity, amount: entry.amount };
  if (entry.kind === "stat") {
    const stat = STAT_KEYS[Math.floor(Math.random() * STAT_KEYS.length)];
    return { kind: "stat", rarity, stat, amount: entry.amount };
  }
  return { kind: "currency", rarity, amount: entry.amount };
}
function drawGachaResults(count) {
  const results = [];
  for (let i = 0; i < count; i += 1) {
    const rarity = rollGachaRarity();
    const entry = pickWeighted(GACHA_POOL[rarity]);
    results.push(resolveGachaEntry(entry, rarity));
  }
  return results;
}
// ガチャ結果をstateへ一括反映する。装備が重複した場合は既存システムに
// 適切な変換先がないため、レアリティ別の固定額でAURUMへ自動変換する。
function applyGachaResults(current, results) {
  let currency = current.currency || 0;
  let exp = current.exp;
  let level = current.level;
  let levelsGained = 0;
  const stats = { ...current.stats };
  const inventory = { ...current.inventory };
  const ownedEquipment = [...(current.ownedEquipment || [])];
  const discoveredItems = new Set(current.discoveredItems || []);
  const equipment = { ...(current.equipment || createEquipmentDefaults()) };
  const claimed = results.map((result) => {
    if (result.kind === "currency") {
      currency += result.amount;
      return { ...result };
    }
    if (result.kind === "exp") {
      const leveled = addExpWithLevel(exp, level, result.amount);
      exp = leveled.exp;
      level = leveled.level;
      levelsGained += leveled.levelsGained;
      return { ...result };
    }
    if (result.kind === "stat") {
      stats[result.stat] = (stats[result.stat] || 0) + result.amount;
      return { ...result };
    }
    if (result.kind === "consumable") {
      if (!result.item) return { ...result, skipped: true };
      inventory[result.item.invKey] = (inventory[result.item.invKey] || 0) + 1;
      discoveredItems.add(result.item.id);
      return { ...result };
    }
    if (result.kind === "equipment") {
      if (!result.item) return { ...result, skipped: true };
      if (ownedEquipment.includes(result.item.id)) {
        const convertedCurrency = GACHA_DUPLICATE_CONVERSION[result.rarity] || 20;
        currency += convertedCurrency;
        return { ...result, duplicate: true, convertedCurrency };
      }
      ownedEquipment.push(result.item.id);
      discoveredItems.add(result.item.id);
      if (!equipment[result.item.slot]) equipment[result.item.slot] = result.item.id;
      return { ...result };
    }
    return result;
  });
  return {
    state: {
      ...current,
      currency,
      exp,
      level,
      stats,
      inventory,
      ownedEquipment,
      discoveredItems: [...discoveredItems],
      equipment,
    },
    claimed,
    levelsGained,
  };
}
function seededRandom(seed) {
  let value = Math.floor((Number(seed) || 0) * 0x100000000) >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}
// 戦闘ログの新規行からダメージ数値を抽出し、浮遊ダメージ数字の演出用データを作る。
// 「〜ダメージ！」＝敵へ与えたダメージ、「〜ダメージを受けた/受けなかった。」「〜ダメージ。」＝プレイヤーが受けたダメージ、として判別する。
function extractDamageEvents(prevBattle, resolvedBattle) {
  if (!resolvedBattle?.log?.length) return [];
  const prevLen = Math.min(prevBattle?.log?.length || 0, 5);
  const addedCount = Math.max(0, resolvedBattle.log.length - prevLen);
  const newLines = addedCount > 0 ? resolvedBattle.log.slice(-addedCount) : resolvedBattle.log.slice(-2);
  const base = Date.now();
  return newLines.map((line, index) => {
    const match = line.match(/(\d+)\s*ダメージ/);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!amount) return null;
    const target = line.trim().endsWith("！") ? "enemy" : "player";
    return { id: `${base}-${index}`, amount, target, critical: line.includes("CRITICAL"), weak: line.includes("WEAKNESS") };
  }).filter(Boolean);
}
function rollEquipmentDrop(floor, ownedEquipment, rng = Math.random) {
  const tier = dungeonTier(floor);
  const table = DUNGEON_DROP_TABLE[tier] || DUNGEON_DROP_TABLE.early;
  if (rng() > table.chance) return null;
  const pool = EQUIPMENT_ITEMS.filter((item) => table.rarities.includes(item.rarity) && !(ownedEquipment || []).includes(item.id));
  if (!pool.length) return null;
  return pool[Math.floor(rng() * pool.length)];
}
const emptyStats = () => Object.fromEntries(STAT_KEYS.map((key) => [key, 30]));
const createSocialDefaults = () => ({ friends: [], friendRequests: [], blockedUsers: [], guild: null, notifications: [], privacy: { publicProfile: false, showAge: false, showRealName: false, showStats: false, showAchievements: false }, mockUsers: [], mockGuilds: [], ranking: [], searchResults: [], remoteAvailable: false, remoteUserId: null, conversations: {}, unreadMessages: {}, messagesAvailable: false });
const createDungeonDefaults = () => ({ ticketDate: null, ticketsUsedToday: 0, bonusTickets: 0, currentFloor: 1, bestFloor: 0, gold: 0, battle: null });
const createInventoryDefaults = () => ({ miniPotions: 0, potions: 0, herbTonics: 0, hiPotions: 0, sparklingTonics: 0, megaPotions: 0, powerDraughts: 0, fierceDraughts: 0, megaDraughts: 0, berserkerDraughts: 0 });
const createEquipmentDefaults = () => ({ weapon: null, armor: null, accessory: null });
// 新規ユーザー向けの「最初の5分」オンボーディング進行状況。
// active=falseになった時点で二度と表示しない（既存ユーザーはmigrateStateで自動的にfalseになる）。
const createOnboardingDefaults = () => ({ active: true, seenIntro: false, completedAt: null });
const initialState = () => ({ schemaVersion: STORAGE_VERSION, initialized: false, profile: { name: "", age: "", username: "", goals: [], customGoal: "", avatarUrl: "" }, stats: emptyStats(), job: null, diagnosisScores: {}, level: 1, exp: 0, jobExp: 0, jobLevel: 1, currency: 0, inventory: createInventoryDefaults(), ownedEquipment: [], discoveredItems: [], equipment: createEquipmentDefaults(), dailyActionCount: 0, dailyActionDate: null, dailyQuestProgress: null, actionCounts: {}, actionHistory: [], actionLog: [], actionPerformance: {}, customActions: [], completedQuests: {}, streak: 0, lastActionDate: null, sound: SOUND_DEFAULTS, createdAt: new Date().toISOString(), social: createSocialDefaults(), dungeon: createDungeonDefaults(), onboarding: createOnboardingDefaults(), gachaTickets: 0, gachaHistory: [] });

// --- DUNGEON ---------------------------------------------------------------
// Dungeon state keeps the existing save/reward contract; versioned combat rules live in battle-core.js.
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
  return computeCombatStats({ level: state.level, stats: state.stats, jobMod: (stat) => jobStatModifier(state.job, stat), bonus: equipmentBonuses(state) });
}
function createBattle(state, floor, skills) {
  return createBattleCore(playerCombatStats(state), floor, true, { attributes: state.stats, skills });
}
function levelExp(level) { return 200 + (level - 1) * 40; }
function formatEffects(effects) { return Object.entries(effects).map(([key, value]) => `${key} +${Math.round(Number(value) || 0)}`).join(" / "); }
function migrateState(saved) {
  const defaults = initialState();
  const source = saved && typeof saved === "object" ? saved : {};
  return {
    ...defaults,
    ...source,
    schemaVersion: STORAGE_VERSION,
    stats: { ...defaults.stats, ...(source.stats || {}) },
    sound: { ...SOUND_DEFAULTS, ...(source.sound || {}) },
    profile: {
      ...defaults.profile,
      ...(source.profile || {}),
      name: source.profile?.name || source.name || "",
    },
    actionPerformance: source.actionPerformance && typeof source.actionPerformance === "object" ? source.actionPerformance : {},
    actionLog: Array.isArray(source.actionLog) ? source.actionLog.slice(-100) : [],
    social: {
      ...defaults.social,
      ...(source.social || {}),
      privacy: { ...defaults.social.privacy, ...(source.social?.privacy || {}) },
      mockUsers: [],
      mockGuilds: [],
      friends: (source.social?.friends || []).filter((id) => !["user-aya", "user-kai", "user-mio", "user-ren"].includes(id)),
      friendRequests: (source.social?.friendRequests || []).filter((request) => !["user-aya", "user-kai", "user-mio", "user-ren"].includes(request.userId)),
      blockedUsers: source.social?.blockedUsers || [],
      notifications: source.social?.notifications || [],
      conversations: source.social?.conversations || {},
      unreadMessages: source.social?.unreadMessages || {},
    },
    dungeon: { ...defaults.dungeon, ...(source.dungeon || {}) },
    // 既存ユーザー（すでにonboardingフィールドを持たない保存データ）には
    // オンボーディングを再表示しない。診断が未完了のまま中断していた場合のみ
    // 続きから再開できるようactiveを維持する。
    onboarding: source.onboarding && typeof source.onboarding === "object"
      ? { ...defaults.onboarding, ...source.onboarding }
      : { ...defaults.onboarding, active: !source.initialized, seenIntro: Boolean(source.initialized) },
    currency: typeof source.currency === "number" ? source.currency : (source.dungeon?.gold || 0),
    inventory: { ...defaults.inventory, ...(source.inventory || {}) },
    ownedEquipment: Array.isArray(source.ownedEquipment) ? source.ownedEquipment : [],
    discoveredItems: [...new Set([
      ...(Array.isArray(source.discoveredItems) ? source.discoveredItems : []),
      ...(Array.isArray(source.ownedEquipment) ? source.ownedEquipment : []),
      ...SHOP_ITEMS.filter((item) => (source.inventory?.[item.invKey] || 0) > 0).map((item) => item.id),
    ])],
    equipment: { ...defaults.equipment, ...(source.equipment || {}) },
    gachaTickets: typeof source.gachaTickets === "number" ? source.gachaTickets : 0,
    gachaHistory: Array.isArray(source.gachaHistory) ? source.gachaHistory.slice(-50) : [],
  };
}
function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved) return initialState();
    return migrateState(saved);
  } catch (error) { console.error("セーブデータを読み込めませんでした。", error); return initialState(); }
}
function calculateResult(answers) {
  const scores = Object.fromEntries(STAT_KEYS.map((key) => [key, 0]));
  QUESTIONS.forEach((question, index) => Object.entries(question[1][answers[index] || 0][1]).forEach(([key, value]) => { scores[key] += value; }));
  const stats = Object.fromEntries(STAT_KEYS.map((key) => [key, Math.min(99, 30 + Math.round((scores[key] / 12) * 10))]));
  const job = JOBS.map((candidate) => ({ candidate, score: Object.entries(candidate.weights).reduce((sum, [key, weight]) => sum + (stats[key] || 30) * weight, 0) })).sort((a, b) => b.score - a.score)[0].candidate;
  return { stats, scores, job };
}
function getSocial(state) { return state.social || createSocialDefaults(); }
function selfSocialUser(state) { return { id: "self", username: state.profile.username || "player", displayName: state.profile.name || "PLAYER", realName: state.profile.name || "", age: state.profile.age || "", level: state.level, exp: state.exp, jobLevel: state.jobLevel, guildLevel: getSocial(state).guild?.level || 0, job: state.job?.name || "未設定", icon: state.job?.icon || "A", stats: state.stats, achievements: Object.keys(state.completedQuests || {}).length }; }
function socialNotification(text) { return { id: `notification-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text, createdAt: new Date().toISOString(), read: false }; }
function withSocial(state, patch) { const social = getSocial(state); return { ...state, social: { ...social, ...patch } }; }
function searchableUsers(state, query) { const social = getSocial(state); const term = query.trim().toLowerCase(); const source = term ? (social.searchResults || []) : []; return source.filter((user) => !social.blockedUsers.includes(user.id)); }

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
const DIFFICULTY_MULTIPLIERS = { EASY: .78, NORMAL: 1, HARD: 1.28, EPIC: 1.62, LEGENDARY: 1.95 };
const TARGET_DEFAULTS = { workout: [10, "reps", 10], running: [20, "min", 20], reading: [30, "min", 30], english: [30, "min", 30], design: [30, "min", 30], work: [45, "min", 45], sns: [1, "tasks", 10], challenge: [1, "tasks", 20] };
function jobStatModifier(job, stat) { return JOB_STAT_MODIFIERS[job?.name]?.[stat] || 1; }
function actionTarget(action) {
  if (Number.isFinite(Number(action.target))) return { value: Number(action.target), unit: action.unit || "tasks", minutes: Number(action.estimatedTime) || 15 };
  const fallback = TARGET_DEFAULTS[action.id] || [1, action.unit || "tasks", Number(action.estimatedTime) || 15];
  return { value: fallback[0], unit: action.unit || fallback[1], minutes: Number(action.estimatedTime) || fallback[2] };
}
function personalDifficulty(action, state) {
  const performance = state.actionPerformance?.[action.id] || {};
  const successes = performance.successes || 0;
  const failures = performance.failures || 0;
  const total = successes + failures;
  const consistency = total ? successes / total : .5;
  const effectStats = Object.keys(action.effects || {});
  const averageStat = effectStats.length ? effectStats.reduce((sum, stat) => sum + (state.stats?.[stat] || 30), 0) / effectStats.length : 50;
  const weaknessFactor = Math.max(-.08, Math.min(.12, (55 - averageStat) / 220));
  const consistencyFactor = total ? (consistency > .85 ? .06 : consistency < .5 ? -.08 : 0) : 0;
  return Math.max(.82, Math.min(1.18, 1 + weaknessFactor + consistencyFactor));
}
function personalTarget(action, state) {
  const base = actionTarget(action);
  const performance = state.actionPerformance?.[action.id] || {};
  return { ...base, value: adaptiveActionTarget(base.value, base.unit, performance) };
}
function actionReward(action, state) {
  const difficulty = action.difficulty || "NORMAL";
  const baseExp = Math.max(5, Math.min(120, Number(action.baseExp ?? action.exp ?? 20)));
  const baseEffects = action.baseEffects || action.effects || {};
  const statKeys = Object.keys(baseEffects);
  const jobModifier = statKeys.length ? statKeys.reduce((sum, stat) => sum + jobStatModifier(state.job, stat), 0) / statKeys.length : 1;
  const exp = Math.round(baseExp * (DIFFICULTY_MULTIPLIERS[difficulty] || 1) * personalDifficulty(action, state) * Math.max(.88, Math.min(1.15, jobModifier)));
  const effects = Object.fromEntries(Object.entries(baseEffects).map(([stat, value]) => [stat, Number((Number(value) * jobStatModifier(state.job, stat)).toFixed(2))]));
  return { exp: Math.max(10, Math.min(250, exp)), effects, jobModifier };
}
const ACTION_CURRENCY_BY_DIFFICULTY = { EASY: 3, NORMAL: 6, HARD: 10, EPIC: 16, LEGENDARY: 24 };
function actionCurrencyReward(action, completionRatio = 1) {
  const difficulty = action.difficulty || "NORMAL";
  const base = ACTION_CURRENCY_BY_DIFFICULTY[difficulty] || ACTION_CURRENCY_BY_DIFFICULTY.NORMAL;
  return Math.max(1, Math.round(base * Math.max(.6, Math.min(1.15, completionRatio))));
}
function completionMultiplier(action, completion) {
  const target = Math.max(1, Number(action.target || actionTarget(action).value));
  const actualValue = Number(completion?.actualValue);
  if (!Number.isFinite(actualValue) || actualValue <= 0) return 1;
  const ratio = Math.max(.5, Math.min(1.08, actualValue / target));
  const estimatedTime = Number(action.estimatedTime || actionTarget(action).minutes);
  const actualTime = Number(completion?.actualTime);
  const timeFactor = Number.isFinite(actualTime) && actualTime > estimatedTime
    ? Math.max(.88, 1 - Math.min(.12, (actualTime - estimatedTime) / Math.max(estimatedTime, 1) * .12))
    : 1;
  return Math.max(.5, Math.min(1.08, ratio * timeFactor));
}
function personalizeAction(action, state) {
  const target = personalTarget(action, state);
  const reward = actionReward(action, state);
  return { ...action, baseExp: action.baseExp ?? action.exp ?? 20, baseEffects: action.effects || {}, target: target.value, unit: target.unit, estimatedTime: target.minutes, exp: reward.exp, effects: reward.effects, name: `${action.name} · ${target.value}${target.unit} / ${target.minutes}min` };
}

function personalizedActions(state) {
  const goals = state.profile.goals || [];
  const mainCategory = goals.map((goal) => GOAL_CATEGORY[goal]).filter(Boolean);
  const jobCategory = state.job?.name === "商人" ? "MONEY" : state.job?.name === "賢者" ? "STUDY" : state.job?.name === "錬金術師" || state.job?.name === "吟遊詩人" ? "CREATIVE" : state.job?.name === "剣士" ? "BODY" : null;
  const recent = state.actionHistory || [];
  const candidates = [...ACTION_LIBRARY, ...(state.customActions || [])].map((action) => {
    const personalized = personalizeAction(action, state);
    const weaknessScore = Object.keys(action.effects || {}).reduce((sum, stat) => sum + Math.max(0, Math.min(2, (50 - (state.stats?.[stat] || 30)) / 20)), 0);
    return { ...personalized, score: (mainCategory.includes(action.category) ? 4 : 0) + (jobCategory === action.category ? 3 : 0) + (action.tags?.some((tag) => goals.includes(tag)) ? 2 : 0) + weaknessScore - (action.repeatable ? 0 : recent.slice(-4).includes(action.id) ? 5 : 0) };
  });
  const eligible = candidates.filter((action) => !action.minLevel || state.level >= action.minLevel);
  return eligible.sort((a, b) => b.score - a.score).slice(0, 5);
}
function actionCoach(state) {
  const logs = (state.actionLog || []).filter((log) => log.result === "completed" || log.result === "partial").slice(-20);
  const categoryCounts = logs.reduce((counts, log) => ({ ...counts, [log.category]: (counts[log.category] || 0) + 1 }), {});
  const recentCategories = Object.keys(categoryCounts);
  const weakestStat = STAT_KEYS.reduce((weakest, stat) => (state.stats?.[stat] || 0) < (state.stats?.[weakest] || 0) ? stat : weakest, STAT_KEYS[0]);
  const supportAction = [...ACTION_LIBRARY, ...(state.customActions || [])].find((action) => action.effects?.[weakestStat]);
  const suggestions = [];
  if (supportAction) suggestions.push(`${STAT_META[weakestStat].name}が現在の最弱STATSです。「${supportAction.name}」を少し優先しましょう。`);
  const missingCategory = ACTION_CATEGORIES.find((category) => !recentCategories.includes(category));
  if (missingCategory) suggestions.push(`${missingCategory}系ACTIONが最近少なめです。週に1回だけでも変化を入れましょう。`);
  const performance = Object.entries(state.actionPerformance || {}).find(([, value]) => (value.successes || 0) >= 3 && (value.successes || 0) / Math.max(1, (value.successes || 0) + (value.failures || 0)) >= .85);
  if (performance) suggestions.push("達成率の高いACTIONが見つかりました。次回TARGETを上げて成長の停滞を防ぎます。");
  return suggestions.slice(0, 2);
}
function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
function nextStreak(lastActionDate, today, currentStreak) {
  if (!lastActionDate) return 1;
  if (lastActionDate === today) return currentStreak;
  const last = Date.parse(`${lastActionDate}T00:00:00Z`);
  const current = Date.parse(`${today}T00:00:00Z`);
  return current - last === 86400000 ? currentStreak + 1 : 1;
}
function widgetData(state) {
  const actions = personalizedActions(state);
  const today = todayString();
  const todayCount = state.dailyActionDate === today ? state.dailyActionCount || 0 : 0;
  return {
    username: state.profile.username || "PLAYER",
    job: state.job?.name || "未設定",
    level: state.level,
    exp: state.exp,
    nextLevelExp: levelExp(state.level),
    todayAction: actions[0] || null,
    todayCount,
    todayGoal: 5,
    streak: state.streak || 0,
    guild: getSocial(state).guild?.name || "NO GUILD",
    updatedAt: new Date().toISOString(),
  };
}

function App() {
  const [state, setState] = useState(loadState);
  // EXPバーはレベルアップ時、旧レベルの上限まで満たしてから新レベルの繰越EXPへ
  // 滑らかに切り替える（120/200→+124EXP→LEVEL UP→44/300、のような遷移を再現）。
  const [expDisplayLevel, setExpDisplayLevel] = useState(() => state.level);
  const [expDisplayValue, setExpDisplayValue] = useState(() => state.exp);
  const prevProgressRef = useRef({ level: state.level, exp: state.exp });
  const expOverflowTimerRef = useRef(null);
  useEffect(() => {
    const prev = prevProgressRef.current;
    prevProgressRef.current = { level: state.level, exp: state.exp };
    window.clearTimeout(expOverflowTimerRef.current);
    if (state.level <= prev.level) {
      // レベルアップなし（または復元等によるレベル低下）は、そのまま新しい値へ。
      setExpDisplayLevel(state.level);
      setExpDisplayValue(state.exp);
      return undefined;
    }
    const prefersReduced = typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
    if (prefersReduced) {
      setExpDisplayLevel(state.level);
      setExpDisplayValue(state.exp);
      return undefined;
    }
    // まず旧レベルのバーを満タンまで滑らかに満たし、
    // ACTION COMPLETEの演出と同じ間合いを置いてから新レベルの繰越EXPへ切り替える。
    setExpDisplayLevel(prev.level);
    setExpDisplayValue(levelExp(prev.level));
    expOverflowTimerRef.current = window.setTimeout(() => {
      setExpDisplayLevel(state.level);
      setExpDisplayValue(state.exp);
    }, 850);
    return () => window.clearTimeout(expOverflowTimerRef.current);
  }, [state.level, state.exp]);
  const tweenedExp = useTweenedNumber(expDisplayValue);
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get("screen") || "status");
  const [setup, setSetup] = useState({ name: "", age: "", username: "" });
  const [question, setQuestion] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [notice, setNotice] = useState("");
  const noticeTokenRef = useRef(0);
  const [resetStep, setResetStep] = useState(0);
  const [resetText, setResetText] = useState("");
  const [editing, setEditing] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [showGoal, setShowGoal] = useState(() => Boolean(loadState().initialized && !loadState().profile.goals?.length));
  const [goalSelection, setGoalSelection] = useState([]);
  const [customGoal, setCustomGoal] = useState("");
  const [moreActions, setMoreActions] = useState(false);
  const [updateRegistration, setUpdateRegistration] = useState(null);
  const [cloudStatus, setCloudStatus] = useState("");
  const [openWorldSyncStatus, setOpenWorldSyncStatus] = useState(supabase ? "checking" : "unavailable");
  const [openWorldHasRow, setOpenWorldHasRow] = useState(false);
  const [authStatus, setAuthStatus] = useState(null);
  const [motionQueue, setMotionQueue] = useState([]);
  const [activeMotion, setActiveMotion] = useState(null);
  const [levelGain, setLevelGain] = useState(1);
  const [coopSession, setCoopSession] = useState(null);
  const [gachaDrawing, setGachaDrawing] = useState(false);
  const [gachaResults, setGachaResults] = useState(null);
  const musicRef = useRef(null);
  const musicSettingsRef = useRef(state.sound);
  musicSettingsRef.current = { ...state.sound, appReady: Boolean(state.initialized && state.profile?.name) };
  const motionTimeoutRef = useRef(null);
  const phaseAnnouncedRef = useRef(false);
  const firstPersistenceRef = useRef(true);
  const restoringCloudRef = useRef(false);
  const restoringOpenWorldRef = useRef(false);
  const restoringOpenWorldEquipmentRef = useRef(false);
  const openWorldEquipmentDirtyRef = useRef(false);
  const openWorldProgressKeyRef = useRef(JSON.stringify([state.level, state.exp, state.ownedEquipment, state.equipment]));
  const openWorldEquipmentKeyRef = useRef(JSON.stringify(state.equipment));
  const rewardClaimRef = useRef(null);
  const gachaDrawLockRef = useRef(false);
  const coopChannelRef = useRef(null);
  const coopSessionRef = useRef(null);
  coopSessionRef.current = coopSession;
  useEffect(() => () => {
    closeCoopBattleChannel(coopChannelRef.current).catch((error) => console.warn("COOP接続を終了できませんでした。", error));
  }, []);
  useEffect(() => {
    if (!supabase) return undefined;
    getAuthStatus().then(setAuthStatus).catch((error) => {
      console.warn("認証状態を確認できませんでした。", error);
    });
    return undefined;
  }, []);
  useEffect(() => {
    const handleActionTooHard = (event) => {
      const action = event.detail;
      if (!action?.id) return;
      setState((current) => {
        const previous = current.actionPerformance?.[action.id] || {};
        const target = action.target || actionTarget(action).value;
        return {
          ...current,
          actionPerformance: {
            ...(current.actionPerformance || {}),
            [action.id]: {
              ...previous,
              failures: (previous.failures || 0) + 1,
              lastTarget: Math.max(1, Math.round(target * .85)),
              lastFailedAt: new Date().toISOString(),
            },
          },
          actionLog: [...(current.actionLog || []).slice(-99), {
            actionId: action.id,
            category: action.category,
            difficulty: action.difficulty || "NORMAL",
            target,
            unit: action.unit || actionTarget(action).unit,
            estimatedTime: action.estimatedTime || actionTarget(action).minutes,
            completedAt: new Date().toISOString(),
            result: "too_hard",
          }],
        };
      });
      setNotice("難易度を調整しました。次回は少し軽くなります。");
    };
    window.addEventListener("life-rpg-action-too-hard", handleActionTooHard);
    return () => window.removeEventListener("life-rpg-action-too-hard", handleActionTooHard);
  }, []);
  useEffect(() => {
    if (!supabase) return undefined;
    const flush = () => {
      flushQueuedActionContributions().then((result) => {
        if (result.flushed) setCloudStatus(result.remaining ? "SYNC PARTIAL" : "CLOUD SYNCED");
      }).catch((error) => {
        console.warn("オフライン中のACTION記録を再送できませんでした。", error);
      });
    };
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, []);
  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    loadGameState().then((remote) => {
      if (!active || !remote?.state?.profile?.name) return;
      const localModifiedAt = Number(localStorage.getItem(LOCAL_MODIFIED_KEY) || 0);
      const cloudModifiedAt = Date.parse(remote.updatedAt || "") || 0;
      if (!state.profile.name || cloudModifiedAt > localModifiedAt) {
        restoringCloudRef.current = true;
        setState((current) => current.profile.name && cloudModifiedAt <= localModifiedAt ? current : migrateState(remote.state));
      }
    }).catch((error) => {
      console.warn("クラウドのゲームデータを読み込めませんでした。", error);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const key = JSON.stringify([state.level, state.exp, state.ownedEquipment, state.equipment]);
    if (key === openWorldProgressKeyRef.current) return;
    openWorldProgressKeyRef.current = key;
    if (restoringOpenWorldRef.current) {
      restoringOpenWorldRef.current = false;
      return;
    }
    localStorage.setItem(OPEN_WORLD_LOCAL_MODIFIED_KEY, String(Date.now()));
  }, [state.level, state.exp, state.ownedEquipment, state.equipment]);
  useEffect(() => {
    const key = JSON.stringify(state.equipment);
    if (key === openWorldEquipmentKeyRef.current) return;
    openWorldEquipmentKeyRef.current = key;
    if (restoringOpenWorldEquipmentRef.current) {
      restoringOpenWorldEquipmentRef.current = false;
      return;
    }
    openWorldEquipmentDirtyRef.current = true;
    localStorage.setItem(OPEN_WORLD_EQUIPMENT_MODIFIED_KEY, String(Date.now()));
  }, [state.equipment]);
  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    loadOpenWorldProgress().then((remote) => {
      if (!active) return;
      setOpenWorldHasRow(Boolean(remote));
      if (remote) {
        const localModifiedAt = Number(localStorage.getItem(OPEN_WORLD_LOCAL_MODIFIED_KEY) || 0);
        const cloudModifiedAt = Date.parse(remote.updatedAt || "") || 0;
        const localEquipmentModifiedAt = Number(localStorage.getItem(OPEN_WORLD_EQUIPMENT_MODIFIED_KEY) || 0);
        const cloudEquipmentModifiedAt = Date.parse(remote.equipmentUpdatedAt || remote.updatedAt || "") || 0;
        const remoteLevel = Math.max(1, Number(remote.level) || 1);
        const remoteExp = Math.max(0, Number(remote.exp) || 0);
        const restoreProgress = cloudModifiedAt > localModifiedAt
          || remoteLevel > state.level
          || (remoteLevel === state.level && remoteExp > state.exp);
        const restoreEquipment = cloudEquipmentModifiedAt > localEquipmentModifiedAt;
        const remoteOwnedEquipment = Array.isArray(remote.ownedEquipment) ? remote.ownedEquipment : [];
        const restoreOwnedEquipment = remoteOwnedEquipment.some((itemId) => !state.ownedEquipment?.includes(itemId));
        if (restoreProgress || restoreEquipment || restoreOwnedEquipment) {
          const nextProgressKey = JSON.stringify([
            restoreProgress ? remoteLevel : state.level,
            restoreProgress ? remoteExp : state.exp,
            restoreOwnedEquipment || restoreProgress ? [...new Set([...(state.ownedEquipment || []), ...remoteOwnedEquipment])] : state.ownedEquipment,
            restoreEquipment ? { ...createEquipmentDefaults(), ...(remote.equipment || {}) } : state.equipment,
          ]);
          restoringOpenWorldRef.current = nextProgressKey !== openWorldProgressKeyRef.current;
          restoringOpenWorldEquipmentRef.current = restoreEquipment
            && JSON.stringify(remote.equipment || {}) !== JSON.stringify(state.equipment || {});
          if (restoreEquipment) {
            openWorldEquipmentDirtyRef.current = false;
            localStorage.removeItem(OPEN_WORLD_EQUIPMENT_MODIFIED_KEY);
          } else if (localEquipmentModifiedAt > cloudEquipmentModifiedAt) {
            openWorldEquipmentDirtyRef.current = true;
          }
          setState((current) => ({
            ...current,
            ...(restoreProgress ? {
              level: remoteLevel,
              exp: remoteExp,
            } : {}),
            ...(restoreOwnedEquipment || restoreProgress ? {
              ownedEquipment: [...new Set([...(current.ownedEquipment || []), ...remoteOwnedEquipment])],
            } : {}),
            ...(restoreEquipment ? {
              equipment: { ...createEquipmentDefaults(), ...(remote.equipment || {}) },
            } : {}),
          }));
        }
      }
      setOpenWorldSyncStatus("ready");
    }).catch((error) => {
      if (!active) return;
      console.warn("Godot共有データを読み込めませんでした。", error);
      setOpenWorldSyncStatus(["42P01", "42501", "PGRST205"].includes(error?.code) ? "needs-migration" : "offline");
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!supabase || openWorldSyncStatus !== "ready" || !state.initialized) return undefined;
    const timer = window.setTimeout(() => {
      const equipmentKey = JSON.stringify(state.equipment);
      const updateEquipment = !openWorldHasRow || openWorldEquipmentDirtyRef.current;
      saveOpenWorldProgress(state, updateEquipment).then(() => {
        setOpenWorldHasRow(true);
        if (updateEquipment && openWorldEquipmentKeyRef.current === equipmentKey) {
          openWorldEquipmentDirtyRef.current = false;
          localStorage.removeItem(OPEN_WORLD_EQUIPMENT_MODIFIED_KEY);
        }
      }).catch((error) => {
        console.warn("Godot共有データを保存できませんでした。", error);
      });
    }, 600);
    return () => window.clearTimeout(timer);
  }, [state.level, state.exp, state.ownedEquipment, state.equipment, state.initialized, openWorldSyncStatus, openWorldHasRow]);
  async function createGamePairing() {
    if (openWorldSyncStatus !== "ready") throw new Error("共有データ用のSQLスキーマが適用されていません。");
    await saveOpenWorldProgress(state, true);
    setOpenWorldHasRow(true);
    return createOpenWorldPairingBundle();
  }
  async function syncGameProgress() {
    if (openWorldSyncStatus !== "ready") throw new Error("共有データ用のSQLスキーマが適用されていません。");
    const remote = await loadOpenWorldProgress();
    const localModifiedAt = Number(localStorage.getItem(OPEN_WORLD_LOCAL_MODIFIED_KEY) || 0);
    const cloudModifiedAt = Date.parse(remote?.updatedAt || "") || 0;
    const localEquipmentModifiedAt = Number(localStorage.getItem(OPEN_WORLD_EQUIPMENT_MODIFIED_KEY) || 0);
    const cloudEquipmentModifiedAt = Date.parse(remote?.equipmentUpdatedAt || remote?.updatedAt || "") || 0;
    const remoteLevel = Math.max(1, Number(remote?.level) || 1);
    const remoteExp = Math.max(0, Number(remote?.exp) || 0);
    const restoreProgress = Boolean(remote && (cloudModifiedAt > localModifiedAt
      || remoteLevel > state.level
      || (remoteLevel === state.level && remoteExp > state.exp)));
    const restoreEquipment = Boolean(remote && cloudEquipmentModifiedAt > localEquipmentModifiedAt);
    const remoteOwnedEquipment = Array.isArray(remote?.ownedEquipment) ? remote.ownedEquipment : [];
    const restoreOwnedEquipment = remoteOwnedEquipment.some((itemId) => !state.ownedEquipment?.includes(itemId));
    if (remote && (restoreProgress || restoreEquipment || restoreOwnedEquipment)) {
      const nextProgressKey = JSON.stringify([
        restoreProgress ? remoteLevel : state.level,
        restoreProgress ? remoteExp : state.exp,
        restoreOwnedEquipment || restoreProgress ? [...new Set([...(state.ownedEquipment || []), ...remoteOwnedEquipment])] : state.ownedEquipment,
        restoreEquipment ? { ...createEquipmentDefaults(), ...(remote.equipment || {}) } : state.equipment,
      ]);
      restoringOpenWorldRef.current = nextProgressKey !== openWorldProgressKeyRef.current;
      restoringOpenWorldEquipmentRef.current = restoreEquipment
        && JSON.stringify(remote.equipment || {}) !== JSON.stringify(state.equipment || {});
      if (restoreEquipment) {
        openWorldEquipmentDirtyRef.current = false;
        localStorage.removeItem(OPEN_WORLD_EQUIPMENT_MODIFIED_KEY);
      }
      setState((current) => ({
        ...current,
        ...(restoreProgress ? {
          level: remoteLevel,
          exp: remoteExp,
        } : {}),
        ...(restoreOwnedEquipment || restoreProgress ? {
          ownedEquipment: [...new Set([...(current.ownedEquipment || []), ...remoteOwnedEquipment])],
        } : {}),
        ...(restoreEquipment ? {
          equipment: { ...createEquipmentDefaults(), ...(remote.equipment || {}) },
        } : {}),
      }));
      setOpenWorldHasRow(true);
      return "クラウドの進行状況を反映しました。";
    }
    await saveOpenWorldProgress(state, !openWorldHasRow || openWorldEquipmentDirtyRef.current);
    setOpenWorldHasRow(true);
    openWorldEquipmentDirtyRef.current = false;
    localStorage.removeItem(OPEN_WORLD_EQUIPMENT_MODIFIED_KEY);
    return "この端末の進行状況をクラウドへ保存しました。";
  }
  useEffect(() => {
    const handlePointerDown = (event) => {
      if (event.target.closest("button, a, input, select")) playSound("tap", state.sound);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [state.sound]);
  useEffect(() => {
    const music = new Audio("/game-bgm.mp3");
    music.loop = true;
    music.preload = "none";
    music.volume = musicSettingsRef.current.musicVolume ?? SOUND_DEFAULTS.musicVolume;
    musicRef.current = music;
    const startMusic = () => {
      if (!musicSettingsRef.current.appReady || !musicSettingsRef.current.musicEnabled || !music.paused) return;
      music.play().catch((error) => {
        console.warn("BGMの再生を開始できませんでした。", error);
      });
    };
    document.addEventListener("pointerdown", startMusic, true);
    document.addEventListener("keydown", startMusic, true);
    return () => {
      document.removeEventListener("pointerdown", startMusic, true);
      document.removeEventListener("keydown", startMusic, true);
      music.pause();
      music.removeAttribute("src");
      music.load();
      musicRef.current = null;
    };
  }, []);
  useEffect(() => {
    const music = musicRef.current;
    if (!music) return;
    music.volume = state.sound.musicVolume ?? SOUND_DEFAULTS.musicVolume;
    if (!state.sound.musicEnabled) {
      music.pause();
      music.currentTime = 0;
    }
  }, [state.sound.musicEnabled, state.sound.musicVolume]);
  useEffect(() => () => window.clearTimeout(motionTimeoutRef.current), []);
  // 複数の演出（ACTION COMPLETE→LEVEL UP→NEW SKILL→DUNGEON UNLOCK等）が
  // 同時に発生しても、互いを打ち消さず順番に表示するためのキュー。
  useEffect(() => {
    if (activeMotion || !motionQueue.length) return undefined;
    const [next, ...rest] = motionQueue;
    setMotionQueue(rest);
    setActiveMotion(next);
    if (next.type === "level-up") setLevelGain(next.levels || 1);
    window.clearTimeout(motionTimeoutRef.current);
    motionTimeoutRef.current = window.setTimeout(() => setActiveMotion(null), MOTION_DURATIONS[next.type] || 900);
    return undefined;
  }, [motionQueue, activeMotion]);
  useEffect(() => {
    const style = document.createElement("style");
    style.dataset.lifeRpgMotion = "true";
    style.textContent = `
      html, body { width: 100%; max-width: 100%; overflow-x: clip; }
      .rpg-app { width: 100%; max-width: 720px; min-height: 100vh; min-height: 100svh; min-height: 100dvh; }
      .rpg-app { position: relative; isolation: isolate; }
      .rpg-app::before { content: ""; position: fixed; z-index: 0; inset: -24px; pointer-events: none; background: url("/open-world-bg.jpg") 40% 52% / cover no-repeat; transform: translate3d(-1.5%, -1%, 0) scale(1.04); animation: lifeRpgAmbientDrift 32s ease-in-out infinite alternate; will-change: transform; }
      .rpg-app::after { content: ""; position: fixed; z-index: 0; inset: 0; pointer-events: none; background: linear-gradient(180deg, rgba(8, 9, 14, .84) 0%, rgba(8, 9, 14, .62) 34%, rgba(8, 9, 14, .34) 68%, rgba(8, 9, 14, .65) 100%); transform: translate3d(-.5%, 0, 0); animation: lifeRpgHorizonDrift 48s ease-in-out infinite alternate; will-change: transform; }
      .rpg-app > .welcome { position: relative; z-index: 1; }
      .rpg-app > header, .rpg-app > .exp-bar, .rpg-app > .content { position: relative; z-index: 1; }
      @keyframes lifeRpgAmbientDrift { from { transform: translate3d(-1.5%, -1%, 0) scale(1.04); } to { transform: translate3d(1.5%, 1%, 0) scale(1.04); } }
      @keyframes lifeRpgHorizonDrift { from { transform: translate3d(-.5%, 0, 0); } to { transform: translate3d(.5%, 0, 0); } }
      .content { min-width: 0; overflow-wrap: anywhere; }
      .content > * { min-width: 0; max-width: 100%; }
      .social-user, .social-user-main, .ranking-row, .guild-card { min-width: 0; }
      .social-user-main b, .ranking-row > span:nth-of-type(2) { overflow-wrap: anywhere; }
      @media (max-width: 480px) {
        .rpg-app::before { background-position: 25% 52%; }
        .nav { width: 100%; overflow-x: auto; justify-content: flex-start; scrollbar-width: none; padding-left: max(4px, env(safe-area-inset-left)); padding-right: max(4px, env(safe-area-inset-right)); }
        .nav::-webkit-scrollbar { display: none; }
        .nav button { flex: 0 0 52px; min-width: 0; padding-left: 1px; padding-right: 1px; font-size: clamp(7px, 2.2vw, 9px); letter-spacing: .02em; }
        .nav button span { font-size: 16px; margin-bottom: 3px; }
        .topbar { gap: 10px; }
        .topbar > div:first-child { min-width: 0; }
        .level { flex: none; white-space: nowrap; }
        .social-profile-actions { flex-wrap: wrap; }
        .social-profile-actions > * { min-width: 0; }
      }
      :root { --motion-fast: 150ms; --motion-normal: 250ms; --motion-slow: 400ms; --motion-ease: cubic-bezier(.22,.61,.36,1); }
      button, a, .action-card, .social-user, .quest, .skill, .stat-card, .guild-card, .profile, .today-quest { transition: transform var(--motion-fast) var(--motion-ease), opacity var(--motion-fast) var(--motion-ease), border-color var(--motion-normal) var(--motion-ease), background-color var(--motion-normal) var(--motion-ease); }
      button:active, a:active, .action-card:active, .social-user:active, .guild-card:active { transform: scale(.97); opacity: .82; }
      button:focus-visible, a:focus-visible { outline: 1px solid #eee; outline-offset: 3px; }
      .page-transition { animation: lifeRpgPageIn 320ms var(--motion-ease) both; }
      .content.action-complete-pulse { animation: lifeRpgComplete var(--motion-slow) var(--motion-ease) both; }
      .completion-toast { position: fixed; z-index: 8; left: 50%; top: 26%; transform: translate(-50%, -50%); display: grid; gap: 5px; text-align: center; pointer-events: none; animation: lifeRpgToast 520ms var(--motion-ease) both; }
      .completion-toast b { font-size: 13px; letter-spacing: .16em; }
      .completion-toast span { color: #aaa; font: 22px Georgia, serif; }
      .completion-toast-currency { color: var(--gold, #cbb26a) !important; font-size: 14px !important; font-family: inherit !important; letter-spacing: .06em; }
      .level-up-toast { position: fixed; z-index: 8; left: 50%; top: 27%; isolation: isolate; display: grid; justify-items: center; gap: 7px; min-width: 190px; padding: 22px 28px; color: #f5e9c8; text-align: center; pointer-events: none; animation: lifeRpgLevelUp 2.2s var(--motion-ease) both; }
      .level-up-toast::before { content: ""; position: absolute; z-index: -1; top: 50%; left: 50%; width: 176px; height: 176px; border: 1px solid #c9ad68; border-radius: 50%; background: radial-gradient(circle, #c9ad681a, transparent 68%); box-shadow: 0 0 42px #c9ad6822, inset 0 0 36px #c9ad6812; transform: translate(-50%, -50%); animation: lifeRpgLevelHalo 2.2s var(--motion-ease) both; }
      .level-up-toast::after { content: "✦"; position: absolute; top: -8px; right: 18px; color: #f5df9e; font-size: 14px; text-shadow: 0 0 16px #f5df9e; animation: lifeRpgLevelSpark 2.2s var(--motion-ease) both; }
      .level-up-icon { color: #f5df9e; font-size: 19px; line-height: 1; text-shadow: 0 0 18px #f5df9e88; }
      .level-up-toast small { color: #d5bd80; letter-spacing: .26em; font-size: 10px; }
      .level-up-toast b { font: 30px Georgia, serif; letter-spacing: .02em; text-shadow: 0 0 24px #f5df9e55; display: flex; align-items: center; gap: 10px; }
      .level-up-arrow { color: #b79ce0; font-size: 20px; text-shadow: 0 0 14px #b79ce088; }
      .level-up-count { color: #c8c0ae; font-size: 9px; letter-spacing: .18em; }
      .level-up-stats { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; max-width: 260px; margin-top: 2px; }
      .level-up-stat-pill { padding: 3px 10px; border: 1px solid #7a5fc2; border-radius: 999px; background: linear-gradient(135deg, #2a1f47, #1a1424); color: #d9c8ff; font-size: 10px; letter-spacing: .04em; opacity: 0; animation: lifeRpgStatPill 480ms var(--motion-ease) both; }
      .exp-bar i, .stat-bar i, .skill-track-bar i, .quest-summary i em, .skill-summary i em { transition: width var(--motion-slow) var(--motion-ease); }
      .skill-unlock-toast, .dungeon-unlock-toast, .onboarding-complete-toast { position: fixed; z-index: 8; left: 50%; top: 30%; transform: translate(-50%, -50%); display: grid; justify-items: center; gap: 6px; min-width: 200px; padding: 16px 24px; text-align: center; pointer-events: none; border: 1px solid #3a4039; background: #10130fee; box-shadow: 0 0 30px #0008; animation: lifeRpgToast 1.9s var(--motion-ease) both; }
      .skill-unlock-toast small, .dungeon-unlock-toast small, .onboarding-complete-toast small { letter-spacing: .22em; font-size: 9px; color: #b8c9b0; }
      .skill-unlock-toast b, .dungeon-unlock-toast b { font: 18px Georgia, serif; color: #eee; }
      .dungeon-unlock-toast { border-color: #806a35; box-shadow: 0 0 30px #c2a04b1c, inset 0 0 24px #c2a04b0c; }
      .dungeon-unlock-toast small { color: #d5bd80; }
      .dungeon-unlock-toast b { color: #f0d783; }
      .onboarding-complete-toast { top: 32%; min-width: 240px; padding: 22px 28px; border-color: #806a35; box-shadow: 0 0 42px #c2a04b22, inset 0 0 30px #c2a04b12; animation-duration: 2.6s; }
      .onboarding-complete-toast b { font: 20px Georgia, serif; color: #f0d783; }
      .onboarding-complete-toast span { color: #999; font-size: 11px; letter-spacing: .08em; }
      .dungeon-log { max-height: 150px; overflow-y: auto; overscroll-behavior: contain; scroll-behavior: smooth; padding-right: 4px; }
      .dungeon-log p { margin: 0; }
      .adventurer-rank { display: flex; align-items: center; gap: 14px; margin: 18px 0; padding: 16px; border: 1px solid #806a35; background: radial-gradient(ellipse at 0 50%, #c2a04b22, transparent 60%), linear-gradient(115deg,#201b10,#111); box-shadow: inset 0 0 24px #c2a04b0c; }
      .rank-emblem { display: grid; place-items: center; flex: 0 0 48px; height: 48px; border: 1px solid #c5a755; border-radius: 50%; color: #f0d783; font-size: 24px; text-shadow: 0 0 14px #e8c76a; }
      .rank-copy { display: grid; min-width: 0; gap: 5px; }
      .rank-copy small { color: #bca765; font-size: 8px; letter-spacing: .14em; }
      .rank-copy b { color: #f0d783; font: 19px Georgia,serif; }
      .rank-copy span { color: #999; font-size: 9px; }
      .rank-copy i { display: block; width: min(340px, 65vw); height: 3px; background: #383124; margin-top: 3px; }
      .rank-copy i em { display: block; height: 100%; background: linear-gradient(90deg,#92743a,#f0d783); }
      .quest-summary, .skill-summary { display: grid; gap: 9px; padding: 15px; border: 1px solid #3a4039; background: #151a16dd; margin: 20px 0; }
      .quest-summary > span, .skill-summary > div { color: #aaa; font-size: 10px; letter-spacing: .1em; }
      .quest-summary > b, .skill-summary > div b { color: #eee; font-size: 17px; font-weight: 500; }
      .quest-summary i, .skill-summary i, .skill-track-bar i { display: block; height: 4px; background: #303530; }
      .quest-summary em, .skill-summary em, .skill-track-bar em { display: block; height: 100%; background: #b8c9b0; }
      .quest-summary small, .skill-summary small { color: #888; font-size: 10px; line-height: 1.6; }
      .quest-legacy { border-top: 1px solid #292929; margin-top: 32px; padding-top: 20px; }
      .skill-grid { grid-template-columns: 1fr; }
      .skill-track { border: 1px solid #30332f; background: #111411dd; padding: 14px; }
      .skill-track-head { display: flex; align-items: center; gap: 10px; }
      .skill-track-head > b { font-size: 13px; }
      .skill-track-head > span { color: #aaa; font-size: 11px; }
      .skill-track-head strong { color: #eee; margin-left: 5px; font-weight: 500; }
      .skill-track-bar { display: flex; align-items: center; gap: 10px; margin: 10px 0; }
      .skill-track-bar i { flex: 1; }
      .skill-track-bar small, .skill-first-unlock { color: #888; font-size: 9px; white-space: nowrap; }
      .skill-track-badges { display: grid; gap: 6px; }
      .skill-track-badges .skill { padding: 8px 10px; background: #151715; }
      .skill-track-badges .skill.locked { opacity: .7; }
      .skill-more { width: 100%; margin-top: 14px; }
      .sound-section { border-top: 1px solid #292929; margin-top: 42px; padding-top: 28px; }
      .sound-section h2 { margin: 10px 0; }
      .volume-control { display: grid; gap: 10px; color: #999; font-size: 10px; letter-spacing: .14em; margin-top: 18px; }
      .volume-control input { accent-color: #eee; }
      .bgm-control { position: fixed; z-index: 3; right: 12px; bottom: calc(76px + env(safe-area-inset-bottom)); display: flex; align-items: center; gap: 10px; max-width: calc(100vw - 24px); padding: 8px 12px; border: 1px solid #444; border-radius: 999px; background: #111e; backdrop-filter: blur(10px); }
      .bgm-control button { border: 0; background: transparent; color: #888; font-size: 9px; letter-spacing: .1em; white-space: nowrap; }
      .bgm-control button.on { color: #eee; }
      .bgm-control input { width: 76px; accent-color: #eee; }
      .sound-test { width: 100%; margin-top: 14px; }
      .modal-enter, .message-modal { animation: lifeRpgModalBackdrop var(--motion-normal) var(--motion-ease) both; }
      .modal-enter > *, .message-panel { animation: lifeRpgModalPanel var(--motion-normal) var(--motion-ease) both; }
      @keyframes lifeRpgPageIn { from { opacity: 0; transform: translateY(9px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes lifeRpgComplete { 0% { transform: translateY(0); } 35% { transform: translateY(-2px); } 100% { transform: translateY(0); } }
      @keyframes lifeRpgToast { 0% { opacity: 0; transform: translate(-50%, -42%) scale(.97); } 25% { opacity: 1; transform: translate(-50%, -50%) scale(1); } 100% { opacity: 0; transform: translate(-50%, -65%) scale(1); } }
      @keyframes lifeRpgModalBackdrop { from { opacity: 0; } to { opacity: 1; } }
      @keyframes lifeRpgModalPanel { from { opacity: 0; transform: translateY(14px) scale(.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
      @keyframes lifeRpgLevelUp { 0% { opacity: 0; transform: translate(-50%, -43%) scale(.94); } 18% { opacity: 1; transform: translate(-50%, -50%) scale(1); } 76% { opacity: 1; } 100% { opacity: 0; transform: translate(-50%, -56%) scale(1.025); } }
      @keyframes lifeRpgLevelHalo { 0% { opacity: 0; transform: translate(-50%, -50%) scale(.58); } 24% { opacity: .9; } 100% { opacity: .15; transform: translate(-50%, -50%) scale(1.08); } }
      @keyframes lifeRpgLevelSpark { 0%, 12% { opacity: 0; transform: translateY(8px) scale(.5) rotate(-35deg); } 35% { opacity: 1; transform: translateY(0) scale(1) rotate(0); } 100% { opacity: 0; transform: translateY(-12px) scale(.7) rotate(35deg); } }
      @keyframes lifeRpgStatPill { from { opacity: 0; transform: translateY(6px) scale(.92); } to { opacity: 1; transform: translateY(0) scale(1); } }
      .gacha-screen { padding-bottom: 12px; }
      .gacha-ticket-badge { display: flex; justify-content: space-between; align-items: center; border: 1px solid #6e5b32; background: linear-gradient(135deg, #211c12, #111); padding: 14px 16px; margin: 16px 0; border-radius: 4px; }
      .gacha-ticket-badge small { color: #aaa; letter-spacing: .12em; font-size: 10px; }
      .gacha-ticket-badge b { font-size: 18px; color: #f0d783; }
      .gacha-pay-toggle { display: flex; gap: 8px; margin: 0 0 14px; }
      .gacha-pay-toggle button { flex: 1; border: 1px solid #4a3d66; background: #15111f; color: #b9a9d4; padding: 10px; font-size: 10px; letter-spacing: .06em; border-radius: 3px; }
      .gacha-pay-toggle button.active { color: #f0d783; border-color: #e8c76a; background: #211c12; }
      .gacha-summon-stage { position: relative; display: grid; place-items: center; height: 180px; margin: 10px 0 18px; border: 1px solid #4a3d66; border-radius: 8px; background: radial-gradient(circle at 50% 55%, #241a36 0%, #120e1a 70%); overflow: hidden; }
      .gacha-summon-glow { position: absolute; inset: -20%; background: radial-gradient(circle, rgba(185,143,224,.22) 0%, rgba(185,143,224,0) 65%); opacity: .6; }
      .gacha-summon-stage.drawing .gacha-summon-glow { animation: lifeRpgGachaGlow 1.1s ease-in-out infinite; }
      .gacha-summon-icon { position: relative; font-size: 46px; filter: drop-shadow(0 0 10px rgba(185,143,224,.35)); }
      .gacha-summon-stage.drawing .gacha-summon-icon { animation: lifeRpgGachaSpin 1.1s ease-in-out infinite; }
      .gacha-summon-stage.revealed .gacha-summon-glow { opacity: .25; }
      .gacha-summon-caption { position: relative; display: block; margin-top: 10px; color: #b9a9d4; letter-spacing: .14em; font-size: 10px; }
      .gacha-draw-buttons { display: flex; gap: 10px; margin: 6px 0 20px; }
      .gacha-draw-buttons button { flex: 1; display: grid; gap: 4px; padding: 14px; }
      .gacha-draw-buttons button small { color: #cbb; font-size: 10px; letter-spacing: .08em; }
      .gacha-result-panel { border: 1px solid #4a3d66; background: #15111fdd; padding: 14px; margin: 0 0 20px; display: grid; gap: 8px; }
      .gacha-result-list { display: grid; gap: 7px; max-height: 320px; overflow-y: auto; }
      .gacha-result-row { display: flex; align-items: center; gap: 9px; border: 1px solid #383245; background: #18151fcc; padding: 9px 11px; font-size: 11px; opacity: 0; animation: lifeRpgGachaRowIn .4s var(--motion-ease) both; }
      .gacha-result-row.rarity-epic { border-color: #7b5aa6; box-shadow: 0 0 10px rgba(185,143,224,.18) inset; }
      .gacha-result-row.rarity-legendary { border-color: #a9833f; box-shadow: 0 0 14px rgba(232,199,106,.22) inset; }
      .gacha-result-rarity { border: 1px solid; padding: 2px 6px; font-size: 9px; letter-spacing: .1em; border-radius: 2px; }
      .gacha-result-icon { font-size: 16px; }
      .gacha-history { border-top: 1px solid #292929; margin-top: 20px; padding-top: 18px; }
      .gacha-history-entry { border: 1px solid #383838; background: #121212; padding: 10px 12px; margin: 8px 0; }
      .gacha-history-items { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
      @keyframes lifeRpgGachaGlow { 0%, 100% { opacity: .5; transform: scale(1); } 50% { opacity: .9; transform: scale(1.08); } }
      @keyframes lifeRpgGachaSpin { 0%, 100% { transform: scale(1) rotate(0deg); } 50% { transform: scale(1.12) rotate(8deg); } }
      @keyframes lifeRpgGachaRowIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
      @media (prefers-reduced-motion: reduce) { .gacha-summon-stage.drawing .gacha-summon-glow, .gacha-summon-stage.drawing .gacha-summon-icon, .gacha-result-row { animation: none !important; opacity: 1 !important; } }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; } .rpg-app::before, .rpg-app::after { animation: none !important; } }
      @media (prefers-reduced-motion: reduce) { .page-transition, .level-up-toast, .level-up-toast::before, .level-up-toast::after { animation: none !important; } .level-up-toast { opacity: 1; transform: translate(-50%, -50%); } .level-up-stat-pill { animation: none !important; opacity: 1; } }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
  const [messageLoadingId, setMessageLoadingId] = useState(null);
  const [messageSending, setMessageSending] = useState(false);
  const cloudLoadedRef = useRef(false);
  const usernameConflictNoticeRef = useRef(false);
  const actionCompleteLockRef = useRef(null);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (firstPersistenceRef.current) {
      firstPersistenceRef.current = false;
      if (!localStorage.getItem(LOCAL_MODIFIED_KEY)) localStorage.setItem(LOCAL_MODIFIED_KEY, "0");
      return;
    }
    if (restoringCloudRef.current) {
      restoringCloudRef.current = false;
      return;
    }
    localStorage.setItem(LOCAL_MODIFIED_KEY, String(Date.now()));
  }, [state]);
  useEffect(() => {
    if (!supabase || !state.initialized) return undefined;
    const timer = window.setTimeout(async () => {
      try {
        const result = await syncLifeRpgState(state);
        if (result?.synced) {
          // ゲームデータ（LEVEL/EXP/STATS等）自体の保存は成功しているため、
          // プロフィール公開（SOCIAL）だけが失敗した場合は致命的なエラー表示にしない。
          if (result.profileSynced === false) {
            setCloudStatus("SOCIAL PROFILE非公開");
            if (result.profileErrorReason === "username_taken" && !usernameConflictNoticeRef.current) {
              usernameConflictNoticeRef.current = true;
              showNotice("このUSERNAMEは既に使われています。設定からUSERNAMEを変更してください。", 4000);
            }
          } else {
            setCloudStatus("CLOUD SYNCED");
            usernameConflictNoticeRef.current = false;
          }
          if (!phaseAnnouncedRef.current) {
            playSound("phase", state.sound);
            phaseAnnouncedRef.current = true;
          }
          setState((current) => ({
            ...current,
            social: { ...getSocial(current), remoteAvailable: true, remoteUserId: result.userId },
          }));
        }
    } catch (error) {
      console.warn("Supabaseへの同期に失敗しました。ローカル保存を継続します。", error);
      setCloudStatus("SOCIAL SYNC ERROR");
    }
    if (cloudLoadedRef.current) return;
    try {
      const remote = await loadSocialData();
      if (remote) {
        cloudLoadedRef.current = true;
        setState((current) => ({
          ...current,
          social: {
            ...getSocial(current),
            remoteUserId: remote.userId,
            remoteAvailable: true,
            mockUsers: remote.users || [],
            ranking: remote.ranking || [],
            mockGuilds: remote.guilds || [],
            friends: remote.friends || [],
            friendRequests: remote.friendRequests || [],
            guild: remote.guild,
            searchResults: [],
            unreadMessages: remote.unreadMessages || {},
            messagesAvailable: Boolean(remote.messagesAvailable),
          },
        }));
      }
    } catch (error) {
      console.warn("SOCIALデータの読み込みに失敗しました。", error);
      setCloudStatus("SOCIAL ERROR");
    }}, 700);
    return () => window.clearTimeout(timer);
  }, [state]);
  useEffect(() => {
    const handleUpdate = (event) => setUpdateRegistration(event.detail);
    window.addEventListener("life-rpg-update-ready", handleUpdate);
    return () => window.removeEventListener("life-rpg-update-ready", handleUpdate);
  }, []);
  const skills = useMemo(() => STAT_KEYS.flatMap((stat) => SKILL_THRESHOLDS.map((threshold, index) => ({ id: `${stat}-${threshold}`, stat, threshold, name: `${["見習い", "熟達", "達人", "神域", "伝説"][index]}の${STAT_META[stat].name}` }))), []);
  function showNotice(message, duration = 2400) {
    // 短い通知の後に長い通知が来た場合でも、後から出た通知が
    // 早く消されてしまわないようトークンで世代管理する。
    const token = ++noticeTokenRef.current;
    setNotice(message);
    window.setTimeout(() => { if (noticeTokenRef.current === token) setNotice(""); }, duration);
  }
  function queueMotion(name, details = {}) {
    setMotionQueue((current) => [...current, { type: name, ...details }]);
  }
  function startSetup(event) {
    event.preventDefault();
    if (!setup.name.trim() || !setup.age || !setup.username.trim()) return showNotice("すべての項目を入力してください。");
    const username = setup.username.trim();
    setState((current) => ({ ...current, profile: { ...setup, name: setup.name.trim(), username } }));
    // SOCIAL同期はバックグラウンドで行われるため、事前にUSERNAMEの重複を
    // 確認しておく（重複していても進行はブロックせず、後で変更を促す）。
    isUsernameAvailable(username).then((available) => {
      if (!available) showNotice("このUSERNAMEは既に使われています。後で設定から変更できます。", 4000);
    }).catch(() => {});
  }
  function answer(value) {
    const next = [...answers, value]; setAnswers(next);
    if (question + 1 < QUESTIONS.length) setQuestion((current) => current + 1);
    else { const result = calculateResult(next); setState((current) => ({ ...current, initialized: true, stats: result.stats, diagnosisScores: result.scores, job: result.job })); setShowResult(true); }
  }
  function recordAction(action, completion = {}) {
    // COMPLETE系ボタンの連打によるEXP/AURUM/アイテムの二重付与を防ぐ。
    // 同一ACTIONに対する短時間の再実行のみをブロックし、通常操作は妨げない。
    if (!actionCompleteLockRef.current) actionCompleteLockRef.current = new Set();
    if (actionCompleteLockRef.current.has(action.id)) return;
    actionCompleteLockRef.current.add(action.id);
    window.setTimeout(() => actionCompleteLockRef.current?.delete(action.id), 1200);
    const reward = actionReward(action, state);
    const completionFactor = completionMultiplier(action, completion);
    const effects = Object.fromEntries(Object.entries(reward.effects || {}).map(([stat, value]) => [stat, Number((value * completionFactor).toFixed(2))]));
    action = { ...action, ...reward, exp: Math.max(5, Math.round(reward.exp * completionFactor)), effects, actualValue: completion.actualValue, actualTime: completion.actualTime, completionFactor };
    const today = todayString();
    const dailyQuestPreview = advanceDailyQuests(state.dailyQuestProgress, today, action.category);
    const projectedStats = { ...state.stats };
    Object.entries(action.effects || {}).forEach(([key, value]) => { projectedStats[key] = Math.min(100, (projectedStats[key] || 30) + value); });
    const skillUnlockCount = countNewSkillUnlocks(state.stats, projectedStats, STAT_KEYS, SKILL_THRESHOLDS);
    const unlockedSkillNames = skills
      .filter((skill) => (state.stats[skill.stat] || 0) < skill.threshold && (projectedStats[skill.stat] || 0) >= skill.threshold)
      .map((skill) => skill.name);
    const legacyQuestBonus = QUESTS.filter((quest) => quest.actions.includes(action.id) && !state.completedQuests?.[quest.id]).length * 100;
    const legacyQuestCurrency = QUESTS.filter((quest) => quest.actions.includes(action.id) && !state.completedQuests?.[quest.id]).length * QUEST_CURRENCY_BONUS;
    const progressionBonus = dailyQuestPreview.rewardExp + skillUnlockCount * 15 + legacyQuestBonus;
    let projectedExp = state.exp + action.exp + progressionBonus;
    let projectedLevel = state.level;
    while (projectedExp >= levelExp(projectedLevel)) {
      projectedExp -= levelExp(projectedLevel);
      projectedLevel += 1;
    }
    const unlockedFloor = DUNGEON_FLOORS.find((floor) => floor.floor > state.level && floor.floor <= projectedLevel);
    const previewStreak = nextStreak(state.lastActionDate, today, state.streak || 0);
    const streakMilestoneBonus = previewStreak !== (state.streak || 0) ? (STREAK_MILESTONE_BONUS[previewStreak] || 0) : 0;
    const rankBeforeAction = adventurerRankFor(state, skillCountFor(state.stats));
    const rankAfterAction = adventurerRankFor({ ...state, totalActions: (state.totalActions || 0) + 1, level: projectedLevel }, skillCountFor(projectedStats));
    const rankUpBonus = rankAfterAction.id !== rankBeforeAction.id ? RANK_UP_CURRENCY_BONUS : 0;
    const actionCurrencyGain = actionCurrencyReward(action, completionFactor) + dailyQuestPreview.rewardGold + legacyQuestCurrency + streakMilestoneBonus + rankUpBonus;
    queueMotion("action-complete", { exp: action.exp + progressionBonus, currency: actionCurrencyGain });
    if (projectedLevel > state.level) {
      queueMotion("level-up", { levels: projectedLevel - state.level, fromLevel: state.level, toLevel: projectedLevel, stats: action.effects });
    }
    unlockedSkillNames.forEach((name) => queueMotion("skill-unlock", { name }));
    if (unlockedFloor) queueMotion("dungeon-unlock", { name: unlockedFloor.name, floor: unlockedFloor.floor });
    const dailyQuestsAllDonePreview = dailyQuestPreview.newlyCompleted.length > 0 && dailyQuestPreview.state.completed.length >= DAILY_QUESTS.length;
    const previewGachaTicketsGained = (projectedLevel - state.level) + (dailyQuestsAllDonePreview ? 1 : 0) + (streakMilestoneBonus ? 1 : 0);
    if (rankUpBonus) showNotice(`ADVENTURER RANK UP！「${rankAfterAction.title}」に昇格。+${formatCurrency(rankUpBonus)}`, 5000);
    else if (streakMilestoneBonus) showNotice(`${previewStreak}日連続達成！ボーナス +${formatCurrency(streakMilestoneBonus)}`, 4000);
    if (previewGachaTicketsGained > 0) window.setTimeout(() => showNotice(`🎴 GACHA TICKET +${previewGachaTicketsGained}`, 3200), 650);
    playSound("complete", state.sound);
    if (projectedLevel > state.level) playSound("level", state.sound);
    window.setTimeout(() => playSound("exp", state.sound), 110);
    setState((current) => {
      let exp = current.exp + action.exp;
      let level = current.level;
      while (exp >= levelExp(level)) { exp -= levelExp(level); level += 1; }
      const stats = { ...current.stats };
      Object.entries(action.effects || {}).forEach(([key, value]) => { stats[key] = Math.min(100, (stats[key] || 30) + value); });
      const actionCounts = { ...current.actionCounts, [action.id]: (current.actionCounts[action.id] || 0) + 1 };
      const completedQuests = { ...current.completedQuests };
      let questCurrency = 0;
      QUESTS.filter((quest) => quest.actions.includes(action.id)).forEach((quest) => {
        if (!completedQuests[quest.id]) { completedQuests[quest.id] = true; exp += 100; questCurrency += QUEST_CURRENCY_BONUS; }
      });
      const dailyQuestUpdate = advanceDailyQuests(current.dailyQuestProgress, today, action.category);
      exp += dailyQuestUpdate.rewardExp + countNewSkillUnlocks(current.stats, stats, STAT_KEYS, SKILL_THRESHOLDS) * 15;
      while (exp >= levelExp(level)) { exp -= levelExp(level); level += 1; }
      const newStreak = nextStreak(current.lastActionDate, today, current.streak);
      const streakBonus = newStreak !== (current.streak || 0) ? (STREAK_MILESTONE_BONUS[newStreak] || 0) : 0;
      const rankBefore = adventurerRankFor(current, skillCountFor(current.stats));
      const rankAfter = adventurerRankFor({ ...current, totalActions: (current.totalActions || 0) + 1, level }, skillCountFor(stats));
      const rankBonus = rankAfter.id !== rankBefore.id ? RANK_UP_CURRENCY_BONUS : 0;
      const currency = current.currency + (level - current.level) * LEVEL_UP_CURRENCY_BONUS + actionCurrencyReward(action, completionFactor) + dailyQuestUpdate.rewardGold + questCurrency + streakBonus + rankBonus;
      const jobBonus = current.job && action.category === (current.job.name === "商人" ? "MONEY" : current.job.name === "賢者" ? "STUDY" : current.job.name === "剣士" ? "BODY" : current.job.name === "錬金術師" ? "CREATIVE" : "CHALLENGE") ? 1.5 : 1;
      let jobExp = current.jobExp + Math.round(action.exp * jobBonus);
      let jobLevel = current.jobLevel;
      while (jobExp >= jobLevel * 150) { jobExp -= jobLevel * 150; jobLevel += 1; }
      const social = getSocial(current);
      let guild = social.guild;
      if (guild) {
        let guildExp = guild.exp + action.exp;
        let guildLevel = guild.level;
        while (guildExp >= guildLevel * 200) { guildExp -= guildLevel * 200; guildLevel += 1; }
        guild = { ...guild, exp: guildExp, level: guildLevel, contribution: (guild.contribution || 0) + 1, totalLevel: (guild.totalLevel || 0) + (level > current.level ? level - current.level : 0), questProgress: (guild.questProgress || 0) + 1 };
      }
      const notifications = [socialNotification(`ACTION「${action.name}」達成。${guild ? "GUILD EXP と貢献度を獲得しました。" : "SOCIALに記録しました。"}`), ...(social.notifications || [])].slice(0, 30);
      const dailyActionCount = current.dailyActionDate === today ? (current.dailyActionCount || 0) + 1 : 1;
      const dungeon = normalizeDungeonDaily(current.dungeon, today);
      // GACHA TICKET: レベルアップ・デイリーQUEST全達成・streakマイルストーンで付与。
      // 既存の報酬バランスを壊さないよう少量(各1枚)に留める。
      const dailyQuestsAllDone = dailyQuestUpdate.newlyCompleted.length > 0 && dailyQuestUpdate.state.completed.length >= DAILY_QUESTS.length;
      const gachaTicketsGained = (level - current.level) + (dailyQuestsAllDone ? 1 : 0) + (streakBonus ? 1 : 0);
      const gachaTickets = (current.gachaTickets || 0) + gachaTicketsGained;
      return { ...current, stats, exp, level, currency, jobExp, jobLevel, actionCounts, dailyActionCount, dailyActionDate: today, dailyQuestProgress: dailyQuestUpdate.state, actionHistory: [...(current.actionHistory || []).slice(-19), action.id], completedQuests, totalActions: (current.totalActions || 0) + 1, streak: nextStreak(current.lastActionDate, today, current.streak), lastActionDate: today, social: { ...social, guild, notifications }, dungeon, gachaTickets };
    });
    setState((current) => {
      const previous = current.actionPerformance?.[action.id] || {};
      const fullCompletion = completionFactor >= .99;
      return {
        ...current,
        actionPerformance: {
          ...(current.actionPerformance || {}),
          [action.id]: {
            ...previous,
            successes: (previous.successes || 0) + (fullCompletion ? 1 : 0),
            partials: (previous.partials || 0) + (fullCompletion ? 0 : 1),
            lastTarget: fullCompletion ? action.target || actionTarget(action).value : previous.lastTarget || actionTarget(action).value,
            lastCompletedAt: new Date().toISOString(),
          },
        },
      };
    });
    setState((current) => ({ ...current, actionLog: [...(current.actionLog || []).slice(-99), { actionId: action.id, category: action.category, difficulty: action.difficulty || "NORMAL", target: action.target || actionTarget(action).value, unit: action.unit || actionTarget(action).unit, estimatedTime: action.estimatedTime || actionTarget(action).minutes, actualValue: action.actualValue, actualTime: action.actualTime, exp: action.exp + progressionBonus, effects: action.effects || {}, job: current.job?.name || null, jobModifier: reward.jobModifier, completionFactor, completedAt: new Date().toISOString(), result: completionFactor < .99 ? "partial" : "completed" }] }));
    if (supabase && getSocial(state).remoteAvailable) {
      recordActionContribution(action, getSocial(state).guild?.remote ? getSocial(state).guild.id : null).then((result) => {
        if (result?.queued) setCloudStatus("SYNC QUEUED");
      }).catch((error) => {
        console.warn("行動の共有記録に失敗しました。", error);
        setCloudStatus("LOCAL FALLBACK");
      });
    }
    const previousTarget = state.actionPerformance?.[action.id]?.lastTarget || actionTarget(action).value;
    const personalBest = action.target && action.target > previousTarget ? " PERSONAL BEST" : "";
    const growthSummary = Object.entries(action.effects || {}).map(([stat, value]) => `${stat} ${Math.round(state.stats?.[stat] || 30)}→${Math.min(100, Math.round((state.stats?.[stat] || 30) + value))}`).join(" / ");
    const completionLabel = completionFactor < .99 ? " 部分達成" : completionFactor > 1 ? " PERSONAL BEST" : "";
    const bonusSummary = [
      dailyQuestPreview.newlyCompleted.length ? `デイリーQUEST達成 +${dailyQuestPreview.rewardExp} EXP` : "",
      skillUnlockCount ? `SKILL解放 +${skillUnlockCount * 15} EXP` : "",
    ].filter(Boolean).join(" / ");
    showNotice(`${action.name}を記録しました。 +${action.exp + progressionBonus} EXP / ${growthSummary}${bonusSummary ? ` / ${bonusSummary}` : ""}${completionLabel}${personalBest}`);
  }
  function coopCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
  function updateCoopPresence(presence) {
    const members = Object.values(presence || {}).flat().map((item) => item?.userId).filter(Boolean);
    const uniqueMembers = [...new Set(members)];
    const current = coopSessionRef.current;
    setCoopSession((session) => session ? { ...session, members: uniqueMembers } : session);
  }
  function startCoopBattle(session, guestCombat) {
    if (!session?.floor || session.battle) return;
    const hostCombat = playerCombatStats(state);
    const guest = guestCombat || hostCombat;
    const battle = {
      ...createBattle(state, session.floor, session.skills),
      battleId: `coop-${session.code}`,
      coop: true,
      coopHostId: session.hostId,
      coopPlayers: {
        [session.hostId]: { id: session.hostId, name: state.profile.name || "ホスト", avatarUrl: state.profile.avatarUrl || "", icon: state.job?.icon || "A", hp: hostCombat.maxHp, maxHp: hostCombat.maxHp, combat: hostCombat },
        [session.guestId]: { id: session.guestId, name: session.guestName || "フレンド", avatarUrl: session.guestAvatarUrl || "", icon: session.guestIcon || "A", hp: guest.maxHp, maxHp: guest.maxHp, combat: guest },
      },
      turnActorId: session.hostId,
      turnNumber: 1,
    };
    setCoopSession((current) => current?.code === session.code ? { ...current, battle } : current);
    sendCoopBattleMessage(coopChannelRef.current, "coop-state", { battle, hostId: session.hostId }).catch((error) => console.warn("協力戦を開始できませんでした。", error));
  }
  function handleCoopMessage(payload) {
    const session = coopSessionRef.current;
    if (!session || !payload) return;
    if (payload.type === "coop-join" && session.role === "host") {
      if (!session.battle) {
        setCoopSession((current) => current ? { ...current, guestId: payload.userId, guestCombat: payload.combat, guestName: payload.profile?.name, guestAvatarUrl: payload.profile?.avatarUrl, guestIcon: payload.profile?.icon } : current);
        startCoopBattle({ ...session, guestId: payload.userId, guestCombat: payload.combat, guestName: payload.profile?.name, guestAvatarUrl: payload.profile?.avatarUrl, guestIcon: payload.profile?.icon }, payload.combat);
      }
      else sendCoopBattleMessage(coopChannelRef.current, "coop-state", { battle: session.battle, hostId: session.hostId }).catch((error) => console.warn("協力戦状態を送信できませんでした。", error));
    } else if (payload.type === "coop-state" && session.role === "guest" && payload.battle) {
      setCoopSession((current) => current ? { ...current, battle: payload.battle, hostId: payload.hostId || current.hostId } : current);
    } else if (payload.type === "coop-battle" && session.role === "guest" && payload.battle) {
      setCoopSession((current) => current ? { ...current, battle: payload.battle } : current);
    } else if (payload.type === "coop-command" && session.role === "host") {
      applyCoopCommand(payload.command, payload.itemId, payload.skillId, payload.actorId);
    } else if (payload.type === "coop-timing" && session.role === "host") {
      applyCoopTiming(payload.position, payload.actorId, payload.quality);
    }
  }
  function applyCoopCommand(command, itemId, skillId, actorId) {
    const session = coopSessionRef.current;
    const battle = session?.battle;
    if (!session || !battle || battle.phase !== "select" || (battle.turnActorId && battle.turnActorId !== (actorId || session.userId))) return;
    if (!["attack", "skill", "dodge", "defend"].includes(command)) return;
    if (command === "skill" && !battle.activeSkills?.includes(skillId)) return;
    const nextBattle = { ...battle, phase: "timing", pendingCommand: command, pendingSkillId: skillId || null, pendingActorId: actorId || session.hostId, timingStart: Date.now(), turnSeed: Math.random() };
    setCoopSession((current) => current ? { ...current, battle: nextBattle } : current);
    sendCoopBattleMessage(coopChannelRef.current, "coop-battle", { battle: nextBattle }).catch((error) => console.warn("協力戦入力を同期できませんでした。", error));
  }
  function applyCoopTiming(position, actorId, qualityInput) {
    const session = coopSessionRef.current;
    const battle = session?.battle;
    if (!session || session.role !== "host" || !battle || battle.phase !== "timing") return;
    const quality = qualityInput || (typeof position === "number"
      ? timingQualityAtPosition(position)
      : timingQuality(Date.now() - battle.timingStart, battle.floor));
    const activeActorId = actorId || battle.pendingActorId || session.hostId;
    const actor = battle.coopPlayers?.[activeActorId];
    const actorBattle = actor ? { ...battle, playerHp: actor.hp, playerMaxHp: actor.maxHp } : battle;
    const resolved = resolveTimingHit(actorBattle, actor?.combat || playerCombatStats(state), quality, seededRandom(battle.turnSeed ?? Math.random()));
    const nextPlayers = actor ? { ...battle.coopPlayers, [activeActorId]: { ...actor, hp: resolved.playerHp } } : battle.coopPlayers;
    const nextActorId = activeActorId === session.hostId ? session.guestId : session.hostId;
    const nextBattle = {
      ...resolved,
      coopPlayers: nextPlayers,
      playerHp: nextPlayers?.[session.hostId]?.hp || resolved.playerHp,
      turnActorId: nextActorId,
      turnNumber: (battle.turnNumber || 1) + 1,
      turnSeed: undefined,
      lastHit: { label: quality.label, tier: quality.tier, id: Date.now() },
    };
    setCoopSession((current) => current ? { ...current, battle: nextBattle } : current);
    sendCoopBattleMessage(coopChannelRef.current, "coop-battle", { battle: nextBattle }).catch((error) => console.warn("協力戦結果を同期できませんでした。", error));
  }
  async function openCoopSession(code, role, floor, skills) {
    if (!supabase || !getSocial(state).remoteAvailable) {
      showNotice("フレンド協力にはSOCIAL接続が必要です。");
      return;
    }
    await closeCoopBattleChannel(coopChannelRef.current);
    const normalizedCode = code || coopCode();
    const channelResult = await openCoopBattleChannel(normalizedCode, { onMessage: handleCoopMessage, onPresence: updateCoopPresence });
    coopChannelRef.current = channelResult.channel;
    setCoopSession({ code: normalizedCode, role, hostId: role === "host" ? channelResult.userId : null, userId: channelResult.userId, floor, skills, battle: null, members: [channelResult.userId] });
    if (role === "guest") await sendCoopBattleMessage(channelResult.channel, "coop-join", {
      userId: channelResult.userId,
      combat: playerCombatStats(state),
      profile: { name: state.profile.name || "フレンド", avatarUrl: state.profile.avatarUrl || "", icon: state.job?.icon || "A" },
    });
    showNotice(role === "host" ? `協力ルームを作成しました。コード ${normalizedCode}` : "協力ルームに参加しました。");
  }
  async function createCoopRoom(floor, skills) {
    try { await openCoopSession(null, "host", floor, skills); } catch (error) {
      console.warn("協力ルームの作成に失敗しました。", error);
      showNotice(`協力ルームを作成できませんでした: ${error.message || "接続を確認してください。"}`);
    }
  }
  async function joinCoopRoom(code) {
    try { await openCoopSession(code, "guest", null, []); } catch (error) {
      console.warn("協力ルームへの参加に失敗しました。", error);
      showNotice(`協力ルームに参加できませんでした: ${error.message || "コードを確認してください。"}`);
    }
  }
  async function coopAction(command) {
    const session = coopSessionRef.current;
    if (!session?.battle || session.battle.phase !== "select") return;
    if (session.role === "guest") return sendCoopBattleMessage(coopChannelRef.current, "coop-command", { command, actorId: session.userId });
    applyCoopCommand(command, null, null, session.userId);
  }
  async function coopCommand(command, itemId, skillId) {
    const session = coopSessionRef.current;
    if (!session?.battle || session.battle.phase !== "select") return;
    if (session.role === "guest") return sendCoopBattleMessage(coopChannelRef.current, "coop-command", { command, itemId, skillId, actorId: session.userId });
    applyCoopCommand(command, itemId, skillId, session.userId);
  }
  async function coopTiming(position) {
    const session = coopSessionRef.current;
    if (!session?.battle || session.battle.phase !== "timing") return;
    const quality = typeof position === "number" ? timingQualityAtPosition(position) : null;
    if (session.role === "guest") return sendCoopBattleMessage(coopChannelRef.current, "coop-timing", { position, quality, actorId: session.userId });
    applyCoopTiming(position, session.userId, quality);
  }
  async function leaveCoopRoom() {
    await closeCoopBattleChannel(coopChannelRef.current);
    coopChannelRef.current = null;
    setCoopSession(null);
  }
  function startDungeonFloor(floor, skills = []) {
    const today = todayString();
    const dungeon = normalizeDungeonDaily(state.dungeon, today);
    if (dungeon.battle) return;
    if (floor > state.level) return showNotice(`このフロアに挑戦するにはLV.${floor}が必要です。`);
    playSound("transition", state.sound);
    const rewardSeed = Math.random();
    const battleId = `battle-${Date.now()}-${Math.floor(rewardSeed * 0x100000000).toString(36)}`;
    setState((current) => {
      const normalized = normalizeDungeonDaily(current.dungeon, today);
      if (normalized.battle) return current;
      const available = availableBattleSkills(current.stats);
      const selectedSkills = skills.filter((id) => available.some((skill) => skill.id === id)).slice(0, 3);
      const equippedSkills = selectedSkills.length ? selectedSkills : defaultBattleSkillLoadout(current.stats);
      const battle = { ...createBattle(current, floor, equippedSkills), battleId, rewardSeed };
      return { ...current, dungeon: { ...normalized, battleSkills: equippedSkills, ticketsUsedToday: normalized.ticketsUsedToday + 1, battle } };
    });
  }
  function saveBattleSkills(skills) {
    setState((current) => ({
      ...current,
      dungeon: { ...(current.dungeon || {}), battleSkills: skills.slice(0, 3) },
    }));
  }
  function chooseBattleCommand(type, itemId, skillId) {
    const turnSeed = Math.random();
    setState((current) => {
      const dungeon = current.dungeon;
      const battle = dungeon?.battle;
      if (!battle || battle.phase !== "select") return current;
      const combat = playerCombatStats(current);
      if (type === "attack" || type === "skill" || type === "dodge" || type === "defend") {
        if (type === "skill") {
          const skill = BATTLE_SKILLS.find((entry) => entry.id === skillId && battle.activeSkills?.includes(entry.id));
          if (!skill) return { ...current, dungeon: { ...dungeon, battle: { ...battle, log: [...battle.log.slice(-4), "そのスキルは装備されていません。"] } } };
          if ((battle.cooldowns?.[skill.id] || 0) > 0 || (battle.mp ?? 0) < skill.mp || (battle.energy ?? 0) < skill.energy) {
            return { ...current, dungeon: { ...dungeon, battle: { ...battle, log: [...battle.log.slice(-4), "MP・ENERGYまたはクールダウンを確認してください。"] } } };
          }
        }
        return { ...current, dungeon: { ...dungeon, battle: { ...battle, phase: "timing", pendingCommand: type, pendingSkillId: skillId || null, timingStart: Date.now(), turnSeed } } };
      }
      if (type === "item") {
        const item = SHOP_ITEMS.find((entry) => entry.id === itemId) || SHOP_ITEMS[0];
        if (item.id === "potion") {
          const potions = current.inventory?.potions || 0;
          if (battle.itemUsesLeft <= 0 && potions <= 0) return { ...current, dungeon: { ...dungeon, battle: { ...battle, log: [...battle.log.slice(-4), "回復薬の残り回数がありません。"] } } };
          if (battle.itemUsesLeft > 0) {
            const resolved = resolveBattleTurn({ ...battle, itemUsesLeft: battle.itemUsesLeft - 1 }, combat, "item", { label: "-", mult: 1 }, item, seededRandom(turnSeed));
            return { ...current, dungeon: { ...dungeon, battle: { ...resolved, damageEvents: extractDamageEvents(battle, resolved) } } };
          }
          const resolved = resolveBattleTurn(battle, combat, "item", { label: "-", mult: 1 }, item, seededRandom(turnSeed));
          return { ...current, inventory: { ...current.inventory, potions: potions - 1 }, dungeon: { ...dungeon, battle: { ...resolved, damageEvents: extractDamageEvents(battle, resolved) } } };
        }
        const stock = current.inventory?.[item.invKey] || 0;
        if (stock <= 0) return { ...current, dungeon: { ...dungeon, battle: { ...battle, log: [...battle.log.slice(-4), `${item.name}の在庫がありません。`] } } };
        const resolved = resolveBattleTurn(battle, combat, "item", { label: "-", mult: 1 }, item, seededRandom(turnSeed));
        return { ...current, inventory: { ...current.inventory, [item.invKey]: stock - 1 }, dungeon: { ...dungeon, battle: { ...resolved, damageEvents: extractDamageEvents(battle, resolved) } } };
      }
      if (type === "escape") {
        const resolved = resolveEscape(battle, combat, seededRandom(turnSeed));
        return { ...current, dungeon: { ...dungeon, battle: { ...resolved, damageEvents: extractDamageEvents(battle, resolved) } } };
      }
      return current;
    });
    playSound("tap", state.sound);
  }
  function resolveBattleTiming(positionPercent) {
    const fallbackTurnSeed = Math.random();
    setState((current) => {
      const dungeon = current.dungeon;
      const battle = dungeon?.battle;
      if (!battle || battle.phase !== "timing") return current;
      const combat = playerCombatStats(current);
      const quality = typeof positionPercent === "number"
        ? timingQualityAtPosition(positionPercent)
        : timingQuality(Date.now() - battle.timingStart, battle.floor);
      const resolved = resolveTimingHit(battle, combat, quality, seededRandom(battle.turnSeed ?? fallbackTurnSeed));
      if (resolved.phase === "won" && !resolved.reward) {
        const monster = monsterAt(battle.floor);
        const alreadyCleared = (dungeon.bestFloor || 0) >= battle.floor;
        const drop = rollEquipmentDrop(battle.floor, current.ownedEquipment, seededRandom(battle.rewardSeed ?? fallbackTurnSeed));
        const metrics = resolved.combatMetrics || {};
        const bonusLines = [
          !alreadyCleared && { label: "初回踏破", exp: Math.round(monster.exp * 0.12), gold: 0 },
          metrics.weakHits > 0 && { label: "弱点攻略", exp: 0, gold: 8 },
          metrics.breaks > 0 && { label: "BREAK", exp: 0, gold: 8 },
          metrics.damageTaken === 0 && { label: "NO DAMAGE", exp: Math.round(monster.exp * 0.1), gold: 0 },
          (resolved.maxCombo || 0) >= 3 && { label: `${resolved.maxCombo} COMBO`, exp: 0, gold: 8 },
        ].filter(Boolean);
        const bonusExp = bonusLines.reduce((total, line) => total + line.exp, 0);
        const bonusGold = bonusLines.reduce((total, line) => total + line.gold, 0);
        resolved.reward = {
          exp: (alreadyCleared ? Math.max(1, Math.round(monster.exp * 0.25)) : monster.exp) + bonusExp,
          gold: monster.gold + bonusGold,
          bonusExp,
          bonusGold,
          bonusLines,
          alreadyCleared,
          drop,
        };
      }
      return { ...current, dungeon: { ...dungeon, battle: { ...resolved, turnSeed: undefined, lastHit: { label: quality.label, tier: quality.tier, id: Date.now() }, damageEvents: extractDamageEvents(battle, resolved) } } };
    });
    playSound(state.dungeon?.battle?.pendingCommand === "skill" ? "job" : "tap", state.sound);
  }
  function buyShopItem(itemId) {
    const item = SHOP_ITEMS.find((entry) => entry.id === itemId);
    if (!item) return;
    if (state.currency < item.cost) return showNotice(`${CURRENCY_NAME}が足りません。`);
    setState((current) => {
      if (current.currency < item.cost) return current;
      const inventory = { ...current.inventory, [item.invKey]: (current.inventory?.[item.invKey] || 0) + 1 };
      return { ...current, currency: current.currency - item.cost, inventory, discoveredItems: [...new Set([...(current.discoveredItems || []), item.id])] };
    });
    playSound("tap", state.sound);
    showNotice(`${item.name}を購入しました。（-${formatCurrency(item.cost)}）`);
  }
  function buyEquipment(itemId) {
    const item = EQUIPMENT_ITEMS.find((entry) => entry.id === itemId);
    if (!item) return;
    if ((state.ownedEquipment || []).includes(itemId)) return;
    if (state.currency < item.cost) return showNotice(`${CURRENCY_NAME}が足りません。`);
    setState((current) => {
      if (current.currency < item.cost) return current;
      if ((current.ownedEquipment || []).includes(itemId)) return current;
      const ownedEquipment = [...(current.ownedEquipment || []), itemId];
      const equipment = { ...(current.equipment || createEquipmentDefaults()) };
      if (!equipment[item.slot]) equipment[item.slot] = itemId;
      return { ...current, currency: current.currency - item.cost, ownedEquipment, equipment, discoveredItems: [...new Set([...(current.discoveredItems || []), item.id])] };
    });
    playSound("tap", state.sound);
    showNotice(`${item.name}を購入しました。（-${formatCurrency(item.cost)}）`);
  }
  function equipItem(itemId) {
    const item = EQUIPMENT_ITEMS.find((entry) => entry.id === itemId);
    if (!item) return;
    setState((current) => {
      if (!(current.ownedEquipment || []).includes(itemId)) return current;
      const equipment = { ...(current.equipment || createEquipmentDefaults()) };
      equipment[item.slot] = equipment[item.slot] === itemId ? null : itemId;
      return { ...current, equipment };
    });
    playSound("tap", state.sound);
  }
  function summarizeGachaResults(claimed) {
    return claimed.map((result) => ({
      kind: result.kind,
      rarity: result.rarity,
      name: result.item?.name || (result.kind === "stat" ? STAT_META[result.stat]?.name || result.stat : null),
      icon: result.item?.icon || null,
      amount: result.amount || null,
      duplicate: Boolean(result.duplicate),
      convertedCurrency: result.convertedCurrency || 0,
    }));
  }
  function drawGacha(count, payWith = "ticket") {
    // COMPLETEボタン等と同様に短時間の連打のみをブロックし、演出中の
    // 操作性は妨げない（二重抽選・二重消費の防止）。
    if (gachaDrawLockRef.current) return;
    const ticketCost = count === 10 ? GACHA_TICKET_COST.ten : GACHA_TICKET_COST.single;
    const aurumCost = count === 10 ? GACHA_AURUM_COST.ten : GACHA_AURUM_COST.single;
    const useAurum = payWith === "aurum";
    if (useAurum) {
      if ((state.currency || 0) < aurumCost) return showNotice(`${CURRENCY_NAME}が足りません。`);
    } else if ((state.gachaTickets || 0) < ticketCost) {
      return showNotice("GACHA TICKETが足りません。");
    }
    gachaDrawLockRef.current = true;
    window.setTimeout(() => { gachaDrawLockRef.current = false; }, 1500);
    const results = drawGachaResults(count);
    const preview = applyGachaResults(state, results);
    const summary = summarizeGachaResults(preview.claimed);
    setGachaDrawing(true);
    setGachaResults(null);
    playSound("tap", state.sound);
    setState((current) => {
      if (useAurum) {
        if ((current.currency || 0) < aurumCost) return current;
      } else if ((current.gachaTickets || 0) < ticketCost) {
        return current;
      }
      const { state: nextState, claimed } = applyGachaResults(current, results);
      const historyEntry = { id: `gacha-${Date.now()}`, at: new Date().toISOString(), count, paidWith: useAurum ? "aurum" : "ticket", results: summarizeGachaResults(claimed) };
      return {
        ...nextState,
        currency: useAurum ? nextState.currency - aurumCost : nextState.currency,
        gachaTickets: useAurum ? (current.gachaTickets || 0) : (current.gachaTickets || 0) - ticketCost,
        gachaHistory: [historyEntry, ...(current.gachaHistory || [])].slice(0, 50),
      };
    });
    window.setTimeout(() => {
      setGachaDrawing(false);
      setGachaResults(summary);
      playSound(summary.some((result) => result.rarity === "legendary") ? "achievement" : summary.some((result) => result.rarity === "epic") ? "job" : "complete", state.sound);
      if (preview.levelsGained > 0) {
        queueMotion("level-up", { levels: preview.levelsGained, fromLevel: state.level, toLevel: state.level + preview.levelsGained });
        window.setTimeout(() => playSound("level", state.sound), 120);
      }
    }, 900);
  }
  function continueAfterBattle() {
    const dungeon = state.dungeon;
    const battle = dungeon?.battle;
    if (!battle) return;
    if (battle.phase === "won") {
      const monster = monsterAt(battle.floor);
      const reward = battle.reward || {
        exp: (dungeon.bestFloor || 0) >= battle.floor ? Math.max(1, Math.round(monster.exp * 0.25)) : monster.exp,
        gold: monster.gold,
        alreadyCleared: (dungeon.bestFloor || 0) >= battle.floor,
        drop: rollEquipmentDrop(battle.floor, state.ownedEquipment, seededRandom(battle.rewardSeed ?? Math.random())),
      };
      const isFirstVictory = (dungeon.bestFloor || 0) === 0;
      const battleId = battle.battleId;
      const claimKey = battleId || `legacy-${battle.floor}-${battle.timingStart || battle.log.length}`;
      if (rewardClaimRef.current === claimKey) return;
      const preview = claimBattleReward(state, battleId, battle, reward);
      if (!preview.claimed) return;
      rewardClaimRef.current = claimKey;
      playSound("achievement", state.sound);
      setState((current) => {
        const claimed = claimBattleReward(current, battleId, battle, reward).state;
        const withDrop = reward.drop
          ? { ...claimed, discoveredItems: [...new Set([...(claimed.discoveredItems || []), reward.drop.id])] }
          : claimed;
        // GACHA TICKET: BOSS撃破+2枚、レベルアップは1レベルにつき+1枚。
        const levelsGainedHere = Math.max(0, withDrop.level - current.level);
        const ticketsGained = (monster.boss ? 2 : 0) + levelsGainedHere;
        const withTickets = ticketsGained > 0 ? { ...withDrop, gachaTickets: (withDrop.gachaTickets || 0) + ticketsGained } : withDrop;
        return isFirstVictory && current.onboarding?.active
          ? { ...withTickets, onboarding: { ...withTickets.onboarding, active: false, completedAt: new Date().toISOString() } }
          : withTickets;
      });
      if (preview.reward.levelsGained > 0) {
        queueMotion("level-up", { levels: preview.reward.levelsGained, fromLevel: state.level, toLevel: state.level + preview.reward.levelsGained });
        playSound("level", state.sound);
      }
      if (isFirstVictory && state.onboarding?.active) {
        queueMotion("onboarding-complete");
      }
      if (reward.drop) {
        playSound("job", state.sound);
        showNotice(`${monster.boss ? "BOSSを撃破！ " : ""}${monster.name}を撃破！ +${reward.exp} EXP / +${preview.reward.currency} ${CURRENCY_NAME}\n✨ ${RARITY_META[reward.drop.rarity].label}装備「${reward.drop.icon} ${reward.drop.name}」をドロップ！`, 6000);
      } else {
        showNotice(`${monster.boss ? "BOSSを撃破！ " : ""}${monster.name}を撃破！ +${reward.exp} EXP${reward.alreadyCleared ? "（再挑戦割引）" : ""} / +${preview.reward.currency} ${CURRENCY_NAME}`);
      }
      if (monster.boss) window.setTimeout(() => showNotice("🎴 GACHA TICKET +2", 3200), 700);
    } else if (battle.phase === "lost") {
      playSound("error", state.sound);
      setState((current) => ({ ...current, dungeon: { ...current.dungeon, battle: null } }));
      showNotice("敗北してしまった…ステータスを鍛えてから再挑戦しましょう。");
    } else if (battle.phase === "fled") {
      playSound("tab", state.sound);
      setState((current) => ({ ...current, dungeon: { ...current.dungeon, battle: null } }));
      showNotice("うまく逃げ切った。装備やステータスを整えてから再挑戦しよう。");
    } else {
      setState((current) => ({ ...current, dungeon: { ...current.dungeon, battle: null } }));
    }
  }
  function saveGoals(event) { event.preventDefault(); if (!goalSelection.length && !customGoal.trim()) return showNotice("GOALを1つ以上選択してください。"); setState((current) => ({ ...current, profile: { ...current.profile, goals: goalSelection, customGoal: customGoal.trim() } })); setShowGoal(false); showNotice("あなた専用のACTIONを生成しました。"); }
  function createCustomAction(event) { event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get("title") || "").trim(); if (!name) return; const difficulty = String(form.get("difficulty")); const action = { id: `custom-${Date.now()}`, name, category: String(form.get("category")), difficulty, baseExp: difficulty === "HARD" ? 70 : difficulty === "NORMAL" ? 35 : 15, target: difficulty === "HARD" ? 3 : difficulty === "NORMAL" ? 2 : 1, unit: "tasks", estimatedTime: difficulty === "HARD" ? 45 : difficulty === "NORMAL" ? 25 : 10, effects: { WILL: 1 }, tags: [], custom: true }; setState((current) => ({ ...current, customActions: [...(current.customActions || []), action] })); event.currentTarget.reset(); showNotice("ACTIONを追加しました。"); }
  function saveProfile(event) {
    event.preventDefault();
    const nextUsername = String(setup.username || "").trim();
    setState((current) => ({ ...current, profile: { ...setup, age: String(setup.age) } }));
    setEditing(false);
    showNotice("プロフィールを更新しました。");
    if (nextUsername && nextUsername.toLowerCase() !== (state.profile.username || "").toLowerCase()) {
      isUsernameAvailable(nextUsername).then((available) => {
        if (!available) showNotice("このUSERNAMEは既に使われています。SOCIAL上では別のUSERNAMEをご検討ください。", 4000);
      }).catch(() => {});
    }
  }
  function changeAvatar(event) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|gif)$/i.test(file.name)) {
      input.value = "";
      showNotice("画像ファイルを選択してください。");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      input.value = "";
      showNotice("画像は8MB以下にしてください。");
      return;
    }
    const fileInfo = `[${file.name || "no-name"} / ${file.type || "no-type"} / ${Math.round(file.size / 1024)}KB]`;
    readFileBufferWithRetries(file, { onRetryNotice: () => showNotice(`写真を読み込み中です… ${fileInfo}`, 6000) }).then((buffer) => {
      input.value = "";
      const blob = new Blob([buffer], { type: file.type || "image/jpeg" });
      processImageBlob(blob, fileInfo, {
        size: 512,
        onSaved: (avatarUrl) => {
          setState((current) => ({ ...current, profile: { ...current.profile, avatarUrl } }));
          showNotice("プロフィール画像を更新しました。");
        },
      });
    }).catch((error) => {
      input.value = "";
      console.warn("ファイルの読み込みに失敗しました。", error);
      if (isTransientFileReadError(error)) {
        showNotice(`写真を読み込めませんでした ${fileInfo}。写真Appでこの画像を選び、「ファイル」>「書き出す」>「未編集のオリジナルを書き出す」でデスクトップ等に保存してから、そのファイルを選び直してください。`, 10000);
      } else {
        showNotice(`ファイルを読み込めませんでした ${fileInfo} ${error?.name || ""}:${error?.message || error}`, 8000);
      }
    });
  }
  function changeGuildIcon(event) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    const guild = getSocial(state).guild;
    if (!guild) {
      input.value = "";
      return;
    }
    if (!file.type.startsWith("image/") && !/\.(jpe?g|png|webp|gif)$/i.test(file.name)) {
      input.value = "";
      showNotice("画像ファイルを選択してください。");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      input.value = "";
      showNotice("画像は8MB以下にしてください。");
      return;
    }
    const fileInfo = `[${file.name || "no-name"} / ${file.type || "no-type"} / ${Math.round(file.size / 1024)}KB]`;
    readFileBufferWithRetries(file, { onRetryNotice: () => showNotice(`写真を読み込み中です… ${fileInfo}`, 6000) }).then((buffer) => {
      input.value = "";
      const blob = new Blob([buffer], { type: file.type || "image/jpeg" });
      processImageBlob(blob, fileInfo, {
        size: 128,
        onSaved: async (icon) => {
          try {
            if (supabase && guild.remote) await updateRemoteGuildIcon(guild.id, icon);
            setState((current) => ({ ...current, social: { ...getSocial(current), guild: { ...getSocial(current).guild, icon } } }));
            showNotice("GUILDアイコンを更新しました。");
          } catch (error) {
            console.warn("GUILDアイコンの更新に失敗しました。", error);
            showNotice("GUILDアイコンの更新に失敗しました。オーナーのみ変更できます。", 4000);
          }
        },
      });
    }).catch((error) => {
      input.value = "";
      console.warn("ファイルの読み込みに失敗しました。", error);
      if (isTransientFileReadError(error)) {
        showNotice(`写真を読み込めませんでした ${fileInfo}。写真Appでこの画像を選び、「ファイル」>「書き出す」>「未編集のオリジナルを書き出す」でデスクトップ等に保存してから、そのファイルを選び直してください。`, 10000);
      } else {
        showNotice(`ファイルを読み込めませんでした ${fileInfo} ${error?.name || ""}:${error?.message || error}`, 8000);
      }
    });
  }
  function processImageBlob(file, fileInfo, { size = 512, onSaved }) {
    const saveBitmap = (source, width, height, cleanup = () => {}) => {
      try {
        const scale = Math.min(1, size / Math.max(width, height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * scale));
        canvas.height = Math.max(1, Math.round(height * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          cleanup();
          showNotice("画像を処理できませんでした。別の画像を試してください。");
          return;
        }
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        cleanup();
        onSaved(dataUrl);
      } catch (error) {
        cleanup();
        console.warn("画像の変換に失敗しました。", error);
        showNotice(`画像を変換できませんでした ${fileInfo} ${error?.name || ""}:${error?.message || error}`, 8000);
      }
    };
    const readViaFileReader = () => {
      const reader = new FileReader();
      reader.onerror = () => showNotice(`画像を読み込めませんでした ${fileInfo} FileReaderError:${reader.error?.message || reader.error}`, 8000);
      reader.onload = () => {
        const image = new Image();
        image.onload = () => saveBitmap(image, image.naturalWidth, image.naturalHeight, () => {});
        image.onerror = () => showNotice(`画像のデコードに失敗しました ${fileInfo} (DataURL)`, 8000);
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    };
    const readViaObjectUrl = () => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);
      image.onload = () => saveBitmap(image, image.naturalWidth, image.naturalHeight, () => URL.revokeObjectURL(objectUrl));
      image.onerror = (event) => {
        URL.revokeObjectURL(objectUrl);
        console.warn("objectUrl decode failed", event);
        readViaFileReader();
      };
      image.src = objectUrl;
    };
    if (typeof createImageBitmap === "function") {
      createImageBitmap(file).then((bitmap) => {
        saveBitmap(bitmap, bitmap.width, bitmap.height, () => bitmap.close());
      }).catch((error) => {
        console.warn("createImageBitmap failed", fileInfo, error);
        readViaObjectUrl();
      });
      return;
    }
    readViaObjectUrl();
  }
  function removeAvatar() {
    setState((current) => ({ ...current, profile: { ...current.profile, avatarUrl: "" } }));
    showNotice("プロフィール画像を削除しました。");
  }
  async function addFriend(user) {
    try {
      if (!supabase || !getSocial(state).remoteAvailable || !user?.remote) {
        showNotice("SOCIALに接続できていません。しばらくしてから再試行してください。");
        return;
      }
      const remoteRequest = await sendFriendRequest(user.id);
      if (remoteRequest?.alreadyPending) {
        showNotice("このユーザーにはすでに申請済みです。");
        return;
      }
      setState((current) => { const social = getSocial(current); if (social.friends.includes(user.id) || social.friendRequests.some((request) => request.userId === user.id && request.direction === "outgoing")) return current; return { ...current, social: { ...social, friendRequests: [...social.friendRequests, { id: `request-${Date.now()}`, userId: user.id, direction: "outgoing", status: "pending", createdAt: new Date().toISOString() }], notifications: [socialNotification(`${user.username}へフレンド申請を送りました。`), ...(social.notifications || [])].slice(0, 30) } }; });
      showNotice("フレンド申請を送りました。");
    } catch (error) {
      console.warn("フレンド申請に失敗しました。", error);
      setCloudStatus(`FRIEND ERROR: ${error?.message || "申請に失敗しました。"}`);
      showNotice(`申請に失敗しました: ${error?.message || "Supabase設定を確認してください。"}`);
    }
  }
  async function respondFriend(request, accepted) {
    try {
      if (!supabase || !request?.status) {
        showNotice("SOCIALに接続できていません。");
        return;
      }
      await respondToFriendRequest(request.id, accepted);
      setState((current) => { const social = getSocial(current); const friends = accepted && !social.friends.includes(request.userId) ? [...social.friends, request.userId] : social.friends; return { ...current, social: { ...social, friends, friendRequests: social.friendRequests.filter((item) => item.id !== request.id), notifications: [socialNotification(accepted ? "フレンド申請を承認しました。" : "フレンド申請を辞退しました。"), ...(social.notifications || [])].slice(0, 30) } }; });
      setCloudStatus("CLOUD SYNCED");
      showNotice(accepted ? "フレンドに追加しました。" : "申請を辞退しました。");
    } catch (error) {
      console.warn("フレンド申請の更新に失敗しました。", error);
      setCloudStatus(`FRIEND ERROR: ${error?.message || "更新に失敗しました。"}`);
      showNotice(`承認に失敗しました: ${error?.message || "SupabaseのSQL設定を確認してください。"}`);
    }
  }
  async function removeFriend(userId, block = false) {
    try {
      if (!supabase || !getSocial(state).remoteAvailable) {
        showNotice("SOCIALに接続できていません。");
        return;
      }
      await removeRemoteFriend(userId);
      setState((current) => { const social = getSocial(current); return { ...current, social: { ...social, friends: social.friends.filter((id) => id !== userId), blockedUsers: block && !social.blockedUsers.includes(userId) ? [...social.blockedUsers, userId] : social.blockedUsers, friendRequests: social.friendRequests.filter((request) => request.userId !== userId), notifications: [socialNotification(block ? "ユーザーをブロックしました。" : "フレンドを解除しました。"), ...(social.notifications || [])].slice(0, 30) } }; });
      showNotice(block ? "ユーザーをブロックしました。" : "フレンドを解除しました。");
    } catch (error) {
      console.warn("フレンド解除に失敗しました。", error);
      showNotice("更新に失敗しました。ローカル表示を維持します。");
    }
  }
  async function openMessages(user) {
    if (!user || !getSocial(state).friends.includes(user.id)) return;
    setMessageLoadingId(user.id);
    try {
      if (supabase && getSocial(state).remoteAvailable && user.remote) {
        const messages = await loadConversation(user.id);
        setState((current) => ({ ...current, social: { ...getSocial(current), conversations: { ...getSocial(current).conversations, [user.id]: messages }, unreadMessages: { ...getSocial(current).unreadMessages, [user.id]: 0 }, messagesAvailable: true } }));
      } else {
        setState((current) => {
          const social = getSocial(current);
          const messages = (social.conversations?.[user.id] || []).map((message) => message.recipientId === "self" ? { ...message, readAt: message.readAt || new Date().toISOString() } : message);
          return { ...current, social: { ...social, conversations: { ...social.conversations, [user.id]: messages }, unreadMessages: { ...social.unreadMessages, [user.id]: 0 } } };
        });
      }
    } catch (error) {
      console.warn("メッセージの読み込みに失敗しました。ローカル保存を使用します。", error);
      setCloudStatus("LOCAL FALLBACK");
      setState((current) => {
        const social = getSocial(current);
        return { ...current, social: { ...social, conversations: { ...social.conversations, [user.id]: social.conversations?.[user.id] || [] }, unreadMessages: { ...social.unreadMessages, [user.id]: 0 } } };
      });
    } finally {
      setMessageLoadingId(null);
    }
  }
  async function sendChatMessage(user, body) {
    const text = String(body || "").trim();
    if (!user || !text || !getSocial(state).friends.includes(user.id)) return;
    setMessageSending(true);
    try {
      let message = null;
      if (supabase && getSocial(state).remoteAvailable && user.remote) {
        try {
          message = await sendRemoteMessage(user.id, text);
        } catch (error) {
          console.warn("メッセージ送信に失敗しました。ローカル保存を使用します。", error);
          setCloudStatus("LOCAL FALLBACK");
        }
      }
      setState((current) => {
        const social = getSocial(current);
        const localMessage = message || { id: `local-message-${Date.now()}`, senderId: "self", recipientId: user.id, body: text, createdAt: new Date().toISOString(), readAt: null, isMine: true };
        const existing = social.conversations?.[user.id] || [];
        return { ...current, social: { ...social, conversations: { ...social.conversations, [user.id]: [...existing, localMessage] } } };
      });
    } finally {
      setMessageSending(false);
    }
  }
  async function createGuild(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = { name: String(form.get("name") || "").trim(), tag: String(form.get("tag") || "").trim().toUpperCase(), description: String(form.get("description") || ""), icon: String(form.get("icon") || "✦") };
    if (!input.name || !input.tag) return showNotice("GUILD名とTAGを入力してください。");
    try {
      if (!supabase || !getSocial(state).remoteAvailable) {
        showNotice("SOCIALに接続できていません。");
        return;
      }
      const remoteGuild = await createRemoteGuild(input);
      setState((current) => ({ ...current, social: { ...getSocial(current), guild: remoteGuild, notifications: [socialNotification(`GUILD「${input.name}」を作成しました。`), ...(getSocial(current).notifications || [])].slice(0, 30) } }));
      event.currentTarget.reset();
      showNotice("GUILDを作成しました。");
    } catch (error) {
      console.warn("GUILD作成に失敗しました。", error);
      showNotice("作成に失敗しました。ローカル表示を維持します。");
    }
  }
  async function joinGuild(guild) {
    try {
      if (!supabase || !getSocial(state).remoteAvailable || !guild?.remote) {
        showNotice("SOCIALに接続できていません。");
        return;
      }
      await joinRemoteGuild(guild.id);
      setState((current) => ({ ...current, social: { ...getSocial(current), guild: { ...guild, contribution: 0, memberIds: [...new Set([...(guild.memberIds || []), "self"])] }, notifications: [socialNotification(`GUILD「${guild.name}」に参加しました。`), ...(getSocial(current).notifications || [])].slice(0, 30) } }));
      showNotice("GUILDに参加しました。");
    } catch (error) {
      console.warn("GUILD参加に失敗しました。", error);
      showNotice("参加に失敗しました。ローカル表示を維持します。");
    }
  }
  async function searchUsers(query) {
    if (!supabase) {
      setCloudStatus("SOCIAL NOT CONFIGURED");
      return;
    }
    if (!query.trim()) {
      setState((current) => ({ ...current, social: { ...getSocial(current), searchResults: [] } }));
      return;
    }
    try {
      const users = await searchPublicProfiles(query);
      setState((current) => ({ ...current, social: { ...getSocial(current), searchResults: users } }));
    } catch (error) {
      console.warn("ユーザー検索に失敗しました。", error);
      setCloudStatus("SEARCH ERROR");
      setState((current) => ({ ...current, social: { ...getSocial(current), searchResults: [] } }));
    }
  }
  function togglePrivacy(key) { setState((current) => ({ ...current, social: { ...getSocial(current), privacy: { ...getSocial(current).privacy, [key]: !getSocial(current).privacy[key] } } })); }
  function updateSound(key, value) {
    setState((current) => ({ ...current, sound: { ...SOUND_DEFAULTS, ...(current.sound || {}), [key]: value } }));
    if (key === "enabled" && value) playSound("notification", { ...state.sound, enabled: true });
    if (key === "musicEnabled") {
      const music = musicRef.current;
      if (!value) {
        music?.pause();
        if (music) music.currentTime = 0;
      } else if (music) {
        music.play().catch((error) => {
          console.warn("BGMの再生を開始できませんでした。", error);
          showNotice("画面をもう一度タップするとBGMが再生されます。");
        });
      }
    }
  }
  function resetData() { setState(initialState()); setSetup({ name: "", age: "", username: "" }); setAnswers([]); setQuestion(0); setResetStep(0); setResetText(""); setTab("status"); showNotice("データをリセットしました。"); }
  function exportData() {
    const payload = {
      app: "abore-life-rpg",
      schemaVersion: STORAGE_VERSION,
      exportedAt: new Date().toISOString(),
      state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `abore-life-rpg-backup-${todayString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showNotice("バックアップを書き出しました。");
  }
  async function startAccountLink(provider) {
    try {
      await linkAccount(provider);
      showNotice(`${provider === "apple" ? "Apple" : "Google"}アカウント連携を開始しました。`);
    } catch (error) {
      console.error("アカウント連携を開始できませんでした。", error);
      showNotice(`アカウント連携に失敗しました: ${error.message || "Supabase設定を確認してください。"}`);
    }
  }
  function importData(raw) {
    try {
      const payload = JSON.parse(raw);
      const imported = payload?.state || payload;
      if (!imported || typeof imported !== "object" || Array.isArray(imported) || (!imported.profile && !imported.name)) {
        throw new Error("バックアップ形式が正しくありません。");
      }
      setState(migrateState(imported));
      setSetup({ name: "", age: "", username: "" });
      setAnswers([]);
      setQuestion(0);
      setShowResult(false);
      setShowGoal(false);
      setTab("status");
      showNotice("バックアップを復元しました。");
    } catch (error) {
      console.error("バックアップを復元できませんでした。", error);
      showNotice(`復元できませんでした: ${error.message || "JSONを確認してください。"}`);
    }
  }

  const applyUpdate = () => {
    updateRegistration?.worker?.postMessage({ type: "SKIP_WAITING" });
  };
  const widgetMode = new URLSearchParams(window.location.search).get("widget");
  if (widgetMode && state.profile?.name) return <WidgetScreen state={state} mode={widgetMode} />;
  if (!state.profile.name) return <><SetupScreen setup={setup} setSetup={setSetup} onSubmit={startSetup} /><UpdateNotice visible={Boolean(updateRegistration)} onUpdate={applyUpdate} /></>;
  if (!state.initialized) return <><DiagnosisScreen question={question} answers={answers} onAnswer={answer} /><UpdateNotice visible={Boolean(updateRegistration)} onUpdate={applyUpdate} /></>;
  if (showResult) return <><DiagnosisResultScreen state={state} onContinue={() => { setShowResult(false); setShowGoal(true); }} /><UpdateNotice visible={Boolean(updateRegistration)} onUpdate={applyUpdate} /></>;
  if (showGoal) return <><GoalScreen selected={goalSelection} setSelected={setGoalSelection} customGoal={customGoal} setCustomGoal={setCustomGoal} onSubmit={saveGoals} /><UpdateNotice visible={Boolean(updateRegistration)} onUpdate={applyUpdate} /></>;
  if (state.onboarding?.active && !state.onboarding?.seenIntro) {
    return <><OnboardingIntroScreen state={state} onContinue={() => { setState((current) => ({ ...current, onboarding: { ...current.onboarding, seenIntro: true } })); setTab("actions"); }} /><UpdateNotice visible={Boolean(updateRegistration)} onUpdate={applyUpdate} /></>;
  }
  const displayName = state.profile.name;
  return (
    <main className="rpg-app">
      <style>{styles}</style>
      <header className="topbar">
        <div>
          <div className="eyebrow">ABORE LIFE RPG</div>
          <strong>{displayName}<small>@{state.profile.username}</small></strong>
          <small className="cloud-status">{cloudStatus}</small>
        </div>
        <div className="topbar-right">
          <div className="currency-badge">{formatCurrency(state.currency)}</div>
          <div className="level">LV. {expDisplayLevel}<small>{tweenedExp} / {levelExp(expDisplayLevel)} EXP</small></div>
        </div>
      </header>
      <div className="exp-bar"><i style={{ width: `${Math.min(100, (tweenedExp / levelExp(expDisplayLevel)) * 100)}%` }} /></div>
      {notice && <div className="notice">{notice}</div>}
      {activeMotion?.type === "action-complete" && (
        <div className="completion-toast" role="status">
          <b>✓ COMPLETE</b>
          <span>{activeMotion.exp ? `+${activeMotion.exp} EXP` : "+ EXP"}</span>
          {activeMotion.currency > 0 && <span className="completion-toast-currency">+{formatCurrency(activeMotion.currency)}</span>}
        </div>
      )}
      {activeMotion?.type === "level-up" && (
        <div className="level-up-toast" role="status" aria-live="polite" aria-atomic="true">
          <span className="level-up-icon" aria-hidden="true">✦</span>
          <small>LEVEL UP</small>
          <b>LV. {activeMotion.fromLevel ?? Math.max(1, state.level - levelGain)} <span className="level-up-arrow" aria-hidden="true">→</span> LV. {activeMotion.toLevel ?? state.level}</b>
          {levelGain > 1 && <span className="level-up-count">+{levelGain} LEVELS</span>}
          {activeMotion.stats && Object.values(activeMotion.stats).some((value) => value > 0) && (
            <div className="level-up-stats">
              {Object.entries(activeMotion.stats).filter(([, value]) => value > 0).map(([key, value], index) => (
                <span key={key} className="level-up-stat-pill" style={{ animationDelay: `${520 + index * 90}ms` }}>+{Math.round(value)} {STAT_META[key]?.name || key}</span>
              ))}
            </div>
          )}
        </div>
      )}
      {activeMotion?.type === "skill-unlock" && (
        <div className="skill-unlock-toast" role="status" aria-live="polite" aria-atomic="true">
          <small>NEW SKILL UNLOCKED</small>
          <b>{activeMotion.name}</b>
        </div>
      )}
      {activeMotion?.type === "dungeon-unlock" && (
        <div className="dungeon-unlock-toast" role="status" aria-live="polite" aria-atomic="true">
          <small>DUNGEON UNLOCKED</small>
          <b>FLOOR {activeMotion.floor} · {activeMotion.name}</b>
        </div>
      )}
      {activeMotion?.type === "onboarding-complete" && (
        <div className="onboarding-complete-toast" role="status" aria-live="polite" aria-atomic="true">
          <small>初戦闘 VICTORY</small>
          <b>冒険者としての一歩を踏み出した</b>
          <span>明日も成長しよう</span>
        </div>
      )}
      <section className={`content page-transition ${activeMotion?.type === "action-complete" ? "action-complete-pulse" : ""}`} key={tab}>
        {tab === "status" && <StatusScreen state={state} />}
        {tab === "actions" && <ActionsScreen state={state} onAction={recordAction} moreActions={moreActions} setMoreActions={setMoreActions} onCreate={createCustomAction} />}
        {tab === "quests" && <QuestScreen state={state} />}
        {tab === "skills" && <SkillScreen state={state} skills={skills} />}
        {tab === "dungeon" && <DungeonScreen state={state} coopSession={coopSession} onStartFloor={startDungeonFloor} onCommand={chooseBattleCommand} onCoopCommand={coopCommand} onCoopTiming={coopTiming} onCreateCoopRoom={createCoopRoom} onJoinCoopRoom={joinCoopRoom} onLeaveCoopRoom={leaveCoopRoom} onSelectSkills={saveBattleSkills} onTiming={resolveBattleTiming} onContinue={continueAfterBattle} />}
        {tab === "shop" && <ShopScreen state={state} onBuyItem={buyShopItem} onBuyEquipment={buyEquipment} onEquipItem={equipItem} />}
        {tab === "gacha" && <GachaScreen state={state} drawing={gachaDrawing} results={gachaResults} onDraw={drawGacha} onClearResults={() => setGachaResults(null)} />}
        {tab === "inventory" && <InventoryScreen state={state} onEquipItem={equipItem} />}
        {tab === "social" && <SocialScreen state={state} onAddFriend={addFriend} onRespondFriend={respondFriend} onRemoveFriend={removeFriend} onOpenMessages={openMessages} onSendMessage={sendChatMessage} messageLoadingId={messageLoadingId} messageSending={messageSending} onCreateGuild={createGuild} onJoinGuild={joinGuild} onSearchUsers={searchUsers} onChangeGuildIcon={changeGuildIcon} />}
        {tab === "profile" && <ProfileScreen state={state} editing={editing} setup={setup} setSetup={setSetup} onEdit={() => { setSetup(state.profile); setEditing(true); }} onSave={saveProfile} onAvatarChange={changeAvatar} onAvatarRemove={removeAvatar} privacy={getSocial(state).privacy} onPrivacyToggle={togglePrivacy} notifications={getSocial(state).notifications} resetStep={resetStep} setResetStep={setResetStep} resetText={resetText} setResetText={setResetText} onReset={resetData} sound={state.sound} onSoundChange={updateSound} version={APP_VERSION} onExport={exportData} onImport={importData} authStatus={authStatus} onLinkAccount={startAccountLink} gameSyncStatus={openWorldSyncStatus} onCreateGamePairing={createGamePairing} onSyncGameProgress={syncGameProgress} />}
      </section>
      <nav className="nav">
        {[
          ["status", "◆", "STATUS"],
          ["actions", "⚔", "ACTION"],
          ["quests", "✦", "QUEST"],
          ["skills", "◇", "SKILL"],
          ["dungeon", "⚑", "DUNGEON"],
          ["inventory", "⬒", "ITEM"],
          ["shop", "❖", "SHOP"],
          ["gacha", "🎴", "GACHA"],
          ["social", "♧", "SOCIAL"],
          ["profile", "●", "PROFILE"],
        ].map(([id, icon, label]) => (
          <button className={tab === id ? "active" : ""} key={id} onClick={() => {
            if (tab === id) return;
            setTab(id);
            playSound("tab", state.sound);
          }}>
            <span>{icon}</span>{label}
          </button>
        ))}
      </nav>
      <div className="bgm-control" aria-label="BGM設定">
        <button type="button" className={state.sound.musicEnabled ? "on" : ""} aria-pressed={Boolean(state.sound.musicEnabled)} onClick={() => updateSound("musicEnabled", !state.sound.musicEnabled)}>
          ♫ BGM {state.sound.musicEnabled ? "ON" : "OFF"}
        </button>
        <input type="range" min="0" max="0.5" step="0.01" value={state.sound.musicVolume ?? SOUND_DEFAULTS.musicVolume} aria-label="BGM音量" onChange={(event) => updateSound("musicVolume", Number(event.target.value))} />
      </div>
      <UpdateNotice visible={Boolean(updateRegistration)} onUpdate={applyUpdate} />
    </main>
  );
}

function WidgetScreen({ state, mode = "medium" }) {
  const data = widgetData(state);
  const size = ["small", "large"].includes(mode) ? mode : "medium";
  const actionLink = `/?screen=actions`;
  return <main className={`widget-page widget-${size}`}><style>{`${styles}.widget-page{min-height:100vh;min-height:100svh;background:#080808;color:#f1f1ed;padding:24px 16px;font-family:Inter,system-ui,-apple-system,"Yu Gothic",sans-serif}.widget-card{max-width:560px;margin:0 auto;padding:20px;border:1px solid #555;border-radius:22px;background:linear-gradient(145deg,#1b1b1b,#0c0c0c);box-shadow:0 18px 50px #000;display:grid;gap:18px}.widget-brand,.widget-action,.widget-links a{color:inherit;text-decoration:none}.widget-brand{display:flex;justify-content:space-between;gap:12px;align-items:center;font-size:10px;font-weight:700;letter-spacing:.18em}.widget-brand small{color:#777;letter-spacing:.08em}.widget-level{display:flex;align-items:end;justify-content:space-between;border-top:1px solid #333;padding-top:18px}.widget-level span{font:400 42px Georgia,serif}.widget-level b{color:#aaa;font-size:12px;font-weight:500}.widget-exp{display:grid;gap:9px}.widget-exp div{display:flex;justify-content:space-between;align-items:end}.widget-exp small,.widget-action small{color:#999;font-size:9px;letter-spacing:.18em}.widget-exp strong{font-size:12px;font-weight:400;color:#ddd}.widget-exp i{display:block;height:5px;background:#333;border-radius:9px;overflow:hidden}.widget-exp em{display:block;height:100%;background:#eee}.widget-action{display:grid;gap:9px;border:1px solid #666;background:#151515;border-radius:12px;padding:15px}.widget-action strong{font:400 22px Georgia,serif}.widget-action span{color:#aaa;font-size:11px}.widget-footer{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;color:#777;font-size:9px;letter-spacing:.12em}.widget-footer b{display:block;color:#eee;font-size:15px;font-weight:400;letter-spacing:0;margin-top:5px}.widget-links{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;border-top:1px solid #333;padding-top:14px}.widget-links a{border:1px solid #444;padding:10px 5px;text-align:center;color:#bbb;font-size:9px;letter-spacing:.08em}.widget-note{max-width:560px;margin:16px auto;color:#666;text-align:center;font-size:10px;line-height:1.7}.widget-small .widget-card{max-width:330px;padding:16px;border-radius:18px;gap:13px}.widget-small .widget-level span{font-size:32px}.widget-small .widget-action strong{font-size:17px}.widget-small .widget-footer{grid-template-columns:repeat(2,1fr)}.widget-small .widget-footer span:last-child{display:none}.widget-small .widget-note{display:none}`}</style><section className="widget-card"><a className="widget-brand" href="/"><span>ABORE LIFE RPG</span><small>@{data.username}</small></a><div className="widget-level"><span>LV. {data.level}</span><b>{data.job}</b></div><div className="widget-exp"><div><small>EXP</small><strong>{data.exp} / {data.nextLevelExp}</strong></div><i><em style={{ width: `${Math.min(100, (data.exp / data.nextLevelExp) * 100)}%` }} /></i></div><a className="widget-action" href={actionLink}><small>TODAY'S QUEST</small><strong>{data.todayAction?.name || "ACTIONを確認する"}</strong><span>+{data.todayAction?.exp || 0} EXP · ACTION →</span></a><div className="widget-footer"><span>TODAY <b>{data.todayCount} / {data.todayGoal}</b></span><span>STREAK <b>{data.streak}D</b></span>{size !== "small" && <span>GUILD <b>{data.guild}</b></span>}</div>{size === "large" && <div className="widget-links"><a href="/?screen=profile">PROFILE</a><a href="/?screen=social">GUILD / RANK</a><a href={actionLink}>OPEN ACTION</a></div>}</section><p className="widget-note">ホーム画面に追加すると、LIFE RPGのステータスをすぐ確認できます。</p></main>;
}

function SetupScreen({ setup, setSetup, onSubmit }) { return <main className="rpg-app"><style>{styles}</style><section className="welcome setup"><div className="brand-mark">A</div><div className="eyebrow">WELCOME TO AB‍ORE LIFE RPG</div><h1>あなたの人生を、<span>ゲームにしよう。</span></h1><p className="muted">あなた自身をキャラクターとして育てる旅を始めます。</p><form onSubmit={onSubmit} className="setup-form">{[["name", "名前", "あなたの名前"], ["age", "年齢", "年齢"], ["username", "USERNAME", "ユーザーネーム"]].map(([key, label, placeholder]) => <label key={key}>{label}<input value={setup[key]} onChange={(event) => setSetup({ ...setup, [key]: event.target.value })} placeholder={placeholder} type={key === "age" ? "number" : "text"} /></label>)}<button className="primary" type="submit">START <span>→</span></button></form></section></main>; }
function GoalScreen({ selected, setSelected, customGoal, setCustomGoal, onSubmit }) { const toggle = (goal) => setSelected(selected.includes(goal) ? selected.filter((item) => item !== goal) : [...selected, goal]); return <main className="rpg-app"><style>{styles}</style><section className="welcome goal-screen"><div className="eyebrow">DEFINE YOUR DIRECTION</div><h1>今、あなたが一番<br /><span>叶えたいことは？</span></h1><p className="muted">選んだGOALとJOB、診断結果から、あなた専用のACTIONを生成します。</p><form onSubmit={onSubmit}><div className="goal-grid">{GOALS.map((goal) => <button type="button" className={`goal-option ${selected.includes(goal) ? "selected" : ""}`} key={goal} onClick={() => toggle(goal)}>{selected.includes(goal) ? "✓ " : ""}{goal}</button>)}</div><label className="goal-other">その他<input value={customGoal} onChange={(event) => setCustomGoal(event.target.value)} placeholder="自由に入力" /></label><button className="primary" type="submit">ACTIONを生成する <span>→</span></button></form></section></main>; }
function OnboardingIntroScreen({ state, onContinue }) {
  const job = state.job;
  const strengths = STAT_KEYS.filter((key) => (state.stats?.[key] || 0) >= 55).slice(0, 3).map((key) => STAT_META[key].name);
  return <main className="rpg-app"><style>{`${styles}.onboarding-intro{animation:lifeRpgPageIn 420ms cubic-bezier(.22,.61,.36,1) both}.onboarding-intro .result-job-icon{animation:lifeRpgLevelHalo 2.4s cubic-bezier(.22,.61,.36,1) infinite alternate}@media (prefers-reduced-motion: reduce){.onboarding-intro,.onboarding-intro .result-job-icon{animation:none!important}}`}</style><section className="welcome result onboarding-intro"><div className="eyebrow">YOUR ADVENTURE BEGINS</div><p className="result-kicker">{state.profile.name}、あなたの冒険が始まる</p><div className="result-job-icon">{job?.icon}</div><h1>{job?.name}</h1><p className="result-description">{job?.desc}</p><div className="result-stats">{STAT_KEYS.slice(0, 6).map((key) => <span key={key}>{key}<b>{Math.round(state.stats?.[key] || 0)}</b></span>)}</div>{strengths.length > 0 && <div className="result-block"><small>あなたの強み</small><p>{strengths.join(" ・ ")}</p></div>}<div className="result-block"><small>これから起きること</small><p>ACTIONを記録するとEXPが入り、LEVELが上がるとSTATSとSKILLが解放され、DUNGEONへの道が開けます。</p></div><button className="primary" onClick={onContinue}>最初のACTIONへ <span>→</span></button></section></main>;
}
function DiagnosisScreen({ question, onAnswer }) { const current = QUESTIONS[question]; return <main className="rpg-app"><style>{styles}</style><section className="welcome diagnosis"><div className="eyebrow">INITIAL ASSESSMENT · {String(question + 1).padStart(2, "0")} / 30</div><h1>あなたの特性を<br /><span>読み解きます。</span></h1><div className="progress"><i style={{ width: `${((question + 1) / QUESTIONS.length) * 100}%` }} /></div><h2>{current[0]}</h2><div className="option-grid">{current[1].map(([option], index) => <button className="option" key={option} onClick={() => onAnswer(index)}><b>{String.fromCharCode(65 + index)}</b>{option}</button>)}</div></section></main>; }
function DiagnosisResultScreen({ state, onContinue }) { const job = state.job; const strengths = STAT_KEYS.filter((key) => state.stats[key] >= 55).slice(0, 4).map((key) => STAT_META[key].name); return <main className="rpg-app"><style>{styles}</style><section className="welcome result"><div className="eyebrow">INITIAL ASSESSMENT COMPLETE</div><p className="result-kicker">あなたのJOB</p><div className="result-job-icon">{job.icon}</div><h1>{job.name}</h1><p className="result-description">{job.desc}</p><div className="result-block"><small>あなたの強み</small><p>{strengths.length ? strengths.join(" ・ ") : "柔軟な成長性"}</p></div><div className="result-block"><small>あなたの特徴</small><p>{job.tags.join(" ・ ")}</p></div><div className="result-block"><small>向いている行動</small><p>{job.action}</p></div><div className="result-stats">{STAT_KEYS.slice(0, 6).map((key) => <span key={key}>{key}<b>{Math.round(state.stats[key] || 0)}</b></span>)}</div><button className="primary" onClick={onContinue}>ホームへ進む <span>→</span></button></section></main>; }
function Avatar3D({ state }) {
  const job = state.job;
  const avatarUrl = state.profile?.avatarUrl;
  return <section className="avatar-3d-panel" aria-label="3Dアバター">
    <style>{`
      .avatar-3d-panel{position:relative;display:grid;grid-template-columns:150px 1fr;gap:18px;align-items:center;min-height:190px;margin:18px 0 20px;padding:18px;border:1px solid #5b4a70;border-radius:8px;background:radial-gradient(circle at 28% 42%,#3b2853 0,#171320 46%,#0d0d12 100%);overflow:hidden;isolation:isolate}
      .avatar-3d-panel:after{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(115deg,transparent 20%,#e8c76a12 50%,transparent 80%);transform:translateX(-100%);animation:avatar3dSheen 7s ease-in-out infinite}
      .avatar-3d-scene{position:relative;width:128px;height:150px;perspective:520px;display:grid;place-items:center}
      .avatar-3d-floor{position:absolute;bottom:3px;width:108px;height:27px;border:1px solid #ad8d4d66;border-radius:50%;background:radial-gradient(ellipse,#e8c76a2b 0,transparent 68%);transform:rotateX(66deg);box-shadow:0 0 24px #b98fe033}
      .avatar-3d-figure{position:relative;width:82px;height:128px;transform-style:preserve-3d;animation:avatar3dFloat 4.8s ease-in-out infinite}
      .avatar-3d-figure:before{content:"";position:absolute;left:22px;top:15px;width:40px;height:40px;border:2px solid #e8c76a;border-radius:45% 45% 42% 42%;background:radial-gradient(circle at 35% 28%,#efe1ae,#9c7940 42%,#2a1d32 72%);box-shadow:inset -8px -5px 0 #181322,0 0 14px #e8c76a3b;transform:translateZ(15px)}
      .avatar-3d-figure:after{content:"";position:absolute;left:12px;top:54px;width:60px;height:66px;border:2px solid #a989d6;border-radius:45% 45% 18% 18%;background:linear-gradient(145deg,#a989d6 0,#38264d 48%,#15131e 100%);box-shadow:inset 9px 0 #ffffff0b,inset -10px -10px #0005;transform:translateZ(8px)}
      .avatar-3d-face{position:absolute;z-index:2;left:34px;top:31px;width:6px;height:6px;border-radius:50%;background:#211728;box-shadow:14px 0 #211728;transform:translateZ(28px)}
      .avatar-3d-face:after{content:"";position:absolute;left:4px;top:13px;width:9px;height:3px;border-bottom:1px solid #211728;border-radius:50%;transform:rotate(-4deg)}
      .avatar-3d-limb{position:absolute;z-index:1;top:65px;width:13px;height:50px;border:1px solid #9b7bc3;border-radius:9px;background:#30203f;transform-origin:top center}
      .avatar-3d-limb.left{left:8px;transform:rotate(14deg) translateZ(3px)}
      .avatar-3d-limb.right{right:8px;transform:rotate(-14deg) translateZ(3px)}
      .avatar-3d-copy{min-width:0}.avatar-3d-copy small{display:block;color:#d5bd80;font-size:9px;letter-spacing:.18em}.avatar-3d-copy h2{margin:8px 0 5px;color:#f0d783;font:24px Georgia,serif}.avatar-3d-copy p{margin:0;color:#aaa;font-size:11px;line-height:1.7}.avatar-3d-tag{display:inline-block;margin-top:12px;padding:4px 8px;border:1px solid #806a35;color:#e8c76a;font-size:9px;letter-spacing:.1em}
      @keyframes avatar3dFloat{0%,100%{transform:rotateY(-8deg) translateY(2px)}50%{transform:rotateY(8deg) translateY(-5px)}}
      @keyframes avatar3dSheen{0%,55%,100%{transform:translateX(-100%)}75%{transform:translateX(100%)}}
      @media(max-width:480px){.avatar-3d-panel{grid-template-columns:122px 1fr;gap:10px;padding:14px}.avatar-3d-scene{transform:scale(.86);transform-origin:left center;margin-right:-16px}.avatar-3d-copy h2{font-size:20px}}
      @media(prefers-reduced-motion:reduce){.avatar-3d-figure,.avatar-3d-panel:after{animation:none!important}.avatar-3d-figure{transform:none}}
    `}</style>
    <div className="avatar-3d-scene" aria-hidden="true">
      <div className="avatar-3d-floor" />
      <div className="avatar-3d-figure">
        <span className="avatar-3d-face" />
        <span className="avatar-3d-limb left" />
        <span className="avatar-3d-limb right" />
        {avatarUrl && <img src={avatarUrl} alt="" style={{ position: "absolute", zIndex: 3, left: 25, top: 18, width: 34, height: 34, borderRadius: "50%", objectFit: "cover", opacity: .82, transform: "translateZ(32px)" }} />}
      </div>
    </div>
    <div className="avatar-3d-copy">
      <small>3D ADVENTURER MODEL</small>
      <h2>{state.profile?.name || "冒険者"}</h2>
      <p>{job ? `${job.icon} ${job.name} · LEVEL ${state.level}` : `LEVEL ${state.level} · 冒険者`}</p>
      <span className="avatar-3d-tag">LIFE RPG AVATAR</span>
    </div>
  </section>;
}
function StatusScreen({ state }) {
  const job = state.job;
  const jobNeed = state.jobLevel * 150;
  const combat = playerCombatStats(state);
  const equipment = state.equipment || {};
  const skillCount = STAT_KEYS.reduce((total, stat) => total + SKILL_THRESHOLDS.filter((threshold) => (state.stats?.[stat] || 0) >= threshold).length, 0);
  const rank = adventurerRankFor(state, skillCount);
  return <div><div className="section-heading"><div><div className="eyebrow">PLAYER STATUS</div><h1>ステータス</h1></div><div className="streak">連続記録 <b>{state.streak}日</b></div></div><Avatar3D state={state} /><article className="adventurer-rank"><div className="rank-emblem">✦</div><div className="rank-copy"><small>ADVENTURER RANK · {rank.name.toUpperCase()}</small><b>{rank.title}</b><span>名声 {rank.renown.toLocaleString()}</span>{rank.next && <><i><em style={{ width: `${rank.progress}%` }} /></i><small>次のランク「{rank.next.name}」まであと {Math.max(0, rank.next.threshold - rank.renown)} 名声</small></>}</div></article>{job && <article className="job-banner"><span>{job.icon}</span><div><small>YOUR JOB · LEVEL {state.jobLevel}</small><strong>{job.name}</strong><p>{job.desc}</p><div className="job-exp"><i style={{ width: `${Math.min(100, (state.jobExp / jobNeed) * 100)}%` }} /></div><small>{state.jobExp} / {jobNeed} JOB EXP</small></div></article>}<div className="equip-summary"><div className="equip-summary-combat"><span>ATK {combat.atk}</span><span>DEF {combat.def}</span><span>HP {combat.maxHp}</span><span>技 {combat.skillPower}</span></div><div className="equip-summary-slots">{EQUIP_SLOTS.map((slot) => { const item = equipment[slot.id] && EQUIPMENT_ITEMS.find((entry) => entry.id === equipment[slot.id]); return <div className="equip-summary-slot" key={slot.id}><small className="muted">{slot.label}</small><b style={{ color: item ? RARITY_META[item.rarity].color : undefined }}>{item ? `${item.icon} ${item.name}` : "未装備"}</b></div>; })}</div></div><div className="stat-grid">{STAT_KEYS.map((key) => <article className="stat-card" key={key}><div className="stat-title"><span style={{ color: STAT_META[key].color }}>{key}</span><b>{STAT_META[key].name}</b><strong>{Math.round(state.stats[key] || 0)}</strong></div><div className="stat-bar"><i style={{ background: STAT_META[key].color, width: `${state.stats[key]}%` }} /></div><small>{state.stats[key] >= 60 ? "成長を実感できる領域" : "行動でさらに伸ばせます"}</small></article>)}</div></div>;
}
function ActionsScreen({ state, onAction, moreActions, setMoreActions, onCreate }) {
  const [activeActionId, setActiveActionId] = useState(null);
  const [completion, setCompletion] = useState({ value: "", time: "" });
  const actions = personalizedActions(state);
  const coachSuggestions = actionCoach(state);
  const isFirstAction = state.onboarding?.active && !state.totalActions;
  const visible = moreActions ? actions : actions.slice(0, 4);
  const todayDate = todayString();
  const dailyCount = state.dailyActionDate === todayDate ? state.dailyActionCount || 0 : 0;
  const dailyQuests = dailyQuestView(state.dailyQuestProgress, todayDate);
  const completedToday = dailyQuests.filter((quest) => quest.completed).length;
  const today = visible[0];
  const tooHard = (action) => window.dispatchEvent(new CustomEvent("life-rpg-action-too-hard", { detail: action }));
  const actionMeta = (action) => `${action.category} · ${action.difficulty} · TARGET ${action.target}${action.unit} · ${action.estimatedTime}min · ${formatEffects(action.effects)} · +${action.exp} EXP`;
  const openCompletion = (action) => {
    setActiveActionId(activeActionId === action.id ? null : action.id);
    setCompletion({ value: String(action.target || ""), time: String(action.estimatedTime || "") });
  };
  const submitCompletion = (event, action) => {
    event.preventDefault();
    const value = Number(completion.value);
    const time = Number(completion.time);
    if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(time) || time <= 0) return;
    onAction(action, { actualValue: value, actualTime: time });
    setActiveActionId(null);
  };
  const actionButtons = (action) => <span className="action-card-buttons"><button className="tiny-button" type="button" onClick={() => openCompletion(action)}>COMPLETE</button><button className="tiny-button ghost" type="button" onClick={() => tooHard(action)}>TOO HARD</button>{activeActionId === action.id && <form className="completion-form" onSubmit={(event) => submitCompletion(event, action)}><label>実績<input type="number" min="0.1" step="any" value={completion.value} onChange={(event) => setCompletion({ ...completion, value: event.target.value })} /></label><label>分<input type="number" min="1" step="1" value={completion.time} onChange={(event) => setCompletion({ ...completion, time: event.target.value })} /></label><button className="tiny-button" type="submit">SAVE</button></form>}</span>;
  return <div><style>{`.action-card-buttons{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;margin-left:auto}.completion-form{display:flex;align-items:end;flex-wrap:wrap;gap:6px;width:100%;margin-top:7px}.completion-form label{display:grid;gap:3px;color:#888;font-size:9px;letter-spacing:.08em}.completion-form input{width:68px;border:1px solid #444;background:#101010;padding:6px;color:#eee;font-size:11px}.coach-panel{border:1px solid #454545;background:#141414;padding:14px;margin:20px 0}.coach-panel small{display:block;color:#aaa;letter-spacing:.14em;font-size:9px}.coach-panel p{color:#bbb;font-size:11px;line-height:1.7;margin:8px 0 0}.action-daily-progress{border:1px solid #353a36;background:linear-gradient(120deg,#19201dcc,#111411dd);padding:14px;margin:18px 0}.action-daily-progress>div{display:flex;justify-content:space-between;align-items:center;color:#aaa;font-size:10px;letter-spacing:.1em}.action-daily-progress b{color:#eee;font-size:12px;letter-spacing:0}.action-daily-progress i{display:block;height:4px;background:#303630;margin:10px 0 7px}.action-daily-progress em{display:block;height:100%;background:#b8c9b0}.action-daily-progress p{margin:0;color:#888;font-size:10px;line-height:1.6}.today-quest.onboarding-spotlight{border-color:#806a35;box-shadow:0 0 0 1px #806a3555,0 0 26px #c2a04b1c;position:relative}.onboarding-tag{display:inline-block;color:#f0d783;letter-spacing:.18em;font-size:9px;margin-bottom:6px}`}</style><div className="eyebrow">PERSONALIZED QUEST BOARD</div><h1>ACTION</h1><p className="muted">あなたのGOAL、JOB、STATS、達成履歴に合わせた成長クエスト。</p><aside className="action-daily-progress"><div><span>今日の冒険 · QUEST {completedToday}/{DAILY_QUESTS.length}</span><b>{Math.min(dailyCount, 3)} / 3 ACTION</b></div><i><em style={{ width: `${Math.min(100, dailyCount / 3 * 100)}%` }} /></i><p>小さな行動も記録して、今日のQUESTと自分の成長を進めよう。</p></aside>{coachSuggestions.length > 0 && <aside className="coach-panel"><small>LOCAL PERSONAL COACH</small>{coachSuggestions.map((suggestion) => <p key={suggestion}>• {suggestion}</p>)}</aside>}{state.profile.goals?.length > 0 && <div className="goal-tags">{state.profile.goals.map((goal) => <span key={goal}>{goal}</span>)}</div>}{today && <article className={`today-quest ${isFirstAction ? "onboarding-spotlight" : ""}`}>{isFirstAction && <small className="onboarding-tag">最初のACTION</small>}<small>TODAY'S QUEST · {today.category}</small><h2>{today.name}</h2><span>{actionMeta(today)}</span><div className="today-action-buttons">{actionButtons(today)}</div></article>}<div className="action-heading"><span>DAILY ACTIONS <b>3–5</b></span><button onClick={() => setMoreActions(!moreActions)}>{moreActions ? "LESS ACTION" : "MORE ACTION"}</button></div><div className="action-list">{visible.slice(today ? 1 : 0).map((action) => <article className="action-card" key={action.id}><span className="action-icon">{action.category.slice(0, 1)}</span><span><b>{action.name}</b><small>{actionMeta(action)}</small></span>{actionButtons(action)}</article>)}</div><form className="create-action" onSubmit={onCreate}><div className="eyebrow">CREATE YOUR ACTION</div><input name="title" placeholder="新しいACTIONのタイトル" required /><div className="create-row"><select name="category" defaultValue="CHALLENGE">{ACTION_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select><select name="difficulty" defaultValue="NORMAL"><option>EASY</option><option>NORMAL</option><option>HARD</option></select><button type="submit">CREATE</button></div></form></div>;
}
function QuestScreen({ state }) {
  const quests = dailyQuestView(state.dailyQuestProgress, todayString());
  const completedCount = quests.filter((quest) => quest.completed).length;
  const legacyCompleted = state.completedQuests || {};
  return <div><div className="eyebrow">DAILY QUESTS</div><h1>クエスト</h1><p className="muted">毎日の小さな行動で進むクエスト。日付が変わると新しい目標に切り替わります。</p><article className="quest-summary"><span>今日の達成</span><b>{completedCount} / {quests.length}</b><i><em style={{ width: `${completedCount / quests.length * 100}%` }} /></i><small>達成報酬はACTION記録時に自動で獲得します。</small></article><div className="quest-list">{quests.map((quest) => <article className={`quest ${quest.completed ? "done" : ""}`} key={quest.id}><span>{quest.completed ? "✓" : "○"}</span><div><b>{quest.name}</b><small>{quest.description} · {quest.progress}/{quest.target} ・ 報酬 +{quest.rewardExp} EXP{quest.rewardGold ? ` / +${quest.rewardGold} AURUM` : ""}{quest.completed ? " ・ 達成済み" : ""}</small></div></article>)}</div><div className="quest-legacy"><div className="eyebrow">MILESTONE RECORDS</div><p className="muted">一度きりのチャレンジ記録。これまでの達成状況は引き継がれます。</p><div className="quest-list">{QUESTS.map((quest) => { const completed = Boolean(legacyCompleted[quest.id]); return <article className={`quest ${completed ? "done" : ""}`} key={quest.id}><span>{completed ? "✦" : "◇"}</span><div><b>{quest.name}</b><small>{completed ? "達成済み ・ +100 EXP / +40 AURUM獲得済み" : "対象ACTIONの記録で達成 ・ +100 EXP / +40 AURUM"}</small></div></article>; })}</div></div></div>;
}
function SkillScreen({ state, skills }) {
  const [showAll, setShowAll] = useState(false);
  const unlockedCount = skills.filter((skill) => (state.stats?.[skill.stat] || 0) >= skill.threshold).length;
  return <div><div className="eyebrow">SKILL MASTERY</div><h1>スキル</h1><p className="muted">ACTIONでステータスを育てると称号スキルを解放。新しい称号ごとに +15 EXP。</p><article className="skill-summary"><div><span>解放済みスキル</span><b>{unlockedCount} / {skills.length}</b></div><i><em style={{ width: `${unlockedCount / skills.length * 100}%` }} /></i><small>ステータスの成長が、次の称号とEXPボーナスにつながります。</small></article><div className="skill-grid">{STAT_KEYS.map((stat) => { const value = Math.max(0, Math.min(100, state.stats?.[stat] || 0)); const statSkills = skills.filter((skill) => skill.stat === stat); const nextSkill = statSkills.find((skill) => skill.threshold > value); const groupSkills = statSkills.filter((skill) => value >= skill.threshold || showAll); const nextThreshold = nextSkill?.threshold || 100; const progressStart = nextSkill ? nextThreshold - 20 : 100; const progress = nextSkill ? Math.max(0, Math.min(100, (value - progressStart) / (nextThreshold - progressStart) * 100)) : 100; return <section className="skill-track" key={stat}><div className="skill-track-head"><b style={{ color: STAT_META[stat].color }}>{stat}</b><span>{STAT_META[stat].name} <strong>{value}</strong></span></div><div className="skill-track-bar"><i><em style={{ width: `${nextSkill ? progress : 100}%` }} /></i>{nextSkill && <small>次のスキルまで {Math.max(0, nextThreshold - value)}</small>}</div><div className="skill-track-badges">{groupSkills.length ? groupSkills.map((skill) => { const isUnlocked = value >= skill.threshold; return <article className={`skill ${isUnlocked ? "unlocked" : "locked"}`} key={skill.id}><span style={{ color: STAT_META[stat].color }}>{isUnlocked ? "✦" : "◇"}</span><div><b>{skill.name}</b><small>{isUnlocked ? "解放済み" : `${stat} ${skill.threshold}で解放`}</small></div></article>; }) : <small className="skill-first-unlock">最初のスキルまであと {Math.max(0, 20 - value)} ポイント</small>}</div></section>; })}</div><button className="secondary skill-more" onClick={() => setShowAll(!showAll)}>{showAll ? "未解放スキルを隠す" : "未解放スキルも見る"}</button></div>;
}
function DungeonScreen({ state, coopSession, onStartFloor, onCommand, onCoopCommand, onCoopTiming, onCreateCoopRoom, onJoinCoopRoom, onLeaveCoopRoom, onSelectSkills, onTiming, onContinue }) {
  const today = todayString();
  const dungeon = normalizeDungeonDaily(state.dungeon, today);
  const availableSkills = availableBattleSkills(state.stats);
  const [skillLoadout, setSkillLoadout] = useState(() => (dungeon.battleSkills || defaultBattleSkillLoadout(state.stats)).slice(0, 3));
  if (coopSession?.battle) return <CoopBattle battle={coopSession.battle} session={coopSession} state={state} onCommand={onCoopCommand} onTiming={onCoopTiming} onLeave={onLeaveCoopRoom} />;
  if (coopSession) return <CoopLobby session={coopSession} onLeave={onLeaveCoopRoom} />;
  if (dungeon.battle) return <DungeonBattle battle={dungeon.battle} state={state} onCommand={onCommand} onTiming={onTiming} onContinue={onContinue} />;
  function toggleSkill(id) {
    if (skillLoadout.length === 1 && skillLoadout.includes(id)) return;
    const updated = skillLoadout.includes(id) ? skillLoadout.filter((skillId) => skillId !== id) : skillLoadout.length < 3 ? [...skillLoadout, id] : skillLoadout;
    setSkillLoadout(updated);
    onSelectSkills(updated);
  }
  return <div className="dungeon-screen"><div className="section-heading"><div><div className="eyebrow">SOLO DUNGEON</div><h1>ダンジョン</h1></div></div><p className="muted">はじまりの森 · {formatCurrency(state.currency)} · 最深到達 FLOOR {dungeon.bestFloor || 0}</p>
    <section className="battle-loadout"><div><b>戦闘スキル</b><small>現実で育てたステータスで解放 · 3つまで装備</small></div><div className="battle-loadout-list">{availableSkills.map((skill) => <button type="button" className={skillLoadout.includes(skill.id) ? "selected" : ""} key={skill.id} disabled={!skillLoadout.includes(skill.id) && skillLoadout.length >= 3} onClick={() => toggleSkill(skill.id)} aria-pressed={skillLoadout.includes(skill.id)}><b>{skill.name}</b><small>{skill.desc}</small></button>)}</div><small>{skillLoadout.length}/3 装備中　{availableSkills.length < BATTLE_SKILLS.length ? `· 次の技は対応ステータスを ${Math.min(...BATTLE_SKILLS.filter((skill) => !availableSkills.includes(skill)).map((skill) => skill.unlock))} まで育てると解放` : "· 全スキル解放済み"}</small></section>
    <section className="coop-panel"><div><div className="eyebrow">PARTY MODE</div><b>フレンドと協力する</b><small>同じ敵を見ながら、二人それぞれのHPで交互に行動します。</small></div><div className="coop-actions"><button className="secondary" onClick={() => onCreateCoopRoom(Math.max(1, dungeon.currentFloor || 1), skillLoadout)}>ルームを作る</button><form onSubmit={(event) => { event.preventDefault(); onJoinCoopRoom(event.currentTarget.elements.code.value); }}><input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength="6" placeholder="6桁のルームコード" aria-label="6桁のルームコード" /><button className="secondary" type="submit">参加</button></form></div></section>
    <div className="dungeon-floor-list">{DUNGEON_FLOORS.map((floor) => { const locked = state.level < floor.floor; const cleared = (dungeon.bestFloor || 0) >= floor.floor; const isNext = (dungeon.currentFloor || 1) === floor.floor; const tier = dungeonTier(floor.floor); const recommendedLevel = floor.floor + (floor.boss ? 3 : 2); return <article className={`dungeon-floor tier-${tier} ${floor.boss ? "boss" : ""} ${locked ? "locked" : ""} ${cleared ? "cleared" : ""}`} key={floor.floor}><span className="dungeon-floor-icon">{floor.image ? <img src={floor.image} alt={floor.name} /> : floor.icon}{locked && <span className="dungeon-floor-lock">🔒</span>}{cleared && !locked && <span className="dungeon-floor-badge">済</span>}</span><div className="dungeon-floor-info"><b>FLOOR {floor.floor}{floor.boss ? " · BOSS" : ""}</b><small>{floor.name}</small><small className="muted">推奨目安 LV.{recommendedLevel} · HP {floor.hp} · ATK {floor.atk}</small></div><button className={isNext && !cleared ? "primary" : "secondary"} disabled={locked} onClick={() => onStartFloor(floor.floor, skillLoadout)}>{locked ? `LV.${floor.floor}で解放` : cleared ? "再挑戦" : "挑戦する"}</button></article>; })}</div></div>;
}
function CoopLobby({ session, onLeave }) {
  const waiting = session.role === "host" && (session.members?.length || 0) < 2;
  return <div className="coop-lobby"><div className="eyebrow">PARTY LOBBY</div><h1>協力ルーム</h1><p className="muted">{waiting ? "フレンドが参加するまで戦闘は始まりません。" : "参加を確認しています…"}</p><div className="coop-room-code"><small>ROOM CODE</small><b>{session.code}</b><span>この6桁の数字をフレンドに共有してください</span></div><div className="coop-lobby-status"><span className={session.members?.length > 1 ? "ready" : ""}>●</span>{session.members?.length > 1 ? "フレンドが参加しました。戦闘を準備中…" : "参加待ち…"}</div><button className="secondary" onClick={onLeave}>ルームを退出</button></div>;
}
function CoopBattle({ battle, session, state, onCommand, onTiming, onLeave }) {
  const myHp = battle.coopPlayers?.[session.userId]?.hp ?? battle.playerHp;
  const myMaxHp = battle.coopPlayers?.[session.userId]?.maxHp ?? battle.playerMaxHp;
  const displayBattle = { ...battle, playerHp: myHp, playerMaxHp: myMaxHp };
  const canAct = !battle.turnActorId || battle.turnActorId === session.userId;
  const turnName = battle.coopPlayers?.[battle.turnActorId]?.name || (battle.turnActorId === session.userId ? "あなた" : "フレンド");
  const guardedCommand = (type, itemId, skillId) => { if (canAct) onCommand(type, itemId, skillId); };
  const guardedTiming = (position) => { if (canAct) onTiming(position); };
  return <div className="coop-battle-shell"><div className="coop-party-banner"><div><div className="eyebrow">CO-OP BATTLE · {session.code}</div><b>{session.role === "host" ? "あなたがホスト" : "フレンドのルームに参加中"}</b><small>参加者 {session.members?.length || 1}人 · 二人のHPは個別です</small></div><div className={`coop-turn-indicator ${canAct ? "your-turn" : ""}`} aria-live="polite">{canAct ? "あなたのターン" : `${turnName}のターン`}</div><button className="secondary" onClick={onLeave}>退出</button></div><div className="coop-party-hp">{Object.values(battle.coopPlayers || {}).map((player) => <div className={`coop-party-card ${player.id === session.userId ? "current" : ""} ${player.id === battle.turnActorId ? "active-turn" : ""}`} key={player.id}><div className="coop-party-character">{player.avatarUrl ? <img src={player.avatarUrl} alt="" /> : <span>{player.icon || "A"}</span>}</div><div className="coop-party-copy"><b>{player.id === session.userId ? "あなた" : player.name || "フレンド"}</b><small>{player.id === session.userId ? player.name : "PARTNER"}</small><span><i style={{ width: `${Math.max(0, player.hp / player.maxHp * 100)}%` }} /></span><small>HP {player.hp}/{player.maxHp}</small></div></div>)}</div>{displayBattle.lastHit && <div className={`coop-judgement ${displayBattle.lastHit.tier}`} key={displayBattle.lastHit.id}><b>{displayBattle.lastHit.label}!</b><small>{displayBattle.lastHit.tier === "perfect" ? "PERFECT!" : displayBattle.lastHit.tier === "good" ? "GOOD HIT" : "MISS"}</small></div>}<DungeonBattle battle={displayBattle} state={state} onCommand={guardedCommand} onTiming={guardedTiming} onContinue={onLeave} allowEscape={false} /></div>;
}
function InventoryScreen({ state, onEquipItem, onUseItem }) {
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState("inventory");
  const [catalogFilter, setCatalogFilter] = useState("all");
  const equipment = state.equipment || {};
  const owned = state.ownedEquipment || [];
  const job = state.job;
  const combat = playerCombatStats(state);
  const consumableSlots = SHOP_ITEMS.map((item) => ({ kind: "consumable", item, count: state.inventory?.[item.invKey] || 0 })).filter((slot) => slot.count > 0);
  const equipmentSlots = owned.map((id) => EQUIPMENT_ITEMS.find((entry) => entry.id === id)).filter(Boolean).map((item) => ({ kind: "equipment", item, count: 1 }));
  const slots = [...equipmentSlots, ...consumableSlots];
  const catalog = [
    ...SHOP_ITEMS.map((item) => ({ ...item, kind: "consumable" })),
    ...EQUIPMENT_ITEMS.map((item) => ({ ...item, kind: "equipment" })),
  ];
  const discovered = new Set([
    ...(state.discoveredItems || []),
    ...owned,
    ...SHOP_ITEMS.filter((item) => (state.inventory?.[item.invKey] || 0) > 0).map((item) => item.id),
  ]);
  const catalogItems = catalog.filter((item) => catalogFilter === "all" || item.kind === catalogFilter);
  const collectionCount = catalog.filter((item) => discovered.has(item.id)).length;
  const mainSlots = slots.slice(0, 27);
  while (mainSlots.length < 27) mainSlots.push(null);
  const hotbarSlots = slots.slice(27, 36);
  while (hotbarSlots.length < 9) hotbarSlots.push(null);
  function renderSlot(slot, index, keyPrefix) {
    if (!slot) return <div className="mc-slot empty" key={`${keyPrefix}-${index}`} />;
    const isEquipped = slot.kind === "equipment" && equipment[slot.item.slot] === slot.item.id;
    const isSelected = selected && selected.item.id === slot.item.id;
    return <button className={`mc-slot filled ${isEquipped ? "equipped" : ""} ${isSelected ? "selected" : ""}`} key={slot.item.id} style={slot.kind === "equipment" ? { borderColor: RARITY_META[slot.item.rarity].color } : undefined} onClick={() => setSelected(isSelected ? null : slot)}>
      <span>{slot.item.icon}</span>
      {slot.count > 1 && <em className="mc-slot-count">{slot.count}</em>}
    </button>;
  }
  if (view === "codex") return <div className="inventory-screen"><style>{`.item-codex-summary{display:grid;gap:9px;border:1px solid #6e5b32;background:linear-gradient(135deg,#211c12,#111);padding:16px;margin:18px 0}.item-codex-summary>div{display:flex;justify-content:space-between;align-items:center}.item-codex-summary b{color:#f0d783;font:24px Georgia,serif}.item-codex-summary small{color:#aaa;line-height:1.6}.codex-progress{height:4px;background:#302b20}.codex-progress i{display:block;height:100%;background:#d6bb69}.codex-tabs{display:flex;gap:6px;margin:16px 0;overflow-x:auto}.codex-tabs button{flex:1;min-width:max-content;border:1px solid #444;background:#121212;color:#999;padding:10px;font-size:10px}.codex-tabs button.active{border-color:#d6bb69;color:#f0d783}.codex-grid{display:grid;gap:8px}.codex-item{display:grid;grid-template-columns:42px 1fr;gap:10px;border:1px solid #383838;background:linear-gradient(120deg,#171717,#101010);padding:12px}.codex-item.legendary{border-color:#8c7137;background:linear-gradient(120deg,#27200f,#12110d)}.codex-item-icon{display:grid;place-items:center;width:40px;height:40px;border:1px solid #444;background:#0c0c0c;font-size:22px}.codex-item.unknown .codex-item-icon{color:#777}.codex-item-copy{min-width:0}.codex-item-copy>div{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.codex-item-copy b{font-size:12px;font-weight:500}.codex-item-copy p{margin:5px 0;color:#999;font-size:10px;line-height:1.6}.codex-item-copy small{color:#aaa;font-size:9px;line-height:1.5}.codex-item-state{margin-left:auto;color:#b9c9b2!important;letter-spacing:.08em}.codex-item.unknown .codex-item-state{color:#777!important}.inventory-view-toggle{display:flex;gap:6px;margin:0 0 18px}.inventory-view-toggle button{flex:1;border:1px solid #444;background:#111;color:#999;padding:10px;font-size:10px}.inventory-view-toggle button.active{color:#eee;border-color:#aaa}`}</style><div className="section-heading"><div><div className="eyebrow">ADVENTURER'S ARCHIVE</div><h1>図鑑</h1></div><button className="secondary" onClick={() => setView("inventory")}>持ち物へ戻る</button></div><p className="muted">出会った道具と、まだ見ぬ装備を記録する冒険者の手帳。</p><article className="item-codex-summary"><div><span>COLLECTION</span><b>{collectionCount} / {catalog.length}</b></div><div className="codex-progress"><i style={{ width: `${collectionCount / catalog.length * 100}%` }} /></div><small>{collectionCount === catalog.length ? "全ての品を発見した。あなたは伝説の収集家だ。" : `あと ${catalog.length - collectionCount} 種を発見すると「伝説の収集家」の称号に到達。`}</small></article><div className="codex-tabs">{[["all", "すべて"], ["consumable", "消耗品"], ["equipment", "装備"]].map(([id, label]) => <button type="button" className={catalogFilter === id ? "active" : ""} key={id} onClick={() => setCatalogFilter(id)}>{label}</button>)}</div><div className="codex-grid">{catalogItems.map((item) => { const known = discovered.has(item.id); const rarity = item.rarity || "common"; const stock = item.invKey ? state.inventory?.[item.invKey] || 0 : owned.includes(item.id) ? 1 : 0; const stats = item.kind === "equipment" ? [item.atk && `ATK +${item.atk}`, item.def && `DEF +${item.def}`, item.maxHp && `HP +${item.maxHp}`, item.skillPower && `技 +${item.skillPower}`].filter(Boolean).join(" / ") : item.heal ? `HP ${Math.round(item.heal * 100)}% 回復` : `次の攻撃力 ×${item.buff}`; return <article className={`codex-item ${rarity} ${known ? "" : "unknown"}`} key={item.id}><span className="codex-item-icon">{known ? item.icon : "？"}</span><div className="codex-item-copy"><div><b style={{ color: RARITY_META[rarity].color }}>{known ? item.name : "未発見のアイテム"}</b><small className="rarity-badge" style={{ color: RARITY_META[rarity].color, borderColor: RARITY_META[rarity].color }}>{RARITY_META[rarity].label}</small><small className="codex-item-state">{known ? item.invKey ? `所持 ${stock}` : owned.includes(item.id) ? "発見済み" : "発見済み" : "未発見"}</small></div><p>{known ? item.desc : "ショップ、ダンジョン、冒険の中で発見しよう。"}</p><small>{known ? `${stats} · ${formatCurrency(item.cost)}` : item.kind === "equipment" ? `${EQUIP_SLOTS.find((slot) => slot.id === item.slot)?.label || "装備"} · ???` : "消耗品 · ???"}</small></div></article>; })}</div></div>;
  return <div className="inventory-screen">
    <div className="section-heading"><div><div className="eyebrow">INVENTORY</div><h1>持ち物</h1></div><small className="muted">所持 {formatCurrency(state.currency)}</small></div><div className="inventory-view-toggle"><button className="active" type="button">持ち物</button><button type="button" onClick={() => setView("codex")}>アイテム図鑑 · {collectionCount}/{catalog.length}</button></div>
    <div className="mc-panel">
      <div className="mc-equip-col">
        {EQUIP_SLOTS.map((slot) => {
          const item = equipment[slot.id] && EQUIPMENT_ITEMS.find((entry) => entry.id === equipment[slot.id]);
          return <button className={`mc-slot ${item ? "filled" : ""}`} key={slot.id} style={item ? { borderColor: RARITY_META[item.rarity].color } : undefined} onClick={() => item && onEquipItem(item.id)} title={slot.label}>
            {item ? item.icon : <small className="mc-slot-label">{slot.label}</small>}
          </button>;
        })}
      </div>
      <div className="mc-view-box"><span className="mc-view-silhouette">{job?.icon || "◈"}</span></div>
      <div className="mc-craft-box">
        <div className="mc-craft-grid">
          <div className="mc-craft-cell"><small>ATK</small><b>{combat.atk}</b></div>
          <div className="mc-craft-cell"><small>DEF</small><b>{combat.def}</b></div>
          <div className="mc-craft-cell"><small>HP</small><b>{combat.maxHp}</b></div>
          <div className="mc-craft-cell"><small>技</small><b>{combat.skillPower}</b></div>
        </div>
        <div className="mc-craft-arrow">→</div>
        <div className="mc-craft-result"><small>LV</small><b>{state.level}</b></div>
      </div>
    </div>
    <div className="mc-grid">{mainSlots.map((slot, index) => renderSlot(slot, index, "main"))}</div>
    <div className="mc-grid mc-hotbar">{hotbarSlots.map((slot, index) => renderSlot(slot, index, "hotbar"))}</div>
    {selected && <div className="mc-detail">
      <div className="mc-detail-head"><span>{selected.item.icon}</span><div><b style={{ color: selected.kind === "equipment" ? RARITY_META[selected.item.rarity].color : undefined }}>{selected.item.name}</b><small className="muted">{selected.item.desc}</small></div></div>
      {selected.kind === "equipment" ? <button className="primary" onClick={() => { onEquipItem(selected.item.id); setSelected(null); }}>{equipment[selected.item.slot] === selected.item.id ? "装備を解除" : "装備する"}</button> : <button className="primary" disabled>戦闘中に使用できます</button>}
    </div>}
  </div>;
}
function nextShopGoal(state) {
  const owned = new Set(state.ownedEquipment || []);
  const candidates = [
    ...SHOP_ITEMS.map((item) => ({ id: item.id, name: item.name, icon: item.icon, cost: item.cost })),
    ...EQUIPMENT_ITEMS.filter((item) => !owned.has(item.id)).map((item) => ({ id: item.id, name: item.name, icon: item.icon, cost: item.cost, rarity: item.rarity })),
  ].filter((item) => item.cost > (state.currency || 0));
  if (!candidates.length) return null;
  return candidates.reduce((closest, item) => (item.cost - state.currency < closest.cost - state.currency ? item : closest));
}
function ShopScreen({ state, onBuyItem, onBuyEquipment, onEquipItem }) {
  const [shopTab, setShopTab] = useState("consumable");
  const owned = state.ownedEquipment || [];
  const equipment = state.equipment || {};
  const goal = nextShopGoal(state);
  return <div className="shop-screen"><div className="section-heading"><div><div className="eyebrow">SHOP</div><h1>道具屋</h1></div><small className="muted">所持 {formatCurrency(state.currency)}</small></div><p className="muted">ダンジョン報酬やレベルアップで貯めたAURUMで、冒険に役立つアイテムを購入できます。</p>
    {goal && <article className="shop-next-goal"><small>NEXT GOAL</small><div className="shop-next-goal-row"><span className="shop-next-goal-icon" style={goal.rarity ? { color: RARITY_META[goal.rarity].color } : undefined}>{goal.icon}</span><div><b>{goal.name}</b><small className="muted">あと {formatCurrency(goal.cost - state.currency)} で購入できます</small></div></div><div className="shop-next-goal-bar"><i style={{ width: `${Math.min(100, (state.currency / goal.cost) * 100)}%` }} /></div></article>}
    <div className="shop-tabs">
      <button className={shopTab === "consumable" ? "active" : ""} onClick={() => setShopTab("consumable")}>消耗品</button>
      <button className={shopTab === "equipment" ? "active" : ""} onClick={() => setShopTab("equipment")}>武器・防具</button>
    </div>
    {shopTab === "consumable" && <div className="dungeon-shop-list">{SHOP_ITEMS.map((item) => <div className="dungeon-shop-item" key={item.id}><span className="dungeon-shop-icon">{item.icon}</span><div className="dungeon-shop-info"><b>{item.name}</b><small className="muted">{item.desc}</small><small className="dungeon-shop-stock">在庫 {state.inventory?.[item.invKey] || 0}個</small></div><button className="secondary" disabled={state.currency < item.cost} onClick={() => onBuyItem(item.id)}>{formatCurrency(item.cost)}</button>{state.currency < item.cost && <small className="shop-item-remaining">あと {formatCurrency(item.cost - state.currency)}</small>}</div>)}</div>}
    {shopTab === "equipment" && EQUIP_SLOTS.map((slot) => <div className="equip-slot-group" key={slot.id}>
      <div className="equip-slot-header">{slot.label}</div>
      <div className="dungeon-shop-list">
        {EQUIPMENT_ITEMS.filter((item) => item.slot === slot.id).map((item) => {
          const isOwned = owned.includes(item.id);
          const isEquipped = equipment[slot.id] === item.id;
          return <div className={`dungeon-shop-item equip-item ${isEquipped ? "equipped" : ""}`} key={item.id} style={{ borderColor: isEquipped ? undefined : `${RARITY_META[item.rarity].color}55` }}>
            <span className="dungeon-shop-icon">{item.icon}</span>
            <div className="dungeon-shop-info">
              <b>{item.name}<span className="rarity-badge" style={{ color: RARITY_META[item.rarity].color, borderColor: RARITY_META[item.rarity].color }}>{RARITY_META[item.rarity].label}</span>{isEquipped && <span className="equip-badge">装備中</span>}</b>
              <small className="muted">{item.desc}</small>
              <small className="dungeon-shop-stock">{[item.atk && `ATK+${item.atk}`, item.def && `DEF+${item.def}`, item.maxHp && `HP+${item.maxHp}`, item.skillPower && `技+${item.skillPower}`].filter(Boolean).join(" / ")}</small>
            </div>
            {isOwned ? <button className={isEquipped ? "secondary" : "primary"} onClick={() => onEquipItem(item.id)}>{isEquipped ? "解除" : "装備"}</button> : <button className="secondary" disabled={state.currency < item.cost} onClick={() => onBuyEquipment(item.id)}>{formatCurrency(item.cost)}</button>}
            {!isOwned && state.currency < item.cost && <small className="shop-item-remaining">あと {formatCurrency(item.cost - state.currency)}</small>}
          </div>;
        })}
      </div>
    </div>)}
  </div>;
}
function GachaScreen({ state, drawing, results, onDraw, onClearResults }) {
  const [payWith, setPayWith] = useState("ticket");
  const tickets = state.gachaTickets || 0;
  const currency = state.currency || 0;
  const history = state.gachaHistory || [];
  const usingAurum = payWith === "aurum";
  const canSingle = !drawing && (usingAurum ? currency >= GACHA_AURUM_COST.single : tickets >= GACHA_TICKET_COST.single);
  const canTen = !drawing && (usingAurum ? currency >= GACHA_AURUM_COST.ten : tickets >= GACHA_TICKET_COST.ten);
  function renderResultLine(result, index) {
    const label = result.kind === "consumable" ? result.name
      : result.kind === "equipment" ? result.name
      : result.kind === "exp" ? `EXP +${result.amount}`
      : result.kind === "stat" ? `${result.name} +${result.amount}`
      : `${CURRENCY_NAME} +${result.amount}`;
    return <div className={`gacha-result-row rarity-${result.rarity}`} key={index} style={{ animationDelay: `${index * 70}ms` }}>
      <span className="gacha-result-rarity" style={{ color: RARITY_META[result.rarity].color, borderColor: RARITY_META[result.rarity].color }}>{RARITY_META[result.rarity].label}</span>
      <span className="gacha-result-icon">{result.icon || (result.kind === "exp" ? "✦" : result.kind === "stat" ? "⬆" : result.kind === "currency" ? "◈" : "🎁")}</span>
      <b>{label}</b>
      {result.duplicate && <small className="muted">（重複 → {CURRENCY_ICON}{result.convertedCurrency} に変換）</small>}
    </div>;
  }
  return <div className="gacha-screen">
    <div className="section-heading"><div><div className="eyebrow">LIFE GACHA</div><h1>運命の抽選</h1></div><small className="muted">所持 {formatCurrency(state.currency)}</small></div>
    <p className="muted">GACHA TICKETまたはAURUMを使って、装備・アイテム・成長の欠片を抽選できます。TICKETはレベルアップ、デイリーQUESTの全達成、BOSS撃破、連続記録のマイルストーンで手に入ります。</p>
    <article className="gacha-ticket-badge"><small>GACHA TICKET</small><b>🎴 {tickets}</b></article>
    <div className="gacha-pay-toggle" role="tablist" aria-label="支払い方法">
      <button type="button" role="tab" aria-selected={!usingAurum} className={!usingAurum ? "active" : ""} onClick={() => setPayWith("ticket")}>🎴 TICKETで引く</button>
      <button type="button" role="tab" aria-selected={usingAurum} className={usingAurum ? "active" : ""} onClick={() => setPayWith("aurum")}>◈ AURUMで引く</button>
    </div>
    <div className={`gacha-summon-stage ${drawing ? "drawing" : ""} ${results ? "revealed" : ""}`}>
      <div className="gacha-summon-glow" aria-hidden="true" />
      <span className="gacha-summon-icon" aria-hidden="true">{drawing ? "✦" : "🎴"}</span>
      {drawing && <small className="gacha-summon-caption">抽選中…</small>}
      {!drawing && !results && <small className="gacha-summon-caption">抽選エリア</small>}
    </div>
    {results && (
      <div className="gacha-result-panel" role="status" aria-live="polite">
        <div className="gacha-result-list">{results.map((result, index) => renderResultLine(result, index))}</div>
        <button className="primary" onClick={onClearResults}>ALL CLAIM</button>
      </div>
    )}
    {!results && (
      <div className="gacha-draw-buttons">
        <button className="secondary" disabled={!canSingle} onClick={() => onDraw(1, payWith)}>1 DRAW<small>{usingAurum ? formatCurrency(GACHA_AURUM_COST.single) : `🎴 ${GACHA_TICKET_COST.single}`}</small></button>
        <button className="primary" disabled={!canTen} onClick={() => onDraw(10, payWith)}>10 DRAW<small>{usingAurum ? formatCurrency(GACHA_AURUM_COST.ten) : `🎴 ${GACHA_TICKET_COST.ten}`}</small></button>
      </div>
    )}
    {!usingAurum && tickets < GACHA_TICKET_COST.single && !results && <small className="muted">GACHA TICKETがありません。ACTIONやQUESTで日々の冒険を続けて手に入れましょう。AURUMでも引くことができます。</small>}
    {usingAurum && currency < GACHA_AURUM_COST.single && !results && <small className="muted">{CURRENCY_NAME}が足りません。</small>}
    <div className="gacha-history">
      <div className="eyebrow">獲得履歴</div>
      {history.length === 0 && <p className="muted">まだ抽選履歴がありません。</p>}
      {history.slice(0, 10).map((entry) => (
        <article className="gacha-history-entry" key={entry.id}>
          <small className="muted">{new Date(entry.at).toLocaleString("ja-JP")} · {entry.count}連 · {entry.paidWith === "aurum" ? "◈ AURUM" : "🎴 TICKET"}</small>
          <div className="gacha-history-items">
            {entry.results.map((result, index) => <span className="rarity-badge" key={index} style={{ color: RARITY_META[result.rarity].color, borderColor: RARITY_META[result.rarity].color }}>{result.icon || ""} {result.name || (result.kind === "exp" ? `EXP+${result.amount}` : result.kind === "currency" ? `${CURRENCY_NAME}+${result.amount}` : `+${result.amount}`)}</span>)}
          </div>
        </article>
      ))}
    </div>
  </div>;
}
function DungeonBattle({ battle, state, onCommand, onTiming, onContinue, allowEscape = true }) {
  const markerRef = useRef(null);
  const timingTrackRef = useRef(null);
  const [itemMenuOpen, setItemMenuOpen] = useState(false);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [fastForward, setFastForward] = useState(false);
  const [timingLocked, setTimingLocked] = useState(false);
  const logRef = useRef(null);
  const tier = dungeonTier(battle.floor);
  const playerName = state?.profile?.name || "あなた";
  const playerAvatar = state?.profile?.avatarUrl;
  const playerIcon = state?.job?.icon || "A";
  const combat = playerCombatStats(state);
  const floorInfo = DUNGEON_FLOORS.find((entry) => entry.floor === battle.floor);
  const recommendedLevel = floorInfo ? floorInfo.floor + (floorInfo.boss ? 3 : 2) : battle.floor;
  const rewardMonster = battle.phase === "won" ? monsterAt(battle.floor) : null;
  const fallbackExp = rewardMonster
    ? (state?.dungeon?.bestFloor || 0) >= battle.floor ? Math.max(1, Math.round(rewardMonster.exp * 0.25)) : rewardMonster.exp
    : 0;
  const rewardSummary = battle.reward || (rewardMonster ? {
    exp: fallbackExp,
    gold: rewardMonster.gold,
    drop: null,
    alreadyCleared: (state?.dungeon?.bestFloor || 0) >= battle.floor,
  } : null);
  const rewardProgression = rewardSummary ? previewBattleReward(state, rewardSummary) : null;
  const currentIntent = battle.intent || ENEMY_INTENTS[0];
  const currentSkill = BATTLE_SKILLS.find((skill) => skill.id === battle.pendingSkillId);
  const timingElapsed = battle.phase === "timing" && Number.isFinite(battle.timingStart)
    ? Math.max(0, Date.now() - battle.timingStart)
    : 0;
  const formatBattleStatus = (status) => `${BATTLE_STATUS_EFFECTS[status.id]?.icon || "◇"} ${BATTLE_STATUS_EFFECTS[status.id]?.name || status.id} ${status.turns}`;
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [battle.log.length]);
  useEffect(() => {
    if (battle.phase !== "timing") setTimingLocked(false);
  }, [battle.phase, battle.timingStart]);
  function handleTap() {
    if (timingLocked) return;
    const trackNode = timingTrackRef.current;
    const track = trackNode?.getBoundingClientRect();
    const marker = markerRef.current?.getBoundingClientRect();
    if (!track || !trackNode?.clientWidth || !marker) return;
    const contentLeft = track.left + trackNode.clientLeft;
    const position = ((marker.left + marker.width / 2 - contentLeft) / trackNode.clientWidth) * 100;
    setTimingLocked(true);
    onTiming(position);
  }
  function handlePointerDown(event) {
    event.preventDefault();
    handleTap();
  }
  function handleKeyboardClick(event) {
    if (event.detail === 0) handleTap();
  }
  const itemStock = (id) => { if (id === "potion") return battle.itemUsesLeft + (state?.inventory?.potions || 0); const item = SHOP_ITEMS.find((entry) => entry.id === id); return state?.inventory?.[item.invKey] || 0; };
  const totalItems = SHOP_ITEMS.reduce((sum, item) => sum + itemStock(item.id), 0);
  function useItem(itemId) { setItemMenuOpen(false); onCommand("item", itemId); }
  function useSkill(skillId) { setSkillMenuOpen(false); onCommand("skill", null, skillId); }
  const weakness = ["火炎", "風", "光", "火炎", "火炎", "雷", "雷", "火炎", "火炎", "雷"][battle.floor - 1];
  if (battle.phase === "won" || battle.phase === "lost" || battle.phase === "fled") return <div className={`dungeon-battle result tier-${tier} ${battle.phase}`}><div className="eyebrow">{battle.phase === "won" ? "VICTORY" : battle.phase === "lost" ? "DEFEAT" : "ESCAPED"}</div><h2>{battle.phase === "won" ? `${battle.monster}を撃破！` : battle.phase === "lost" ? `${battle.monster}に敗北…` : `${battle.monster}から逃げ切った`}</h2>{battle.phase === "won" && <div className="dungeon-reward-summary" style={{ margin: "16px 0", padding: "14px", border: "1px solid #8f7844", borderRadius: "8px", background: "rgba(143,120,68,.12)" }}><b style={{ display: "block", marginBottom: "8px", color: "#e8c76a" }}>獲得報酬</b><div>+{rewardSummary?.exp ?? 0} EXP　/　+{rewardProgression?.currency ?? 0} AURUM</div>{rewardSummary?.bonusLines?.length > 0 && <div className="dungeon-reward-bonuses">{rewardSummary.bonusLines.map((line) => <div key={line.label}>✦ {line.label}{line.exp ? ` · +${line.exp} EXP` : ""}{line.gold ? ` · +${line.gold} AURUM` : ""}</div>)}</div>}{rewardProgression?.levelsGained > 0 && <small className="muted">レベルアップ報酬 +{rewardProgression.levelsGained * LEVEL_UP_CURRENCY_BONUS} AURUM を含む</small>}<div style={{ marginTop: "6px" }}>{battle.reward ? battle.reward.drop ? `装備ドロップ：${RARITY_META[battle.reward.drop.rarity]?.label || ""}「${battle.reward.drop.icon} ${battle.reward.drop.name}」` : "装備ドロップなし" : "装備ドロップ抽選は受取時に確定"}</div>{rewardSummary?.alreadyCleared && <small className="muted">再挑戦報酬</small>}</div>}{battle.phase === "fled" && <p className="muted" style={{ margin: "16px 0" }}>報酬はありません。装備やステータスを整えてから再挑戦しましょう。</p>}<div className="dungeon-log" ref={logRef} aria-live="polite">{battle.log.map((line, index) => <p key={index}>{line}</p>)}</div><button className="primary" onClick={onContinue}>{battle.phase === "won" ? "報酬を受け取って戻る" : "フロア選択へ戻る"}</button></div>;
  return <div className={`dungeon-battle tier-${tier} anim-${battle.combatEffect || "idle"} ${fastForward ? "fast-forward" : ""}`}>
    <style>{`
      .dungeon-battle.anim-player-strike .dungeon-enemy,
      .dungeon-battle.anim-skill-strike .dungeon-enemy,
      .dungeon-battle.anim-counter .dungeon-enemy,
      .dungeon-battle.anim-weak-hit .dungeon-enemy,
      .dungeon-battle.anim-critical .dungeon-enemy,
      .dungeon-battle.anim-exchange .dungeon-enemy { animation: battle-enemy-hit 420ms ease-out; }
      .dungeon-battle.anim-player-strike .dungeon-hero-model,
      .dungeon-battle.anim-skill-strike .dungeon-hero-model,
      .dungeon-battle.anim-exchange .dungeon-hero-model { animation: hero-lunge 420ms ease-in-out; }
      .dungeon-battle.anim-dodge .dungeon-hero-model,
      .dungeon-battle.anim-perfect-dodge .dungeon-hero-model { animation: hero-dodge 420ms ease-in-out; }
      .dungeon-battle.anim-enemy-strike .dungeon-player-card { animation: battle-player-hit 360ms ease-out; }
      .dungeon-battle.anim-exchange .dungeon-player-card { animation: battle-player-hit 360ms ease-out; }
      .dungeon-battle.anim-guard .dungeon-player-face { animation: battle-guard 400ms ease-out; }
      .dungeon-battle.anim-perfect-guard .dungeon-player-face { animation: battle-guard 520ms ease-out; }
      .dungeon-battle.anim-dodge .dungeon-player-card,
      .dungeon-battle.anim-perfect-dodge .dungeon-player-card { animation: battle-dodge 400ms ease-out; }
      .dungeon-battle.anim-break .dungeon-enemy { animation: battle-break 560ms ease-out; }
      @keyframes battle-enemy-hit { 0%,100% { transform:translateZ(45px) rotateY(-8deg) scale(1.08) translateX(0); filter:none; } 32% { transform:translateZ(45px) rotateY(-8deg) scale(1.08) translateX(-13px) rotate(-2deg); filter:brightness(1.8); } 62% { transform:translateZ(45px) rotateY(-8deg) scale(1.08) translateX(6px); } }
      @keyframes battle-player-hit { 0%,100% { transform:translateX(0); } 35% { transform:translateX(-8px); filter:brightness(1.5); } 65% { transform:translateX(4px); } }
      @keyframes battle-guard { 0%,100% { transform:scale(1); } 45% { transform:scale(1.12); filter:drop-shadow(0 0 10px #a9d6ff); } }
      @keyframes battle-dodge { 0%,100% { transform:translateX(0); } 40% { transform:translateX(16px) rotate(2deg); opacity:.72; } }
      @keyframes battle-break { 0%,100% { transform:translateY(0); } 25% { transform:translateY(-10px) rotate(3deg); filter:brightness(1.8); } 55% { transform:translateY(5px) rotate(-3deg); } }
      @keyframes hero-lunge { 0%,100% { transform:translateZ(72px) rotateY(11deg); } 40% { transform:translateZ(145px) rotateY(11deg) translateX(75px) scale(1.08); } }
      @keyframes hero-dodge { 0%,100% { transform:translateZ(72px) rotateY(11deg); } 40% { transform:translateZ(90px) rotateY(11deg) translateX(-30px) rotate(-8deg); } }
      .dungeon-intent { position:absolute; z-index:2; left:50%; top:12px; transform:translateX(-50%); display:grid; justify-items:center; gap:2px; min-width:150px; padding:7px 12px; border:1px solid #b98955; border-radius:999px; background:#111d; color:#ffe0a1; text-align:center; box-shadow:0 3px 18px #0009; }
      .dungeon-intent b { font-size:11px; letter-spacing:.1em; }
      .dungeon-intent small { color:#ddd0b4; font-size:9px; }
      .dungeon-intent.heavy, .dungeon-intent.charge { border-color:#d8785e; color:#ffab91; animation:intent-warning 1s ease-in-out infinite alternate; }
      .dungeon-intent.feint { border-color:#a88be0; color:#d1baff; }
      .dungeon-combat-meters { display:grid; grid-template-columns:1fr auto; align-items:center; gap:8px; margin-top:7px; }
      .dungeon-break-meter { height:4px; overflow:hidden; border-radius:9px; background:#34302a; }
      .dungeon-break-meter i { display:block; height:100%; background:linear-gradient(90deg,#c07d4c,#ffe29b); transition:width 240ms ease-out; }
      .dungeon-combo { color:#f0d58c; font-size:10px; font-weight:700; letter-spacing:.08em; }
      .dungeon-tell { margin:0; color:#f0d58c; font-size:11px; text-align:center; }
      .dungeon-command-panel .dodge-command { border-color:#6189a5; color:#d1eaff; }
      .dungeon-command-panel .escape-command { border-color:#8a7a5a; color:#cbb98a; }
      .dungeon-player-card { position:relative; }
      .dungeon-vs-stats { display:flex; flex-wrap:wrap; gap:6px; margin-top:3px; color:#c9bd9c; font-size:9px; letter-spacing:.05em; }
      .dungeon-vs-stats span { padding:1px 6px; border:1px solid #4a4030; border-radius:999px; background:#1a170f; }
      .dungeon-damage-pop { position:absolute; left:50%; top:8px; transform:translateX(-50%); font:800 15px Georgia,serif; color:#fff; text-shadow:0 2px 6px #000; pointer-events:none; animation:damage-pop-float 900ms ease-out forwards; z-index:5; }
      .dungeon-damage-pop.player { color:#ff8b7a; }
      .dungeon-damage-pop.critical { font-size:22px; color:#ffd15c; }
      .dungeon-damage-pop.weak { color:#ffb45c; }
      @keyframes damage-pop-float { 0% { opacity:0; transform:translate(-50%,4px) scale(.85); } 20% { opacity:1; transform:translate(-50%,-10px) scale(1.05); } 100% { opacity:0; transform:translate(-50%,-42px) scale(1); } }
      @media (prefers-reduced-motion: reduce) {
        .dungeon-damage-pop { animation:none!important; opacity:1; top:-4px; }
      }
      .battle-loadout { display:grid; gap:10px; margin:14px 0 18px; padding:14px; border:1px solid #51472f; background:linear-gradient(125deg,#1b1913,#111); }
      .battle-loadout>div:first-child { display:grid; gap:4px; }
      .battle-loadout>div:first-child b { color:#e3d4ab; font:16px Georgia,serif; }
      .battle-loadout small { color:#9b988e; font-size:10px; }
      .battle-loadout-list { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
      .battle-loadout-list button { display:grid; gap:4px; padding:10px; text-align:left; color:#aaa; border:1px solid #3c3a34; background:#121211; }
      .battle-loadout-list button.selected { color:#e8d39d; border-color:#b99a5b; background:#292317; }
      .battle-loadout-list button:disabled { opacity:.38; cursor:not-allowed; }
      .battle-loadout-list button b { font-size:11px; }
      .battle-loadout-list button small { line-height:1.4; }
      .dungeon-resource-bars { display:grid; gap:4px; margin-top:6px; }
      .dungeon-resource-bars>div { display:grid; grid-template-columns:26px 1fr 44px; align-items:center; gap:5px; color:#bcb8ad; font-size:9px; }
      .dungeon-resource-bars i { height:3px; background:#302f2c; }
      .dungeon-resource-bars i em { display:block; height:100%; background:#83a6b4; }
      .dungeon-resource-bars .energy em { background:#c5ad70; }
      .dungeon-statuses { display:flex; flex-wrap:wrap; gap:4px; margin-top:5px; color:#ddc990; font-size:9px; }
      .dungeon-enemy-weakness { margin-top:3px; color:#f2d28c; font-size:9px; letter-spacing:.08em; }
      .dungeon-skill-menu { grid-column:1/-1; display:grid; gap:5px; padding:8px; border:1px solid #56482d; background:#12110f; }
      .dungeon-skill-menu button { display:flex; justify-content:space-between; align-items:center; gap:8px; text-align:left; }
      .dungeon-skill-menu small { color:#aaa; font-size:9px; }
      .dungeon-reward-bonuses { margin-top:7px; color:#d7c48f; font-size:10px; line-height:1.7; }
      .dungeon-break-meter i { background:linear-gradient(90deg,#ffe29b,#c07d4c); }
      .dungeon-fast-forward { display:block; margin:6px 0 0 auto; padding:6px 9px; border:1px solid #49443a; background:#151412; color:#a9a398; font-size:9px; }
      .dungeon-battle.fast-forward .dungeon-enemy,
      .dungeon-battle.fast-forward .dungeon-player-card,
      .dungeon-battle.fast-forward .dungeon-player-face { animation-duration:110ms!important; }
      @keyframes intent-warning { to { box-shadow:0 0 16px #d8785e77; } }
      .dungeon-scene { height:260px; perspective:850px; perspective-origin:50% 47%; transform-style:preserve-3d; background:#506779; }
      .dungeon-scene-sky { transform:translateZ(-180px) scale(1.35); }
      .dungeon-scene-clouds { transform:translateZ(-115px) scale(1.2); }
      .dungeon-scene-mountains { transform:translateZ(-65px) scale(1.12); filter:drop-shadow(0 8px 8px #26364066); }
      .dungeon-scene-field { top:63%; bottom:auto; height:70%; transform:rotateX(52deg) translateZ(-12px) scale(1.18); transform-origin:center top; background:repeating-linear-gradient(90deg,transparent 0 46px,#d6e8ad12 47px 48px),repeating-linear-gradient(0deg,transparent 0 32px,#d6e8ad14 33px 34px),linear-gradient(180deg,#84ad65,#35553d); border-top:1px solid #d0e8aa66; box-shadow:0 -10px 35px #223d35aa; }
      .dungeon-scene::after { content:""; position:absolute; inset:45% 0 0; pointer-events:none; background:linear-gradient(180deg,transparent,#08100a55); transform:translateZ(6px); }
      .dungeon-enemy { left:58%; right:auto; bottom:18%; transform:translateZ(45px) rotateY(-8deg) scale(1.08); transform-style:preserve-3d; filter:drop-shadow(12px 15px 8px #102018aa); }
      .dungeon-battle-portrait { width:132px; height:132px; border-radius:20px 8px 20px 8px; border:3px solid #d9c894; box-shadow:inset 0 0 0 3px #1118,0 0 0 5px #1118,0 18px 30px #050b0a99; transform:rotateY(-4deg) rotateX(2deg); }
      .dungeon-hero-model { position:absolute; z-index:1; left:17%; bottom:16%; width:76px; height:128px; transform:translateZ(72px) rotateY(11deg); transform-style:preserve-3d; filter:drop-shadow(8px 12px 7px #102018aa); animation:hero-idle 2.8s ease-in-out infinite; }
      .dungeon-hero-rune { position:absolute; left:-19px; bottom:-5px; width:112px; height:35px; border:2px solid #d4c17d99; border-radius:50%; background:radial-gradient(ellipse,#d8c27b42 0,transparent 68%); box-shadow:0 0 24px #c5a85b55; transform:rotateX(70deg) translateZ(-22px); }
      .dungeon-hero-body { position:absolute; left:17px; bottom:22px; width:45px; height:60px; border:1px solid #d6d0b5; border-radius:16px 16px 9px 9px; background:linear-gradient(110deg,#f1ead2 0 13%,#435b68 14% 54%,#1c2933 55% 100%); box-shadow:inset -8px 0 0 #10192388,8px 3px 0 #b9aa7d55; clip-path:polygon(24% 0,76% 0,100% 24%,86% 100%,14% 100%,0 24%); }
      .dungeon-hero-head { position:absolute; z-index:2; left:22px; bottom:74px; display:grid; place-items:center; width:36px; height:36px; overflow:hidden; border:2px solid #e4d6ab; border-radius:50%; background:radial-gradient(circle at 34% 28%,#fff,#b5c9c0 48%,#42545b 75%); color:#172126; font:700 14px Georgia,serif; box-shadow:0 2px 8px #0009,4px 0 0 #a4936b; }
      .dungeon-hero-head img { width:100%; height:100%; object-fit:cover; }
      .dungeon-hero-sword { position:absolute; z-index:3; right:-2px; bottom:26px; color:#f4e9c1; font-size:39px; line-height:1; text-shadow:0 0 8px #d7c68a,3px 4px #26323a; transform:rotate(-17deg) translateZ(16px); }
      .dungeon-hero-label { position:absolute; left:50%; bottom:-22px; width:100px; transform:translateX(-50%); color:#f3ead1; font-size:9px; text-align:center; text-shadow:0 2px 4px #000; white-space:nowrap; }
      @keyframes hero-idle { 0%,100% { translate:0 0; } 50% { translate:0 -4px; } }
      @media(max-width:480px) { .dungeon-scene { height:238px; } .dungeon-enemy { left:auto; right:8%; bottom:20%; } .dungeon-battle-portrait { width:112px; height:112px; } .dungeon-hero-model { left:10%; transform:translateZ(62px) rotateY(11deg) scale(.9); } }
      @media (prefers-reduced-motion: reduce) {
        .dungeon-battle .dungeon-enemy,
        .dungeon-battle .dungeon-player-card,
        .dungeon-battle .dungeon-player-face,
        .dungeon-battle .dungeon-intent,
        .dungeon-battle .dungeon-hero-model { animation:none!important; transition:none!important; }
      }
    `}</style>
    <div className="dungeon-scene">
      <div className="dungeon-scene-sky" />
      <div className="dungeon-scene-clouds" />
      <div className="dungeon-scene-mountains" />
      <div className="dungeon-scene-field" />
      <div className="dungeon-hero-model" aria-label={playerName} role="img">
        <div className="dungeon-hero-rune" />
        <div className="dungeon-hero-body" />
        <div className="dungeon-hero-head">{playerAvatar ? <img src={playerAvatar} alt="" /> : playerIcon}</div>
        <span className="dungeon-hero-sword" aria-hidden="true">⚔</span>
        <span className="dungeon-hero-label">{playerName}</span>
      </div>
      <div className={`dungeon-intent ${currentIntent.id}`} aria-live="polite"><b>{currentIntent.name}</b><small>{currentIntent.tell}</small></div>
      <div className="dungeon-enemy" key={battle.combatEffectId || 0}>
        {battle.image && <img className="dungeon-battle-portrait" src={battle.image} alt={battle.monster} />}
        <div className="dungeon-enemy-name">{battle.monster}{battle.boss && <em>BOSS</em>}</div>
        <div className="dungeon-enemy-hp"><i style={{ width: `${Math.max(0, (battle.monsterHp / battle.monsterMaxHp) * 100)}%` }} /></div>
        <div className="dungeon-vs-stats"><span>ATK {battle.monsterAtk ?? "-"}</span><span>DEF {battle.monsterDef ?? "-"}</span><span>推奨LV {recommendedLevel}</span></div>
        {battle.version >= 4 && <small className="dungeon-enemy-weakness">弱点 · {weakness}</small>}
        {!!battle.enemyStatuses?.length && <div className="dungeon-statuses">{battle.enemyStatuses.map((status) => <span key={status.id}>{formatBattleStatus(status)}</span>)}</div>}
        {(battle.damageEvents || []).filter((event) => event.target === "enemy").map((event) => <span key={event.id} className={`dungeon-damage-pop enemy ${event.critical ? "critical" : ""} ${event.weak ? "weak" : ""}`}>{event.amount}</span>)}
      </div>
      {battle.lastHit && <p className={`dungeon-hit-effect ${battle.lastHit.tier}`} key={battle.lastHit.id}>{battle.lastHit.label}!</p>}
    </div>
    <button className="dungeon-fast-forward" aria-pressed={fastForward} onClick={() => setFastForward(!fastForward)}>演出短縮 {fastForward ? "ON" : "OFF"}</button>
    <div className="dungeon-log" ref={logRef} aria-live="polite">{battle.log.map((line, index) => <p key={index}>{line}</p>)}</div>
    <div className="dungeon-hud">
      <div className="dungeon-player-card" key={battle.combatEffectId || 0}>
        <div className="dungeon-player-face">{playerAvatar ? <img src={playerAvatar} alt={playerName} /> : playerIcon}</div>
        <div className="dungeon-player-info">
          <b>{playerName}</b>
          <div className="dungeon-hp-bar player"><i style={{ width: `${Math.max(0, (battle.playerHp / battle.playerMaxHp) * 100)}%` }} /></div>
          <small>HP {battle.playerHp}/{battle.playerMaxHp}</small>
          <div className="dungeon-vs-stats"><span>ATK {combat.atk}</span><span>DEF {combat.def}</span></div>
          {battle.version >= 4 && <div className="dungeon-resource-bars"><div><span>MP</span><i><em style={{ width: `${Math.min(100, battle.mp / battle.maxMp * 100)}%` }} /></i><small>{battle.mp}/{battle.maxMp}</small></div><div><span>EN</span><i className="energy"><em style={{ width: `${battle.energy}%` }} /></i><small>{battle.energy}/100</small></div></div>}
          {!!battle.playerStatuses?.length && <div className="dungeon-statuses">{battle.playerStatuses.map((status) => <span key={status.id}>{formatBattleStatus(status)}</span>)}</div>}
          {(battle.damageEvents || []).filter((event) => event.target === "player").map((event) => <span key={event.id} className="dungeon-damage-pop player">{event.amount}</span>)}
          <div className="dungeon-combat-meters" aria-label={`ブレイク ${battle.version >= 4 ? 100 - (battle.breakGauge ?? 100) : battle.breakGauge || 0}%、コンボ ${battle.combo || 0}`}>
            <div className="dungeon-break-meter" role="progressbar" aria-label="ブレイクゲージ" aria-valuemin="0" aria-valuemax="100" aria-valuenow={battle.version >= 4 ? 100 - (battle.breakGauge ?? 100) : battle.breakGauge || 0}><i style={{ width: `${battle.version >= 4 ? 100 - (battle.breakGauge ?? 100) : battle.breakGauge || 0}%` }} /></div>
            <span className="dungeon-combo">{battle.combo ? `×${battle.combo} COMBO` : "BREAK"}</span>
          </div>
        </div>
      </div>
      {battle.phase === "timing" ? <div className={`dungeon-timing ${timingLocked ? "timing-locked" : ""} ${battle.pendingCommand === "dodge" ? "evade" : ""}`}><p className="muted">{timingLocked ? "判定中… その位置を確認しています" : battle.pendingCommand === "dodge" ? "敵の攻撃に合わせて回避！ PERFECTで反撃" : battle.pendingCommand === "defend" ? "敵の予告に合わせてガード！ PERFECTで気絶・反撃" : battle.pendingCommand === "skill" ? `${currentSkill?.name || "スキル"} · ${currentSkill?.element || ""} · タイミングで威力上昇` : "中心の光る帯でタイミングを狙え！"}</p><div className="timing-track" ref={timingTrackRef}><div className="timing-zone good" /><div className="timing-zone perfect" /><div className="timing-marker" key={battle.timingStart} ref={markerRef} style={{ animationDuration: `${timingCycleMs(battle.floor)}ms`, animationDelay: timingLocked ? undefined : `-${timingElapsed}ms`, animationPlayState: timingLocked ? "paused" : "running" }} /></div><button className="primary timing-button" disabled={timingLocked} onPointerDown={handlePointerDown} onClick={handleKeyboardClick}>{timingLocked ? "判定中…" : battle.pendingCommand === "skill" ? `${currentSkill?.name || "スキル"}発動！` : battle.pendingCommand === "dodge" ? "回避！" : battle.pendingCommand === "defend" ? "ガード！" : "攻撃！"}</button></div> : <div className="dungeon-command-panel">{skillMenuOpen && <div className="dungeon-skill-menu">{(battle.activeSkills || []).map((id) => { const skill = BATTLE_SKILLS.find((entry) => entry.id === id); if (!skill) return null; const cooldown = battle.cooldowns?.[skill.id] || 0; const disabled = cooldown > 0 || battle.mp < skill.mp || battle.energy < skill.energy; return <button type="button" key={skill.id} disabled={disabled} onClick={() => useSkill(skill.id)}><span><b>{skill.name}</b><small>{skill.desc} · MP {skill.mp} / EN {skill.energy}{cooldown ? ` · CD ${cooldown}` : ""}</small></span><span>選択</span></button>; })}<button className="dungeon-item-cancel" onClick={() => setSkillMenuOpen(false)}>戻る</button></div>}{itemMenuOpen && <div className="dungeon-item-menu">{SHOP_ITEMS.map((item) => <button key={item.id} disabled={itemStock(item.id) <= 0} onClick={() => useItem(item.id)}><span className="cmd-icon">{item.icon}</span>{item.name} ({itemStock(item.id)})</button>)}<button className="dungeon-item-cancel" onClick={() => setItemMenuOpen(false)}>戻る</button></div>}<button onClick={() => onCommand("attack")}><span className="cmd-icon">⚔</span>攻撃</button><button disabled={!battle.activeSkills?.length} onClick={() => { setItemMenuOpen(false); setSkillMenuOpen(!skillMenuOpen); }}><span className="cmd-icon">✧</span>スキル</button><button onClick={() => { setSkillMenuOpen(false); onCommand("defend"); }}><span className="cmd-icon">🛡</span>ガード</button><button className="dodge-command" onClick={() => { setSkillMenuOpen(false); onCommand("dodge"); }}><span className="cmd-icon">↗</span>回避</button><button disabled={totalItems <= 0} onClick={() => { setSkillMenuOpen(false); setItemMenuOpen(!itemMenuOpen); }}><span className="cmd-icon">🎒</span>アイテム ({totalItems})</button>{allowEscape && <button className="escape-command" onClick={() => { setSkillMenuOpen(false); setItemMenuOpen(false); onCommand("escape"); }}><span className="cmd-icon">🏃</span>逃げる</button>}</div>}
    </div>
  </div>;
}
function SocialUserCard({ user, onSelect, actions }) {
  return <article className="social-user"><button className="social-user-main" onClick={() => onSelect(user)}><span className="social-avatar">{user.icon || user.displayName?.[0] || "A"}</span><span><b>{user.displayName}</b><small>@{user.username} · LV.{user.level}</small></span></button><div className="social-user-actions">{actions}</div></article>;
}
function SocialScreen({ state, onAddFriend, onRespondFriend, onRemoveFriend, onOpenMessages, onSendMessage, messageLoadingId, messageSending, onCreateGuild, onJoinGuild, onSearchUsers, onChangeGuildIcon }) {
  const [section, setSection] = useState("friends");
  const [query, setQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState(null);
  const [compareUser, setCompareUser] = useState(null);
  const [messageUser, setMessageUser] = useState(null);
  const [rankingTab, setRankingTab] = useState("LEVEL");
  const social = getSocial(state);
  const self = selfSocialUser(state);
  const users = social.mockUsers || [];
  const findUser = (id) => users.find((user) => user.id === id);
  const friendUsers = social.friends.map(findUser).filter(Boolean);
  const requests = social.friendRequests.map((request) => ({ ...request, user: findUser(request.userId) })).filter((request) => request.user);
  const results = searchableUsers(state, query);
  const profile = selectedUser;
  const guild = social.guild;
  const guildMembers = guild ? (guild.memberIds || []).map((id) => id === "self" ? self : findUser(id)).filter(Boolean) : [];
  const periodRanking = rankingTab === "WEEKLY" ? social.weeklyRanking : rankingTab === "MONTHLY" ? social.monthlyRanking : null;
  const rankingUsers = [...(periodRanking?.length ? periodRanking : social.ranking?.length ? social.ranking : []), self].filter((user, index, list) => list.findIndex((item) => item.id === user.id) === index).sort((a, b) => { if (rankingTab === "WEEKLY" || rankingTab === "MONTHLY") return (b.periodExp || 0) - (a.periodExp || 0); if (rankingTab === "EXP") return b.exp - a.exp; if (rankingTab === "JOB LEVEL") return b.jobLevel - a.jobLevel; if (rankingTab === "GUILD") return (b.guildLevel || b.level) - (a.guildLevel || a.level); return b.level - a.level; });
  const unreadTotal = Object.values(social.unreadMessages || {}).reduce((sum, count) => sum + count, 0);
  const openMessagePanel = (user) => { setMessageUser(user); onOpenMessages?.(user); };
  return <div className="social-screen"><div className="eyebrow">CONNECT / COMPETE / GROW</div><div className="social-title-row"><div><h1>SOCIAL</h1><p className="muted">仲間とつながり、成長を共有しましょう。</p></div><span className="notification-count">{social.notifications.filter((item) => !item.read).length + unreadTotal || ""}</span></div><div className="social-tabs">{[["friends", "FRIENDS"], ["guild", "GUILD"], ["ranking", "RANKING"]].map(([id, label]) => <button key={id} className={section === id ? "active" : ""} onClick={() => { setSection(id); setSelectedUser(null); }}>{label}</button>)}</div>{section === "friends" && <div className="social-panel"><label className="social-search">SEARCH USER<input value={query} onChange={(event) => { setQuery(event.target.value); onSearchUsers?.(event.target.value); }} placeholder="USERNAME または USER ID" /></label>{query && <div className="social-results">{results.length ? results.map((user) => <SocialUserCard key={user.id} user={user} onSelect={setSelectedUser} actions={<button className="tiny-button" disabled={social.friends.includes(user.id) || social.friendRequests.some((request) => request.userId === user.id)} onClick={() => onAddFriend(user)}>{social.friends.includes(user.id) ? "FRIEND" : "ADD FRIEND"}</button>} />) : <p className="muted">ユーザーが見つかりません。</p>}</div>}<div className="social-subheading"><span>FRIENDS <b>{friendUsers.length}</b></span></div>{friendUsers.length ? <div className="social-list">{friendUsers.map((user) => <SocialUserCard key={user.id} user={user} onSelect={setSelectedUser} actions={<><button className="tiny-button" onClick={() => openMessagePanel(user)}>MESSAGE{social.unreadMessages?.[user.id] ? ` · ${social.unreadMessages[user.id]}` : ""}</button><button className="tiny-button" onClick={() => onRemoveFriend(user.id)}>REMOVE</button></>} />)}</div> : <div className="empty-social">まだフレンドはいません。USERNAMEで検索して申請しましょう。</div>} {requests.length > 0 && <><div className="social-subheading"><span>FRIEND REQUESTS <b>{requests.length}</b></span></div><div className="social-list">{requests.map((request) => <SocialUserCard key={request.id} user={request.user} onSelect={setSelectedUser} actions={request.direction === "incoming" ? <><button className="tiny-button" onClick={() => onRespondFriend(request, true)}>ACCEPT</button><button className="tiny-button ghost" onClick={() => onRespondFriend(request, false)}>DECLINE</button></> : <span className="request-pending">PENDING</span>} />)}</div></>}</div>}{section === "friends" && profile && <section className="social-profile"><button className="close-link" onClick={() => setSelectedUser(null)}>× CLOSE</button><div className="social-profile-head"><span className="social-avatar large">{profile.icon}</span><div><h2>{profile.displayName}</h2><p className="muted">@{profile.username} · {profile.job}</p></div></div><div className="social-profile-meta"><span>LEVEL <b>{profile.level}</b></span><span>JOB LEVEL <b>{profile.jobLevel}</b></span><span>ACHIEVEMENTS <b>{profile.achievements}</b></span></div><div className="social-profile-actions">{social.friends.includes(profile.id) && <button className="primary" onClick={() => openMessagePanel(profile)}>MESSAGE{social.unreadMessages?.[profile.id] ? ` · ${social.unreadMessages[profile.id]}` : ""}</button>}<button className="secondary" onClick={() => setCompareUser(compareUser ? null : profile)}>{compareUser ? "CLOSE COMPARE" : "COMPARE"}</button><button className="secondary" onClick={() => onRemoveFriend(profile.id)}>REMOVE</button><button className="danger" onClick={() => onRemoveFriend(profile.id, true)}>BLOCK</button></div>{compareUser && <div className="compare-grid">{STAT_KEYS.map((key) => <div key={key}><small>{key}</small><span>{state.stats[key]}</span><i style={{ width: `${Math.min(100, (profile.stats?.[key] || 0))}%` }} /><em>{profile.stats?.[key] || 0}</em></div>)}</div>}</section>}{section === "guild" && <GuildPanel state={state} social={social} guild={guild} guildMembers={guildMembers} onCreateGuild={onCreateGuild} onJoinGuild={onJoinGuild} onChangeGuildIcon={onChangeGuildIcon} />}{section === "ranking" && <div className="ranking-panel"><div className="ranking-tabs">{["LEVEL", "EXP", "JOB LEVEL", "GUILD", "WEEKLY", "MONTHLY"].map((label) => <button key={label} className={rankingTab === label ? "active" : ""} onClick={() => setRankingTab(label)}>{label}</button>)}</div><div className="ranking-list">{rankingUsers.map((user, index) => <article className={`ranking-row ${user.id === "self" ? "me" : ""}`} key={user.id}><strong>#{index + 1}</strong><span className="social-avatar">{user.icon}</span><span><b>{user.displayName}</b><small>@{user.username} · {user.job}</small></span><em>{rankingTab === "JOB LEVEL" ? `JOB LV.${user.jobLevel}` : rankingTab === "GUILD" ? `LV.${user.guildLevel || user.level}` : `LV.${user.level}`}</em></article>)}</div><p className="ranking-note">あなたの順位: <b>#{rankingUsers.findIndex((user) => user.id === "self") + 1}</b> / {rankingUsers.length}</p></div>}{messageUser && <MessagePanel user={messageUser} messages={social.conversations?.[messageUser.id] || []} loading={messageLoadingId === messageUser.id} sending={messageSending} onClose={() => setMessageUser(null)} onSend={(body) => onSendMessage?.(messageUser, body)} />}</div>;
}
const messageStyles = `.message-modal{position:fixed;inset:0;z-index:10;background:rgba(0,0,0,.78);display:flex;align-items:flex-end;justify-content:center;padding:18px}.message-panel{width:min(680px,100%);max-height:min(80vh,680px);display:flex;flex-direction:column;border:1px solid #555;background:#111;box-shadow:0 20px 60px #000;padding:18px}.message-header{display:flex;justify-content:space-between;align-items:start;border-bottom:1px solid #333;padding-bottom:12px}.message-header small{color:#888;font-size:9px;letter-spacing:.16em}.message-header h2{font-family:Georgia,serif;font-size:24px;font-weight:400;margin:6px 0 0}.message-header p{color:#777;font-size:10px;margin:4px 0 0}.message-list{min-height:180px;max-height:48vh;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:16px 3px}.message-bubble{max-width:82%;align-self:flex-start;background:#222;border:1px solid #444;padding:9px 11px}.message-bubble.mine{align-self:flex-end;background:#eee;color:#111;border-color:#eee}.message-bubble p{font-size:12px;line-height:1.5;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.message-bubble small{display:block;color:#888;font-size:8px;margin-top:5px}.message-bubble.mine small{color:#666}.message-form{display:flex;gap:7px;border-top:1px solid #333;padding-top:12px}.message-form input{flex:1;min-width:0;border:1px solid #444;background:#171717;padding:11px;outline:0}.message-form .primary{margin:0;padding:11px 13px;font-size:9px}.message-form .primary:disabled{opacity:.45}.message-note{color:#666;font-size:9px;margin-top:9px}`;
function MessagePanel({ user, messages, loading, sending, onClose, onSend }) {
  const [text, setText] = useState("");
  const submit = (event) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    onSend(body);
    setText("");
  };
  return <div className="message-modal" role="dialog" aria-modal="true" aria-label={`${user.displayName}とのメッセージ`}><style>{messageStyles}</style><div className="message-panel"><div className="message-header"><div><small>DIRECT MESSAGE</small><h2>{user.displayName}</h2><p>@{user.username}</p></div><button className="close-link" onClick={onClose}>× CLOSE</button></div><div className="message-list">{loading ? <p className="muted">メッセージを読み込んでいます…</p> : messages.length ? messages.map((message) => <div className={`message-bubble ${message.isMine || message.senderId === "self" ? "mine" : ""}`} key={message.id}><p>{message.body}</p><small>{new Date(message.createdAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div>) : <p className="muted">まだメッセージはありません。最初の一言を送ってみましょう。</p>}</div><form className="message-form" onSubmit={submit}><input value={text} onChange={(event) => setText(event.target.value)} maxLength="2000" placeholder="メッセージを入力…" disabled={loading || sending} /><button className="primary" type="submit" disabled={!text.trim() || loading || sending}>{sending ? "送信中…" : "送信"}</button></form><small className="message-note">フレンド同士だけがメッセージを送受信できます。</small></div></div>;
}
function GuildPanel({ state, social, guild, guildMembers, onCreateGuild, onJoinGuild, onChangeGuildIcon }) {
  const [query, setQuery] = useState("");
  const mockGuilds = (social.mockGuilds || []).filter((item) => !query || `${item.name} ${item.tag}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="guild-panel">{guild ? <><article className="guild-hero"><span className="guild-icon">{isImageIcon(guild.icon) ? <img src={guild.icon} alt="" /> : guild.icon}</span><div><small>MY GUILD · [{guild.tag}]</small><h2>{guild.name}</h2><p>{guild.description}</p>{(guild.isOwner || !guild.remote) && <label className="secondary tiny-button guild-icon-upload">ICONを変更<input type="file" accept="image/*" onChange={onChangeGuildIcon} className="visually-hidden-input" /></label>}</div></article><div className="guild-metrics"><span>GUILD LEVEL <b>{guild.level}</b></span><span>GUILD EXP <b>{guild.exp}</b></span><span>TOTAL LEVEL <b>{guild.totalLevel}</b></span><span>RANK <b>{guild.rank ? `#${guild.rank}` : "—"}</b></span><span>MY CONTRIBUTION <b>{guild.contribution}</b></span><span>QUEST <b>{guild.questProgress} / 30</b></span></div><div className="guild-progress"><div><span>GUILD QUEST PROGRESS</span><b>{Math.min(100, Math.round((guild.questProgress / 30) * 100))}%</b></div><i><em style={{ width: `${Math.min(100, (guild.questProgress / 30) * 100)}%` }} /></i></div><div className="social-subheading"><span>MEMBERS <b>{guildMembers.length}</b></span></div><div className="guild-members">{guildMembers.map((member) => <div key={member.id}><span className="social-avatar">{member.icon}</span><span><b>{member.displayName}</b><small>@{member.username} · LV.{member.level}</small></span></div>)}</div></> : <><div className="empty-social guild-empty"><h2>MY GUILD</h2><p className="muted">自分だけのGUILDを作るか、仲間のGUILDに参加できます。</p><form className="guild-form" onSubmit={onCreateGuild}><input name="name" placeholder="GUILD NAME" required /><input name="tag" placeholder="TAG (最大8文字)" maxLength="8" required /><input name="description" placeholder="DESCRIPTION" /><div className="guild-form-row"><input name="icon" placeholder="ICON" maxLength="2" /><button className="primary" type="submit">CREATE GUILD</button></div><small className="guild-form-hint">ICONは作成後に写真へ変更できます。</small></form></div><div className="social-subheading"><span>SEARCH GUILD</span></div><input className="guild-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="GUILD NAME または TAG" /><div className="guild-list">{mockGuilds.map((item) => <article className="guild-card" key={item.id}><span className="guild-icon">{isImageIcon(item.icon) ? <img src={item.icon} alt="" /> : item.icon}</span><div><h3>{item.name} <small>[{item.tag}]</small></h3><p>{item.description}</p><small>LV.{item.level} · TOTAL LEVEL {item.totalLevel} · RANK #{item.rank}</small></div><button className="tiny-button" onClick={() => onJoinGuild(item)}>JOIN</button></article>)}</div></>}</div>;
}

function BackupControls({ onExport, onImport }) {
  const inputRef = useRef(null);
  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    onImport(await file.text());
  }
  return <div className="backup-controls"><button className="secondary" type="button" onClick={onExport}>JSONを書き出す</button><button className="secondary" type="button" onClick={() => inputRef.current?.click()}>JSONを復元する</button><input ref={inputRef} type="file" accept="application/json,.json" onChange={handleFileChange} className="visually-hidden-input" /><small>端末変更やSafariのデータ削除に備えて、定期的に保存してください。</small><AccountDeletion /></div>;
}

function AccountDeletion() {
  const [eligible, setEligible] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) throw error;
      if (active) setEligible(Boolean(data.session?.user && !data.session.user.is_anonymous));
    }).catch((error) => console.warn("アカウント状態を確認できませんでした。", error));
    return () => { active = false; };
  }, []);
  if (!eligible) return null;
  async function handleDelete() {
    if (confirmText !== "DELETE" || busy) return;
    setBusy(true);
    try {
      await deleteAccount();
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LOCAL_MODIFIED_KEY);
      localStorage.removeItem("life_rpg_action_queue");
      window.location.reload();
    } catch (error) {
      setBusy(false);
      console.warn("アカウント削除に失敗しました。", error);
    }
  }
  return <div className="account-delete"><small>ACCOUNT DELETION</small><p>正式アカウントとクラウド上の関連データを削除します。この操作は取り消せません。</p><input value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder="DELETE と入力" /><button className="danger full" type="button" disabled={confirmText !== "DELETE" || busy} onClick={handleDelete}>{busy ? "削除中…" : "アカウントを完全削除"}</button></div>;
}
function OpenWorldSyncPanel({ state, status, onCreatePairing, onSync }) {
  const [busy, setBusy] = useState(false);
  const [bundle, setBundle] = useState("");
  const [message, setMessage] = useState("");
  const statusText = status === "ready"
    ? "クラウド同期の準備ができています。"
    : status === "checking"
      ? "同期設定を確認しています…"
      : status === "needs-migration"
        ? "Supabaseに最新のsupabase/schema.sqlを適用してください。"
        : status === "offline"
          ? "クラウドに接続できません。ローカルデータは保持されています。"
          : "Supabase接続が設定されていません。";
  async function handleCreatePairing() {
    setBusy(true);
    setMessage("");
    try {
      setBundle(await onCreatePairing());
      setMessage("GodotのSETTINGSに以下のJSONを貼り付けてください。コードは10分間有効です。");
    } catch (error) {
      setMessage(error?.message || "ペアリングコードを作成できませんでした。");
    } finally {
      setBusy(false);
    }
  }
  async function handleSync() {
    setBusy(true);
    setMessage("");
    try {
      setMessage(await onSync());
    } catch (error) {
      setMessage(error?.message || "同期に失敗しました。");
    } finally {
      setBusy(false);
    }
  }
  return <section className="game-sync-section">
    <div className="eyebrow">OPEN WORLD GAME SYNC</div>
    <h2>Godot版と進行状況を共有</h2>
    <p className="muted">LEVEL / EXP / 所持装備 / 装備中スロットを共有します。ペアリング後はこのアカウントのデータをGodot版と同期します。</p>
    <p className="game-sync-status" role="status">{statusText}</p>
    <div className="game-sync-actions">
      <button className="secondary" type="button" disabled={busy || status !== "ready"} onClick={handleCreatePairing}>{busy ? "処理中…" : "Godotをペアリング"}</button>
      <button className="secondary" type="button" disabled={busy || status !== "ready"} onClick={handleSync}>今すぐ同期</button>
    </div>
    {message && <p className="game-sync-message" role="status">{message}</p>}
    {bundle && <textarea className="game-sync-bundle" aria-label="GodotペアリングJSON" readOnly value={bundle} onFocus={(event) => event.currentTarget.select()} />}
    {bundle && <button className="secondary game-sync-copy" type="button" onClick={async () => { try { await navigator.clipboard.writeText(bundle); setMessage("ペアリングJSONをコピーしました。"); } catch { setMessage("テキスト欄を選択してコピーしてください。"); } }}>JSONをコピー</button>}
    <div className="game-sync-progress">現在 LEVEL {state.level} · EXP {state.exp}<span>{Object.entries(state.equipment || {}).filter(([, itemId]) => itemId).length}枠を装備中</span></div>
    <small className="muted">ペアリングJSONは他人に共有しないでください。コードは一度だけ使用できます。</small>
    <style>{`.game-sync-section{display:grid;gap:10px;border-top:1px solid #292929;margin-top:30px;padding-top:24px}.game-sync-section h2{margin:0}.game-sync-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.game-sync-actions button,.game-sync-copy{font-size:10px;letter-spacing:.06em}.game-sync-actions button:disabled{opacity:.45;cursor:not-allowed}.game-sync-status,.game-sync-message{margin:0;color:#aaa;font-size:12px;line-height:1.7}.game-sync-progress{display:flex;justify-content:space-between;gap:8px;color:#ddd;font-size:12px}.game-sync-progress span{color:#888}.game-sync-bundle{width:100%;min-height:94px;resize:vertical;border:1px solid #444;background:#101010;color:#ddd;padding:10px;font:11px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}.game-sync-copy{width:100%}.game-sync-section>small{font-size:10px}`}</style>
  </section>;
}

function ProfileScreen({ state, editing, setup = {}, setSetup, onEdit, onSave, onAvatarChange, onAvatarRemove, privacy: privacyInput, onPrivacyToggle, notifications: notificationsInput, resetStep, setResetStep, resetText, setResetText, onReset, sound, onSoundChange, version, onExport, onImport, authStatus, onLinkAccount, gameSyncStatus, onCreateGamePairing, onSyncGameProgress }) {
  const privacy = privacyInput && typeof privacyInput === "object" ? privacyInput : {};
  const notifications = Array.isArray(notificationsInput) ? notificationsInput : [];
  const job = state.job;
  const privacyItems = [["publicProfile", "PUBLIC PROFILE"], ["showAge", "SHOW AGE"], ["showRealName", "SHOW REAL NAME"], ["showStats", "SHOW STATS"], ["showAchievements", "SHOW ACHIEVEMENTS"]];
  return <div><div className="eyebrow">ADVENTURER PROFILE</div><h1>プロフィール</h1>{editing ? <form className="profile edit-form" onSubmit={onSave}>{[["name", "名前"], ["age", "年齢"], ["username", "USERNAME"]].map(([key, label]) => <label key={key}>{label}<input value={setup[key]} onChange={(event) => setSetup({ ...setup, [key]: event.target.value })} /></label>)}<button className="primary" type="submit">保存する</button></form> : <><article className="profile"><div className="avatar">{state.profile.avatarUrl ? <img src={state.profile.avatarUrl} alt="プロフィール画像" /> : (job?.icon || "A")}</div><h2>{state.profile.name}</h2><p className="muted">@{state.profile.username} · {state.profile.age}歳</p>{job && <div className="profile-job"><span>{job.icon}</span> {job.name}</div>}<div className="profile-stats"><span>LEVEL <b>{state.level}</b></span><span>行動数 <b>{state.totalActions}</b></span><span>連続日数 <b>{state.streak}日</b></span></div></article><div className="avatar-controls"><label className="secondary avatar-upload">写真を変更<input type="file" accept="image/*" onChange={onAvatarChange} className="visually-hidden-input" /></label>{state.profile.avatarUrl && <button className="secondary" type="button" onClick={onAvatarRemove}>写真を削除</button>}</div><button className="secondary edit-button" onClick={onEdit}>プロフィールを編集</button></>}<section className="sound-section"><div className="eyebrow">SOUND / EXPERIENCE</div><h2>サウンド設定</h2><p className="muted">操作に合わせた控えめなUIサウンドです。iPhoneの消音設定や端末音量も尊重します。</p><button className={"privacy-toggle " + (sound?.enabled ? "on" : "")} onClick={() => onSoundChange("enabled", !sound?.enabled)}><span>{sound?.enabled ? "●" : "○"}</span>SOUND EFFECTS<b>{sound?.enabled ? "ON" : "OFF"}</b></button><label className="volume-control">MASTER VOLUME<input type="range" min="0" max="0.5" step="0.01" value={sound?.volume ?? SOUND_DEFAULTS.volume} onChange={(event) => onSoundChange("volume", Number(event.target.value))} /></label><button className={"privacy-toggle " + (sound?.musicEnabled ? "on" : "")} onClick={() => onSoundChange("musicEnabled", !sound?.musicEnabled)}><span>{sound?.musicEnabled ? "●" : "○"}</span>BGM<b>{sound?.musicEnabled ? "ON" : "OFF"}</b></button><label className="volume-control">BGM VOLUME<input type="range" min="0" max="0.5" step="0.01" value={sound?.musicVolume ?? SOUND_DEFAULTS.musicVolume} onChange={(event) => onSoundChange("musicVolume", Number(event.target.value))} /></label><button className="secondary sound-test" onClick={() => playSound("notification", sound)}>サウンドを試聴</button></section><section className="privacy-section"><div className="eyebrow">SOCIAL PRIVACY</div><h2>公開設定</h2><p className="muted">SOCIALで共有する情報を選択できます。初期設定はすべて非公開です。</p><div className="privacy-list">{privacyItems.map(([key, label]) => <button key={key} className={"privacy-toggle " + (privacy[key] ? "on" : "")} onClick={() => onPrivacyToggle(key)}><span>{privacy[key] ? "●" : "○"}</span>{label}<b>{privacy[key] ? "ON" : "OFF"}</b></button>)}</div></section><section className="notification-section"><div className="eyebrow">SOCIAL NOTIFICATIONS</div><h2>通知</h2>{notifications.length ? <div className="notification-list">{notifications.slice(0, 8).map((item) => <div className={"notification-item " + (item.read ? "read" : "")} key={item.id}><span>◇</span><p>{item.text}<small>{new Date(item.createdAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></p></div>)}</div> : <p className="muted">新しい通知はありません。</p>}</section><section className="data-section"><div className="eyebrow">ACCOUNT / DATA</div><h2>データ</h2><p className="muted">保存されたプロフィール、診断結果、JOB、ステータス、進行状況を管理します。</p>{authStatus?.anonymous && <div className="account-linking"><div className="eyebrow">PROTECT YOUR PROGRESS</div><p className="muted">匿名ユーザーの進行状況を、正式なアカウントへ引き継ぎます。</p><button className="secondary" type="button" onClick={() => onLinkAccount("apple")}>Appleで連携</button><button className="secondary" type="button" onClick={() => onLinkAccount("google")}>Googleで連携</button></div>}<OpenWorldSyncPanel state={state} status={gameSyncStatus} onCreatePairing={onCreateGamePairing} onSync={onSyncGameProgress} /><BackupControls onExport={onExport} onImport={onImport} />{resetStep === 0 && <button className="danger-link" onClick={() => { playSound("reset", sound); setResetStep(1); }}>データをリセット</button>}{resetStep === 1 && <div className="confirm-box"><h3>本当にデータをリセットしますか？</h3><p>プロフィール情報、診断結果、JOB、ステータス、EXP、クエスト進行状況、実績が削除されます。</p><div className="confirm-actions"><button className="secondary" onClick={() => setResetStep(0)}>キャンセル</button><button className="danger" onClick={() => { playSound("reset", sound); setResetStep(2); }}>次へ</button></div></div>}{resetStep === 2 && <div className="confirm-box"><h3>最終確認</h3><p>この操作を実行すると、あなたのLIFE RPGデータは初期状態に戻ります。</p><input value={resetText} onChange={(event) => setResetText(event.target.value)} placeholder="RESET と入力" /><button className="danger full" disabled={resetText !== "RESET"} onClick={onReset}>データを完全にリセット</button></div>}<div className="version">LIFE RPG<br /><span>Version {version}</span></div></section></div>;
}

function UpdateNotice({ visible, onUpdate }) {
  if (!visible) return null;
  return <aside className="update-notice" role="status"><div><small>NEW VERSION AVAILABLE</small><strong>LIFE RPGがアップデートされました。</strong></div><button onClick={onUpdate}>UPDATE</button></aside>;
}

const styles = `*{box-sizing:border-box}html{background:#080808}body{margin:0;background:#080808;color:#f1f1ed;font-family:Inter,system-ui,-apple-system,"Yu Gothic",sans-serif;-webkit-text-size-adjust:100%;overscroll-behavior-y:none}.rpg-app{min-height:100vh;min-height:100svh;max-width:720px;margin:auto;padding-top:env(safe-area-inset-top);background:linear-gradient(180deg,#111 0,#080808 48%)}button,input{font:inherit;color:inherit;cursor:pointer;touch-action:manipulation}button{-webkit-tap-highlight-color:transparent}button:active{transform:scale(.985)}.welcome{position:relative;z-index:1;max-width:540px;margin:auto;padding:13vh 24px 48px}.setup{padding-top:12vh}.brand-mark{width:44px;height:44px;border:1px solid #888;border-radius:50%;display:grid;place-items:center;font-family:Georgia,serif;font-size:25px;margin-bottom:52px}.eyebrow{color:#aaa9a3;font-size:10px;font-weight:700;letter-spacing:.2em}.welcome h1{font-family:Georgia,"Times New Roman",serif;font-size:clamp(32px,8vw,56px);font-weight:400;line-height:1.2;margin:20px 0}.welcome h1 span,h1 span{color:#d8d8d2}.muted{color:#888;line-height:1.8}.setup-form,.edit-form{display:grid;gap:18px;margin-top:42px}.setup-form label,.edit-form label{display:grid;gap:8px;color:#999;font-size:11px;letter-spacing:.12em}.setup-form input,.edit-form input,.confirm-box input{width:100%;border:0;border-bottom:1px solid #474747;background:transparent;padding:12px 2px;outline:0}.setup-form input:focus,.edit-form input:focus,.confirm-box input:focus{border-color:#eee}.primary,.secondary,.danger,.danger-link{border:1px solid #777;background:#eee;color:#111;padding:15px 18px;border-radius:5px;font-weight:700;letter-spacing:.14em}.primary{margin-top:16px;text-align:left}.primary span{float:right}.secondary{background:transparent;color:#ddd;border-color:#444}.diagnosis h1{font-size:34px}.goal-screen h1{font-size:34px}.goal-grid{display:grid;gap:8px;margin:28px 0}.goal-option{padding:13px;text-align:left;border:1px solid #333;background:#121212;border-radius:5px}.goal-option.selected{border-color:#aaa;background:#222}.goal-other{display:grid;gap:8px;color:#999;font-size:11px;letter-spacing:.12em}.goal-other input{border:0;border-bottom:1px solid #474747;background:transparent;padding:12px 2px;outline:0}.result{padding-top:10vh}.result-kicker{color:#999;letter-spacing:.18em;font-size:11px;margin-top:46px}.result-job-icon{font-size:44px;margin-top:28px}.result h1{font-size:42px;margin-top:12px}.result-description{color:#aaa;line-height:1.8}.result-block{border-top:1px solid #333;padding:15px 0}.result-block small{color:#888;letter-spacing:.12em}.result-block p{margin:8px 0 0;color:#ddd}.result-stats{display:grid;grid-template-columns:repeat(6,1fr);border-top:1px solid #333;border-bottom:1px solid #333;padding:16px 0;margin:12px 0 20px;gap:5px}.result-stats span{text-align:center;color:#888;font-size:10px}.result-stats b{display:block;color:#eee;font-size:18px;font-weight:400;margin-top:6px}.progress,.exp-bar,.stat-bar{height:4px;border-radius:9px;background:#262626;overflow:hidden}.progress{margin:36px 0 12px}.progress i,.exp-bar i,.stat-bar i{display:block;height:100%;background:#e5e5df}.diagnosis h2{font-size:22px;font-weight:500;margin:42px 0 20px}.option-grid{display:grid;gap:10px}.option{display:flex;align-items:center;gap:14px;min-height:56px;padding:15px;border:1px solid #343434;background:#121212;border-radius:5px;text-align:left}.option:hover,.action-card:hover{border-color:#999;background:#1b1b1b}.option b{display:grid;place-items:center;width:27px;height:27px;border:1px solid #555;border-radius:50%;color:#ddd}.topbar{display:flex;justify-content:space-between;align-items:center;padding:24px}.topbar strong{display:block;margin-top:8px;font-family:Georgia,serif;font-size:19px;font-weight:400}.topbar strong small{display:block;color:#777;font:10px Inter,sans-serif;margin-top:5px}.level{text-align:right;color:#ddd;font-weight:700}.level small{display:block;color:#777;font-size:10px;font-weight:400;margin-top:5px}.topbar-right{display:grid;gap:8px;justify-items:end}.currency-badge{border:1px solid #444;background:#151515;color:#e8d98a;padding:5px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.04em;white-space:nowrap}.exp-bar{margin:0 24px}.content{padding:34px 24px calc(100px + env(safe-area-inset-bottom))}.section-heading{display:flex;justify-content:space-between;align-items:end;margin-bottom:24px}h1{font-family:Georgia,"Times New Roman",serif;font-size:32px;font-weight:400;margin:8px 0 0}h2{font-weight:400}.streak{text-align:right;color:#777;font-size:11px}.streak b{display:block;color:#ddd;font-size:20px;margin-top:4px}.job-banner{display:flex;gap:17px;align-items:center;border:1px solid #555;background:#151515;padding:19px;margin-bottom:18px}.job-banner>span{font-size:35px;color:#eee}.job-banner small{color:#888;letter-spacing:.16em}.job-banner strong{display:block;font-family:Georgia,serif;font-size:25px;margin:5px 0}.job-banner p{color:#999;font-size:12px;margin:0}.job-exp{height:3px;background:#333;margin:12px 0 6px}.job-exp i{display:block;height:100%;background:#eee}.goal-tags{display:flex;flex-wrap:wrap;gap:6px;margin:18px 0}.goal-tags span{border:1px solid #444;padding:6px 9px;color:#aaa;font-size:10px}.today-quest{border:1px solid #777;background:#151515;padding:20px;margin:24px 0}.today-quest small{color:#aaa;letter-spacing:.14em}.today-quest h2{font-family:Georgia,serif;font-size:23px;margin:16px 0 8px}.today-quest>span{color:#aaa;font-size:11px}.today-quest button{display:block;width:100%;margin-top:18px;padding:12px;border:1px solid #999;background:#eee;color:#111;font-weight:700;letter-spacing:.12em}.action-heading{display:flex;justify-content:space-between;align-items:center;margin:24px 0 12px;color:#aaa;font-size:11px;letter-spacing:.12em}.action-heading b{color:#eee}.action-heading button{border:0;background:transparent;color:#aaa;font-size:10px;letter-spacing:.1em}.create-action{border-top:1px solid #292929;margin-top:34px;padding-top:24px}.create-action>input{width:100%;border:0;border-bottom:1px solid #474747;background:transparent;padding:13px 2px;outline:0;margin:12px 0}.create-row{display:flex;gap:8px}.create-row select{flex:1;border:1px solid #444;background:#151515;padding:10px;color:#eee}.create-row button{border:1px solid #aaa;background:#eee;color:#111;padding:10px;font-size:10px;font-weight:700}
.stat-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.stat-card,.profile,.quest,.skill,.action-card{border:1px solid #292929;background:#121212;border-radius:6px}.stat-card{padding:15px}.stat-title{display:flex;align-items:center;gap:8px}.stat-title span{font-size:12px;font-weight:800}.stat-title b{font-size:12px;color:#aaa}.stat-title strong{margin-left:auto;font-size:24px;font-weight:400}.stat-bar{margin:16px 0 9px;height:3px}.stat-card small,.action-card small,.quest small,.skill small{display:block;color:#777;font-size:11px}.action-list,.quest-list,.skill-grid{display:grid;gap:10px;margin-top:24px}.action-card{display:flex;align-items:center;gap:15px;min-height:60px;padding:12px 15px;text-align:left}.action-icon{display:grid;place-items:center;width:40px;height:40px;border:1px solid #444;color:#ddd;font-size:18px}.action-card b{display:block;margin-bottom:5px;font-weight:500}.action-card strong{margin-left:auto;color:#ccc;font-size:22px}.quest,.skill{display:flex;align-items:center;gap:15px;padding:17px}.quest>span{font-size:22px;color:#666}.quest.done{border-color:#52645a}.quest.done>span{color:#c5d7c9}.quest b,.skill b{display:block;margin-bottom:5px;font-weight:500}.skill-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.skill{padding:13px}.skill>span{font-size:20px}.skill:not(.unlocked){opacity:.48}.profile{text-align:center;padding:30px;margin-top:25px}.avatar{display:grid;place-items:center;width:72px;height:72px;margin:auto;border:1px solid #999;border-radius:50%;font-family:Georgia,serif;font-size:29px;overflow:hidden;background:#171717}.avatar img{width:100%;height:100%;object-fit:cover}.avatar-controls{display:flex;justify-content:center;gap:8px;margin-top:12px}.avatar-upload{display:inline-flex;align-items:center;cursor:pointer;margin:0}.visually-hidden-input{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.profile h2{margin:18px 0 5px}.profile-job{display:inline-block;border:1px solid #555;padding:8px 18px;margin-top:12px;color:#ddd}.profile-stats{display:flex;justify-content:space-around;border-top:1px solid #333;margin-top:24px;padding-top:20px;color:#777;font-size:11px}.profile-stats b{display:block;color:#eee;font-size:22px;margin-top:7px;font-weight:400}.edit-button{display:block;width:100%;margin-top:12px}.data-section{border-top:1px solid #292929;margin-top:42px;padding-top:28px}.data-section h2{margin:10px 0}.danger-link{margin-top:15px;background:transparent;color:#c9a9a9;border-color:#614b4b}.confirm-box{border:1px solid #614b4b;padding:18px;margin-top:18px}.confirm-box h3{font-size:17px;font-weight:500;margin-top:0}.confirm-box p{color:#999;font-size:13px;line-height:1.8}.confirm-box input{margin:8px 0 16px}.confirm-actions{display:flex;gap:10px}.confirm-actions>*{flex:1}.danger{background:#8c6060;border-color:#8c6060;color:#fff}.danger:disabled{opacity:.35;cursor:not-allowed}.full{width:100%}.version{color:#666;font-size:10px;letter-spacing:.12em;line-height:1.8;text-align:center;margin-top:42px;padding-top:20px;border-top:1px solid #292929}.version span{color:#888}.notice{position:fixed;z-index:2;left:50%;top:calc(20px + env(safe-area-inset-top));transform:translateX(-50%);padding:12px 18px;background:#eee;color:#111;border-radius:999px;font-size:12px;white-space:nowrap}.update-notice{position:fixed;z-index:5;right:16px;bottom:calc(84px + env(safe-area-inset-bottom));left:16px;display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px 16px;border:1px solid #555;background:#151515;color:#eee;box-shadow:0 12px 34px #000b}.update-notice small{display:block;color:#999;font-size:9px;letter-spacing:.14em}.update-notice strong{display:block;margin-top:6px;font-size:12px;font-weight:400}.update-notice button{flex:none;border:1px solid #aaa;background:#eee;color:#111;padding:10px 13px;font-size:10px;font-weight:700;letter-spacing:.1em}.nav{position:fixed;z-index:1;bottom:0;left:50%;transform:translateX(-50%);display:flex;width:min(720px,100%);justify-content:space-around;padding:10px 8px calc(10px + env(safe-area-inset-bottom));background:#101010ee;border-top:1px solid #292929;backdrop-filter:blur(12px)}.nav button{border:0;background:transparent;color:#666;font-size:9px;letter-spacing:.08em;min-width:52px;min-height:44px}.nav button span{display:block;font-size:17px;margin-bottom:4px}.nav button.active{color:#eee}@media(max-width:480px){.content{padding-left:16px;padding-right:16px}.topbar{padding-left:16px;padding-right:16px}.exp-bar{margin-left:16px;margin-right:16px}.stat-grid{gap:8px}.stat-card{padding:12px}.skill-grid{grid-template-columns:1fr}.result-stats{grid-template-columns:repeat(3,1fr);row-gap:14px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{transition-duration:.01ms!important;animation-duration:.01ms!important}}.social-title-row{display:flex;justify-content:space-between;align-items:start}.notification-count{display:grid;place-items:center;min-width:18px;height:18px;border:1px solid #aaa;border-radius:50%;color:#eee;font-size:9px}.social-tabs,.ranking-tabs{display:flex;gap:4px;overflow-x:auto;border-bottom:1px solid #292929;margin:25px 0 22px}.social-tabs button,.ranking-tabs button{border:0;border-bottom:2px solid transparent;background:transparent;color:#777;padding:11px 12px;font-size:10px;font-weight:700;letter-spacing:.1em;white-space:nowrap}.social-tabs button.active,.ranking-tabs button.active{color:#eee;border-color:#eee}.social-panel,.guild-panel,.ranking-panel{display:grid;gap:18px}.social-search,.guild-search{display:grid;gap:8px;color:#999;font-size:10px;font-weight:700;letter-spacing:.15em}.social-search input,.guild-search{width:100%;border:1px solid #333;background:#121212;padding:13px;outline:0}.social-search input:focus,.guild-search:focus{border-color:#999}.social-results,.social-list,.guild-list,.ranking-list{display:grid;gap:8px}.social-subheading{border-top:1px solid #292929;padding-top:20px;color:#999;font-size:10px;letter-spacing:.14em}.social-subheading b{color:#eee;margin-left:4px}.social-user{display:flex;align-items:center;gap:8px;border:1px solid #292929;background:#121212;padding:10px}.social-user-main{display:flex;align-items:center;gap:11px;flex:1;border:0;background:transparent;text-align:left}.social-user-main b,.social-user-main small{display:block}.social-user-main b{font-weight:500}.social-user-main small{color:#777;font-size:10px;margin-top:4px}.social-avatar{display:grid;place-items:center;flex:none;width:38px;height:38px;border:1px solid #666;border-radius:50%;font-family:Georgia,serif}.social-avatar.large{width:58px;height:58px;font-size:24px}.social-user-actions{display:flex;gap:4px;align-items:center}.tiny-button{border:1px solid #888;background:#eee;color:#111;padding:8px 9px;font-size:9px;font-weight:700;letter-spacing:.08em;white-space:nowrap}.tiny-button.ghost{background:transparent;color:#ccc;border-color:#555}.tiny-button:disabled{opacity:.45}.request-pending{color:#777;font-size:9px;letter-spacing:.1em}.empty-social{border:1px dashed #444;color:#777;padding:24px;text-align:center;line-height:1.8}.social-profile{border:1px solid #555;background:#151515;padding:18px}.close-link{display:block;margin-left:auto;border:0;background:transparent;color:#888;font-size:10px}.social-profile-head{display:flex;align-items:center;gap:15px;margin:12px 0}.social-profile-head h2{margin:0}.social-profile-head p{margin:5px 0 0}.social-profile-meta,.guild-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;border-top:1px solid #333;padding-top:17px;color:#777;font-size:9px;letter-spacing:.08em}.social-profile-meta b,.guild-metrics b{display:block;color:#eee;font-size:16px;font-weight:400;margin-top:6px}.social-profile-actions{display:flex;gap:6px;margin-top:18px}.social-profile-actions>*{flex:1;padding:10px 5px;font-size:9px}.compare-grid{display:grid;gap:8px;margin-top:18px;border-top:1px solid #333;padding-top:15px}.compare-grid>div{display:grid;grid-template-columns:38px 30px 1fr 32px;align-items:center;gap:7px}.compare-grid small,.compare-grid em{color:#888;font-size:10px;font-style:normal}.compare-grid span{color:#eee;font-size:11px}.compare-grid i{height:4px;background:#eee;display:block}.compare-grid em{color:#ddd;text-align:right}.guild-hero{display:flex;align-items:center;gap:16px;border:1px solid #666;background:#151515;padding:20px}.guild-icon{display:grid;place-items:center;width:48px;height:48px;border:1px solid #888;font-family:Georgia,serif;font-size:25px;flex:none;overflow:hidden;border-radius:6px}.guild-icon img{width:100%;height:100%;object-fit:cover}.guild-icon-upload{display:inline-flex;margin-top:10px}.guild-hero small{color:#999;letter-spacing:.12em}.guild-hero h2{margin:5px 0;font-family:Georgia,serif}.guild-hero p{color:#999;font-size:11px;margin:0;line-height:1.6}.guild-metrics{grid-template-columns:repeat(2,1fr);border:1px solid #292929;padding:15px}.guild-progress{border-top:1px solid #292929;padding-top:15px}.guild-progress>div{display:flex;justify-content:space-between;color:#999;font-size:9px;letter-spacing:.12em}.guild-progress i{display:block;height:4px;background:#292929;margin-top:10px}.guild-progress em{display:block;height:100%;background:#eee}.guild-members{display:grid;gap:7px}.guild-members>div{display:flex;align-items:center;gap:10px;padding:9px;border-bottom:1px solid #222}.guild-members b,.guild-members small{display:block}.guild-members b{font-weight:500}.guild-members small{color:#777;font-size:10px;margin-top:3px}.guild-empty{text-align:left}.guild-empty h2{margin-top:0}.guild-form{display:grid;gap:9px;text-align:left;margin-top:20px}.guild-form-hint{color:#777;font-size:9px;letter-spacing:.05em}.guild-form input{border:0;border-bottom:1px solid #444;background:transparent;padding:11px 2px;outline:0}.guild-form-row{display:flex;gap:8px}.guild-form-row input{flex:1}.guild-form-row .primary{margin:0;padding:11px;font-size:9px}.guild-card{display:flex;align-items:center;gap:12px;border:1px solid #333;padding:12px}.guild-card>div{flex:1}.guild-card h3{font-size:14px;font-weight:500;margin:0}.guild-card h3 small{color:#888;font-size:10px}.guild-card p{color:#999;font-size:10px;margin:5px 0}.guild-card>div>small{color:#777;font-size:9px}.ranking-tabs{margin-top:0}.ranking-row{display:flex;align-items:center;gap:10px;border-bottom:1px solid #292929;padding:12px 4px}.ranking-row>strong{width:25px;color:#777;font-size:12px}.ranking-row>span:nth-of-type(2){flex:1}.ranking-row b,.ranking-row small{display:block}.ranking-row b{font-weight:500}.ranking-row small{color:#777;font-size:10px;margin-top:4px}.ranking-row em{color:#aaa;font-style:normal;font-size:10px;white-space:nowrap}.ranking-row.me{border-color:#999;background:#171717;padding-left:8px}.ranking-row.me>strong,.ranking-row.me em{color:#eee}.ranking-note{border:1px solid #444;padding:14px;color:#999;font-size:11px}.ranking-note b{color:#eee;font-size:18px;margin:0 4px}.privacy-section,.notification-section{border-top:1px solid #292929;margin-top:42px;padding-top:28px}.privacy-section h2,.notification-section h2{margin:10px 0}.privacy-list{display:grid;gap:7px}.privacy-toggle{display:flex;align-items:center;gap:10px;border:1px solid #333;background:#121212;padding:13px;text-align:left;color:#aaa;font-size:10px;letter-spacing:.1em}.privacy-toggle span{font-size:15px;color:#777}.privacy-toggle b{margin-left:auto;color:#666;font-size:9px}.privacy-toggle.on{border-color:#888;color:#eee}.privacy-toggle.on span,.privacy-toggle.on b{color:#eee}.notification-list{display:grid;gap:7px}.notification-item{display:flex;gap:10px;border-bottom:1px solid #292929;padding:10px 0}.notification-item>span{color:#ccc}.notification-item p{margin:0;font-size:12px;line-height:1.5}.notification-item small{display:block;color:#777;font-size:9px;margin-top:4px}.notification-item.read{opacity:.55}.dungeon-screen{display:grid;gap:14px}.dungeon-tickets{font-size:11px;color:#aaa;text-align:right}.dungeon-floor-list{display:grid;gap:8px;margin-top:6px}.dungeon-floor{display:flex;align-items:center;gap:10px;border:1px solid #292929;padding:10px 12px;border-radius:8px}.dungeon-floor.boss{border-color:#8a3333}.dungeon-floor.cleared{opacity:.72}.dungeon-floor.locked{opacity:.4}.dungeon-floor-icon{font-size:22px;width:38px;height:38px;text-align:center;flex:none;display:grid;place-items:center;overflow:hidden;border-radius:8px;position:relative;border:1px solid #3a3a3a}.dungeon-floor-icon img{width:100%;height:100%;object-fit:cover}.dungeon-floor-lock{position:absolute;inset:0;display:grid;place-items:center;background:rgba(6,6,6,.72);font-size:14px}.dungeon-floor-badge{position:absolute;top:-4px;right:-4px;display:grid;place-items:center;width:16px;height:16px;border-radius:50%;background:#eee;color:#111;font-size:9px;font-weight:700;box-shadow:0 0 0 2px #101010}.dungeon-floor-info{flex:1;display:grid;gap:2px}.dungeon-floor-info small{color:#999}.dungeon-shop{margin-top:26px;border-top:1px solid #292929;padding-top:22px}.dungeon-shop .section-heading{margin-bottom:14px;align-items:center}.dungeon-shop .section-heading h2{margin:4px 0 0;font-family:Georgia,serif;font-size:20px}.dungeon-shop-list{display:grid;gap:8px}.dungeon-shop-item{display:flex;align-items:center;gap:12px;border:1px solid #292929;background:#121212;border-radius:8px;padding:12px}.dungeon-shop-icon{font-size:22px;flex:none;width:36px;text-align:center}.dungeon-shop-info{flex:1;display:grid;gap:2px}.dungeon-shop-info b{font-weight:500}.dungeon-shop-info small{color:#888;font-size:10px;line-height:1.5}.dungeon-shop-stock{color:#aaa!important}.dungeon-shop-item button{white-space:nowrap;padding:10px 12px;font-size:10px}.dungeon-battle{display:grid;gap:10px;position:relative;padding:0;border-radius:12px;overflow:hidden;border:1px solid #23301f;box-shadow:0 14px 40px rgba(0,0,0,.6)}.dungeon-battle.result{text-align:center;gap:14px;padding:14px;background:radial-gradient(120% 140% at 50% -10%,#1c2a22 0,#0d1310 55%,#070a08 100%)}.dungeon-scene{position:relative;height:200px;overflow:hidden;border-bottom:1px solid #1a1a1a}.dungeon-scene-sky{position:absolute;inset:0;background:linear-gradient(180deg,#7fb2d9 0%,#bcdcec 45%,#cfe6c9 62%,#8fbf7a 100%)}.dungeon-scene-clouds{position:absolute;inset:0 0 auto 0;height:70%;background:radial-gradient(60px 20px at 20% 25%,rgba(255,255,255,.85),transparent 70%),radial-gradient(80px 24px at 55% 15%,rgba(255,255,255,.75),transparent 70%),radial-gradient(70px 22px at 85% 30%,rgba(255,255,255,.7),transparent 70%)}.dungeon-scene-mountains{position:absolute;left:0;right:0;bottom:32%;height:46%;background:linear-gradient(160deg,#9aa8b8 0%,#7e8fa3 55%,#65788e 100%);clip-path:polygon(0% 100%,8% 45%,18% 70%,30% 20%,42% 60%,55% 15%,68% 55%,80% 25%,92% 65%,100% 40%,100% 100%)}.dungeon-scene-field{position:absolute;left:0;right:0;bottom:0;height:34%;background:linear-gradient(180deg,#7fae5c 0%,#5f9048 60%,#4d7a3a 100%)}.dungeon-enemy{position:absolute;left:10%;bottom:10%;display:grid;justify-items:center;gap:4px;text-align:center}.dungeon-battle-portrait{width:120px;height:120px;object-fit:cover;border-radius:12px;border:2px solid rgba(0,0,0,.35);box-shadow:0 12px 26px rgba(0,0,0,.5);background:#0006}.dungeon-enemy-name{background:rgba(10,10,10,.55);color:#fff;font-size:11px;padding:2px 8px;border-radius:10px;white-space:nowrap}.dungeon-enemy-name em{margin-left:6px;color:#ffb0b0;font-size:9px;border:1px solid rgba(255,255,255,.4);padding:1px 5px;border-radius:8px}.dungeon-enemy-hp{width:100px;height:8px;background:rgba(0,0,0,.4);border:1px solid rgba(0,0,0,.5);border-radius:6px;overflow:hidden}.dungeon-enemy-hp i{display:block;height:100%;background:#7cb88f;transition:width .25s ease}.dungeon-log{position:relative;background:#141414;border:1px solid #262626;margin:0 12px;border-radius:8px;padding:8px 10px;font-size:11px;display:grid;gap:3px;min-height:44px;color:#ccc}.dungeon-hud{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 12px 12px}.dungeon-player-card{display:flex;align-items:center;gap:10px;border:1px solid #333;background:#141414;border-radius:8px;padding:10px}.dungeon-player-face{display:grid;place-items:center;flex:none;width:44px;height:44px;border-radius:50%;border:1px solid #666;overflow:hidden;font-family:Georgia,serif;font-size:18px;background:#1a1a1a}.dungeon-player-face img{width:100%;height:100%;object-fit:cover}.dungeon-player-info{flex:1;display:grid;gap:3px}.dungeon-player-info b{font-size:12px;font-weight:500}.dungeon-player-info small{color:#999;font-size:9px}.dungeon-hp-bar{height:8px;background:#1c1c1c;border-radius:6px;overflow:hidden}.dungeon-hp-bar i{display:block;height:100%;background:#c66;transition:width .25s ease}.dungeon-hp-bar.player i{background:#7cb88f}.dungeon-command-panel{display:grid;grid-template-columns:repeat(2,1fr);gap:6px;align-content:start;position:relative}.dungeon-command-panel button{border:1px solid #3a4a3a;background:#182018;color:#dfe8df;padding:9px 4px;font-size:10px;border-radius:6px}.dungeon-item-menu{position:absolute;left:0;right:0;bottom:calc(100% + 8px);display:grid;gap:6px;background:#101410ee;border:1px solid #3a4a3a;border-radius:8px;padding:8px;backdrop-filter:blur(8px);z-index:2}.dungeon-item-menu button{border:1px solid #3a4a3a;background:#182018;color:#dfe8df;padding:9px 8px;font-size:11px;border-radius:6px;text-align:left}.dungeon-item-menu button:disabled{opacity:.4}.dungeon-item-cancel{background:transparent!important;color:#999!important;text-align:center!important}.dungeon-command-panel button:disabled{opacity:.4}.dungeon-timing{grid-column:1/-1;display:grid;gap:10px;justify-items:center}.timing-track{position:relative;width:100%;height:26px;margin-top:-6px;background:#241414;border:1px solid #262626;border-radius:6px;overflow:hidden}.timing-zone{position:absolute;top:0;height:100%}.timing-zone.good{left:28%;width:44%;background:rgba(214,178,90,.32)}.timing-zone.perfect{left:41%;width:18%;background:rgba(124,184,143,.55);animation:dungeonZonePulse .5s ease-in-out infinite alternate}@keyframes dungeonZonePulse{from{box-shadow:0 0 0 rgba(124,184,143,0)}to{box-shadow:0 0 12px rgba(124,184,143,.9)}}.timing-marker{position:absolute;top:2px;width:5px;height:22px;border-radius:2px;background:#f1f1ed;box-shadow:0 0 6px rgba(241,241,237,.7);left:0;animation:dungeonTimingMove 1.4s cubic-bezier(.45,0,.55,1) infinite alternate}.timing-marker::before{content:"";position:absolute;inset:-3px -4px;border-radius:4px;animation:dungeonMarkerPulse .35s ease-in-out infinite alternate}.timing-marker::after{content:"";position:absolute;top:0;left:-3px;width:5px;height:100%;border-radius:2px;background:linear-gradient(180deg,rgba(241,241,237,.5),transparent);filter:blur(2px)}@keyframes dungeonTimingMove{from{left:0}to{left:calc(100% - 5px)}}@keyframes dungeonMarkerPulse{from{box-shadow:0 0 4px rgba(241,241,237,.5)}to{box-shadow:0 0 14px rgba(241,241,237,1)}}.timing-button{width:100%}.dungeon-hit-effect{position:absolute;top:4px;right:10px;font-weight:700;font-size:16px;letter-spacing:.05em;pointer-events:none;animation:dungeonHitPop .6s ease-out forwards}.dungeon-hit-effect.perfect{color:#7cb88f;text-shadow:0 0 10px rgba(124,184,143,.8)}.dungeon-hit-effect.good{color:#d6b25a;text-shadow:0 0 8px rgba(214,178,90,.6)}.dungeon-hit-effect.miss{color:#c66;text-shadow:0 0 8px rgba(204,102,102,.5)}@keyframes dungeonHitPop{0%{opacity:0;transform:scale(.4) translateY(6px)}30%{opacity:1;transform:scale(1.15) translateY(0)}100%{opacity:0;transform:scale(1) translateY(-14px)}}.cmd-icon{margin-right:6px;font-size:13px}.dungeon-floor.tier-early{border-color:#3f7a52}.dungeon-floor.tier-early .dungeon-floor-icon{border-color:#3f7a52}.dungeon-floor.tier-mid{border-color:#b9762e}.dungeon-floor.tier-mid .dungeon-floor-icon{border-color:#b9762e}.dungeon-floor.tier-late{border-color:#9c3a3a}.dungeon-floor.tier-late .dungeon-floor-icon{border-color:#9c3a3a}.dungeon-floor.tier-boss{border-color:#c9a227;background:linear-gradient(135deg,#1c1808,#121212)}.dungeon-floor.tier-boss .dungeon-floor-icon{border-color:#c9a227;box-shadow:0 0 10px rgba(201,162,39,.5)}.dungeon-battle.tier-early{border-color:#2f4f3a}.dungeon-battle.tier-early .dungeon-battle-portrait{border-color:#3f7a52;box-shadow:0 10px 30px rgba(0,0,0,.5),0 0 24px rgba(63,122,82,.5)}.dungeon-battle.tier-early .dungeon-enemy-hp i{background:#7cb88f}.dungeon-battle.tier-mid{border-color:#4d3a1f}.dungeon-battle.tier-mid .dungeon-battle-portrait{border-color:#b9762e;box-shadow:0 10px 30px rgba(0,0,0,.5),0 0 24px rgba(185,118,46,.5)}.dungeon-battle.tier-mid .dungeon-enemy-hp i{background:#d6a24f}.dungeon-battle.tier-late{border-color:#4a2323}.dungeon-battle.tier-late .dungeon-battle-portrait{border-color:#9c3a3a;box-shadow:0 10px 30px rgba(0,0,0,.5),0 0 26px rgba(156,58,58,.55)}.dungeon-battle.tier-late .dungeon-enemy-hp i{background:#d17b7b}.dungeon-battle.tier-boss{border-color:#6b551a}.dungeon-battle.tier-boss .dungeon-battle-portrait{border-color:#c9a227;box-shadow:0 10px 30px rgba(0,0,0,.5),0 0 30px rgba(201,162,39,.6)}.dungeon-battle.tier-boss .dungeon-enemy-hp i{background:#e0be3f}.dungeon-battle.tier-boss .dungeon-enemy-name em{color:#e0be3f;border-color:#c9a227}.dungeon-battle.result.tier-early .eyebrow{color:#7cb88f}.dungeon-battle.result.tier-mid .eyebrow{color:#d6a24f}.dungeon-battle.result.tier-late .eyebrow{color:#d17b7b}.dungeon-battle.result.tier-boss .eyebrow{color:#e0be3f}.dungeon-battle.result.lost{border-color:#4a2323}@media(max-width:480px){.social-user-actions{flex-wrap:wrap}.social-user-actions .tiny-button{padding:7px 6px}.social-profile-meta{gap:4px}.guild-metrics{gap:8px}.social-tabs button,.ranking-tabs button{padding-left:8px;padding-right:8px}.dungeon-scene{height:160px}.dungeon-battle-portrait{width:88px;height:88px}.dungeon-enemy-hp{width:80px}.dungeon-hud{grid-template-columns:1fr}.dungeon-player-card{padding:8px}.dungeon-player-face{width:38px;height:38px;font-size:15px}.dungeon-command-panel{grid-template-columns:repeat(2,1fr)}.dungeon-command-panel button{padding:11px 4px;font-size:11px}.nav{padding-left:2px;padding-right:2px}.nav button{min-width:0;font-size:8px;padding:0 2px}.shop-screen .dungeon-shop-item{flex-wrap:wrap}}
:root{--gold:#cbb26a;--gold-soft:#e8d9a6;--amethyst:#9b8fd1;--ink:#0a0a10;--ink-2:#141420;--border-soft:rgba(203,178,106,.22);--border-arcane:rgba(155,143,209,.24)}.shop-next-goal{border:1px solid var(--border-soft);background:linear-gradient(135deg,rgba(203,178,106,.08),rgba(155,143,209,.06));border-radius:8px;padding:12px 14px;margin:14px 0}.shop-next-goal>small{color:var(--amethyst);letter-spacing:.14em;font-size:9px}.shop-next-goal-row{display:flex;align-items:center;gap:10px;margin-top:6px}.shop-next-goal-icon{font-size:22px;flex:none;width:32px;text-align:center}.shop-next-goal-row b{display:block;font-size:13px}.shop-next-goal-row small{color:#999}.shop-next-goal-bar{margin-top:8px;height:3px;background:#221d13;border-radius:2px;overflow:hidden}.shop-next-goal-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--amethyst),var(--gold-soft))}.shop-item-remaining{width:100%;color:var(--gold,#cbb26a)!important;font-size:9px;letter-spacing:.04em}
html{background:var(--ink)}
body{background:radial-gradient(120% 90% at 50% -10%,#1c1a2c 0,#0a0a10 55%,#08080c 100%)}
.rpg-app{background:linear-gradient(180deg,#141420 0,#0a0a10 55%)}
.brand-mark{border-color:var(--border-soft);color:var(--gold-soft)}
.eyebrow{color:var(--amethyst)}
h1,.welcome h1{text-shadow:0 0 22px rgba(203,178,106,.12)}
.muted{color:#9d97ab}
.primary{background:linear-gradient(135deg,var(--gold-soft),var(--gold));border-color:var(--gold);color:#181208}
.secondary{border-color:var(--border-arcane);color:#e4e1f5}
.tiny-button{border-color:var(--border-arcane);background:linear-gradient(145deg,#191725,#111119);color:#e7e2f1;min-height:36px;display:inline-flex;align-items:center;justify-content:center}
.tiny-button.ghost{background:transparent;color:#c4bfd2;border-color:var(--border-arcane)}
.tiny-button:disabled{background:#131118;color:#777}
.notice{border:1px solid var(--border-soft);background:linear-gradient(135deg,#1c1730,#121018);color:var(--gold-soft);box-shadow:0 10px 28px #000a}
.create-row button{border-color:var(--border-arcane);background:linear-gradient(145deg,#191725,#111119);color:#e7e2f1}
.message-bubble.mine{background:linear-gradient(135deg,var(--gold-soft),var(--gold));color:#181208;border-color:var(--gold)}
.update-notice button{border-color:var(--gold);background:linear-gradient(135deg,var(--gold-soft),var(--gold));color:#181208}
.progress i,.exp-bar i,.stat-bar i,.job-exp i{background:linear-gradient(90deg,var(--amethyst),var(--gold-soft))}
.topbar{border-bottom:1px solid var(--border-soft)}
.level,.streak b{color:var(--gold-soft)}
.currency-badge{border-color:var(--border-soft);background:linear-gradient(135deg,#1a1630,#121018);color:var(--gold-soft)}
.stat-card,.profile,.quest,.skill,.action-card,.option,.goal-option,.result-block,.job-banner,.today-quest,.create-action{border-color:var(--border-arcane)}
.option:hover,.action-card:hover{border-color:var(--gold)}
.goal-option.selected{border-color:var(--gold);background:#181428}
.job-banner{border-color:var(--border-soft);background:linear-gradient(135deg,#161228,#0f0e18)}
.job-banner>span{color:var(--gold-soft)}
.today-quest{border-color:var(--border-soft);background:linear-gradient(135deg,#161228,#0f0e18)}
.today-quest button{background:linear-gradient(135deg,var(--gold-soft),var(--gold));border-color:var(--gold);color:#181208}
.result-stats,.diagnosis h2 + .option-grid,.exp-bar{border-color:var(--border-arcane)}
.stat-title b{color:var(--amethyst)}
.nav{background:#100e18ee;border-top:1px solid var(--border-arcane)}
.nav button.active{color:var(--gold-soft)}
.quest.done span,.skill.unlocked span{color:var(--gold-soft)!important}
.dungeon-shop-item,.dungeon-item-menu{border-color:var(--border-arcane)}
.dungeon-shop-item button:not(:disabled){border-color:var(--gold);background:linear-gradient(135deg,var(--gold-soft),var(--gold));color:#181208}
.shop-tabs{display:flex;gap:8px;margin:18px 0}
.shop-tabs button{flex:1;border:1px solid var(--border-arcane,#444);background:transparent;color:#aaa;padding:11px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:.1em}
.shop-tabs button.active{background:linear-gradient(135deg,var(--gold-soft),var(--gold));border-color:var(--gold);color:#181208}
.equip-slot-group{margin-bottom:22px}
.equip-slot-header{color:#999;font-size:11px;letter-spacing:.14em;margin-bottom:8px}
.equip-item.equipped{border-color:var(--gold);background:linear-gradient(135deg,#1c1730,#151220)}
.equip-badge{display:inline-block;margin-left:8px;font-size:9px;letter-spacing:.08em;color:#181208;background:var(--gold-soft);padding:2px 6px;border-radius:9px;vertical-align:middle}
.equip-summary{display:grid;gap:12px;border:1px solid var(--border-arcane,#333);border-radius:6px;background:#121212;padding:15px;margin-bottom:18px}
.equip-summary-combat{display:flex;flex-wrap:wrap;gap:14px;color:var(--gold-soft);font-weight:700;font-size:13px}
.equip-summary-slots{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.equip-summary-slot{display:grid;gap:4px}
.equip-summary-slot b{font-size:12px;font-weight:500;color:#ddd}
.rarity-badge{display:inline-block;margin-left:8px;font-size:8px;letter-spacing:.06em;border:1px solid;padding:1px 5px;border-radius:8px;vertical-align:middle;font-weight:700}
.notice{white-space:pre-line;text-align:center;max-width:86vw;border-radius:16px;line-height:1.6}
.mc-panel{display:flex;align-items:stretch;gap:14px;border:2px solid #3a3a44;background:linear-gradient(180deg,#1b1a24,#131218);border-radius:8px;padding:14px;margin-bottom:16px}
.mc-equip-col{display:flex;flex-direction:column;gap:8px;justify-content:center}
.mc-view-box{flex:1;display:grid;place-items:center;border:2px solid #3a3a44;background:repeating-conic-gradient(#17161f 0 25%,#1e1d28 0 50%) 0 0/24px 24px;border-radius:6px;min-height:120px}
.mc-view-silhouette{font-size:44px;color:#eee}
.mc-craft-box{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px}
.mc-craft-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:4px}
.mc-craft-cell{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:44px;height:44px;border:2px solid #4a4a56;background:#232230;border-radius:4px;font-size:9px;color:#888}
.mc-craft-cell b{color:var(--gold-soft,#e8d98a);font-size:13px;font-weight:700}
.mc-craft-arrow{color:#777;font-size:16px}
.mc-craft-result{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:44px;height:44px;border:2px solid var(--gold,#cbb26a);background:#232230;border-radius:4px;font-size:9px;color:#888}
.mc-craft-result b{color:var(--gold-soft,#e8d98a);font-size:15px;font-weight:700}
.mc-grid{display:grid;grid-template-columns:repeat(9,1fr);gap:6px;border:2px solid #3a3a44;background:#131218;border-radius:8px;padding:10px}
.mc-hotbar{margin-top:12px}
.mc-slot{position:relative;aspect-ratio:1;border:2px solid #4a4a56;background:#232230;border-radius:4px;display:grid;place-items:center;font-size:20px;padding:0}
.mc-slot.empty{border-style:inset;background:#1b1a24;opacity:.55}
.mc-slot.filled{cursor:pointer}
.mc-slot.filled:hover,.mc-slot.selected{border-color:var(--gold,#cbb26a)}
.mc-slot.equipped{box-shadow:inset 0 0 0 2px var(--gold-soft,#e8d98a)}
.mc-slot-label{font-size:8px;color:#777;letter-spacing:.05em;text-align:center;padding:0 2px}
.mc-slot-count{position:absolute;right:3px;bottom:1px;font-size:10px;font-style:normal;font-weight:700;color:#fff;text-shadow:1px 1px 0 #000}
.mc-detail{display:flex;align-items:center;justify-content:space-between;gap:14px;border:2px solid #3a3a44;background:#1b1a24;border-radius:8px;padding:12px 14px;margin-top:12px}
.mc-detail-head{display:flex;align-items:center;gap:12px}
.mc-detail-head>span{font-size:26px}
.mc-detail-head small{display:block;margin-top:2px;font-size:11px}
.mc-detail button{white-space:nowrap}
.coop-panel{display:grid;gap:12px;border:1px solid #3e3e3e;background:#131313;padding:16px;margin:20px 0}.coop-panel>b,.coop-panel small{display:block}.coop-panel small{color:#888;font-size:11px;margin-top:5px}.coop-actions{display:flex;gap:8px;flex-wrap:wrap}.coop-actions form{display:flex;gap:6px;flex:1;min-width:190px}.coop-actions input{min-width:0;flex:1;border:1px solid #444;background:#0d0d0d;padding:10px;text-transform:uppercase}.coop-actions button{padding:10px 12px}.coop-lobby{display:grid;gap:18px;max-width:480px;margin:0 auto;padding:44px 0;text-align:center}.coop-lobby h1{margin:0}.coop-room-code{display:grid;gap:8px;border:1px solid #6e5b32;background:linear-gradient(135deg,#211c12,#111);padding:24px}.coop-room-code small{color:#b9a56f;letter-spacing:.2em}.coop-room-code b{color:#f0d783;font:36px Georgia,serif;letter-spacing:.2em}.coop-room-code span,.coop-lobby-status{color:#999;font-size:11px}.coop-lobby-status{padding:12px;border:1px solid #333;background:#121212}.coop-lobby-status span{color:#665e4a;margin-right:8px}.coop-lobby-status span.ready{color:#b9c978}.coop-party-banner{display:flex;justify-content:space-between;align-items:center;gap:12px;border:1px solid #51472f;background:#1b1913;padding:12px;margin-bottom:10px}.coop-party-banner b,.coop-party-banner small{display:block}.coop-party-banner small{color:#999;font-size:10px;margin-top:4px}.coop-party-hp{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}.coop-party-card{display:flex;align-items:center;gap:9px;border:1px solid #383838;background:#121212;padding:9px}.coop-party-card.current{border-color:#aa8d4e}.coop-party-character{display:grid;place-items:center;width:38px;height:46px;overflow:hidden;border:1px solid #75623d;background:linear-gradient(160deg,#28343a,#111);color:#ead69d;font:20px Georgia,serif}.coop-party-character img{width:100%;height:100%;object-fit:cover}.coop-party-copy{min-width:0;flex:1}.coop-party-copy b,.coop-party-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.coop-party-copy small{color:#aaa;font-size:9px;margin-top:3px}.coop-party-copy span{display:block;height:5px;margin-top:7px;background:#302d28}.coop-party-copy i{display:block;height:100%;background:linear-gradient(90deg,#c9785d,#e4c46b)}.coop-battle-shell .dungeon-battle{margin-top:0}
.coop-party-card.active-turn{border-color:#d8bd70;box-shadow:0 0 0 1px #d8bd7044,0 0 16px #d8bd7022}.coop-turn-indicator{padding:7px 10px;border:1px solid #49443a;color:#aaa;font-size:10px;letter-spacing:.08em;white-space:nowrap}.coop-turn-indicator.your-turn{border-color:#b99a5b;color:#f0d58c;animation:coop-turn-pulse 1.1s ease-in-out infinite alternate}.coop-judgement{display:grid;justify-items:center;gap:2px;margin:-2px auto 8px;animation:coop-judgement-in 380ms ease-out}.coop-judgement b{font:700 25px Georgia,serif;letter-spacing:.1em;color:#f0d58c;text-shadow:0 0 14px #e0bd6a99}.coop-judgement small{font-size:9px;color:#ddd}.coop-judgement.perfect b{color:#fff2b1;text-shadow:0 0 18px #fff0a0}.coop-judgement.miss b{color:#b9a8a0;text-shadow:none}@keyframes coop-turn-pulse{to{box-shadow:0 0 14px #d8bd7055}}@keyframes coop-judgement-in{0%{opacity:0;transform:translateY(8px) scale(.82)}60%{opacity:1;transform:translateY(-2px) scale(1.06)}100%{transform:translateY(0) scale(1)}}.coop-battle-shell .dungeon-battle{margin-top:0}
.dungeon-screen .battle-loadout{border-color:var(--border-soft);background:linear-gradient(135deg,#171426,#101018)}
.dungeon-screen .battle-loadout>div:first-child b{color:var(--gold-soft)}
.dungeon-screen .battle-loadout-list button{color:#d7d2e5;border-color:var(--border-arcane);background:linear-gradient(145deg,#191725,#111119);border-radius:5px}
.dungeon-screen .battle-loadout-list button b{color:#f0edf8}
.dungeon-screen .battle-loadout-list button small{color:#aaa5b7}
.dungeon-screen .battle-loadout-list button.selected{color:var(--gold-soft);border-color:var(--gold);background:linear-gradient(145deg,#2b2417,#19150f);box-shadow:inset 0 0 0 1px #cbb26a22}
.dungeon-screen .battle-loadout-list button.selected b{color:#f3dfa0}
.dungeon-screen .battle-loadout-list button:disabled{background:#101016;color:#777;opacity:.55}
.inventory-screen .item-codex-summary{border-color:var(--border-soft);background:linear-gradient(135deg,#211c12,#111)}
.inventory-screen .codex-tabs button,.inventory-screen .inventory-view-toggle button{color:#c4bfd2;border-color:var(--border-arcane);background:linear-gradient(145deg,#191725,#111119);border-radius:5px}
.inventory-screen .codex-tabs button.active,.inventory-screen .inventory-view-toggle button.active{color:var(--gold-soft);border-color:var(--gold);background:linear-gradient(145deg,#2b2417,#19150f)}
.inventory-screen .codex-item{border-color:var(--border-arcane);background:linear-gradient(120deg,#191725,#101018);color:#eeeaf6}
.inventory-screen .codex-item.legendary{border-color:#8c7137;background:linear-gradient(120deg,#27200f,#12110d)}
.inventory-screen .codex-item-copy p{color:#b7b1c3}
.inventory-screen .codex-item-copy small{color:#c2bdce}
.inventory-screen .codex-item.unknown{background:linear-gradient(120deg,#171620,#101018)}
.dungeon-battle .dungeon-skill-menu button{color:#e7e2f1;border:1px solid var(--border-arcane);background:linear-gradient(145deg,#191725,#111119)}
.dungeon-battle .dungeon-skill-menu button b{color:#f1e4b8}
.dungeon-battle .dungeon-skill-menu button small{color:#b5afc1}
.dungeon-battle .dungeon-skill-menu button:disabled{opacity:.45}
.shop-screen{min-width:0}
.shop-screen .shop-next-goal-row>div{flex:1;min-width:0;overflow-wrap:anywhere}
.shop-screen .dungeon-shop-item{display:grid;grid-template-columns:36px minmax(0,1fr) max-content;align-items:center;gap:10px;min-width:0}
.shop-screen .dungeon-shop-info{min-width:0;overflow-wrap:anywhere}
.shop-screen .dungeon-shop-info>b{display:flex;align-items:center;flex-wrap:wrap;gap:4px;min-width:0;overflow-wrap:anywhere}
.shop-screen .dungeon-shop-info .rarity-badge,.shop-screen .dungeon-shop-info .equip-badge{margin-left:0}
.shop-screen .dungeon-shop-item>button{max-width:100%;white-space:normal;overflow-wrap:anywhere}
.shop-screen .shop-item-remaining{grid-column:2/-1}
.shop-screen .shop-tabs button{min-width:0}
@media(max-width:360px){.shop-screen .dungeon-shop-item{grid-template-columns:30px minmax(0,1fr) max-content;gap:7px;padding:10px}.shop-screen .dungeon-shop-icon{width:30px}.shop-screen .dungeon-shop-item>button{padding:8px 6px;font-size:9px;letter-spacing:.02em}}
`;

export default App;
