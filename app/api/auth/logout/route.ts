import { clearedSessionCookie,revokeCurrentSession } from "../../../lib/auth";
export async function POST(request:Request){await revokeCurrentSession();return Response.redirect(new URL("/",request.url),303,{headers:{"set-cookie":clearedSessionCookie(request.url)}});}
