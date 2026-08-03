export type LeagueSettings = {
  seasonId: string;
  seasonLabel: string;
  startingPoints: number;
  weeklyMinimumPoints: number;
  weeklyWindow: "tuesday-monday";
  requirementBegins: string;
  requirementEnds: string;
  weeklyShortfallPolicy: "deduct-shortfall";
  shortfallCollection: "available-balance-only";
  voidedWagersCountForMinimum: boolean;
  standingsBalance: "total-equity";
  wagerDecimals: number;
  eligibleLeagues: Array<"nfl" | "cfb">;
  includeNflPreseason: boolean;
  eligibleMarkets: Array<"spread" | "moneyline" | "total">;
  primaryMarketsOnly: boolean;
  wagerOpenPolicy: "league-week";
  wagerLockPolicy: "server-before-kickoff";
  acceptedWagersFinal: boolean;
  parlayMinLegs: number;
  parlayMaxLegs: number;
  teaserMinLegs: number;
  teaserMaxLegs: number;
  teaserPoints: number;
  teaserPrices: Record<string, number>;
  sameGameCombinations: boolean;
  crossLeagueTickets: boolean;
  primarySportsbook: "draftkings";
  backupSportsbook: "fanduel";
  automaticSportsbookFallback: boolean;
  returnToPrimarySportsbook: boolean;
  oddsStaleHours: number;
  missingMarketPolicy: "close-market-only";
  erroneousLinePolicy: "commissioner-void-with-reason";
  moneylineTiePolicy: "void";
  singlePushPolicy: "refund";
  reducedParlayPolicy: "reprice-remaining";
  oneLegParlayPolicy: "grade-single-locked-odds";
  reducedTeaserPolicy: "grade-remaining";
  oneLegTeaserPolicy: "void";
  allLegsVoidPolicy: "void";
  postponementHours: number;
  suspendedGamePolicy: "official-result-then-postponement";
  correctionHours: number;
  clearErrorCorrectionUntilFinal: boolean;
  entryLimit: number;
  lateEntryCutoff: string;
  lateEntryRequirementStarts: "following-week";
  rebuyCutoff: string;
  rebuyRequiresZeroBalance: boolean;
  rebuyStartingPoints: number;
  unlimitedRebuysBeforeCutoff: boolean;
  rebuyRequirementStarts: "following-week";
  postCutoffBustPolicy: "eliminated-visible";
  suspensionRequirementPolicy: "full-week-exempt";
  emptyWeekPolicy: "no-requirement";
  wagerRevealPolicy: "each-selection-at-kickoff";
  finalizationPolicy: "after-super-bowl-settlement-and-corrections";
  primaryRanking: "final-total-equity";
  firstTiebreaker: "fewer-rebuys";
  finalTiebreaker: "split-prize";
};

export const DEFAULT_LEAGUE_SETTINGS: LeagueSettings = {
  seasonId: "2026",
  seasonLabel: "2026 Season",
  startingPoints: 10_000,
  weeklyMinimumPoints: 500,
  weeklyWindow: "tuesday-monday",
  requirementBegins: "CFB Week 0",
  requirementEnds: "Super Bowl",
  weeklyShortfallPolicy: "deduct-shortfall",
  shortfallCollection: "available-balance-only",
  voidedWagersCountForMinimum: true,
  standingsBalance: "total-equity",
  wagerDecimals: 2,
  eligibleLeagues: ["nfl", "cfb"],
  includeNflPreseason: true,
  eligibleMarkets: ["spread", "moneyline", "total"],
  primaryMarketsOnly: true,
  wagerOpenPolicy: "league-week",
  wagerLockPolicy: "server-before-kickoff",
  acceptedWagersFinal: true,
  parlayMinLegs: 2,
  parlayMaxLegs: 10,
  teaserMinLegs: 2,
  teaserMaxLegs: 10,
  teaserPoints: 6,
  teaserPrices: {
    "2": -120,
    "3": 150,
    "4": 250,
    "5": 400,
    "6": 600,
    "7": 900,
    "8": 1200,
    "9": 1500,
    "10": 2000,
  },
  sameGameCombinations: false,
  crossLeagueTickets: true,
  primarySportsbook: "draftkings",
  backupSportsbook: "fanduel",
  automaticSportsbookFallback: true,
  returnToPrimarySportsbook: true,
  oddsStaleHours: 8,
  missingMarketPolicy: "close-market-only",
  erroneousLinePolicy: "commissioner-void-with-reason",
  moneylineTiePolicy: "void",
  singlePushPolicy: "refund",
  reducedParlayPolicy: "reprice-remaining",
  oneLegParlayPolicy: "grade-single-locked-odds",
  reducedTeaserPolicy: "grade-remaining",
  oneLegTeaserPolicy: "void",
  allLegsVoidPolicy: "void",
  postponementHours: 48,
  suspendedGamePolicy: "official-result-then-postponement",
  correctionHours: 72,
  clearErrorCorrectionUntilFinal: true,
  entryLimit: 1,
  lateEntryCutoff: "Kickoff of the first FBS game designated CFB Week 8",
  lateEntryRequirementStarts: "following-week",
  rebuyCutoff: "Kickoff of the first FBS game designated CFB Week 8",
  rebuyRequiresZeroBalance: true,
  rebuyStartingPoints: 10_000,
  unlimitedRebuysBeforeCutoff: true,
  rebuyRequirementStarts: "following-week",
  postCutoffBustPolicy: "eliminated-visible",
  suspensionRequirementPolicy: "full-week-exempt",
  emptyWeekPolicy: "no-requirement",
  wagerRevealPolicy: "each-selection-at-kickoff",
  finalizationPolicy: "after-super-bowl-settlement-and-corrections",
  primaryRanking: "final-total-equity",
  firstTiebreaker: "fewer-rebuys",
  finalTiebreaker: "split-prize",
};

const weekdayIndex: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function centralCalendarParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    weekday: weekdayIndex[value("weekday")] ?? 0,
  };
}

function centralMidnightUtc(year: number, month: number, day: number) {
  const desired = Date.UTC(year, month - 1, day);
  let guess = desired;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const represented = Date.UTC(
      value("year"),
      value("month") - 1,
      value("day"),
      value("hour"),
      value("minute"),
      value("second"),
    );
    guess += desired - represented;
  }
  return new Date(guess);
}

export type LeagueWeek = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

function leagueWeekFromCalendarStart(year: number, month: number, day: number) {
  const start = centralMidnightUtc(year, month, day);
  const endCalendar = new Date(Date.UTC(year, month - 1, day + 7));
  const end = centralMidnightUtc(
    endCalendar.getUTCFullYear(),
    endCalendar.getUTCMonth() + 1,
    endCalendar.getUTCDate(),
  );
  return { start, end };
}

function centralDateKey(date: Date) {
  const { year, month, day } = centralCalendarParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatLeagueWeekLabel({ start, end }: { start: Date; end: Date }) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
  });
  const startParts = formatter.formatToParts(start);
  const endParts = formatter.formatToParts(new Date(end.getTime() - 1));
  const value = (parts: Intl.DateTimeFormatPart[], type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const startMonth = value(startParts, "month");
  const startDay = value(startParts, "day");
  const endMonth = value(endParts, "month");
  const endDay = value(endParts, "day");
  return `${startMonth} ${startDay}–${startMonth === endMonth ? "" : `${endMonth} `}${endDay}`.toUpperCase();
}

export function leagueWeekWindow(now = new Date()) {
  const local = centralCalendarParts(now);
  const daysSinceTuesday = (local.weekday - 2 + 7) % 7;
  const startCalendar = new Date(Date.UTC(local.year, local.month - 1, local.day - daysSinceTuesday));
  return leagueWeekFromCalendarStart(
    startCalendar.getUTCFullYear(),
    startCalendar.getUTCMonth() + 1,
    startCalendar.getUTCDate(),
  );
}

export function leagueWeekKey(week: { start: Date }) {
  return centralDateKey(week.start);
}

export function leagueWeekWindowForStart(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (!year || !month || !day) return null;
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (
    calendar.getUTCFullYear() !== year
    || calendar.getUTCMonth() !== month - 1
    || calendar.getUTCDate() !== day
    || calendar.getUTCDay() !== 2
  ) return null;
  return leagueWeekFromCalendarStart(year, month, day);
}

export function leagueSeasonWeeks(seasonId: string): LeagueWeek[] {
  const seasonYear = Number(seasonId);
  if (!Number.isInteger(seasonYear) || seasonYear < 2000 || seasonYear > 3000) return [];

  const augustFirst = new Date(Date.UTC(seasonYear, 7, 1));
  const firstStart = new Date(Date.UTC(
    seasonYear,
    7,
    1 - ((augustFirst.getUTCDay() - 2 + 7) % 7),
  ));
  const finalExclusive = Date.UTC(seasonYear + 1, 2, 1);
  const weeks: LeagueWeek[] = [];
  for (let cursor = firstStart.getTime(); cursor < finalExclusive; cursor += 7 * 86_400_000) {
    const startCalendar = new Date(cursor);
    const window = leagueWeekFromCalendarStart(
      startCalendar.getUTCFullYear(),
      startCalendar.getUTCMonth() + 1,
      startCalendar.getUTCDate(),
    );
    weeks.push({ key: leagueWeekKey(window), label: formatLeagueWeekLabel(window), ...window });
  }
  return weeks;
}

function calendarWeekKey(date: Date) {
  const daysSinceTuesday = (date.getUTCDay() - 2 + 7) % 7;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceTuesday));
  return start.toISOString().slice(0, 10);
}

function firstWeekdayOnOrAfter(year: number, month: number, day: number, weekday: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + (weekday - date.getUTCDay() + 7) % 7);
  return date;
}

export function cfbWeekZeroKey(seasonId: string) {
  const year = Number(seasonId);
  if (!Number.isInteger(year)) return null;
  // Week 0 is the Saturday on or after August 20 (Aug. 22 in 2026).
  return calendarWeekKey(firstWeekdayOnOrAfter(year, 8, 20, 6));
}

export type CompetitionWeekLabels = {
  nfl: string;
  cfb: string;
  combined: string;
};

export function competitionWeekLabels(seasonId: string, weekKey: string): CompetitionWeekLabels | null {
  const seasonYear = Number(seasonId);
  const week = leagueWeekWindowForStart(weekKey);
  const cfbWeekZero = cfbWeekZeroKey(seasonId);
  if (!Number.isInteger(seasonYear) || !week || !cfbWeekZero) return null;

  const weekNumberFrom = (anchorKey: string) => Math.round(
    (week.start.getTime() - leagueWeekWindowForStart(anchorKey)!.start.getTime()) / (7 * 86_400_000),
  );
  const laborDay = firstWeekdayOnOrAfter(seasonYear, 9, 1, 1);
  const nflWeekOne = calendarWeekKey(new Date(laborDay.getTime() + 3 * 86_400_000));
  const nflIndex = weekNumberFrom(nflWeekOne);
  const cfbIndex = weekNumberFrom(cfbWeekZero);

  const nfl = nflIndex === -5
    ? "NFL Hall of Fame Game"
    : nflIndex >= -4 && nflIndex <= -2
      ? `NFL Preseason Week ${nflIndex + 5}`
      : nflIndex >= 0 && nflIndex <= 17
        ? `NFL Week ${nflIndex + 1}`
        : nflIndex > 17
          ? "NFL Playoffs"
          : "NFL Preseason";
  const cfb = cfbIndex >= 0 && cfbIndex <= 15
    ? `CFB Week ${cfbIndex}`
    : cfbIndex > 15
      ? "CFB Postseason"
      : "CFB Preseason";
  return { nfl, cfb, combined: `${nfl} · ${cfb}` };
}

export function validateLeagueSettings(value: unknown): LeagueSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Season settings must be a JSON object.");
  }
  const merged = { ...DEFAULT_LEAGUE_SETTINGS, ...value } as LeagueSettings;
  const positive = [
    ["startingPoints", merged.startingPoints],
    ["weeklyMinimumPoints", merged.weeklyMinimumPoints],
    ["rebuyStartingPoints", merged.rebuyStartingPoints],
    ["parlayMinLegs", merged.parlayMinLegs],
    ["parlayMaxLegs", merged.parlayMaxLegs],
    ["teaserMinLegs", merged.teaserMinLegs],
    ["teaserMaxLegs", merged.teaserMaxLegs],
    ["teaserPoints", merged.teaserPoints],
    ["oddsStaleHours", merged.oddsStaleHours],
    ["postponementHours", merged.postponementHours],
    ["correctionHours", merged.correctionHours],
  ] as const;
  for (const [name, number] of positive) {
    if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} must be greater than zero.`);
  }
  if (!Number.isInteger(merged.wagerDecimals) || merged.wagerDecimals < 0 || merged.wagerDecimals > 2) {
    throw new Error("wagerDecimals must be 0, 1, or 2.");
  }
  if (merged.parlayMinLegs > merged.parlayMaxLegs || merged.teaserMinLegs > merged.teaserMaxLegs) {
    throw new Error("Minimum ticket legs cannot exceed maximum ticket legs.");
  }
  if (merged.primarySportsbook !== "draftkings" || merged.backupSportsbook !== "fanduel") {
    throw new Error("The configured sportsbook order must be DraftKings, then FanDuel.");
  }
  for (let legs = merged.teaserMinLegs; legs <= merged.teaserMaxLegs; legs += 1) {
    if (!Number.isFinite(Number(merged.teaserPrices[String(legs)]))) {
      throw new Error(`A teaser price is required for ${legs} legs.`);
    }
  }
  return merged;
}
