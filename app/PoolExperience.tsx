"use client";

import { useEffect, useMemo, useState } from "react";
import { LeagueSettings } from "./lib/league-config";
import { isApprovedMember } from "./lib/member-access";

type Sport = "ALL" | "NFL" | "CFB";
type Market = "Spread" | "Moneyline" | "Total";
type BetType = "Single" | "Parlay" | "Teaser";
type Selection = {
  id: string;
  gameId: string;
  game: string;
  pick: string;
  odds: number;
  market: Market;
  line: number;
  direction: "team" | "over" | "under";
};

type BoardGame = {
  id: string; sport: "NFL" | "CFB"; day: string; time: string; network: string;
  away: string; awayRecord: string; home: string; homeRecord: string;
  spreadAway: string; spreadAwayOdds: number; spreadHome: string; spreadHomeOdds: number;
  mlAway: number; mlHome: number; total: string; totalOverOdds: number; totalUnderOdds: number;
  availableMarkets: Market[];
  outcomeIds: Record<Market, { away: string; home: string }>;
};

type LiveOutcome = { id: string; market: "spread" | "moneyline" | "total"; side: string; line: number | null; price: number };
type LiveGame = { id: string; league: "nfl" | "cfb"; awayTeam: string; homeTeam: string; kickoffAt: string; oddsProvider?: string; oddsCapturedAt?: string; outcomes: LiveOutcome[] };
type BoardWeek = { key: string; label: string; start: string; end: string; isCurrent: boolean };
type OddsPayload = { games?: LiveGame[]; feedConfigured?: boolean; week?: BoardWeek; weeks?: BoardWeek[] };
type MemberSnapshot = {
  displayName: string; status: string; role: string; balance?: number;
  equity?: number; openStake?: number; startingBalance?: number; rebuyCount?: number; rank?: number | null;
  seasonNet?: number; approvedMemberCount?: number;
};
type Standing = { memberId: number; rank: number; displayName: string; balance: number; equity: number; openStake: number; net: number; rebuyCount: number; wins: number; losses: number };
type PortalSnapshot = {
  authenticated: boolean;
  signInPath?: string;
  member?: MemberSnapshot;
  standings: Standing[];
};

function formatOdds(odds: number) {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function payout(stake: number, odds: number) {
  if (!stake || stake < 0) return 0;
  const profit = odds > 0 ? stake * odds / 100 : stake * 100 / Math.abs(odds);
  return Math.round((stake + profit) * 100) / 100;
}

function combinedAmericanOdds(legs: Selection[]) {
  if (!legs.length) return 0;
  const decimal = legs.reduce((product, leg) => product * (leg.odds > 0 ? 1 + leg.odds / 100 : 1 + 100 / Math.abs(leg.odds)), 1);
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

function teaserPrice(legCount: number, settings: LeagueSettings) {
  return settings.teaserPrices[String(legCount)] ?? 0;
}

function teasedPick(selection: Selection, points: number) {
  if (selection.market === "Spread") {
    const adjusted = selection.line + points;
    const label = adjusted > 0 ? `+${adjusted}` : `${adjusted}`;
    return `${selection.pick.replace(/[+-]?\d+(\.\d+)?$/, "").trim()} ${label}`;
  }
  if (selection.market === "Total") {
    const adjusted = selection.direction === "over" ? selection.line - points : selection.line + points;
    return `${selection.direction === "over" ? "Over" : "Under"} ${adjusted}`;
  }
  return selection.pick;
}

export function PoolExperience({ settings }: { settings: LeagueSettings }) {
  const [sport, setSport] = useState<Sport>("ALL");
  const [market, setMarket] = useState<Market>("Spread");
  const [betType, setBetType] = useState<BetType>("Single");
  const [ticket, setTicket] = useState<Selection[]>([]);
  const [teaserPoints, setTeaserPoints] = useState(settings.teaserPoints);
  const [stake, setStake] = useState(100);
  const [notice, setNotice] = useState("");
  const [boardGames, setBoardGames] = useState<BoardGame[]>([]);
  const [feedLabel, setFeedLabel] = useState("CONNECTING LIVE LINES");
  const [weekOptions, setWeekOptions] = useState<BoardWeek[]>([]);
  const [boardWeek, setBoardWeek] = useState<BoardWeek | null>(null);
  const [selectedWeekKey, setSelectedWeekKey] = useState<string | null>(null);
  const [portal, setPortal] = useState<PortalSnapshot | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const refreshBoard = () => {
      const query = selectedWeekKey ? `?week=${encodeURIComponent(selectedWeekKey)}` : "";
      return fetch(`/api/odds${query}`)
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload: OddsPayload) => {
        if (!active) return;
        setWeekOptions(payload.weeks ?? []);
        setBoardWeek(payload.week ?? null);
        if (!selectedWeekKey && payload.week?.key) setSelectedWeekKey(payload.week.key);
        const normalized = (payload.games ?? []).map((game): BoardGame | null => {
          const spreadAway = game.outcomes.find((item) => item.market === "spread" && item.side === "away");
          const spreadHome = game.outcomes.find((item) => item.market === "spread" && item.side === "home");
          const mlAway = game.outcomes.find((item) => item.market === "moneyline" && item.side === "away");
          const mlHome = game.outcomes.find((item) => item.market === "moneyline" && item.side === "home");
          const over = game.outcomes.find((item) => item.market === "total" && item.side === "over");
          const under = game.outcomes.find((item) => item.market === "total" && item.side === "under");
          const availableMarkets: Market[] = [];
          if (spreadAway && spreadHome) availableMarkets.push("Spread");
          if (mlAway && mlHome) availableMarkets.push("Moneyline");
          if (over?.line != null && under?.line != null) availableMarkets.push("Total");
          if (!availableMarkets.length) return null;
          const kickoff = new Date(game.kickoffAt);
          return {
            id: game.id,
            sport: game.league.toUpperCase() as "NFL" | "CFB",
            day: kickoff.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase(),
            time: kickoff.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
            network: game.oddsProvider?.toUpperCase() ?? "LIVE",
            away: game.awayTeam, awayRecord: "—", home: game.homeTeam, homeRecord: "—",
            spreadAway: spreadAway ? `${Number(spreadAway.line) > 0 ? "+" : ""}${spreadAway.line}` : "—",
            spreadAwayOdds: spreadAway?.price ?? 0,
            spreadHome: spreadHome ? `${Number(spreadHome.line) > 0 ? "+" : ""}${spreadHome.line}` : "—",
            spreadHomeOdds: spreadHome?.price ?? 0,
            mlAway: mlAway?.price ?? 0,
            mlHome: mlHome?.price ?? 0,
            total: `${over?.line ?? under?.line ?? "—"}`,
            totalOverOdds: over?.price ?? 0,
            totalUnderOdds: under?.price ?? 0,
            availableMarkets,
            outcomeIds: {
              Spread: { away: spreadAway?.id ?? "", home: spreadHome?.id ?? "" },
              Moneyline: { away: mlAway?.id ?? "", home: mlHome?.id ?? "" },
              Total: { away: over?.id ?? "", home: under?.id ?? "" },
            },
          };
        }).filter((game): game is BoardGame => game !== null);
        setBoardGames(normalized);
        if (normalized.length && payload.week?.isCurrent) {
          const latestCapturedAt = (payload.games ?? [])
            .map((game) => game.oddsCapturedAt)
            .filter((value): value is string => Boolean(value))
            .sort()
            .at(-1);
          setTicket((current) => {
            const liveLines = new Map((payload.games ?? []).flatMap((game) => game.outcomes.map((outcome) => [outcome.id, outcome])));
            const changed = current.some((selection) => {
              const live = liveLines.get(selection.id);
              return !live || live.price !== selection.odds || (live.line ?? selection.line) !== selection.line;
            });
            if (changed) setNotice("Lines updated. Review your selections before placing the wager.");
            return changed ? [] : current;
          });
          const capturedLabel = latestCapturedAt
            ? ` · UPDATED ${new Date(latestCapturedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
            : "";
          setFeedLabel(`LIVE ${normalized[0]?.network ?? ""} LINES${capturedLabel}`);
        } else {
          setTicket([]);
          setFeedLabel(payload.feedConfigured ? "NO LINES POSTED" : "LINE FEED NOT CONFIGURED");
        }
      })
      .catch(() => {
        if (!active) return;
        setBoardGames([]);
        setTicket([]);
        setFeedLabel("LINE FEED UNAVAILABLE");
      });
    };

    void refreshBoard();
    const timer = window.setInterval(refreshBoard, 5 * 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selectedWeekKey]);

  useEffect(() => {
    fetch("/api/me")
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload: PortalSnapshot) => setPortal(payload))
      .catch(() => setPortal({ authenticated: false, signInPath: "/login?returnTo=%2F", standings: [] }));
  }, []);

  const visibleGames = boardGames.filter((game) =>
    (sport === "ALL" || game.sport === sport) && game.availableMarkets.includes(market));
  const ticketOdds = useMemo(() => betType === "Single"
    ? ticket[0]?.odds ?? 0
    : betType === "Parlay"
      ? combinedAmericanOdds(ticket)
      : teaserPrice(ticket.length, settings), [betType, settings, ticket]);
  const returnValue = useMemo(() => ticketOdds ? payout(stake, ticketOdds) : 0, [stake, ticketOdds]);
  const minimumLegsMet = betType === "Single"
    ? ticket.length === 1
    : ticket.length >= (betType === "Parlay" ? settings.parlayMinLegs : settings.teaserMinLegs);

  const select = (selection: Selection) => {
    if (!boardWeek?.isCurrent) {
      setNotice("This board is view-only. Wagering opens during the current league week.");
      return;
    }
    setTicket((current) => {
      if (betType === "Single") return [selection];
      if (current.some((leg) => leg.id === selection.id)) return current.filter((leg) => leg.id !== selection.id);
      const withoutSameGame = current.filter((leg) => leg.gameId !== selection.gameId);
      const maximum = betType === "Parlay" ? settings.parlayMaxLegs : settings.teaserMaxLegs;
      return [...withoutSameGame, selection].slice(0, maximum);
    });
    setNotice("");
  };

  const changeBetType = (next: BetType) => {
    setBetType(next);
    setTicket([]);
    setNotice("");
    if (next === "Teaser" && market === "Moneyline") setMarket("Spread");
  };

  const placeWager = async () => {
    if (!minimumLegsMet || stake <= 0 || !ticketOdds) return;
    if (!boardWeek?.isCurrent) {
      setNotice("This board is view-only. Wagering opens during the current league week.");
      return;
    }
    if (!portal?.authenticated) {
      window.location.href = portal?.signInPath ?? "/login?returnTo=%2F";
      return;
    }
    if (portal.member?.status !== "approved") {
      setNotice("Your membership is awaiting commissioner approval.");
      return;
    }
    setSubmitting(true);
    setNotice("");
    try {
      const response = await fetch("/api/wagers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          betType: betType.toLowerCase(),
          stake,
          requestId: crypto.randomUUID(),
          teaserPoints: betType === "Teaser" ? teaserPoints : undefined,
          legs: ticket.map((leg) => ({ outcomeId: leg.id })),
        }),
      });
      const body = await response.json() as { error?: string; balance?: number };
      if (!response.ok) throw new Error(body.error ?? "The wager could not be placed.");
      setPortal((current) => current?.member
        ? { ...current, member: { ...current.member, balance: Number(body.balance) } }
        : current);
      setNotice(`${stake.toLocaleString()} Points wagered. The ticket is in My Portal.`);
      setTicket([]);
      setStake(100);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The wager could not be placed.");
    } finally {
      setSubmitting(false);
    }
  };

  const member = portal?.member;
  const standings = portal?.standings ?? [];
  const signedIn = Boolean(portal?.authenticated && member);
  const approvedMember = signedIn && isApprovedMember(member);
  const signInPath = portal?.signInPath ?? "/login?returnTo=%2F";
  const selectedWeekIsCurrent = boardWeek?.isCurrent ?? true;
  const showWagerSlip = signedIn && selectedWeekIsCurrent;
  const placeDisabled = stake <= 0 || !minimumLegsMet || !ticketOdds || submitting || !selectedWeekIsCurrent || (signedIn && member?.status !== "approved");
  const weekLabel = boardWeek?.label ?? "LOADING WEEK";

  return (
    <main>
      <header className="site-header shell">
        <a className="brand" href="#" aria-label="Gridiron Ledger home">
          <span className="brand-mark">GL</span>
          <span><strong>GRIDIRON</strong><small>LEDGER</small></span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#board">Wager board</a>
          <a href="#standings">Standings</a>
          <a href="/action">League action</a>
          <a href="/rules">Rules</a>
          <a href="/portal">My portal</a>
        </nav>
        <div className="header-actions">
          <span className="season-label">{settings.seasonLabel.toUpperCase()}</span>
          <a className="login-link" href={signedIn ? "/portal" : signInPath}>{signedIn ? "My account" : "Sign in"}</a>
          <a className="button button-small" href="#board">Make picks <span>↗</span></a>
        </div>
      </header>

      <section className="hero shell">
        <div className="eyebrow"><span className="live-dot" /> PRIVATE FOOTBALL POOL · VIRTUAL POINTS</div>
        <h1>Office<br /><em>Football Pool</em></h1>
        <p className="hero-copy">Bet full-game spreads, moneylines, and totals across NFL and FBS games. Your available balance and open wagers combine to set your place in the standings.</p>
        <div className="hero-actions">
          <a className="button button-primary" href="#board">View this week&apos;s board <span>↓</span></a>
          <a className="button button-ghost" href={signedIn ? "/portal" : signInPath}>{signedIn ? "Open my portal" : "Join the league"}</a>
        </div>
        {approvedMember && (
          <div className="hero-ledger" aria-label="Your league performance">
            <div><span>AVAILABLE BALANCE</span><strong>{Number(member?.balance).toLocaleString()}</strong><small>POINTS</small></div>
            <div><span>SEASON NET</span><strong>{Number(member?.seasonNet) >= 0 ? "+" : ""}{Number(member?.seasonNet).toLocaleString()}</strong><small>POINTS</small></div>
            <div><span>SEASON RANK</span><strong>{member?.rank ? String(member.rank).padStart(2, "0") : "—"}</strong><small>{member?.approvedMemberCount ? `OF ${member.approvedMemberCount}` : "—"}</small></div>
          </div>
        )}
      </section>

      <section className="board-band" id="board">
        <div className="shell">
          <div className="section-heading board-heading">
            <div>
              <p className="eyebrow">{selectedWeekIsCurrent ? "CURRENT LEAGUE WEEK" : "VIEWING LEAGUE WEEK"} · {weekLabel}</p>
              <h2>{selectedWeekIsCurrent ? "This week's board." : "Week board."}</h2>
            </div>
            <div className="feed-label"><span className="live-dot" /> {feedLabel}</div>
          </div>

          <div className={`pool-layout${showWagerSlip ? "" : " pool-layout-signed-out"}`}>
            <div>
              <div className="board-controls">
                <div className="segmented" aria-label="Filter by league">
                  {(["ALL", "NFL", "CFB"] as Sport[]).map((item) => (
                    <button className={sport === item ? "active" : ""} key={item} onClick={() => setSport(item)}>{item}</button>
                  ))}
                </div>
                <label className="week-picker">
                  <span>VIEW WEEK</span>
                  <select
                    aria-label="Select league week"
                    disabled={!weekOptions.length}
                    value={selectedWeekKey ?? ""}
                    onChange={(event) => {
                      setSelectedWeekKey(event.target.value);
                      setTicket([]);
                      setNotice("");
                    }}
                  >
                    {!weekOptions.length && <option value="">Loading weeks</option>}
                    {weekOptions.map((week) => <option key={week.key} value={week.key}>{week.label}{week.isCurrent ? " · Current" : ""}</option>)}
                  </select>
                </label>
                <div className="segmented market-tabs" aria-label="Choose market">
                  {(["Spread", "Moneyline", "Total"] as Market[]).map((item) => (
                    <button disabled={betType === "Teaser" && item === "Moneyline"} className={market === item ? "active" : ""} key={item} onClick={() => setMarket(item)}>{item}</button>
                  ))}
                </div>
              </div>

              <div className="sportsbook">
                {visibleGames.length ? visibleGames.map((game) => (
                  <article className="market-game" key={game.id}>
                    <div className="game-meta">
                      <span className={`league-pill league-pill-${game.sport.toLowerCase()}`}>{game.sport}</span>
                      <strong>{game.day} · {game.time}</strong>
                      <small>{game.network}</small>
                    </div>
                    <div className="team-lines">
                      {[["away", game.away, game.awayRecord], ["home", game.home, game.homeRecord]].map(([side, team, record]) => {
                        const isAway = side === "away";
                        const pick = market === "Spread"
                          ? `${team} ${isAway ? game.spreadAway : game.spreadHome}`
                          : market === "Moneyline"
                            ? `${team} ML`
                            : `${isAway ? "Over" : "Under"} ${game.total}`;
                        const odds = market === "Spread"
                          ? (isAway ? game.spreadAwayOdds : game.spreadHomeOdds)
                          : market === "Moneyline"
                            ? (isAway ? game.mlAway : game.mlHome)
                            : (isAway ? game.totalOverOdds : game.totalUnderOdds);
                        const id = game.outcomeIds[market][side as "away" | "home"];
                        const selected = ticket.some((leg) => leg.id === id);
                        const line = market === "Spread"
                          ? Number(isAway ? game.spreadAway : game.spreadHome)
                          : market === "Total"
                            ? Number(game.total)
                            : odds;
                        return (
                          <div className="team-line" key={side}>
                            <div className="team-name"><strong>{team}</strong><span>{record}</span></div>
                            <button disabled={!selectedWeekIsCurrent} title={selectedWeekIsCurrent ? undefined : "This week is view-only."} className={selected ? "selected" : ""} onClick={() => select({ id, gameId: game.id, game: `${game.away} @ ${game.home}`, pick, odds, market, line, direction: market === "Total" ? (isAway ? "over" : "under") : "team" })}>
                              <b>{market === "Spread" ? (isAway ? game.spreadAway : game.spreadHome) : market === "Moneyline" ? "ML" : isAway ? `O ${game.total}` : `U ${game.total}`}</b>
                              <span>{formatOdds(odds)}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </article>
                )) : (
                  <div className="board-empty">
                    <strong>{selectedWeekIsCurrent ? "No live lines are available yet." : "No lines have been posted for this week."}</strong>
                    <p>{selectedWeekIsCurrent ? "The board updates after the next scheduled feed or commissioner refresh." : "This board is view-only. Future weeks fill as sportsbooks publish lines."}</p>
                  </div>
                )}
              </div>
            </div>

            {showWagerSlip && <aside className="bet-slip" aria-label="Wager slip">
              <div className="slip-title"><span>WAGER SLIP</span><b>{ticket.length}</b></div>
              <div className="bet-type-tabs" aria-label="Wager type">
                {(["Single", "Parlay", "Teaser"] as BetType[]).map((item) => (
                  <button className={betType === item ? "active" : ""} key={item} onClick={() => changeBetType(item)}>{item}</button>
                ))}
              </div>
              {signedIn && member?.status !== "approved" && <div className="success-note">Your account is connected. A commissioner must approve it before you can wager.</div>}
              {notice && <div className="success-note">{notice}</div>}
              {ticket.length ? (
                <>
                  {betType === "Teaser" && (
                    <label className="teaser-control"><span>TEASER POINTS</span><select value={teaserPoints} onChange={(event) => setTeaserPoints(Number(event.target.value))}><option value={settings.teaserPoints}>{settings.teaserPoints} points</option></select></label>
                  )}
                  {ticket.map((leg) => (
                    <div className="ticket" key={leg.id}>
                      <button className="ticket-close" onClick={() => setTicket((current) => current.filter((item) => item.id !== leg.id))} aria-label={`Remove ${leg.pick}`}>×</button>
                      <small>{leg.market.toUpperCase()} · {betType === "Single" ? "STRAIGHT" : "LEG"}</small>
                      <strong>{betType === "Teaser" ? teasedPick(leg, teaserPoints) : leg.pick}</strong>
                      <span>{leg.game}</span>
                      {betType !== "Teaser" && <mark>{formatOdds(leg.odds)}</mark>}
                    </div>
                  ))}
                  {betType !== "Single" && ticket.length < 2 && <p className="leg-note">Add at least one more game to complete this {betType.toLowerCase()}.</p>}
                  <label className="stake-field">
                    <span>WAGER</span>
                    <div><input min="0.01" step="0.01" type="number" value={stake} onChange={(event) => setStake(Number(event.target.value))} /><b>PTS</b></div>
                  </label>
                  <div className="quick-stakes">
                    {[25, 50, 100, 250].map((value) => <button key={value} onClick={() => setStake(value)}>+{value}</button>)}
                  </div>
                  <div className="slip-totals"><span>{betType} price</span><strong>{ticketOdds ? formatOdds(ticketOdds) : "—"}</strong></div>
                  <div className="slip-totals"><span>Potential return</span><strong>{minimumLegsMet ? returnValue.toLocaleString() : "—"} PTS</strong></div>
                  <button className="place-wager" disabled={placeDisabled} onClick={placeWager}>
                    {submitting ? "Placing wager" : member?.status !== "approved" ? "Approval pending" : `Place ${betType.toLowerCase()}`} <span>↗</span>
                  </button>
                  {betType === "Teaser" && <p className="pricing-note">{settings.teaserPoints}-point teaser pricing is fixed for {settings.teaserMinLegs}–{settings.teaserMaxLegs} legs.</p>}
                </>
              ) : (
                <div className="empty-slip">
                  <span>+</span>
                  <strong>No selections yet.</strong>
                  <p>Choose a line or price from the board to start a wager.</p>
                </div>
              )}
              <div className="balance-row">
                <span>{approvedMember ? "Available" : "Member access"}</span>
                <strong>{approvedMember ? `${Number(member?.balance).toLocaleString()} PTS` : signedIn ? "APPROVAL PENDING" : "SIGN IN"}</strong>
              </div>
            </aside>}
          </div>
          <p className="board-note">DraftKings is the source. FanDuel fills a market only when DraftKings does not have one. Weeks outside the current league week are view-only.</p>
        </div>
      </section>

      <section className="standings-section shell" id="standings">
        <div className="section-heading">
          <div><p className="eyebrow">{settings.seasonLabel.toUpperCase()} STANDINGS</p><h2>Current standings.</h2></div>
          <a className="text-link" href="#standings">Full standings <span>→</span></a>
        </div>
        <div className="standings-grid">
          {standings.length ? standings.map((standing) => (
            <article key={`${standing.rank}-${standing.displayName}`}>
              <span className="rank-number">{String(standing.rank).padStart(2, "0")}</span>
              <div><strong>{standing.displayName}</strong><small>{standing.wins}–{standing.losses} RECORD</small></div>
              <b>{standing.net >= 0 ? "+" : ""}{standing.net.toLocaleString()}<small> PTS</small></b>
            </article>
          )) : <article className="standings-empty"><span className="rank-number">—</span><div><strong>No standings yet.</strong><small>APPROVED MEMBERS APPEAR AFTER THE FIRST UPDATE</small></div></article>}
        </div>
      </section>

      <section className="rules-band" id="rules">
        <div className="shell rules-layout">
          <div>
            <p className="eyebrow">HOW THE LEAGUE WORKS</p>
            <h2>Four rules to get started.</h2>
          </div>
          <ol>
            <li><b>01</b><div><strong>Start with {settings.startingPoints.toLocaleString()} Points</strong><p>Every player begins with the same virtual bankroll. No Points have cash value.</p></div></li>
            <li><b>02</b><div><strong>Wager on NFL + CFB</strong><p>Play spreads, moneylines, and totals before each game kicks off.</p></div></li>
            <li><b>03</b><div><strong>Build parlays and teasers</strong><p>Tickets may include NFL and FBS games. Each leg must come from a different game.</p></div></li>
            <li><b>04</b><div><strong>Wager {settings.weeklyMinimumPoints.toLocaleString()} Points each week</strong><p>Any shortfall is deducted after the final eligible game of the Tuesday–Monday week kicks off.</p></div></li>
          </ol>
        </div>
      </section>

      <section className="cta shell">
        <div><p className="eyebrow">NEW SLATE EVERY TUESDAY</p><h2>Build your next wager.</h2></div>
        <a className="button button-dark" href={signedIn ? "/portal" : signInPath}>{signedIn ? "Open my portal" : "Enter the pool"} <span>↗</span></a>
      </section>

      <footer className="footer shell"><span>GRIDIRON LEDGER © 2026</span><nav><a href="/rules">Rules</a><a href="#board">Wager board</a><a href="#standings">Standings</a></nav></footer>
    </main>
  );
}
