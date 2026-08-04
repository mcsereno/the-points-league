import assert from "node:assert/strict";
import test from "node:test";
import { isValidRequestId, rebuyRequestReference, requestIdOrNew } from "../app/lib/request-id";

test("accepts and preserves a client retry ID", () => {
  const requestId = "d64a05bb-28cb-4e57-9c45-14f3ec0be768";
  assert.equal(isValidRequestId(requestId), true);
  assert.equal(requestIdOrNew(requestId), requestId);
});

test("rejects malformed client request IDs", () => {
  assert.equal(isValidRequestId("too-short"), false);
  assert.equal(isValidRequestId("contains spaces and punctuation!"), false);
  assert.equal(isValidRequestId(null), false);
});

test("keeps each rebuy request distinct while making retries deterministic", () => {
  const first = rebuyRequestReference("2026", 14, "d64a05bb-28cb-4e57-9c45-14f3ec0be768");
  assert.equal(first, rebuyRequestReference("2026", 14, "d64a05bb-28cb-4e57-9c45-14f3ec0be768"));
  assert.notEqual(first, rebuyRequestReference("2026", 14, "f3d9fbcd-2a8f-48c6-85ee-24ba3253a496"));
});
