import {
  hasCustomerCapability,
  type AccountContext,
} from "@/access/account-access";
import type { PlatformAdministratorAccess } from "@/access/platform-administrator-gate";
import type { RefundAllocation } from "@/payment/payment-contract";
import type { BookingCancellationCommand } from "./booking-cancellation";
import type {
  BookingIncidentCommand,
  BookingNoShowCommand,
} from "./booking-completion-commands";
import type { BookingParticipantRole } from "./booking-financial-view";
import type {
  BookingPayoutCommand,
  BookingSettlementCommand,
  BookingSettlementResult,
} from "./booking-payout";
import { BookingLifecycleConflict } from "./supabase-booking-lifecycle";

export type ConfirmedBookingCommand = {
  readonly reference: string;
  // Replay key, passed on unchanged.
  readonly commandId: string;
} & (
  | {
      readonly kind: "cancel";
      readonly reason: string | null;
      readonly category: BookingCancellationCommand["category"];
    }
  | {
      readonly kind: "refund";
      readonly reason: string;
      readonly allocation: RefundAllocation;
    }
  | { readonly kind: "no_show"; readonly reason: string }
  | {
      readonly kind: "incident";
      readonly category: BookingIncidentCommand["category"];
      readonly narrative: string;
    }
  | { readonly kind: "place_hold" | "open_dispute"; readonly reason: string }
  | {
      readonly kind: "release_hold";
      readonly reason: string;
      readonly subjectId: string;
    }
  | {
      readonly kind: "resolve_dispute";
      readonly reason: string;
      readonly subjectId: string;
      readonly outcome: "owner_won" | "customer_won";
    }
  | {
      readonly kind: "resolve_dispute";
      readonly reason: string;
      readonly subjectId: string;
      readonly outcome: "partial_customer_award";
      readonly allocation: RefundAllocation;
    }
  | { readonly kind: "settle"; readonly reason: string }
);

export interface ConfirmedBookingManagementResult {
  readonly status:
    | "cancelled"
    | "requested"
    | "no_show"
    | "recorded"
    | BookingSettlementResult["status"]
    | "conflict"
    | "access-required"
    | "unavailable";
}

export interface ConfirmedBookingManagementSession {
  // Asked only once an account context has resolved, so a failed read is an outage and rejects.
  userId(): Promise<string | undefined>;
  accountContext(): Promise<AccountContext | undefined>;
  platformAdministratorAccess(): Promise<PlatformAdministratorAccess>;
  booking(
    reference: string,
    actorRole: BookingParticipantRole,
  ): Promise<{ readonly bookingRequestId: string } | null>;
  cancel(command: BookingCancellationCommand): Promise<unknown>;
  requestRefundException(command: {
    readonly bookingRequestId: string;
    readonly commandId: string;
    readonly reason: string;
    readonly allocation: RefundAllocation;
  }): Promise<unknown>;
  recordNoShow(command: BookingNoShowCommand): Promise<unknown>;
  recordIncident(command: BookingIncidentCommand): Promise<unknown>;
  recordPayout(command: BookingPayoutCommand): Promise<unknown>;
  settle(command: BookingSettlementCommand): Promise<BookingSettlementResult>;
}

const administratorOnly: readonly BookingParticipantRole[] = [
  "platform_administrator",
];
const permittedRoles: Record<
  ConfirmedBookingCommand["kind"],
  readonly BookingParticipantRole[]
> = {
  cancel: ["customer", "cottage_owner", "platform_administrator"],
  incident: ["cottage_owner", "platform_administrator"],
  refund: administratorOnly,
  no_show: administratorOnly,
  place_hold: administratorOnly,
  release_hold: administratorOnly,
  open_dispute: administratorOnly,
  resolve_dispute: administratorOnly,
  settle: administratorOnly,
};

function holdsRole(
  context: AccountContext,
  actorRole: BookingParticipantRole,
): boolean {
  switch (actorRole) {
    case "customer":
      return hasCustomerCapability(context);
    case "cottage_owner":
      return (
        context.role === "cottage_owner" && context.approvalState === "approved"
      );
    case "platform_administrator":
      return context.role === "platform_administrator";
  }
}

export function createConfirmedBookingManagement(
  openSession: () => Promise<ConfirmedBookingManagementSession>,
) {
  return {
    async run(
      actorRole: BookingParticipantRole,
      command: ConfirmedBookingCommand,
    ): Promise<ConfirmedBookingManagementResult> {
      if (!permittedRoles[command.kind].includes(actorRole))
        return { status: "access-required" };
      try {
        const session = await openSession();
        const context = await session.accountContext();
        if (!context) return { status: "access-required" };
        const userId = await session.userId();
        if (
          !userId ||
          context.userId !== userId ||
          !holdsRole(context, actorRole)
        )
          return { status: "access-required" };
        if (
          actorRole === "platform_administrator" &&
          (await session.platformAdministratorAccess()) !== "allowed"
        )
          return { status: "access-required" };
        const booking = await session.booking(command.reference, actorRole);
        if (!booking) return { status: "access-required" };
        const target = {
          bookingRequestId: booking.bookingRequestId,
          commandId: command.commandId,
        };
        switch (command.kind) {
          case "cancel":
            await session.cancel({
              ...target,
              actorRole,
              reason: command.reason,
              category: command.category,
            });
            return { status: "cancelled" };
          case "refund":
            await session.requestRefundException({
              ...target,
              reason: command.reason,
              allocation: command.allocation,
            });
            return { status: "requested" };
          case "no_show":
            await session.recordNoShow({ ...target, reason: command.reason });
            return { status: "no_show" };
          case "incident":
            await session.recordIncident({
              ...target,
              actorRole: actorRole as BookingIncidentCommand["actorRole"],
              category: command.category,
              narrative: command.narrative,
            });
            return { status: "recorded" };
          case "place_hold":
          case "open_dispute":
            await session.recordPayout({
              ...target,
              action: command.kind,
              reason: command.reason,
            });
            return { status: "recorded" };
          case "release_hold":
            await session.recordPayout({
              ...target,
              action: command.kind,
              reason: command.reason,
              subjectId: command.subjectId,
            });
            return { status: "recorded" };
          case "resolve_dispute":
            await session.recordPayout({
              ...target,
              action: command.kind,
              reason: command.reason,
              subjectId: command.subjectId,
              outcome: command.outcome,
              ...(command.outcome === "partial_customer_award"
                ? { allocation: command.allocation }
                : {}),
            });
            return { status: "recorded" };
          case "settle":
            return await session.settle({ ...target, reason: command.reason });
        }
      } catch (error) {
        if (error instanceof BookingLifecycleConflict)
          return { status: "conflict" };
        console.error("Booking management command failed", {
          code: "booking_management_unavailable",
        });
        return { status: "unavailable" };
      }
    },
  };
}
