export type MemberApproval = {
  status?: string;
} | null | undefined;

export function isApprovedMember(member: MemberApproval) {
  return member?.status === "approved";
}
