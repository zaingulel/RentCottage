import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { createCottageInventory } from "./cottage-inventory";
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

it("returns a complete scoped owner calendar span and rejects corrupt cells", async () => {
  const input = {
    profileId,
    scheduleRevisionId: revisionId,
    from: "2099-08-20",
    to: "2099-08-22",
  };
  const unitKeys = [
    { id: shiftId, kind: "shift" },
    { id: secondShiftId, kind: "shift" },
    { id: bundleId, kind: "full_day_bundle" },
  ];
  const cell = (
    index: number,
    calendarState: string | null,
    ownerState = "open",
    temporarilyUnavailable = false,
  ) => ({
    ...unitKeys[index],
    priceIqd: 125000,
    ownerState,
    calendarState,
    temporarilyUnavailable,
    available: calendarState === "open",
    editable: ["open", "closed", "private_blocked"].includes(
      calendarState ?? "",
    ),
    commitmentReference: ["pending_hold", "confirmed_booking"].includes(
      calendarState ?? "",
    )
      ? "RC-BOOKING-2601"
      : null,
  });
  const valid = {
    ...input,
    asOf: "2099-08-01T00:00:00+00:00",
    unitKeys,
    days: [
      {
        serviceDay: "2099-08-20",
        units: [
          cell(0, "open"),
          cell(1, "closed", "closed"),
          cell(2, "private_blocked", "private_blocked"),
        ],
      },
      {
        serviceDay: "2099-08-21",
        units: [
          cell(0, "pending_hold"),
          cell(1, "confirmed_booking"),
          cell(2, "component_unavailable"),
        ],
      },
      {
        serviceDay: "2099-08-22",
        units: [
          cell(0, null, "open", true),
          cell(1, "closed", "closed"),
          cell(2, null, "open", true),
        ],
      },
    ],
  };
  const rpc = vi.fn().mockResolvedValue({ data: valid, error: null });
  const repository = new SupabaseCottageInventoryRepository({
    rpc,
  } as unknown as SupabaseClient);
  await expect(repository.resolveOwnerCalendarSpan(input)).resolves.toEqual(
    valid,
  );
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith(
    "resolve_cottage_inventory_owner_calendar_span",
    {
      target_profile_id: profileId,
      target_schedule_revision_id: revisionId,
      target_from: input.from,
      target_to: input.to,
    },
  );
  const corruptions: Array<(payload: typeof valid) => void> = [
    (p) => {
      Object.assign(p.days[0]!.units[0]!, { priceIqd: null });
    },
    (p) => {
      p.profileId = secondShiftId;
    },
    (p) => {
      p.scheduleRevisionId = secondShiftId;
    },
    (p) => {
      p.from = "2099-08-19";
    },
    (p) => {
      p.to = "2099-08-23";
    },
    (p) => {
      p.asOf = "yesterday";
    },
    (p) => {
      p.days.pop();
    },
    (p) => {
      p.days.push(p.days[0]!);
    },
    (p) => {
      p.days[1] = p.days[0]!;
    },
    (p) => {
      p.days[0]!.units.pop();
    },
    (p) => {
      p.days[0]!.units.push(p.days[0]!.units[0]!);
    },
    (p) => {
      p.days[0]!.units[1] = p.days[0]!.units[0]!;
    },
    (p) => {
      p.days[1]!.units[0]!.id = profileId;
    },
    (p) => {
      p.unitKeys[0]!.id = profileId;
    },
    (p) => {
      p.unitKeys[1] = p.unitKeys[0]!;
    },
    (p) => {
      p.unitKeys.pop();
    },
    (p) => {
      p.days[0]!.units[0]!.ownerState = "pending_hold";
    },
    (p) => {
      p.days[0]!.units[0]!.ownerState = "closed";
    },
    (p) => {
      p.days[0]!.units[0]!.calendarState = "unavailable";
    },
    (p) => {
      p.days[2]!.units[0]!.temporarilyUnavailable = false;
    },
    (p) => {
      p.days[2]!.units[0]!.calendarState = "open";
    },
    (p) => {
      p.days[2]!.units[0]!.available = true;
    },
    (p) => {
      p.days[2]!.units[0]!.editable = true;
    },
    (p) => {
      p.days[2]!.units[0]!.commitmentReference = "borrowed";
    },
    (p) => {
      p.days[1]!.units[0]!.commitmentReference = null;
    },
    (p) => {
      p.days[1]!.units[2]!.commitmentReference = "borrowed";
    },
    (p) => {
      Object.assign(p.days[0]!.units[0]!, { available: "true" });
    },
    (p) => {
      Object.assign(p.days[0]!.units[0]!, { priceIqd: "125000" });
    },
    (p) => {
      Object.assign(p, { privateAddress: "hostile" });
    },
  ];
  for (const corrupt of corruptions) {
    const payload = structuredClone(valid);
    corrupt(payload);
    rpc.mockResolvedValueOnce({ data: payload, error: null });
    await expect(repository.resolveOwnerCalendarSpan(input)).rejects.toThrow(
      "Cottage Inventory provider data is invalid",
    );
  }
  rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
  await expect(repository.resolveOwnerCalendarSpan(input)).rejects.toThrow(
    "Cottage Inventory provider is unavailable",
  );
});

it("rejects malformed batch receipts and preserves refusals", async () => {
  const request = {
    from: "2099-08-20",
    to: "2099-08-21",
    unitKeys: [{ id: shiftId, kind: "shift" as const }],
    state: "closed" as const,
    mode: "range" as const,
    reviewConfirmed: false,
    replacePrivateBlocks: [],
    cells: [
      {
        serviceDay: "2099-08-20",
        id: shiftId,
        kind: "shift" as const,
        expectedOwnerState: "open" as const,
      },
      {
        serviceDay: "2099-08-21",
        id: shiftId,
        kind: "shift" as const,
        expectedOwnerState: "closed" as const,
      },
    ],
  };
  const coordinates = request.cells.map(({ serviceDay, id, kind }) => ({
    serviceDay,
    id,
    kind,
  }));
  const saved = {
    status: "saved",
    profileId,
    scheduleRevisionId: revisionId,
    request,
    changed: [coordinates[0]],
    unchanged: [coordinates[1]],
  };
  const unitKeys = [
    { id: shiftId, kind: "shift" },
    { id: secondShiftId, kind: "shift" },
    { id: bundleId, kind: "full_day_bundle" },
  ];
  const calendar = {
    profileId,
    scheduleRevisionId: revisionId,
    from: request.from,
    to: request.to,
    asOf: "2099-08-01T00:00:00Z",
    unitKeys,
    days: request.cells.map((cell, day) => ({
      serviceDay: cell.serviceDay,
      units: unitKeys.map((key, i) => ({
        ...key,
        ownerState: day === 0 && i === 0 ? "open" : "closed",
        priceIqd: 125000,
        available: false,
        calendarState:
          day === 0 && i === 0
            ? "pending_hold"
            : day === 0 && i === 2
              ? "component_unavailable"
              : "closed",
        commitmentReference: day === 0 && i === 0 ? "RC-BATCH-HOLD" : null,
        editable: !(day === 0 && (i === 0 || i === 2)),
        temporarilyUnavailable: false,
      })),
    })),
  };
  const refused = {
    status: "refused",
    profileId,
    scheduleRevisionId: revisionId,
    request,
    conflicts: [
      {
        ...coordinates[0],
        reason: "pending_hold",
        commitmentReference: "RC-BATCH-HOLD",
      },
    ],
    eligible: [request.cells[1]],
    calendar,
  };
  const rpc = vi.fn().mockResolvedValue({ data: saved, error: null });
  const repository = new SupabaseCottageInventoryRepository({
    rpc,
  } as unknown as SupabaseClient);
  const input = { profileId, scheduleRevisionId: revisionId, batch: request };
  await expect(repository.setAvailabilityBatch(input)).resolves.toEqual(saved);
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "set_cottage_inventory_availability_batch",
    {
      target_profile_id: profileId,
      target_schedule_revision_id: revisionId,
      requested_batch: request,
    },
  );
  rpc.mockResolvedValueOnce({ data: refused, error: null });
  await expect(repository.setAvailabilityBatch(input)).resolves.toEqual(
    refused,
  );
  for (const data of [
    { ...saved, status: "partial" },
    { ...saved, profileId: shiftId },
    { ...saved, extra: true },
    { ...saved, request: { ...request, from: "2099-08-19" } },
    {
      ...saved,
      request: {
        ...request,
        cells: [
          { ...request.cells[0], expectedOwnerState: "closed" },
          request.cells[1],
        ],
      },
    },
    { ...saved, request: { ...request, extra: true } },
    { ...saved, changed: [] },
    { ...saved, changed: coordinates, unchanged: [] },
    { ...saved, changed: [coordinates[0], coordinates[0]] },
    { ...saved, unchanged: [{ ...coordinates[1], id: secondShiftId }] },
    { ...refused, conflicts: [] },
    { ...refused, eligible: [] },
    {
      ...refused,
      eligible: [{ ...request.cells[1], expectedOwnerState: "open" }],
    },
    { ...refused, eligible: [request.cells[0], request.cells[1]] },
    { ...refused, conflicts: [{ ...refused.conflicts[0], reason: "unknown" }] },
    {
      ...refused,
      conflicts: [{ ...refused.conflicts[0], commitmentReference: "forged" }],
    },
    {
      ...refused,
      conflicts: [{ ...refused.conflicts[0], reason: "stale_state" }],
    },
    { ...refused, calendar: { ...calendar, from: "2099-08-19" } },
    { ...refused, calendar: { ...calendar, days: [] } },
  ]) {
    rpc.mockResolvedValueOnce({ data, error: null });
    await expect(repository.setAvailabilityBatch(input)).rejects.toThrow(
      "Cottage Inventory provider data is invalid",
    );
  }
});

it("preserves inventory operation outcomes through the real adapter", async () => {
  type Inventory = ReturnType<typeof createCottageInventory>;
  const serviceDay = "2099-08-20";
  const identity = {
    target_profile_id: profileId,
    target_schedule_revision_id: revisionId,
  };
  const datedIdentity = { ...identity, target_service_day: serviceDay };
  const batch = {
    from: serviceDay,
    to: "2099-08-21",
    unitKeys: [{ id: shiftId, kind: "shift" as const }],
    state: "closed" as const,
    mode: "range" as const,
    reviewConfirmed: false,
    replacePrivateBlocks: [],
    cells: [
      {
        serviceDay,
        id: shiftId,
        kind: "shift" as const,
        expectedOwnerState: "open" as const,
      },
      {
        serviceDay: "2099-08-21",
        id: shiftId,
        kind: "shift" as const,
        expectedOwnerState: "closed" as const,
      },
    ],
  };
  const operations = {
    loadOwnerEditorState: {
      run: (inventory: Inventory) =>
        inventory.loadOwnerEditorState(profileId, revisionId, serviceDay),
      rpc: "load_cottage_inventory_owner_editor_state",
      parameters: datedIdentity,
    },
    savePricing: {
      run: (inventory: Inventory) =>
        inventory.savePricing(profileId, revisionId, {
          units: [{ id: shiftId, kind: "shift", standardPriceIqd: 120000 }],
        }),
      rpc: "save_cottage_inventory_pricing",
      parameters: {
        ...identity,
        requested_prices: {
          units: [
            { unitId: shiftId, unitKind: "shift", standardPriceIqd: 120000 },
          ],
        },
      },
    },
    resolvePublicAvailability: {
      run: (inventory: Inventory) =>
        inventory.resolvePublicAvailability(profileId, revisionId, serviceDay),
      rpc: "resolve_cottage_inventory_public_availability",
      parameters: datedIdentity,
    },
    resolveOwnerCalendar: {
      run: (inventory: Inventory) =>
        inventory.resolveOwnerCalendar(profileId, revisionId, serviceDay),
      rpc: "resolve_cottage_inventory_owner_calendar",
      parameters: datedIdentity,
    },
    resolveOwnerCalendarSpan: {
      run: (inventory: Inventory) =>
        inventory.resolveOwnerCalendarSpan(
          profileId,
          revisionId,
          serviceDay,
          "2099-08-21",
        ),
      rpc: "resolve_cottage_inventory_owner_calendar_span",
      parameters: {
        ...identity,
        target_from: serviceDay,
        target_to: "2099-08-21",
      },
    },
    setAvailability: {
      run: (inventory: Inventory) =>
        inventory.setAvailability(profileId, revisionId, serviceDay, {
          units: [{ id: shiftId, kind: "shift", state: "private_blocked" }],
        }),
      rpc: "set_cottage_inventory_availability",
      parameters: {
        ...datedIdentity,
        requested_states: [
          { unitId: shiftId, unitKind: "shift", state: "private_blocked" },
        ],
      },
    },
    setAvailabilityBatch: {
      run: (inventory: Inventory) =>
        inventory.setAvailabilityBatch(profileId, revisionId, batch),
      rpc: "set_cottage_inventory_availability_batch",
      parameters: { ...identity, requested_batch: batch },
    },
  };
  const cases = [
    {
      operation: "loadOwnerEditorState",
      code: "42501",
      expected: { status: "denied" },
    },
    { operation: "savePricing", code: "42501", expected: { status: "denied" } },
    {
      operation: "resolvePublicAvailability",
      code: "42501",
      expected: { status: "denied" },
    },
    {
      operation: "resolveOwnerCalendar",
      code: "42501",
      expected: { status: "denied" },
    },
    {
      operation: "resolveOwnerCalendarSpan",
      code: "42501",
      expected: { status: "denied" },
    },
    {
      operation: "setAvailability",
      code: "42501",
      expected: { status: "denied" },
    },
    {
      operation: "setAvailabilityBatch",
      code: "42501",
      expected: { status: "denied" },
    },
    {
      operation: "savePricing",
      code: "RC409",
      expected: { status: "conflict" },
    },
    { operation: "savePricing", code: "RC202", expected: { status: "denied" } },
    {
      operation: "setAvailabilityBatch",
      code: "22023",
      expected: { status: "invalid", fields: ["batch"] },
    },
    {
      operation: "setAvailabilityBatch",
      code: "RC409",
      expected: { status: "conflict" },
    },
    {
      operation: "resolveOwnerCalendarSpan",
      code: "22023",
      expected: { status: "unavailable" },
    },
    {
      operation: "savePricing",
      code: "UNKNOWN",
      expected: { status: "unavailable" },
    },
  ] as const;
  for (const example of cases) {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: example.code },
    });
    const from = vi.fn();
    const storageFrom = vi.fn();
    const inventory = createCottageInventory(
      new SupabaseCottageInventoryRepository({
        rpc,
        from,
        storage: { from: storageFrom },
      } as unknown as SupabaseClient),
    );
    const operation = operations[example.operation];
    const context = `${example.operation}: ${example.code}`;
    await expect(operation.run(inventory), context).resolves.toEqual(
      example.expected,
    );
    expect(rpc, context).toHaveBeenCalledExactlyOnceWith(
      operation.rpc,
      operation.parameters,
    );
    expect(from, context).not.toHaveBeenCalled();
    expect(storageFrom, context).not.toHaveBeenCalled();
  }
});
