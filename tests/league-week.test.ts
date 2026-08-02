import assert from "node:assert/strict";
import test from "node:test";
import { leagueSeasonWeeks, leagueWeekKey, leagueWeekWindowForStart } from "../app/lib/league-config";

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
