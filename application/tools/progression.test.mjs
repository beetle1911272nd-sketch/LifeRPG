import assert from "node:assert/strict";
import {
  adaptiveActionTarget,
  adventurerRankFor,
  advanceDailyQuests,
  countNewSkillUnlocks,
  dailyQuestStateForDate,
  dailyQuestView,
} from "../sandbox/progression-core.js";

const date = "2026-09-28";
let saved = null;

let result = advanceDailyQuests(saved, date, "BODY");
saved = result.state;
assert.deepEqual(result.newlyCompleted.map((quest) => quest.id), ["first-step"]);
assert.equal(result.rewardExp, 15);

result = advanceDailyQuests(saved, date, "BODY");
saved = result.state;
assert.deepEqual(result.newlyCompleted, []);
assert.equal(result.rewardExp, 0);

result = advanceDailyQuests(saved, date, "STUDY");
saved = result.state;
assert.deepEqual(result.newlyCompleted.map((quest) => quest.id), ["steady-steps", "explorer"]);
assert.equal(result.rewardExp, 55);

assert.equal(dailyQuestView(saved, date).filter((quest) => quest.completed).length, 3);
assert.deepEqual(dailyQuestStateForDate(saved, "2026-09-29"), {
  date: "2026-09-29",
  actions: 0,
  categories: [],
  completed: [],
});

assert.equal(
  countNewSkillUnlocks({ STR: 39, INT: 20 }, { STR: 42, INT: 40 }, ["STR", "INT"], [20, 40]),
  2,
);
assert.equal(
  countNewSkillUnlocks({ STR: 40 }, { STR: 40 }, ["STR"], [20, 40]),
  0,
);
assert.equal(adaptiveActionTarget(10, "reps", { successes: 3, lastTarget: 10 }), 12);
assert.equal(adaptiveActionTarget(10, "reps", { successes: 6, lastTarget: 9 }), 11);
assert.equal(adaptiveActionTarget(10, "reps", { successes: 30, lastTarget: 20 }), 20);
assert.equal(adaptiveActionTarget(10, "reps", { failures: 4, lastTarget: 8 }), 8);
assert.equal(adventurerRankFor({ totalActions: 0, level: 1, dungeon: { bestFloor: 0 } }).id, "rookie");
assert.equal(adventurerRankFor({ totalActions: 600, level: 20, dungeon: { bestFloor: 10 } }, 40).id, "legend");
assert.equal(adventurerRankFor({ totalActions: 25, level: 1, dungeon: { bestFloor: 0 } }).next.id, "veteran");

console.log("✓ Progression tests passed.");
