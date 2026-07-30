import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_LEAGUE_SETTINGS } from "../app/lib/league-config";
import { gradeLeg, gradeTicket } from "../app/lib/grading";

test("grades spreads, totals, and moneyline ties from locked terms", () => {
  assert.equal(gradeLeg({
    market: "spread",
    side: "away",
    lockedLine: 3,
    teasedLine: null,
    awayScore: 20,
    homeScore: 21,
  }), "won");
  assert.equal(gradeLeg({
    market: "spread",
    side: "home",
    lockedLine: -3,
    teasedLine: null,
    awayScore: 20,
    homeScore: 23,
  }), "push");
  assert.equal(gradeLeg({
    market: "total",
    side: "under",
    lockedLine: 48,
    teasedLine: 54,
    awayScore: 24,
    homeScore: 27,
  }), "won");
  assert.equal(gradeLeg({
    market: "moneyline",
    side: "home",
    lockedLine: null,
    teasedLine: null,
    awayScore: 24,
    homeScore: 24,
  }), "void");
});

test("returns stake plus winnings for a winning single", () => {
  assert.deepEqual(
    gradeTicket(
      { betType: "single", stake: 110 },
      [{ result: "won", lockedPrice: -110 }],
      DEFAULT_LEAGUE_SETTINGS,
    ),
    { status: "won", payout: 210, reason: "The selection won." },
  );
});

test("reprices a parlay reduced to one active selection", () => {
  assert.deepEqual(
    gradeTicket(
      { betType: "parlay", stake: 100 },
      [
        { result: "won", lockedPrice: 150 },
        { result: "push", lockedPrice: -110 },
      ],
      DEFAULT_LEAGUE_SETTINGS,
    ),
    { status: "won", payout: 250, reason: "The remaining active selections won." },
  );
});

test("voids a teaser reduced below two active selections", () => {
  assert.deepEqual(
    gradeTicket(
      { betType: "teaser", stake: 100 },
      [
        { result: "won", lockedPrice: -110 },
        { result: "push", lockedPrice: -110 },
      ],
      DEFAULT_LEAGUE_SETTINGS,
    ),
    {
      status: "void",
      payout: 100,
      reason: "The teaser was reduced below two active selections.",
    },
  );
});

test("uses the fixed reduced teaser matrix", () => {
  assert.deepEqual(
    gradeTicket(
      { betType: "teaser", stake: 100 },
      [
        { result: "won", lockedPrice: -110 },
        { result: "won", lockedPrice: -110 },
        { result: "won", lockedPrice: -110 },
        { result: "void", lockedPrice: -110 },
      ],
      DEFAULT_LEAGUE_SETTINGS,
    ),
    { status: "won", payout: 250, reason: "The remaining active selections won." },
  );
});

test("refunds a ticket when every selection pushes or is voided", () => {
  assert.deepEqual(
    gradeTicket(
      { betType: "parlay", stake: 75 },
      [
        { result: "push", lockedPrice: -110 },
        { result: "void", lockedPrice: -110 },
      ],
      DEFAULT_LEAGUE_SETTINGS,
    ),
    { status: "void", payout: 75, reason: "All selections pushed or were voided." },
  );
});
