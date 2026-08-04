const requestIdPattern = /^[a-zA-Z0-9-]{16,80}$/;

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && requestIdPattern.test(value);
}

export function requestIdOrNew(value: unknown) {
  return isValidRequestId(value) ? value : crypto.randomUUID();
}

export function rebuyRequestReference(seasonId: string, memberId: number, requestId: string) {
  return `rebuy:${seasonId}:${memberId}:${requestId}`;
}
