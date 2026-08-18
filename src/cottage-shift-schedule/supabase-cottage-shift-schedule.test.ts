import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { SupabaseCottageShiftScheduleRepository } from "./supabase-cottage-shift-schedule";

const profileId = "70000000-0000-4000-8000-000000000001";

describe("Supabase Cottage Shift Schedule adapter", () => {
  it("saves the normalized schedule through one atomic database operation", async () => {
    const data = {
      profileId,
      revision: 2,
      fullDayBundleId: "90000000-0000-4000-8000-000000000001",
      shifts: [
        {
          id: "80000000-0000-4000-8000-000000000001",
          name: "Morning",
          startTime: "08:00",
          endTime: "12:00",
          position: 1,
          crossesMidnight: false,
        },
        {
          id: "80000000-0000-4000-8000-000000000002",
          name: "Evening",
          startTime: "18:00",
          endTime: "02:00",
          position: 2,
          crossesMidnight: true,
        },
      ],
    };
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    const repository = new SupabaseCottageShiftScheduleRepository({
      rpc,
    } as unknown as SupabaseClient);

    await expect(
      repository.save({
        profileId,
        expectedRevision: 1,
        shifts: data.shifts.map(
          ({ name, startTime, endTime, position, crossesMidnight }) => ({
            name,
            startTime,
            endTime,
            position,
            crossesMidnight,
          }),
        ),
      }),
    ).resolves.toEqual(data);
    expect(rpc).toHaveBeenCalledWith("replace_cottage_shift_schedule", {
      target_profile_id: profileId,
      target_expected_revision: 1,
      requested_shifts: data.shifts.map(({ name, startTime, endTime }) => ({
        name,
        startTime,
        endTime,
      })),
    });
  });

  it("loads the profile pointer and its complete current revision through RLS reads", async () => {
    const revisionId = "91000000-0000-4000-8000-000000000001";
    const maybeSingleProfile = vi.fn().mockResolvedValue({
      data: { current_shift_schedule_id: revisionId },
      error: null,
    });
    const maybeSingleRevision = vi.fn().mockResolvedValue({
      data: {
        id: revisionId,
        profile_id: profileId,
        revision: 3,
        full_day_bundle_id: "90000000-0000-4000-8000-000000000001",
      },
      error: null,
    });
    const shifts = [
      {
        id: "80000000-0000-4000-8000-000000000001",
        schedule_revision_id: revisionId,
        position: 1,
        name: "Morning",
        start_time: "08:00:00",
        end_time: "12:00:00",
      },
      {
        id: "80000000-0000-4000-8000-000000000002",
        schedule_revision_id: revisionId,
        position: 2,
        name: "Evening",
        start_time: "18:00:00",
        end_time: "02:00:00",
      },
    ];
    const client = {
      from: vi.fn((table: string) => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue(
            table === "owner_application_cottage_profiles"
              ? { maybeSingle: maybeSingleProfile }
              : table === "cottage_shift_schedule_revisions"
                ? { maybeSingle: maybeSingleRevision }
                : {
                    order: vi
                      .fn()
                      .mockResolvedValue({ data: shifts, error: null }),
                  },
          ),
        }),
      })),
      rpc: vi.fn(),
    } as unknown as SupabaseClient;

    await expect(
      new SupabaseCottageShiftScheduleRepository(client).loadCurrent(profileId),
    ).resolves.toMatchObject({
      profileId,
      revision: 3,
      shifts: [
        {
          name: "Morning",
          startTime: "08:00",
          endTime: "12:00",
          crossesMidnight: false,
        },
        {
          name: "Evening",
          startTime: "18:00",
          endTime: "02:00",
          crossesMidnight: true,
        },
      ],
    });
  });

  it("rejects a saved schedule returned for a different Cottage Profile", async () => {
    const repository = new SupabaseCottageShiftScheduleRepository({
      rpc: vi.fn().mockResolvedValue({
        data: {
          profileId: "70000000-0000-4000-8000-000000000002",
          revision: 1,
          fullDayBundleId: "90000000-0000-4000-8000-000000000001",
          shifts: [
            {
              id: "80000000-0000-4000-8000-000000000001",
              name: "Morning",
              startTime: "08:00",
              endTime: "12:00",
              position: 1,
              crossesMidnight: false,
            },
            {
              id: "80000000-0000-4000-8000-000000000002",
              name: "Evening",
              startTime: "18:00",
              endTime: "22:00",
              position: 2,
              crossesMidnight: false,
            },
          ],
        },
        error: null,
      }),
    } as unknown as SupabaseClient);

    await expect(
      repository.save({
        profileId,
        expectedRevision: 0,
        shifts: [
          {
            name: "Morning",
            startTime: "08:00",
            endTime: "12:00",
            position: 1,
            crossesMidnight: false,
          },
          {
            name: "Evening",
            startTime: "18:00",
            endTime: "22:00",
            position: 2,
            crossesMidnight: false,
          },
        ],
      }),
    ).rejects.toThrow("Shift Schedule provider data is invalid");
  });

  it("rejects a loaded Cottage Shift assigned to another schedule revision", async () => {
    const revisionId = "91000000-0000-4000-8000-000000000001";
    const shifts = [
      {
        id: "80000000-0000-4000-8000-000000000001",
        schedule_revision_id: revisionId,
        position: 1,
        name: "Morning",
        start_time: "08:00:00",
        end_time: "12:00:00",
      },
      {
        id: "80000000-0000-4000-8000-000000000002",
        schedule_revision_id: "91000000-0000-4000-8000-000000000002",
        position: 2,
        name: "Evening",
        start_time: "18:00:00",
        end_time: "22:00:00",
      },
    ];
    const client = {
      from: vi.fn((table: string) => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue(
            table === "owner_application_cottage_profiles"
              ? {
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { current_shift_schedule_id: revisionId },
                    error: null,
                  }),
                }
              : table === "cottage_shift_schedule_revisions"
                ? {
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: {
                        id: revisionId,
                        profile_id: profileId,
                        revision: 1,
                        full_day_bundle_id:
                          "90000000-0000-4000-8000-000000000001",
                      },
                      error: null,
                    }),
                  }
                : {
                    order: vi
                      .fn()
                      .mockResolvedValue({ data: shifts, error: null }),
                  },
          ),
        }),
      })),
      rpc: vi.fn(),
    } as unknown as SupabaseClient;

    await expect(
      new SupabaseCottageShiftScheduleRepository(client).loadCurrent(profileId),
    ).rejects.toThrow("Shift Schedule provider data is invalid");
  });

  it("rejects circularly overlapping rows returned by the provider", async () => {
    const repository = new SupabaseCottageShiftScheduleRepository({
      rpc: vi.fn().mockResolvedValue({
        data: {
          profileId,
          revision: 1,
          fullDayBundleId: "90000000-0000-4000-8000-000000000001",
          shifts: [
            {
              id: "80000000-0000-4000-8000-000000000001",
              name: "Early",
              startTime: "01:00",
              endTime: "04:00",
              position: 1,
              crossesMidnight: false,
            },
            {
              id: "80000000-0000-4000-8000-000000000002",
              name: "Prior night",
              startTime: "23:00",
              endTime: "02:00",
              position: 2,
              crossesMidnight: true,
            },
          ],
        },
        error: null,
      }),
    } as unknown as SupabaseClient);

    await expect(
      repository.save({
        profileId,
        expectedRevision: 0,
        shifts: [
          {
            name: "Early",
            startTime: "01:00",
            endTime: "04:00",
            position: 1,
            crossesMidnight: false,
          },
          {
            name: "Prior night",
            startTime: "23:00",
            endTime: "02:00",
            position: 2,
            crossesMidnight: true,
          },
        ],
      }),
    ).rejects.toThrow("Shift Schedule provider data is invalid");
  });
});
