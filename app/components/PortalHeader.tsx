import Link from "next/link";

export function PortalHeader({ admin = false }: { admin?: boolean }) {
  return <header className="site-header shell">
    <Link className="brand" href="/" aria-label="The Points League home"><span className="brand-dog">PL</span><span><strong>THE POINTS</strong><small>LEAGUE</small></span></Link>
    <nav aria-label="Portal navigation"><Link href="/">Wager board</Link><Link href="/action">League action</Link><Link href="/rules">Rules</Link><Link href="/portal">My portal</Link>{admin && <Link href="/admin">Commissioner</Link>}</nav>
    <div className="header-actions"><form action="/api/auth/logout" method="post"><button className="login-link signout-button" type="submit">Sign out</button></form></div>
  </header>;
}
