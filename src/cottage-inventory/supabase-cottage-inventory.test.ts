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

  it("parses the exact narrow public availability response", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        profileId,
        scheduleRevisionId: revisionId,
        serviceDay: "2099-08-20",
        units: [
          { id: shiftId, kind: "shift", available: true },
          { id: secondShiftId, kind: "shift", available: false },
          { id: bundleId, kind: "full_day_bundle", available: false },
        ],
      },
      error: null,
    });
    const repository = new SupabaseCottageInventoryRepository({
      rpc,
    } as unknown as SupabaseClient);

    await expect(
      repository.resolvePublicAvailability({
        profileId,
        scheduleRevisionId: revisionId,
        serviceDay: "2099-08-20",
      }),
    ).resolves.toEqual({
      profileId,
      scheduleRevisionId: revisionId,
      serviceDay: "2099-08-20",
      units: [
        { id: shiftId, kind: "shift", available: true },
        { id: secondShiftId, kind: "shift", available: false },
        { id: bundleId, kind: "full_day_bundle", available: false },
      ],
    });
    expect(rpc).toHaveBeenCalledWith(
      "resolve_cottage_inventory_public_availability",
      {
        target_profile_id: profileId,
        target_schedule_revision_id: revisionId,
        target_service_day: "2099-08-20",
      },
    );
  });

  it("rejects privileged keys at the public availability boundary", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        profileId,
        scheduleRevisionId: revisionId,
        serviceDay: "2099-08-20",
        units: [
          {
            id: shiftId,
            kind: "shift",
            available: false,
            commitmentReference: "RC-BOOKING-2601",
          },
          {
            id: secondShiftId,
            kind: "shift",
            available: false,
          },
          {
            id: bundleId,
            kind: "full_day_bundle",
            available: false,
          },
        ],
      },
      error: null,
    });
    const repository = new SupabaseCottageInventoryRepository({
      rpc,
    } as unknown as SupabaseClient);

    await expect(
      repository.resolvePublicAvailability({
        profileId,
        scheduleRevisionId: revisionId,
        serviceDay: "2099-08-20",
      }),
    ).rejects.toThrow("Cottage Inventory provider data is invalid");
    expect(rpc).toHaveBeenCalledWith(
      "resolve_cottage_inventory_public_availability",
      {
        target_profile_id: profileId,
        target_schedule_revision_id: revisionId,
        target_service_day: "2099-08-20",
      },
    );
  });

  it("parses direct commitments and component-derived bundle state through the owner calendar RPC", async () => {
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
            calendarState: "pending_hold",
            commitmentReference: "RC-REQUEST-2601",
            editable: false,
          },
          {
            id: secondShiftId,
            kind: "shift",
            priceIqd: 115000,
            available: true,
            calendarState: "open",
            commitmentReference: null,
            editable: true,
          },
          {
            id: bundleId,
            kind: "full_day_bundle",
            priceIqd: 220000,
            available: false,
            calendarState: "component_unavailable",
            commitmentReference: null,
            editable: false,
          },
        ],
      },
      error: null,
    });
    const repository = new SupabaseCottageInventoryRepository({
      rpc,
    } as unknown as SupabaseClient);

    await expect(
      repository.resolveOwnerCalendar({
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
          calendarState: "pending_hold",
          commitmentReference: "RC-REQUEST-2601",
          editable: false,
        },
        {
          id: secondShiftId,
          kind: "shift",
          priceIqd: 115000,
          available: true,
          calendarState: "open",
          commitmentReference: null,
          editable: true,
        },
        {
          id: bundleId,
          kind: "full_day_bundle",
          priceIqd: 220000,
          available: false,
          calendarState: "component_unavailable",
          commitmentReference: null,
          editable: false,
        },
      ],
    });
    expect(rpc).toHaveBeenCalledWith(
      "resolve_cottage_inventory_owner_calendar",
      {
        target_profile_id: profileId,
        target_schedule_revision_id: revisionId,
        target_service_day: "2099-08-20",
      },
    );
  });

  it.each([
    {
      name: "an editable component-derived bundle",
      index: 2,
      changes: { editable: true },
    },
    {
      name: "an available Pending Hold",
      index: 0,
      changes: { available: true },
    },
    {
      name: "an available Closed Shift",
      index: 1,
      changes: { calendarState: "closed", available: true },
    },
    {
      name: "a read-only uncommitted Shift",
      index: 1,
      changes: { calendarState: "private_blocked", editable: false },
    },
  ])("rejects $name from the Owner Calendar provider", async (example) => {
    const units = [
      {
        id: shiftId,
        kind: "shift",
        priceIqd: 120000,
        available: false,
        calendarState: "pending_hold",
        commitmentReference: "RC-REQUEST-2601",
        editable: false,
      },
      {
        id: secondShiftId,
        kind: "shift",
        priceIqd: 115000,
        available: true,
        calendarState: "open",
        commitmentReference: null,
        editable: true,
      },
      {
        id: bundleId,
        kind: "full_day_bundle",
        priceIqd: 220000,
        available: false,
        calendarState: "component_unavailable",
        commitmentReference: null,
        editable: false,
      },
    ];
    units[example.index] = { ...units[example.index]!, ...example.changes };
    const rpc = vi.fn().mockResolvedValue({
      data: {
        profileId,
        scheduleRevisionId: revisionId,
        serviceDay: "2099-08-20",
        units,
      },
      error: null,
    });
    const repository = new SupabaseCottageInventoryRepository({
      rpc,
    } as unknown as SupabaseClient);

    await expect(
      repository.resolveOwnerCalendar({
        profileId,
        scheduleRevisionId: revisionId,
        serviceDay: "2099-08-20",
      }),
    ).rejects.toThrow("Cottage Inventory provider data is invalid");
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
