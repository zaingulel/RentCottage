import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { SupabaseCottagePublicationRepository } from "./supabase-cottage-publication";

const profileId = "70000000-0000-4000-8000-000000000024";
const cycleId = "20000000-0000-4000-8000-000000000024";
const revisionId = "30000000-0000-4000-8000-000000000024";

function result(data: unknown) {
  return Promise.resolve({ data, error: null });
}

function repositoryWith({
  heads = [
    {
      locale: "en",
      localized_revision_id: revisionId,
    },
  ],
  revisions = [
    {
      id: revisionId,
      locale: "en",
      origin: "owner_source",
      description: "Description",
      house_rules: "Rules",
    },
  ],
  decisions = [
    {
      localized_revision_id: revisionId,
      approved: true,
      decided_at: "2026-08-18T00:00:00.000Z",
    },
  ],
  control = { production_ready: false },
}: {
  heads?: unknown;
  revisions?: unknown;
  decisions?: unknown;
  control?: unknown;
} = {}) {
  const client = {
    from: vi.fn((table: string) => {
      if (table === "cottage_profile_review_cycles") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn(() =>
                    result({ id: cycleId, state: "in_review" }),
                  ),
                })),
              })),
            })),
          })),
        };
      }
      if (table === "cottage_profile_localized_heads") {
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => result(heads)) })),
        };
      }
      if (table === "cottage_profile_localized_revisions") {
        return {
          select: vi.fn(() => ({ in: vi.fn(() => result(revisions)) })),
        };
      }
      if (table === "cottage_profile_localized_decisions") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(() => ({ order: vi.fn(() => result(decisions)) })),
            })),
          })),
        };
      }
      if (table === "cottage_translation_runtime_control") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({ single: vi.fn(() => result(control)) })),
          })),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }),
  } as unknown as SupabaseClient;
  return new SupabaseCottagePublicationRepository(client, client);
}

describe("Supabase Cottage publication adapter", () => {
  it.each([
    ["localized heads", { heads: {} }],
    ["localized revisions", { revisions: {} }],
    ["localized decisions", { decisions: {} }],
    ["runtime control", { control: {} }],
    ["runtime readiness", { control: { production_ready: "false" } }],
    [
      "decision approval",
      {
        decisions: [
          {
            localized_revision_id: revisionId,
            approved: "true",
            decided_at: "2026-08-18T00:00:00.000Z",
          },
        ],
      },
    ],
    [
      "localized revision text",
      {
        revisions: [
          {
            id: revisionId,
            locale: "en",
            origin: "owner_source",
            description: "Description",
          },
        ],
      },
    ],
  ] as const)(
    "rejects malformed successful %s payloads",
    async (_name, data) => {
      await expect(
        repositoryWith(data).loadCurrentReview(profileId),
      ).rejects.toThrow("invalid-provider-data");
    },
  );
});
