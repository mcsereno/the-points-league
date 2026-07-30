import { env } from "cloudflare:workers";
import { approvalEmail, sendMemberEmailOnce } from "../../../lib/email";
import { getLeagueSettings } from "../../../lib/league-settings";
import { isSameOrigin, requireCommissioner } from "../../../lib/portal-auth";

export async function POST(request:Request){
  if(!isSameOrigin(request))return Response.json({error:"Invalid request origin."},{status:403});
  if(!await requireCommissioner())return Response.json({error:"Commissioner access required."},{status:403});
  const body=await request.json() as {id?:number;status?:string;role?:string;balance?:number;startingBalance?:number;action?:string};
  if(!body.id)return Response.json({error:"Member id is required."},{status:400});
  if(body.status&&!["pending","approved","suspended"].includes(body.status))return Response.json({error:"Invalid status."},{status:400});
  if(body.role&&!["member","commissioner"].includes(body.role))return Response.json({error:"Invalid role."},{status:400});
  const current=await env.DB.prepare("SELECT id,email,display_name AS displayName,status,role,balance,starting_balance AS startingBalance,email_verified_at AS emailVerifiedAt FROM members WHERE id=?").bind(body.id).first<Record<string,unknown>>();
  if(!current)return Response.json({error:"Member not found."},{status:404});
  if(body.status==="approved"&&!current.emailVerifiedAt)return Response.json({error:"This player must verify their email before approval."},{status:400});
  await env.DB.prepare("UPDATE members SET status=?,role=?,balance=?,starting_balance=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(body.status??current.status,body.role??current.role,body.balance??current.balance,body.startingBalance??current.startingBalance,body.id).run();
  const member=await env.DB.prepare("SELECT id,email,display_name AS displayName,status,role,starting_balance AS startingBalance,balance,email_verified_at AS emailVerifiedAt,created_at AS createdAt FROM members WHERE id=?").bind(body.id).first();
  let email:{sent:boolean;error?:string}|undefined;
  if(body.status==="approved"&&current.status!=="approved"&&member){
    const settings=await getLeagueSettings();
    const message=approvalEmail(String(member.displayName),settings.startingPoints);
    email=await sendMemberEmailOnce(`member:${body.id}:approved`,{to:String(member.email),...message});
  }
  return Response.json({ok:true,member,email});
}
