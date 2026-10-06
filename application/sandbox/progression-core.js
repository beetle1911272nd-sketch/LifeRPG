export const DAILY_QUESTS = [
  { id: "first-step", name: "今日の一歩", description: "ACTIONを1つ記録する", target: 1, rewardExp: 15, rewardGold: 10, track: "actions" },
  { id: "steady-steps", name: "コツコツ冒険者", description: "ACTIONを3つ記録する", target: 3, rewardExp: 30, rewardGold: 20, track: "actions" },
  { id: "explorer", name: "新しい道を歩く", description: "異なる2カテゴリのACTIONを記録する", target: 2, rewardExp: 25, rewardGold: 20, track: "categories" },
];

export const ADVENTURER_RANKS = [
  { id: "rookie", name: "新米", title: "新米冒険者", threshold: 0 },
  { id: "trailblazer", name: "開拓者", title: "道を切り拓く者", threshold: 25 },
  { id: "veteran", name: "熟練", title: "百戦錬磨の冒険者", threshold: 100 },
  { id: "hero", name: "英雄", title: "世界に名を刻む英雄", threshold: 300 },
  { id: "legend", name: "伝説", title: "伝説の冒険者", threshold: 800 },
];

export function dailyQuestStateForDate(savedState, date) {
  if (savedState?.date !== date) return { date, actions: 0, categories: [], completed: [] };
  return {
    date,
    actions: Math.max(0, Number(savedState.actions) || 0),
    categories: Array.isArray(savedState.categories) ? [...new Set(savedState.categories)] : [],
    completed: Array.isArray(savedState.completed) ? [...new Set(savedState.completed)] : [],
  };
}

export function advanceDailyQuests(savedState, date, category) {
  const current = dailyQuestStateForDate(savedState, date);
  const next = {
    ...current,
    actions: current.actions + 1,
    categories: category && !current.categories.includes(category)
      ? [...current.categories, category]
      : current.categories,
  };
  const newlyCompleted = DAILY_QUESTS
    .filter((quest) => !next.completed.includes(quest.id))
    .filter((quest) => (quest.track === "actions" ? next.actions : next.categories.length) >= quest.target);
  next.completed = [...next.completed, ...newlyCompleted.map((quest) => quest.id)];
  return {
    state: next,
    newlyCompleted,
    rewardExp: newlyCompleted.reduce((sum, quest) => sum + quest.rewardExp, 0),
    rewardGold: newlyCompleted.reduce((sum, quest) => sum + (quest.rewardGold || 0), 0),
  };
}

export function dailyQuestView(savedState, date) {
  const progress = dailyQuestStateForDate(savedState, date);
  return DAILY_QUESTS.map((quest) => ({
    ...quest,
    progress: Math.min(quest.target, quest.track === "actions" ? progress.actions : progress.categories.length),
    completed: progress.completed.includes(quest.id),
  }));
}

export function countNewSkillUnlocks(previousStats, nextStats, statKeys, thresholds) {
  return statKeys.reduce((count, stat) => {
    const previous = Number(previousStats?.[stat]) || 0;
    const next = Number(nextStats?.[stat]) || 0;
    return count + thresholds.filter((threshold) => previous < threshold && next >= threshold).length;
  }, 0);
}

export function adaptiveActionTarget(baseTarget, unit, performance = {}) {
  const base = Math.max(1, Number(baseTarget) || 1);
  const savedTarget = Number(performance.lastTarget);
  const current = Number.isFinite(savedTarget) && savedTarget > 0 ? Math.min(base * 2, savedTarget) : base;
  const successes = Math.max(0, Number(performance.successes) || 0);
  const growthEveryThree = successes > 0 && successes % 3 === 0;
  const growth = growthEveryThree ? Math.max(1, Math.round(base * (unit === "reps" ? 0.15 : 0.1))) : 0;
  return Math.max(1, Math.round(Math.min(base * 2, current + growth)));
}

export function adventurerRankFor(state, unlockedSkillCount = 0) {
  const renown = Math.max(0, Number(state?.totalActions) || 0)
    + Math.max(0, Number(unlockedSkillCount) || 0) * 3
    + Math.max(0, Number(state?.dungeon?.bestFloor) || 0) * 5
    + Math.max(0, (Number(state?.level) || 1) - 1) * 2;
  const rankIndex = ADVENTURER_RANKS.reduce((result, rank, index) => (renown >= rank.threshold ? index : result), 0);
  const current = ADVENTURER_RANKS[rankIndex];
  const next = ADVENTURER_RANKS[rankIndex + 1] || null;
  const progress = next
    ? Math.max(0, Math.min(100, ((renown - current.threshold) / (next.threshold - current.threshold)) * 100))
    : 100;
  return { ...current, renown, next, progress };
}
