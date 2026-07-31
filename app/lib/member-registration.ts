import { env } from "cloudflare:workers";
import { getLeagueSettings } from "./league-settings";

type AuthenticatedUser={id:string;email:string;email_confirmed_at:string;user_metadata?:{username?:string}};
const owner=()=>((env as unknown as Record<string,string|undefined>).SITE_OWNER_EMAIL??"").trim().toLowerCase();

export async function createOrUpdateMember(user:AuthenticatedUser){
  const email=user.email.toLowerCase();
  const username=user.user_metadata?.username?.trim()||email.split("@")[0];
  const existing=await env.DB.prepare("SELECT id FROM members WHERE email=? OR auth_user_id=?").bind(email,user.id).first<{id:number}>();
  const settings=await getLeagueSettings();
  const commissioner=email===owner();
  await env.DB.prepare("INSERT INTO members (auth_user_id,email,email_verified_at,display_name,status,role,starting_balance,balance) VALUES (?,?,CURRENT_TIMESTAMP,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET auth_user_id=excluded.auth_user_id,email_verified_at=CURRENT_TIMESTAMP,display_name=CASE WHEN members.display_name='' THEN excluded.display_name ELSE members.display_name END,status=CASE WHEN excluded.role='commissioner' THEN 'approved' ELSE members.status END,role=CASE WHEN excluded.role='commissioner' THEN 'commissioner' ELSE members.role END,updated_at=CURRENT_TIMESTAMP").bind(user.id,email,username,commissioner?"approved":"pending",commissioner?"commissioner":"member",settings.startingPoints,settings.startingPoints).run();
  const member=await env.DB.prepare("SELECT id,display_name AS displayName,status FROM members WHERE email=?").bind(email).first<{id:number;displayName:string;status:string}>();
  if(!member)throw new Error("Your member account could not be created.");
  return {member,isNew:!existing};
}
