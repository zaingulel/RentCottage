import { describe, expect, it } from "vitest";

import { parseAccountContext } from "./supabase-account-access";

describe("Supabase account context boundary", () => {
  it("accepts an explicit valid Cottage Owner state", () => {
    expect(
      parseAccountContext({
        user_id: "81f35355-d3f7-4bfd-bfc4-e4a6887adfc3",
        role: "cottage_owner",
        owner_approval_state: "prospective",
      }),
    ).toEqual({
      userId: "81f35355-d3f7-4bfd-bfc4-e4a6887adfc3",
      role: "cottage_owner",
      approvalState: "prospective",
    });
  });

  it.each([
    undefined,
    { user_id: "not-a-uuid", role: "customer", owner_approval_state: null },
    {
      user_id: "81f35355-d3f7-4bfd-bfc4-e4a6887adfc3",
      role: "unexpected",
      owner_approval_state: null,
    },
    {
      user_id: "81f35355-d3f7-4bfd-bfc4-e4a6887adfc3",
      role: "customer",
      owner_approval_state: "approved",
    },
  ])("rejects invalid provider data %#", (value) => {
    expect(() => parseAccountContext(value)).toThrow(/Account context/);
  });
});
