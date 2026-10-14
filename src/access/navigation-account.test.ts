import { describe, expect, it } from "vitest";

import { navigationAccountFor } from "./navigation-account";

const customer = {
  status: "authenticated",
  context: { userId: "user-1", role: "customer" },
} as const;

describe("header account", () => {
  it("keeps the signed-in account when the first name cannot be read", () => {
    for (const name of [
      { status: "unavailable" },
      { status: "not_asked" },
      undefined,
    ] as const) {
      expect(navigationAccountFor(customer, name)).toStrictEqual({
        status: "authenticated",
        context: { role: "customer" },
      });
    }
  });

  it("adds only the letter for a named account", () => {
    const account = navigationAccountFor(customer, {
      status: "named",
      firstName: "Zana",
      initial: "Z",
    });
    expect(account).toStrictEqual({
      status: "authenticated",
      context: { role: "customer" },
      name: { status: "named", initial: "Z" },
    });
    expect(JSON.stringify(account)).not.toContain("Zana");
  });

  it("marks a missing first name", () => {
    expect(navigationAccountFor(customer, { status: "missing" })).toStrictEqual(
      {
        status: "authenticated",
        context: { role: "customer" },
        name: { status: "missing" },
      },
    );
  });

  it("maps roles for the header and passes other states through", () => {
    expect(
      navigationAccountFor(
        {
          status: "authenticated",
          context: {
            userId: "user-3",
            role: "cottage_owner",
            approvalState: "approved",
          },
        },
        undefined,
      ),
    ).toStrictEqual({
      status: "authenticated",
      context: { role: "cottage_owner", approvalState: "approved" },
    });
    expect(
      navigationAccountFor(
        { status: "authenticated", context: undefined },
        undefined,
      ),
    ).toStrictEqual({ status: "authenticated", context: undefined });
    expect(
      navigationAccountFor({ status: "signed_out" }, undefined),
    ).toStrictEqual({
      status: "signed_out",
    });
    expect(
      navigationAccountFor({ status: "unavailable" }, undefined),
    ).toStrictEqual({
      status: "unavailable",
    });
  });
});
