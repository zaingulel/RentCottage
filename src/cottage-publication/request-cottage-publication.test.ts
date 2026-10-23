import { afterEach, expect, it, vi } from "vitest";

import * as translationConfiguration from "@/translation/configuration";

import { createRequestCottageTranslation } from "./request-cottage-publication";

const { client, createAdapter, translate } = vi.hoisted(() => {
  const translate = vi.fn().mockResolvedValue({
    humanReviewReason: "synthetic provider review required",
  });
  return {
    client: { rpc: vi.fn(), from: vi.fn() },
    createAdapter: vi.fn(() => ({ translate })),
    translate,
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => client),
}));
vi.mock("@/access/supabase-server", () => ({
  createRequestSupabaseClient: vi.fn(async () => client),
}));
vi.mock("@/translation/openai-responses", () => ({
  createOpenAIResponsesTranslationAdapter: createAdapter,
}));
vi.mock("@/config/hosted-demo-target", () => ({
  hostedDemoTarget: {
    workerOrigin: "https://invited-demo.example.workers.dev",
    supabaseProjectRef: "demo-fixture",
    accessIssuer: "https://fixture.cloudflareaccess.com",
    accessAudience: "fixture-application-audience",
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("hosted demo generates only supported fictional samples without live provider construction or usage", async () => {
  const source = {
    APP_ENVIRONMENT: "preview",
    SUPABASE_PROJECT_REF: "demo-fixture",
    SUPABASE_URL: "https://demo-fixture.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "fixture-publishable",
    SUPABASE_SECRET_KEY: "fixture-secret",
    PRIVILEGED_AUDIT_HMAC_KEY: "fixture-audit-key-with-at-least-32-characters",
    DEPLOYMENT_COMMIT: "b".repeat(40),
    OPENAI_API_KEY: "synthetic-provider-key-never-live",
    TRANSLATION_PROVIDER_TERMS_APPROVED: "true",
    TRANSLATION_NATIVE_REVIEW_APPROVED: "true",
    TRANSLATION_QUALITY_THRESHOLD_APPROVED: "true",
    TRANSLATION_ORDINARY_PROMPT_CONTENT: "Fixture translation prompt",
    TRANSLATION_STRONGER_PROMPT_CONTENT: "Fixture translation prompt",
    TRANSLATION_JUDGE_PROMPT_CONTENT: "Fixture judge prompt",
    TRANSLATION_EVALUATION_PROTOCOL_DIGEST: "c".repeat(64),
    TRANSLATION_APPROVED_EVALUATION_ARTIFACT_DIGEST: "a".repeat(64),
    // Approval of these synthetic routes and prompts, never a live approval.
    TRANSLATION_PRODUCTION_APPROVAL_DIGEST:
      "600b6809a6900672100541cb004f495ebbbd83dc263935c9176f399e313dfcd7",
    TRANSLATION_MONTHLY_REQUEST_LIMIT: "1000",
    TRANSLATION_MONTHLY_TOKEN_LIMIT: "1000000",
    TRANSLATION_MONTHLY_SPEND_MICROUSD_LIMIT: "50000000",
    TRANSLATION_RESERVATION_MICROUSD: "10000",
    TRANSLATION_MAXIMUM_ATTEMPTS: "3",
    TRANSLATION_TIMEOUT_MILLISECONDS: "15000",
    TRANSLATION_MAXIMUM_SEGMENT_CHARACTERS: "2000",
    TRANSLATION_MAXIMUM_REQUEST_BYTES: "3000",
    TRANSLATION_MAXIMUM_INPUT_TOKENS: "4096",
    TRANSLATION_PROVIDER_FRAMING_TOKEN_ALLOWANCE: "512",
    TRANSLATION_MAXIMUM_OUTPUT_TOKENS: "512",
    TRANSLATION_INPUT_MICROUSD_PER_MILLION: "200000",
    TRANSLATION_OUTPUT_MICROUSD_PER_MILLION: "1200000",
  };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("TRANSLATION_") || key.startsWith("NEXT_PUBLIC_")) {
      vi.stubEnv(key, undefined);
    }
  }
  for (const [key, value] of Object.entries(source)) vi.stubEnv(key, value);
  vi.stubEnv("HOSTED_DEMO", undefined);

  const reviewCycleId = "20000000-0000-4000-8000-000000000818";
  const attemptId = "40000000-0000-4000-8000-000000000818";
  const leaseToken = "50000000-0000-4000-8000-000000000818";
  let description =
    "Fictional demonstration cottage in the Shaqlawa area of Erbil. A garden and pool setting for up to eight guests, with three bedrooms, two bathrooms and parking. No real accommodation is offered.";
  client.rpc.mockImplementation(async (name: string) => {
    switch (name) {
      case "begin_cottage_profile_translation_execution":
        return {
          data: {
            id: attemptId,
            lease_token: leaseToken,
            review_cycle_id: reviewCycleId,
            source_revision_id: "30000000-0000-4000-8000-000000000818",
            target_language: "ar",
          },
          error: null,
        };
      case "reserve_cottage_translation_usage":
        return {
          data: { granted: true, reservation_id: "synthetic-reservation" },
          error: null,
        };
      case "complete_cottage_profile_translation_execution":
      case "route_current_cottage_translation_to_human_review":
      case "fail_cottage_profile_translation_execution":
        return { data: true, error: null };
      default:
        throw new Error(`Unexpected fixture operation: ${name}`);
    }
  });
  client.from.mockImplementation((table: string) => {
    if (table === "cottage_profile_source_revisions") {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                source_language: "en",
                description,
                house_rules:
                  "Fictional demonstration only. Respect neighbours, do not smoke indoors, and keep the party within the cottage's stated guest capacity.",
              },
              error: null,
            }),
          }),
        }),
      };
    }
    if (table === "cottage_translation_cache") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected fixture table: ${table}`);
  });
  const readConfiguration = vi.spyOn(
    translationConfiguration,
    "readTranslationConfiguration",
  );

  const ordinary = await createRequestCottageTranslation();
  expect(await ordinary.generateTranslation(reviewCycleId, "ar")).toEqual({
    status: "human_review_required",
  });
  expect(readConfiguration).toHaveBeenCalledOnce();
  expect(createAdapter).toHaveBeenCalledExactlyOnceWith({
    apiKey: "synthetic-provider-key-never-live",
    timeoutMilliseconds: 15000,
  });
  expect(translate).toHaveBeenCalledOnce();

  vi.clearAllMocks();
  vi.stubEnv("HOSTED_DEMO", "true");
  const hostedDemo = await createRequestCottageTranslation();
  expect(await hostedDemo.generateTranslation(reviewCycleId, "ar")).toEqual({
    status: "completed",
  });
  expect(readConfiguration).not.toHaveBeenCalled();
  expect(createAdapter).not.toHaveBeenCalled();
  expect(translate).not.toHaveBeenCalled();
  expect(client.rpc).toHaveBeenCalledTimes(2);
  expect(client.rpc).toHaveBeenCalledWith(
    "begin_cottage_profile_translation_execution",
    {
      target_review_cycle_id: reviewCycleId,
      target_language: "ar",
      target_route: "ordinary",
      target_lease_milliseconds: 6000,
    },
  );
  expect(client.rpc).toHaveBeenCalledWith(
    "complete_cottage_profile_translation_execution",
    expect.objectContaining({
      target_attempt_id: attemptId,
      target_lease_token: leaseToken,
      returned_provider: "fictional-cottage-translations",
      returned_model: "catalog-v1",
      returned_effort: "none",
      returned_prompt_version: "fictional-cottage-catalog-v1",
      translated_description:
        "كوخ تجريبي خيالي في منطقة شقلاوة في أربيل. حديقة ومسبح لما يصل إلى ثمانية ضيوف، مع ثلاث غرف نوم وحمامين وموقف سيارات. لا يُعرض أي سكن حقيقي.",
    }),
  );
  expect(client.rpc).not.toHaveBeenCalledWith(
    "reserve_cottage_translation_usage",
    expect.anything(),
  );

  vi.clearAllMocks();
  description += " Edited.";
  expect(await hostedDemo.generateTranslation(reviewCycleId, "ar")).toEqual({
    status: "unsupported_content",
  });
  expect(client.rpc).toHaveBeenCalledWith(
    "fail_cottage_profile_translation_execution",
    {
      target_attempt_id: attemptId,
      target_lease_token: leaseToken,
      target_failure_code: "unsupported_content",
    },
  );
  expect(client.rpc).not.toHaveBeenCalledWith(
    "complete_cottage_profile_translation_execution",
    expect.anything(),
  );
  expect(client.rpc).not.toHaveBeenCalledWith(
    "reserve_cottage_translation_usage",
    expect.anything(),
  );
  expect(createAdapter).not.toHaveBeenCalled();
  expect(translate).not.toHaveBeenCalled();
});
