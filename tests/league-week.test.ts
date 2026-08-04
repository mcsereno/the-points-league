import assert from "node:assert/strict";
import test from "node:test";
import { competitionWeekLabels, leagueSeasonWeeks, leagueWeekKey, leagueWeekWindowForStart, nflPreseasonWeekKeys } from "../app/lib/league-config";

test("the 2026 season begins with the Tuesday before August 1", () => {
  const weeks = leagueSeasonWeeks("2026");

  assert.equal(weeks[0]?.key, "2026-07-28");
  assert.equal(weeks[0]?.label, "JUL 28–AUG 3");
  assert.equal(weeks.at(-1)?.key, "2027-02-23");
});

test("a selected week must be a valid Tuesday start", () => {
  const week = leagueWeekWindowForStart("2026-08-04");

  assert.equal(leagueWeekKey(week!), "2026-08-04");
  assert.equal(leagueWeekWindowForStart("2026-08-05"), null);
  assert.equal(leagueWeekWindowForStart("2026-02-31"), null);
});

test("competition labels use the real 2026 NFL preseason and CFB Week 0 calendar", () => {
  assert.deepEqual(competitionWeekLabels("2026", "2026-07-28"), {
    nfl: "NFL Hall of Fame Game",
    cfb: "CFB Preseason",
    combined: "NFL Hall of Fame Game · CFB Preseason",
  });
  assert.deepEqual(competitionWeekLabels("2026", "2026-08-04"), {
    nfl: "NFL Preseason Week 1",
    cfb: "CFB Preseason",
    combined: "NFL Preseason Week 1 · CFB Preseason",
  });
  assert.deepEqual(competitionWeekLabels("2026", "2026-08-18"), {
    nfl: "NFL Preseason Week 3",
    cfb: "CFB Week 0",
    combined: "NFL Preseason Week 3 · CFB Week 0",
  });
  assert.deepEqual(competitionWeekLabels("2026", "2026-08-25"), {
    nfl: "NFL Preseason",
    cfb: "CFB Week 1",
    combined: "NFL Preseason · CFB Week 1",
  });
});

test("NFL preseason sync covers the Hall of Fame game and each preseason week", () => {
  assert.deepEqual(nflPreseasonWeekKeys("2026"), [
    "2026-07-28",
    "2026-08-04",
    "2026-08-11",
    "2026-08-18",
  ]);
});
