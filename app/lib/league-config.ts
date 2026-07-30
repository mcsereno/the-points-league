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

export function leagueWeekWindow(now = new Date()) {
  const local = centralCalendarParts(now);
  const daysSinceTuesday = (local.weekday - 2 + 7) % 7;
  const startCalendar = new Date(Date.UTC(local.year, local.month - 1, local.day - daysSinceTuesday));
  const endCalendar = new Date(Date.UTC(
    startCalendar.getUTCFullYear(),
    startCalendar.getUTCMonth(),
    startCalendar.getUTCDate() + 7,
  ));
  const start = centralMidnightUtc(
    startCalendar.getUTCFullYear(),
    startCalendar.getUTCMonth() + 1,
    startCalendar.getUTCDate(),
  );
  const end = centralMidnightUtc(
    endCalendar.getUTCFullYear(),
    endCalendar.getUTCMonth() + 1,
    endCalendar.getUTCDate(),
  );
  return { start, end };
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
