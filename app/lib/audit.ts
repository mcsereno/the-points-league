import { env } from "cloudflare:workers";
import { getLeagueSettings } from "./league-settings";

export async function recordAudit(eventType:string,subjectType:string,subjectId:string|number|undefined,actorEmail:string|undefined,details:Record<string,unknown>={}){
  const settings=await getLeagueSettings();
  await env.DB.prepare("INSERT INTO audit_events (season_id,actor_email,event_type,subject_type,subject_id,details_json) VALUES (?,?,?,?,?,?)").bind(settings.seasonId,actorEmail?.toLowerCase()??null,eventType,subjectType,subjectId==null?null:String(subjectId),JSON.stringify(details)).run();
}
