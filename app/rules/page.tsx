import Link from "next/link";
import { getLeagueSettings } from "../lib/league-settings";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const settings = await getLeagueSettings();
  const teaserMatrix = Object.entries(settings.teaserPrices)
    .map(([legs, price]) => `${legs} legs ${price > 0 ? "+" : ""}${price}`)
    .join(" · ");

  const sections = [
    {
      number: "01",
      title: "Season and standings",
      rules: [
        `Each approved entry begins with ${settings.startingPoints.toLocaleString()} virtual Points. Points have no cash value.`,
        "One active entry is allowed per person.",
        `Standings rank total equity: available balance plus stakes tied up in open wagers. The entry with the highest final total equity wins.`,
        "Fewer rebuys breaks a tie. If balance and rebuy count are still tied, the applicable prize is split.",
        "Final standings become official after all Super Bowl wagers settle and all permitted corrections are complete.",
      ],
    },
    {
      number: "02",
      title: "Weekly requirement",
      rules: [
        `Every league week runs Tuesday through Monday. Beginning with ${settings.requirementBegins}, each active entry must wager at least ${settings.weeklyMinimumPoints.toLocaleString()} Points on games scheduled within that week.`,
        `If less than ${settings.weeklyMinimumPoints.toLocaleString()} Points are wagered, the exact shortfall is deducted after the final eligible game of the week kicks off.`,
        `A player with fewer than ${settings.weeklyMinimumPoints.toLocaleString()} available Points satisfies the requirement by wagering the entire available balance.`,
        "The penalty is capped at the available balance. No unpaid remainder carries forward.",
        "A later-voided qualifying wager still counts. Empty-slate weeks and full weeks affected by commissioner suspension are exempt.",
      ],
    },
    {
      number: "03",
      title: "Eligible wagers",
      rules: [
        "Eligible games include NFL preseason, NFL regular season and playoffs through the Super Bowl, plus FBS regular season, conference championships, bowls, and the College Football Playoff.",
        "Only primary full-game spreads, moneylines, and totals are offered. Alternate lines, partial-game markets, props, and same-game combinations are not offered.",
        `Singles use one selection. Parlays allow ${settings.parlayMinLegs}–${settings.parlayMaxLegs} selections; ${settings.teaserPoints}-point teasers allow ${settings.teaserMinLegs}–${settings.teaserMaxLegs}. Every leg must use a different game.`,
        "NFL and FBS selections may be combined on one parlay or teaser. Teasers may use spreads and totals, but not moneylines.",
        `Fixed ${settings.teaserPoints}-point teaser prices: ${teaserMatrix}.`,
      ],
    },
    {
      number: "04",
      title: "Lines and acceptance",
      rules: [
        `DraftKings is the primary sportsbook. FanDuel automatically replaces a missing DraftKings market, and new wagers return to DraftKings when its market reappears.`,
        "If neither sportsbook has a valid primary market, that market stays closed. Other valid markets for the game remain open.",
        `Markets close when odds are more than ${settings.oddsStaleHours} hours old. Accepted wagers retain their exact locked line and price.`,
        "The server must receive a wager before scheduled kickoff. Submitted wagers are final. Members cannot cancel or edit them.",
        "A clearly erroneous provider line may be voided and refunded by the commissioner only with a documented reason.",
      ],
    },
    {
      number: "05",
      title: "Pushes, voids, and delays",
      rules: [
        "A pushed single or a two-way moneyline tie returns the full stake.",
        "A pushed or voided parlay leg is removed and the remaining parlay is repriced. A one-leg remainder becomes a single at that leg's locked odds.",
        "A pushed or voided teaser leg is removed and the remaining teaser is graded at the reduced leg count. A one-leg remainder is voided.",
        "If every leg is pushed or voided, the full ticket is voided and the stake returned.",
        `Postponed wagers remain active if the game begins within ${settings.postponementHours} hours of its original start. If the league declares a suspended or abandoned game final, that official result is used. Otherwise, the same ${settings.postponementHours}-hour window applies.`,
      ],
    },
    {
      number: "06",
      title: "Entry, rebuy, and corrections",
      rules: [
        `New players may join through ${settings.lateEntryCutoff}. Their weekly requirement begins the following league week.`,
        `An entry must reach exactly zero before rebuying. Rebuys restore ${settings.rebuyStartingPoints.toLocaleString()} Points and are unlimited until ${settings.rebuyCutoff}.`,
        "A rebought entry's weekly requirement resumes the following league week. Rebuy count remains part of the season record.",
        "An entry that reaches zero after the cutoff is eliminated but remains visible in final standings.",
        `Settled wagers may be corrected within ${settings.correctionHours} hours. Clear grading or data errors may be corrected any time before final standings become official.`,
      ],
    },
  ];

  return <main>
    <header className="site-header shell">
      <Link className="brand" href="/" aria-label="Gridiron Ledger home">
        <span className="brand-mark">GL</span>
        <span><strong>GRIDIRON</strong><small>LEDGER</small></span>
      </Link>
      <nav aria-label="Rules navigation"><Link href="/#board">Wager board</Link><Link href="/#standings">Standings</Link><Link href="/action">League action</Link><Link href="/portal">My portal</Link></nav>
      <div className="header-actions"><span className="season-label">{settings.seasonLabel.toUpperCase()}</span><Link className="button button-small" href="/#board">Make picks <span>↗</span></Link></div>
    </header>
    <section className="rulebook-hero shell">
      <p className="eyebrow">OFFICIAL {settings.seasonLabel.toUpperCase()} RULEBOOK</p>
      <h1>League rules.</h1>
      <p>This rulebook covers bankrolls, weekly wagering, eligible markets, rebuys, grading, and final standings for the season.</p>
    </section>
    <section className="rulebook-band">
      <div className="shell rulebook-grid">
        {sections.map((section) => <article key={section.number}>
          <div><b>{section.number}</b><h2>{section.title}</h2></div>
          <ol>{section.rules.map((rule) => <li key={rule}>{rule}</li>)}</ol>
        </article>)}
      </div>
    </section>
    <footer className="footer shell"><span>GRIDIRON LEDGER © 2026</span><nav><Link href="/">Home</Link><Link href="/#board">Wager board</Link><Link href="/portal">My portal</Link></nav></footer>
  </main>;
}
