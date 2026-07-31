import { env } from "cloudflare:workers";
import { sendEmail } from "./email";

export async function alertCommissionerOnce(eventKey:string,subject:string,text:string){
  const values=env as unknown as Record<string,string|undefined>;const to=values.SITE_OWNER_EMAIL?.trim();if(!to)return {sent:false,error:"SITE_OWNER_EMAIL is not configured."};
  await env.DB.prepare("INSERT OR IGNORE INTO operational_alerts (event_key,status) VALUES (?,'pending')").bind(eventKey).run();
  const alert=await env.DB.prepare("SELECT status FROM operational_alerts WHERE event_key=?").bind(eventKey).first<{status:string}>();if(!alert||alert.status==="sent")return {sent:true};
  const result=await sendEmail({to,subject,text});
  await env.DB.prepare("UPDATE operational_alerts SET status=?,last_error=?,sent_at=CASE WHEN ?='sent' THEN CURRENT_TIMESTAMP ELSE sent_at END,updated_at=CURRENT_TIMESTAMP WHERE event_key=?").bind(result.sent?"sent":"failed",result.error??null,result.sent?"sent":"failed",eventKey).run();
  return result;
}
