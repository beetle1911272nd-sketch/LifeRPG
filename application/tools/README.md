# Battle core extraction

`sandbox/battle-core.js` contains the battle calculations and dungeon/timing data as an ES module. The app keeps its existing call sites and supplies player equipment and job modifiers through thin wrappers.

`BATTLE_V2_ENABLED` keeps the tuned enemy HP/ATK/DEF values and percentage-based incoming damage mitigation enabled; set it to `false` to restore legacy enemy values and damage formulas. New battles use version 4: data-driven enemy patterns, telegraphed intent, stat-based builds, equipped skills with MP/energy/cooldowns, elemental weaknesses, break, combos, guard timing, status effects, and mastery bonuses. Existing version 2 and 3 saves keep their own resolution paths, as do unversioned legacy battles.

Run the deterministic comparison against the legacy fixture with:

```sh
node tools/regression.test.mjs
```

The fixture retains the original battle formulas and the equipment/job values consumed by those formulas. It is deliberately limited to the portions needed by this test, rather than duplicating the full application. Tests compare the extraction in legacy compatibility mode and separately assert V2 tuning, mitigation, and V3 tactical behavior:

```sh
node tools/battle-v3.test.mjs
```

Version 4 mechanics and compatibility behavior can be checked with:

```sh
node tools/battle-v4.test.mjs
```

Run deterministic balance samples for GOOD, all-MISS, and random timing play (level equals floor; `--stat` sets every base stat and `--count` controls sample size):

```sh
node tools/sim.js --stat 50 --count 500
```

The dungeon list shows a rough recommended level (floor +2; boss +3). The existing level-based unlock remains unchanged.

Victory screens preview the exact EXP/AURUM/drop recorded on the winning battle. Rewards are claimed once when the player returns to the floor list; the state transition verifies the winning battle ID before applying progression and equipment, preventing repeated taps from granting rewards twice. Legacy saved victories without a preview retain their existing reward calculation on claim.
