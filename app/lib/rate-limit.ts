import { env } from "cloudflare:workers";

const encoder=new TextEncoder();
const base64=(bytes:Uint8Array)=>{let text="";for(const byte of bytes)text+=String.fromCharCode(byte);return btoa(text).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");};
async function hash(value:string){return base64(new Uint8Array(await crypto.subtle.digest("SHA-256",encoder.encode(value))));}
export function requestIdentity(request:Request){return request.headers.get("cf-connecting-ip")??request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()??"unknown";}
export async function consumeRateLimit(bucket:string,key:string,limit:number,minutes:number){const keyHash=await hash(key);const current=await env.DB.prepare("SELECT window_started_at AS startedAt,attempts FROM auth_rate_limits WHERE bucket=? AND key_hash=?").bind(bucket,keyHash).first<{startedAt:string;attempts:number}>();const fresh=!current||Date.now()-new Date(current.startedAt).getTime()>=minutes*60_000;const attempts=fresh?1:Number(current.attempts)+1;await env.DB.prepare("INSERT INTO auth_rate_limits (bucket,key_hash,window_started_at,attempts,updated_at) VALUES (?,?,CURRENT_TIMESTAMP,?,CURRENT_TIMESTAMP) ON CONFLICT(bucket,key_hash) DO UPDATE SET window_started_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE auth_rate_limits.window_started_at END,attempts=excluded.attempts,updated_at=CURRENT_TIMESTAMP").bind(bucket,keyHash,attempts,fresh?1:0).run();return {allowed:attempts<=limit,retryAfterSeconds:fresh?minutes*60:Math.max(1,Math.ceil((minutes*60_000-(Date.now()-new Date(current!.startedAt).getTime()))/1000))};
}
