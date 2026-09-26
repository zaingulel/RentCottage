import { createRequire } from "node:module";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TestInfo } from "@playwright/test";

import {
  type AccessJourneyInitialState,
  validateAccessJourneyInitialState,
} from "./access-journey-readers";

export type OwnedAccessJourney =
  | "signin"
  | "owner-submit"
  | "owner-layout"
  | "shared-account";
type Allocation = AccessJourneyInitialState["allocation"];
type NativeAttempt = Pick<
  TestInfo,
  "project" | "retry" | "repeatEachIndex" | "title"
>;

const { accessJourneyIdentity, prepareAccessJourney } = createRequire(
  import.meta.url,
)("./lib/access-journey-fixtures.mjs") as {
  accessJourneyIdentity(input: {
    journey: OwnedAccessJourney;
    project: string;
    retry: number;
    repeatEachIndex: number;
    phase: string;
  }): { allocation: Allocation; fixtureCase: { title: string } };
  prepareAccessJourney(options: {
    allocation: Allocation;
    environment: NodeJS.ProcessEnv;
    privilegedClient: SupabaseClient;
    publishableKey: string;
    selectedTitle: string;
    url: string;
  }): Promise<AccessJourneyInitialState>;
};
const consumedCoordinates = new Set<string>();

export function ownedAccessJourneyAllocation(
  journey: OwnedAccessJourney,
  testInfo: NativeAttempt,
  phase: string,
): Allocation {
  const identity = accessJourneyIdentity({
    journey,
    project: testInfo.project.name,
    retry: testInfo.retry,
    repeatEachIndex: testInfo.repeatEachIndex,
    phase,
  });
  if (testInfo.title !== identity.fixtureCase.title) {
    throw new Error(`Selected access journey title does not match ${journey}.`);
  }
  return identity.allocation;
}

export async function prepareOwnedAccessJourney(
  journey: OwnedAccessJourney,
  testInfo: TestInfo,
  dependencies = {
    createClient,
    prepareAccessJourney,
    validateAccessJourneyInitialState,
  },
): Promise<AccessJourneyInitialState> {
  const allocation = ownedAccessJourneyAllocation(
    journey,
    testInfo,
    process.env.ACCESS_JOURNEY_PHASE ?? "ordinary",
  );
  const coordinate = JSON.stringify(allocation);
  if (consumedCoordinates.has(coordinate)) {
    throw new Error(`Duplicate access journey attempt: ${coordinate}.`);
  }
  consumedCoordinates.add(coordinate);
  const url = process.env.SUPABASE_URL ?? "";
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
  const privilegedClient = dependencies.createClient(
    url,
    process.env.SUPABASE_SECRET_KEY ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const fixture = await dependencies.prepareAccessJourney({
    allocation,
    environment: process.env,
    privilegedClient,
    publishableKey,
    selectedTitle: testInfo.title,
    url,
  });
  await dependencies.validateAccessJourneyInitialState({
    fixture,
    privilegedClient,
    publishableKey,
    url,
  });
  await testInfo.attach("owned-access-journey-readiness", {
    body: Buffer.from(
      JSON.stringify({
        allocation: fixture.allocation,
        phone: fixture.phone,
        applicationId: fixture.applicationId,
        profileId: fixture.profileId,
        userId: fixture.userId,
        readiness: "validated",
      }),
    ),
    contentType: "application/json",
  });
  return fixture;
}
