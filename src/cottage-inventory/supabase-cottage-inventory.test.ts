import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { SupabaseCottageInventoryRepository } from "./supabase-cottage-inventory";

const profileId = "70000000-0000-4000-8000-000000000001";
const revisionId = "71000000-0000-4000-8000-000000000001";
const shiftId = "72000000-0000-4000-8000-000000000001";
const secondShiftId = "72000000-0000-4000-8000-000000000002";
const bundleId = "73000000-0000-4000-8000-000000000001";

describe("Supabase Cottage Inventory adapter", () => {
  it("loads and validates persisted owner editor pricing and dated state", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        profileId,
        scheduleRevisionId: revisionId,
        serviceDay: "2099-08-20",
        units: [
          {
            id: shiftId,
            kind: "shift",
            standardPriceIqd: 125000,
            weekdayOverrides: [{ weekday: 4, priceIqd: 160000 }],
            dateOverrides: [{ serviceDay: "2099-08-27", priceIqd: 180000 }],
            ownerState: "private_blocked",
          },
          {
            id: secondShiftId,
            kind: "shift",
            standardPriceIqd: null,
            weekdayOverrides: [],
            dateOverrides: [],
            ownerState: "closed",
          },
          {
            id: bundleId,
            kind: "full_day_bundle",
            standardPriceIqd: 220000,
            weekdayOverrides: [],
            dateOverrides: [],
            ownerState: "open",
          },
        ],
      },
      error: null,
    });
    const repository = new SupabaseCottageInventoryRepository({
      rpc,
    } as unknown as SupabaseClient);

    await expect(
      repository.loadOwnerEditorState({
        profileId,
        scheduleRevisionId: revisionId,
        serviceDay: "2099-08-20",
      }),
    ).resolves.toMatchObject({
      serviceDay: "2099-08-20",
      units: expect.arrayContaining([
        expect.objectContaining({
          standardPriceIqd: 125000,
          weekdayOverrides: [{ weekday: 4, priceIqd: 160000 }],
          dateOverrides: [{ serviceDay: "2099-08-27", priceIqd: 180000 }],
          ownerState: "private_blocked",
        }),
      ]),
    });
    expect(rpc).toHaveBeenCalledWith(
      "load_cottage_inventory_owner_editor_state",
      {
        target_profile_id: profileId,
        target_schedule_revision_id: revisionId,
        target_service_day: "2099-08-20",
      },
    );
  });

  it("writes pricing through the narrow pricing RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { profileId, scheduleRevisionId: revisionId },
      error: null,
    });
    const repository = new SupabaseCottageInventoryRepository({
      rpc,
    } as unknown as SupabaseClient);

    await expect(
      repository.savePricing({
        profileId,
        scheduleRevisionId: revisionId,
        pricing: {
          units: [{ id: shiftId, kind: "shift", standardPriceIqd: 120000 }],
        },
      }),
    ).resolves.toEqual({ profileId, scheduleRevisionId: revisionId });
    expect(rpc).toHaveBeenCalledWith("save_cottage_inventory_pricing", {
      target_profile_id: profileId,
      target_schedule_revision_id: revisionId,
      requested_prices: {
        units: [
          {
            unitId: shiftId,
            unitKind: "shift",
            standardPriceIqd: 120000,
          },
        ],
      },
    });
  });

  it("parses a fresh server-side resolution through the resolver RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        profileId,
        scheduleRevisionId: revisionId,
        serviceDay: "2099-08-20",
        units: [
          {
            id: shiftId,
            kind: "shift",
            priceIqd: 120000,
            available: false,
            ownerState: "private_blocked",
            committed: true,
            commitmentReference: "RC-BOOKING-2601",
          },
          {
            id: secondShiftId,
            kind: "shift",
            priceIqd: null,
            available: false,
            ownerState: "open",
            committed: false,
            commitmentReference: null,
          },
          {
            id: bundleId,
            kind: "full_day_bundle",
            priceIqd: null,
            available: false,
            ownerState: "closed",
            committed: false,
            commitmentReference: null,
          },
        ],
      },
      error: null,
    });
    const repository = new SupabaseCottageInventoryRepository({
      rpc,
    } as unknown as SupabaseClient);

    await expect(
      repository.resolve({
        profileId,
        scheduleRevisionId: revisionId,
        serviceDay: "2099-08-20",
      }),
    ).resolves.toEqual({
      profileId,
      scheduleRevisionId: revisionId,
      serviceDay: "2099-08-20",
      units: [
        {
          id: shiftId,
          kind: "shift",
          priceIqd: 120000,
          available: false,
          ownerState: "private_blocked",
          committed: true,
          commitmentReference: "RC-BOOKING-2601",
        },
        {
          id: secondShiftId,
          kind: "shift",
          priceIqd: null,
          available: false,
          ownerState: "open",
          committed: false,
          commitmentReference: null,
        },
        {
          id: bundleId,
          kind: "full_day_bundle",
          priceIqd: null,
          available: false,
          ownerState: "closed",
          committed: false,
          commitmentReference: null,
        },
      ],
    });
    expect(rpc).toHaveBeenCalledWith("resolve_cottage_inventory", {
      target_profile_id: profileId,
      target_schedule_revision_id: revisionId,
      target_service_day: "2099-08-20",
    });
  });

  it("writes dated availability through the narrow availability RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        profileId,
        scheduleRevisionId: revisionId,
        serviceDay: "2099-08-20",
      },
      error: null,
    });
    const repository = new SupabaseCottageInventoryRepository({
      rpc,
    } as unknown as SupabaseClient);

    await expect(
      repository.setAvailability({
        profileId,
        scheduleRevisionId: revisionId,
        serviceDay: "2099-08-20",
        availability: {
          units: [{ id: shiftId, kind: "shift", state: "private_blocked" }],
        },
      }),
    ).resolves.toEqual({
      profileId,
      scheduleRevisionId: revisionId,
      serviceDay: "2099-08-20",
    });
    expect(rpc).toHaveBeenCalledWith("set_cottage_inventory_availability", {
      target_profile_id: profileId,
      target_schedule_revision_id: revisionId,
      target_service_day: "2099-08-20",
      requested_states: [
        { unitId: shiftId, unitKind: "shift", state: "private_blocked" },
      ],
    });
  });
});
