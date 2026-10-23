import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { BookingCompletionResult } from "./booking-completion";
import { runScheduledBookingCompletion } from "./booking-completion-schedule";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  })),
}));

const environment = {
  APP_ENVIRONMENT: "test",
  SUPABASE_PROJECT_REF: "local-test",
  SUPABASE_URL: "http://127.0.0.1:54331",
  SUPABASE_PUBLISHABLE_KEY: "local-publishable",
  SUPABASE_SECRET_KEY: "local-secret",
};

describe("scheduled booking completion", () => {
  it.each([
    { APP_ENVIRONMENT: "production" },
    { APP_ENVIRONMENT: "preview" },
    { SUPABASE_PROJECT_REF: "hosted" },
    { SUPABASE_URL: "https://example.supabase.co" },
    { SUPABASE_URL: "http://remote.example" },
    { SUPABASE_SECRET_KEY: "" },
    { SUPABASE_PUBLISHABLE_KEY: "" },
  ])(
    "rejects unapproved execution before constructing the drain %#",
    async (override) => {
      const processDue = vi.fn();
      await expect(
        runScheduledBookingCompletion(
          { ...environment, ...override },
          processDue,
        ),
      ).rejects.toThrow("approved fictional runtime");
      expect(processDue).not.toHaveBeenCalled();
    },
  );

  it("runs one bounded drain and permits an empty successful tick", async () => {
    const processDue = vi.fn().mockResolvedValue([]);
    await expect(
      runScheduledBookingCompletion(environment, processDue),
    ).resolves.toEqual([]);
    expect(processDue).toHaveBeenCalledExactlyOnceWith(50);
  });

  it("preserves successful outcomes and candidates made ineligible before commit", async () => {
    const results: readonly BookingCompletionResult[] = [
      {
        status: "completed",
        bookingRequestId: "60000000-0000-4000-8000-000000003901",
        effectivePeriodEnd: "2099-08-24T18:00:00.000Z",
        completedAt: "2099-08-24T18:01:00.000Z",
      },
      {
        status: "ineligible",
        bookingRequestId: "60000000-0000-4000-8000-000000003902",
      },
      {
        status: "matured",
        bookingRequestId: "60000000-0000-4000-8000-000000003903",
        effectivePeriodEnd: "2099-08-24T18:00:00.000Z",
        assessedAt: "2099-08-24T18:01:00.000Z",
      },
    ];

    await expect(
      runScheduledBookingCompletion(environment, async () => results),
    ).resolves.toEqual(results);
  });

  it("propagates a failed drain without converting it into a successful tick", async () => {
    const error = new Error("Booking completion could not be recorded");

    await expect(
      runScheduledBookingCompletion(environment, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});

it("scheduled booking completion admits only the exact hosted demo before constructing the drain", async () => {
  const hosted = {
    APP_ENVIRONMENT: "preview",
    HOSTED_DEMO: "true",
    SUPABASE_PROJECT_REF: "yvibcyqtyihpzpmomnzg",
    SUPABASE_URL: "https://yvibcyqtyihpzpmomnzg.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable",
    SUPABASE_SECRET_KEY: "synthetic-secret",
    PRIVILEGED_AUDIT_HMAC_KEY: "synthetic-audit-key-with-32-characters",
    DEPLOYMENT_COMMIT: "0123456789abcdef0123456789abcdef01234567",
  };
  vi.mocked(createClient).mockClear();

  await expect(runScheduledBookingCompletion(hosted)).resolves.toEqual([]);
  expect(createClient).toHaveBeenCalledExactlyOnceWith(
    "https://yvibcyqtyihpzpmomnzg.supabase.co",
    "synthetic-secret",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  expect(
    vi.mocked(createClient).mock.results[0].value.rpc,
  ).toHaveBeenCalledExactlyOnceWith("list_due_booking_completions", {
    target_limit: 50,
  });

  const deniedOverrides: readonly Partial<typeof hosted>[] = [
    ...Object.keys(hosted).map((key) => ({ [key]: undefined })),
    { APP_ENVIRONMENT: "production" },
    { APP_ENVIRONMENT: "test" },
    { APP_ENVIRONMENT: "development" },
    { HOSTED_DEMO: "false" },
    { HOSTED_DEMO: "TRUE" },
    { SUPABASE_PROJECT_REF: "another-project" },
    {
      SUPABASE_PROJECT_REF: "another-project",
      SUPABASE_URL: "https://another-project.supabase.co",
    },
    { SUPABASE_URL: "invalid" },
    { SUPABASE_URL: `${hosted.SUPABASE_URL}/rest/v1` },
    { SUPABASE_URL: `${hosted.SUPABASE_URL}/` },
    { SUPABASE_URL: `${hosted.SUPABASE_URL}?project=approved` },
    { SUPABASE_URL: `${hosted.SUPABASE_URL}#approved` },
    {
      SUPABASE_URL: "https://attacker@yvibcyqtyihpzpmomnzg.supabase.co",
    },
    { SUPABASE_PUBLISHABLE_KEY: "" },
    { SUPABASE_SECRET_KEY: "" },
    { PRIVILEGED_AUDIT_HMAC_KEY: "short" },
    { DEPLOYMENT_COMMIT: "0123456789abcdef0123456789abcdef0123456" },
    { DEPLOYMENT_COMMIT: "gggggggggggggggggggggggggggggggggggggggg" },
  ];
  for (const override of deniedOverrides) {
    vi.mocked(createClient).mockClear();
    await expect(
      runScheduledBookingCompletion({ ...hosted, ...override }),
    ).rejects.toThrow(
      "Scheduled booking completion requires an approved fictional runtime and credentials",
    );
    expect(createClient).not.toHaveBeenCalled();
  }
});
