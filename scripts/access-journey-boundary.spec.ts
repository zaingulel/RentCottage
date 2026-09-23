import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import {
  type AccessJourneyInitialState,
  validateAccessJourneyInitialState,
} from "./access-journey-readers";

const allocation = (journey: "signin" | "shared-account") => ({
  journey,
  project: "worker" as const,
  retry: 0,
  repeatEachIndex: 0,
  order: "ordinary" as const,
});
const require = createRequire(import.meta.url);
const { accessJourneyIdentity, prepareAccessJourney } =
  require("./lib/access-journey-fixtures.mjs") as {
    accessJourneyIdentity(coordinates: ReturnType<typeof allocation>): {
      allocation: ReturnType<typeof allocation>;
      draft: { exactAddress: string; legalName: string };
      fixtureCase: { recipe: "draft" | "new-account" };
      phone: string;
    };
    prepareAccessJourney(options: {
      allocation: ReturnType<typeof allocation>;
      environment: NodeJS.ProcessEnv;
      privilegedClient: object;
      publishableKey: string;
      selectedTitle: string;
      url: string;
    }): Promise<{
      allocation: ReturnType<typeof allocation>;
      applicationId: string;
      attemptPath: string;
      draft: { exactAddress: string; legalName: string };
      fixtureCase: { recipe: "draft" };
      phone: string;
      profileId: string;
      userId: string;
      ownerClient: NonNullable<AccessJourneyInitialState["ownerClient"]>;
    }>;
  };

const url = process.env.SUPABASE_URL!;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;
const signinTitle =
  "shared sign-in from the homepage returns a prospective owner to their private application";

test("owned access readiness uses production account and application readers", async () => {
  const privilegedClient = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonymous = accessJourneyIdentity(allocation("shared-account"));
  await validateAccessJourneyInitialState({
    fixture: anonymous,
    privilegedClient,
    publishableKey,
    url,
  });

  const prepared = await prepareAccessJourney({
    allocation: allocation("signin"),
    environment: process.env,
    privilegedClient,
    publishableKey,
    selectedTitle: signinTitle,
    url,
  });
  expect(prepared.phone).not.toBe(anonymous.phone);
  expect(prepared.userId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(prepared.applicationId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(prepared.profileId).toMatch(/^[0-9a-f-]{36}$/i);

  let consumed = false;
  await expect(
    validateAccessJourneyInitialState({
      expectedLegalName: "Incorrect expected legal name",
      fixture: prepared,
      privilegedClient,
      publishableKey,
      url,
    }).then(() => {
      consumed = true;
    }),
  ).rejects.toThrow("production readers found incorrect initial state");
  expect(consumed).toBe(false);

  const incorrectProfileId = crypto.randomUUID();
  expect(incorrectProfileId).not.toBe(prepared.profileId);
  let profileMismatchConsumed = false;
  await expect(
    validateAccessJourneyInitialState({
      fixture: { ...prepared, profileId: incorrectProfileId },
      privilegedClient,
      publishableKey,
      url,
    }).then(() => {
      profileMismatchConsumed = true;
    }),
  ).rejects.toThrow("profile id");
  expect(profileMismatchConsumed).toBe(false);

  await validateAccessJourneyInitialState({
    fixture: prepared,
    privilegedClient,
    publishableKey,
    url,
  });
  const record = JSON.parse(readFileSync(prepared.attemptPath, "utf8"));
  expect(record).toMatchObject({
    applicationId: prepared.applicationId,
    pendingOperation: null,
    phone: prepared.phone,
    profileId: prepared.profileId,
    userId: prepared.userId,
    version: 1,
  });
});
