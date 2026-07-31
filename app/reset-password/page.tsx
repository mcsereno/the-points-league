import Link from "next/link";
import { ResetPasswordForm } from "./ResetPasswordForm";
export const dynamic="force-dynamic";
export default function ResetPasswordPage(){return <main className="auth-page"><section className="auth-card"><Link className="brand auth-brand" href="/" aria-label="Gridiron Ledger home"><span className="brand-mark">GL</span><span><strong>GRIDIRON</strong><small>LEDGER</small></span></Link><ResetPasswordForm /></section></main>;}
