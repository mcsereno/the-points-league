import Link from "next/link";
import { ResetPasswordForm } from "./ResetPasswordForm";
export const dynamic="force-dynamic";
export default function ResetPasswordPage(){return <main className="auth-page"><section className="auth-card"><Link className="brand auth-brand" href="/" aria-label="The Points League home"><span className="brand-dog">PL</span><span><strong>THE POINTS</strong><small>LEAGUE</small></span></Link><ResetPasswordForm /></section></main>;}
