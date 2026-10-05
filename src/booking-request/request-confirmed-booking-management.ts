import "server-only";
import { SupabaseAccountContextStore } from "@/access/supabase-account-access";
import { createRequestSupabaseClient } from "@/access/supabase-server";
import { createBookingCancellation } from "./booking-cancellation";
import { createBookingNoShow } from "./booking-completion-commands";
import { getBookingFinancialView } from "./booking-financial-view";
import { createBookingPayout } from "./booking-payout";
import { createConfirmedBookingManagement } from "./confirmed-booking-management";
import { createRequestBookingSettlement } from "./request-booking-settlement";
import { SupabaseBookingCancellationRepository } from "./supabase-booking-cancellation";
import {
  SupabaseBookingNoShowRepository,
  recordBookingIncident,
} from "./supabase-booking-lifecycle";
import { SupabaseBookingPayoutRepository } from "./supabase-booking-payout";
import { SupabaseBookingRefundRepository } from "./supabase-booking-refund";

export function createRequestConfirmedBookingManagement() {
  return createConfirmedBookingManagement(async () => {
    const client = await createRequestSupabaseClient();
    return {
      async userId() {
        const { data, error } = await client.auth.getUser();
        return error ? undefined : data.user?.id;
      },
      accountContext: () => new SupabaseAccountContextStore(client).resolve(),
      async assuranceLevel() {
        const { data, error } =
          await client.auth.mfa.getAuthenticatorAssuranceLevel();
        return error ? undefined : (data?.currentLevel ?? undefined);
      },
      booking: (reference, actorRole) =>
        getBookingFinancialView(client, reference, actorRole),
      cancel: (command) =>
        createBookingCancellation(
          new SupabaseBookingCancellationRepository(client),
        ).cancel(command),
      requestRefundException: (command) =>
        new SupabaseBookingRefundRepository(client).requestException(command),
      recordNoShow: (command) =>
        createBookingNoShow(new SupabaseBookingNoShowRepository(client)).record(
          command,
        ),
      recordIncident: (command) => recordBookingIncident(client, command),
      recordPayout: (command) =>
        createBookingPayout(new SupabaseBookingPayoutRepository(client)).record(
          command,
        ),
      settle: (command) =>
        createRequestBookingSettlement(client).settle(command),
    };
  });
}
