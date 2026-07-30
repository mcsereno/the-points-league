import { getSessionMember, isSameOrigin, requireSessionMember, SessionMember } from "./auth";

export { isSameOrigin };
export async function requirePortalMember(returnTo="/portal"){return {member:await requireSessionMember(returnTo)};}
export async function requireCommissioner(){const member=await getSessionMember();if(!member||member.role!=="commissioner")return null;return {member};}
export type Member=SessionMember;
