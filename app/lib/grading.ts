import type { LeagueSettings } from "./league-config";

export type Result = "pending" | "won" | "lost" | "push" | "void";

export type GradingLeg = {
  market: "spread" | "moneyline" | "total";
  side: string;
  lockedLine: number | null;
  teasedLine: number | null;
  awayScore: number;
  homeScore: number;
};

export type TicketLeg = {
  result: Result;
  lockedPrice: number;
};

export type GradingTicket = {
  betType: "single" | "parlay" | "teaser";
  stake: number;
};

function decimalOdds(price: number) {
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}

function americanOdds(prices: number[]) {
  const decimal = prices.reduce((product, price) => product * decimalOdds(price), 1);
  return decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : Math.round(-100 / (decimal - 1));
}

function returnAmount(stake: number, price: number) {
  const profit = price > 0 ? stake * price / 100 : stake * 100 / Math.abs(price);
  return Math.round((stake + profit) * 100) / 100;
}

export function gradeLeg(leg: GradingLeg): Result {
  const away = Number(leg.awayScore);
  const home = Number(leg.homeScore);

  if (leg.market === "moneyline") {
    if (away === home) return "void";
    return leg.side === "away"
      ? away > home ? "won" : "lost"
      : home > away ? "won" : "lost";
  }

  const line = leg.teasedLine ?? leg.lockedLine;
  if (line == null) return "void";

  if (leg.market === "spread") {
    const margin = leg.side === "away" ? away + line - home : home + line - away;
    return margin > 0 ? "won" : margin < 0 ? "lost" : "push";
  }

  const total = away + home;
  if (total === line) return "push";
  return leg.side === "over"
    ? total > line ? "won" : "lost"
    : total < line ? "won" : "lost";
}

export function gradeTicket(
  ticket: GradingTicket,
  legs: TicketLeg[],
  settings: LeagueSettings,
) {
  if (!legs.length || legs.some((leg) => leg.result === "pending")) return null;
  if (legs.some((leg) => leg.result === "lost")) {
    return { status: "lost" as const, payout: 0, reason: "One or more selections lost." };
  }

  const active = legs.filter((leg) => leg.result === "won");
  if (!active.length) {
    const status = ticket.betType === "single" && legs[0]?.result === "push" ? "push" : "void";
    return { status, payout: ticket.stake, reason: "All selections pushed or were voided." };
  }

  if (ticket.betType === "single") {
    return {
      status: "won" as const,
      payout: returnAmount(ticket.stake, active[0]!.lockedPrice),
      reason: "The selection won.",
    };
  }

  if (ticket.betType === "teaser" && active.length < settings.teaserMinLegs) {
    return {
      status: "void" as const,
      payout: ticket.stake,
      reason: "The teaser was reduced below two active selections.",
    };
  }

  const price = ticket.betType === "teaser"
    ? settings.teaserPrices[String(active.length)]
    : active.length === 1
      ? active[0]!.lockedPrice
      : americanOdds(active.map((leg) => leg.lockedPrice));

  if (price == null) {
    return { status: "void" as const, payout: ticket.stake, reason: "No valid reduced-ticket price was available." };
  }

  return {
    status: "won" as const,
    payout: returnAmount(ticket.stake, price),
    reason: active.length === legs.length ? "Every selection won." : "The remaining active selections won.",
  };
}
