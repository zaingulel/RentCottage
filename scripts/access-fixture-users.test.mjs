import { describe, expect, it, vi } from "vitest";

import {
  findAccessFixtureUser,
  listAllAccessFixtureUsers,
} from "./lib/access-fixture-users.mjs";

describe("access fixture user lookup", () => {
  it("loads every auth-user page before fixture matching", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `user-${index + 1}`,
      phone: `964750${String(index + 1).padStart(7, "0")}`,
    }));
    const listUsers = vi
      .fn()
      .mockResolvedValueOnce({ data: { users: firstPage }, error: null })
      .mockResolvedValueOnce({
        data: { users: [{ id: "user-1001", phone: "9647510000000" }] },
        error: null,
      });

    const users = await listAllAccessFixtureUsers({ listUsers });

    expect(users).toHaveLength(1001);
    expect(listUsers).toHaveBeenNthCalledWith(1, {
      page: 1,
      perPage: 1000,
    });
    expect(listUsers).toHaveBeenNthCalledWith(2, {
      page: 2,
      perPage: 1000,
    });
  });

  it("matches the same Iraqi phone with or without a leading plus", () => {
    const existing = { id: "owner-1", phone: "9647510000000" };

    expect(findAccessFixtureUser([existing], "+9647510000000")).toBe(existing);
  });
});
