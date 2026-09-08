import "server-only";

import { createRequestCottageInventory } from "@/cottage-inventory/request-cottage-inventory";
import { createRequestCottagePublication } from "@/cottage-publication/request-cottage-publication";
import { createRequestCottageShiftSchedule } from "@/cottage-shift-schedule/request-cottage-shift-schedule";

import { loadOwnerCottageAccess } from "./request-owner-cottage-access";

export async function loadOwnerCottageEditor(profileId: string) {
  try {
    return await loadOwnerCottageAccess(
      async (cottageProfile, approvalState) => {
        const publication = await createRequestCottagePublication();
        const shiftSchedule = await createRequestCottageShiftSchedule();
        const inventory = await createRequestCottageInventory();
        const [profile, review, scheduleResult] = await Promise.all([
          cottageProfile.load(profileId),
          publication.loadCurrentReview(profileId),
          shiftSchedule.loadCurrent(profileId),
        ]);
        if (scheduleResult.status !== "loaded") {
          throw new Error("Owner Cottage Shift Schedule load failed");
        }

        let pricing = null;
        if (scheduleResult.schedule?.scheduleRevisionId) {
          const pricingResult = await inventory.loadOwnerEditorState(
            profileId,
            scheduleResult.schedule.scheduleRevisionId,
          );
          if (pricingResult.status !== "loaded") {
            throw new Error("Owner Cottage Inventory load failed");
          }

          const expectedUnits = new Map<string, "shift" | "full_day_bundle">([
            ...scheduleResult.schedule.shifts.map(
              (shift) => [shift.id, "shift"] as const,
            ),
            [
              scheduleResult.schedule.fullDayBundleId,
              "full_day_bundle",
            ] as const,
          ]);
          if (
            pricingResult.state.units.length !== expectedUnits.size ||
            pricingResult.state.units.some(
              (unit) => expectedUnits.get(unit.id) !== unit.kind,
            )
          ) {
            throw new Error(
              "Owner Cottage Inventory units do not match schedule",
            );
          }
          pricing = pricingResult.state;
        }

        return {
          profile,
          review,
          schedule: scheduleResult.schedule,
          pricing,
          editable: approvalState === "approved",
        };
      },
    );
  } catch (error) {
    return { status: "unavailable" as const, error };
  }
}
