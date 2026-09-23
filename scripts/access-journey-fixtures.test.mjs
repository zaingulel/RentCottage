import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import * as fixtures from "./lib/access-journey-fixtures.mjs";

const signinTitle =
  "shared sign-in from the homepage returns a prospective owner to their private application";
const sharedAccountTitle =
  "one account returns to customer bookings, enrolls explicitly and signs out only this device";

const allocation = (overrides = {}) => ({
  journey: "signin",
  project: "worker",
  retry: 0,
  repeatEachIndex: 0,
  order: "ordinary",
  ...overrides,
});

describe("access journey fixture identity contract", () => {
  it("access journey identities isolate signin and shared-account attempts", () => {
    expect(fixtures.accessJourneyCases).toEqual([
      {
        id: 1,
        journey: "signin",
        file: "tests/access.spec.ts",
        title: signinTitle,
        projects: ["mobile", "desktop", "worker"],
        recipe: "draft",
      },
      {
        id: 9,
        journey: "shared-account",
        file: "tests/access.spec.ts",
        title: sharedAccountTitle,
        projects: ["mobile", "desktop", "worker"],
        recipe: "new-account",
      },
    ]);

    const entries = fixtures.accessJourneyOtpEntries();
    expect(entries).toHaveLength(108);
    expect(new Set(entries.map(([phone]) => phone))).toHaveLength(108);
    expect(fixtures.accessJourneyIdentity(allocation()).phone).toBe(
      "+9647700009216",
    );
    expect(
      fixtures.accessJourneyIdentity(
        allocation({ journey: "shared-account", retry: 1 }),
      ).phone,
    ).toBe("+9647700121344");
    expect(
      fixtures.accessJourneyIdentity(allocation({ retry: 1 })).phone,
    ).not.toBe(fixtures.accessJourneyIdentity(allocation()).phone);
    expect(
      fixtures.accessJourneyIdentity(
        allocation({ repeatEachIndex: 1 }),
      ).phone,
    ).not.toBe(fixtures.accessJourneyIdentity(allocation()).phone);
    expect(
      fixtures.accessJourneyIdentity(allocation({ order: "reverse" })).phone,
    ).not.toBe(fixtures.accessJourneyIdentity(allocation()).phone);
  });

  it("access journey admission rejects unsupported coordinates and existing identities", async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "access-journey-admission-"));
    const attemptPath = join(stateRoot, "access-journey-attempt.json");
    const guardDatabase = vi.fn();
    const createUser = vi.fn();
    const valid = allocation();
    const phone = fixtures.accessJourneyIdentity(valid).phone;
    const privilegedClient = {
      auth: {
        admin: {
          createUser,
          listUsers: vi.fn().mockResolvedValue({
            data: { users: [{ id: crypto.randomUUID(), phone }] },
            error: null,
          }),
        },
      },
    };
    const options = {
      allocation: valid,
      environment: {
        APP_ENVIRONMENT: "test",
        SUPABASE_LOCAL_PROJECT: "rentcottage-verification",
        SUPABASE_LOCAL_WORKDIR: stateRoot,
        SUPABASE_URL: "http://127.0.0.1:54331",
      },
      guardDatabase,
      privilegedClient,
      publishableKey: "local-publishable",
      selectedTitle: signinTitle,
      url: "http://127.0.0.1:54331",
    };

    try {
      await expect(
        fixtures.prepareAccessJourney({
          ...options,
          allocation: allocation({ project: "tablet" }),
        }),
      ).rejects.toThrow("Unknown access journey project: tablet");
      await expect(
        fixtures.prepareAccessJourney({
          ...options,
          selectedTitle: sharedAccountTitle,
        }),
      ).rejects.toThrow("Selected access journey title does not match signin");
      expect(guardDatabase).not.toHaveBeenCalled();
      expect(existsSync(attemptPath)).toBe(false);

      await expect(fixtures.prepareAccessJourney(options)).rejects.toThrow(
        "Allocated access journey identity already exists",
      );
      expect(guardDatabase).toHaveBeenCalledOnce();
      expect(createUser).not.toHaveBeenCalled();
      expect(existsSync(attemptPath)).toBe(false);
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });
});
