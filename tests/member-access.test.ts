import assert from "node:assert/strict";
import test from "node:test";
import { isApprovedMember } from "../app/lib/member-access";

test("member performance is available only to approved members", () => {
  assert.equal(isApprovedMember({ status: "approved" }), true);
  assert.equal(isApprovedMember({ status: "pending" }), false);
  assert.equal(isApprovedMember({ status: "suspended" }), false);
  assert.equal(isApprovedMember(undefined), false);
});
