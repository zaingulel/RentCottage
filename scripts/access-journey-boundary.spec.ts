import { createRequire } from "node:module";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import {
  type AccessJourneyInitialState,
  validateAccessJourneyInitialState,
} from "./access-journey-readers";

const allocation = (
  journey: "signin" | "owner-submit" | "owner-layout" | "shared-account",
) => ({
  journey,
  project: "worker" as const,
  retry: 0,
  repeatEachIndex: 0,
  phase: "boundary" as const,
});
const require = createRequire(import.meta.url);
const { accessJourneyCases, prepareAccessJourney } =
  require("./lib/access-journey-fixtures.mjs") as {
    accessJourneyCases: ReadonlyArray<{
      journey: ReturnType<typeof allocation>["journey"];
      title: string;
      recipe: "draft" | "new-account";
    }>;
    prepareAccessJourney(options: {
      allocation: ReturnType<typeof allocation>;
      environment: NodeJS.ProcessEnv;
      privilegedClient: object;
      publishableKey: string;
      selectedTitle: string;
      url: string;
    }): Promise<AccessJourneyInitialState>;
  };

const url = process.env.SUPABASE_URL!;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY!;
const secretKey = process.env.SUPABASE_SECRET_KEY!;

test("owned access readiness uses production account and application readers", async () => {
  const privilegedClient = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const fixtures: AccessJourneyInitialState[] = [];
  for (const fixtureCase of accessJourneyCases) {
    const fixture = await prepareAccessJourney({
      allocation: allocation(fixtureCase.journey),
      environment: process.env,
      privilegedClient,
      publishableKey,
      selectedTitle: fixtureCase.title,
      url,
    });
    await validateAccessJourneyInitialState({
      fixture,
      privilegedClient,
      publishableKey,
      url,
    });
    fixtures.push(fixture);
  }
  expect(fixtures.map((fixture) => fixture.allocation.journey)).toEqual([
    "signin",
    "owner-submit",
    "owner-layout",
    "shared-account",
  ]);
  expect(new Set(fixtures.map((fixture) => fixture.phone)).size).toBe(4);
  const prepared = fixtures[0];
  expect(prepared.userId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(prepared.applicationId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(prepared.profileId).toMatch(/^[0-9a-f-]{36}$/i);
  for (const fixture of fixtures.slice(1)) {
    expect(fixture.userId).toBeUndefined();
    expect(fixture.applicationId).toBeUndefined();
    expect(fixture.profileId).toBeUndefined();
  }

  for (const [overrides, candidateUrl, expectedError] of [
    [
      { APP_ENVIRONMENT: "production" },
      url,
      "Access journey fixtures require APP_ENVIRONMENT=test.",
    ],
    [
      { SUPABASE_URL: "http://127.0.0.1:54331" },
      url,
      "Access journey fixture environment is not disposable.",
    ],
    [
      { SUPABASE_URL: "invalid" },
      "invalid",
      "Access journey fixtures require loopback Supabase.",
    ],
    [
      { SUPABASE_URL: "https://127.0.0.1:55331" },
      "https://127.0.0.1:55331",
      "Access journey fixture environment is not disposable.",
    ],
    [
      { SUPABASE_URL: "http://example.com:55331" },
      "http://example.com:55331",
      "Access journey fixture environment is not disposable.",
    ],
    [
      { SUPABASE_LOCAL_PROJECT: "demo_project" },
      url,
      "Access journey fixture environment is not disposable.",
    ],
    [
      { SUPABASE_LOCAL_WORKDIR: "" },
      url,
      "Access journey fixture environment is not disposable.",
    ],
  ] as const) {
    let invalidEnvironmentConsumed = false;
    await expect(
      validateAccessJourneyInitialState({
        environment: { ...process.env, ...overrides },
        fixture: prepared,
        privilegedClient,
        publishableKey,
        url: candidateUrl,
      }).then(() => {
        invalidEnvironmentConsumed = true;
      }),
    ).rejects.toThrow(expectedError);
    expect(invalidEnvironmentConsumed).toBe(false);
  }

  const absent = fixtures[1];
  const created = await privilegedClient.auth.admin.createUser({
    phone: absent.phone,
    phone_confirm: true,
  });
  expect(created.error).toBeNull();
  expect(created.data.user?.id).toMatch(/^[0-9a-f-]{36}$/i);
  let absentConsumed = false;
  await expect(
    validateAccessJourneyInitialState({
      fixture: absent,
      privilegedClient,
      publishableKey,
      url,
    }).then(() => {
      absentConsumed = true;
    }),
  ).rejects.toThrow("reserved phone is not absent");
  expect(absentConsumed).toBe(false);

  for (const field of ["userId", "applicationId", "profileId"]) {
    let invalidIdConsumed = false;
    await expect(
      validateAccessJourneyInitialState({
        fixture: { ...prepared, [field]: "invalid'::uuid" },
        privilegedClient,
        publishableKey,
        url,
      }).then(() => {
        invalidIdConsumed = true;
      }),
    ).rejects.toThrow("incomplete issued identifiers");
    expect(invalidIdConsumed).toBe(false);
  }

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
});
