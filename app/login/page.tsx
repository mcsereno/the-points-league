import Link from "next/link";
import { LoginForm } from "./LoginForm";
export const dynamic="force-dynamic";
const safe=(value:string|string[]|undefined)=>{const item=Array.isArray(value)?value[0]:value;return item?.startsWith("/")&&!item.startsWith("//")?item:"/portal";};
export default async function LoginPage({searchParams}:{searchParams:Promise<{returnTo?:string|string[]}>}){const params=await searchParams;return <main className="auth-page"><section className="auth-card"><Link className="brand auth-brand" href="/" aria-label="The Points League home"><span className="brand-dog">PL</span><span><strong>THE POINTS</strong><small>LEAGUE</small></span></Link><LoginForm returnTo={safe(params.returnTo)}/></section></main>;}
