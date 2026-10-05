import { describe, expect, it, vi } from "vitest";

import type { AccountContext } from "@/access/account-access";
import type { BookingParticipantRole } from "./booking-financial-view";
import {
  createConfirmedBookingManagement,
  type ConfirmedBookingCommand,
  type ConfirmedBookingManagementSession,
} from "./confirmed-booking-management";

type Kind = ConfirmedBookingCommand["kind"];

const reference = "RC-REQ-AAAAAAAAAAAAAAAA";
const commandId = "00000000-0000-4000-8000-000000000575";
const subjectId = "00000000-0000-4000-8000-000000000576";
const bookingRequestId = "00000000-0000-4000-8000-000000000577";
const signedInUserId = "00000000-0000-4000-8000-000000000578";
const envelope = { reference, commandId };

const commands: Record<Kind, ConfirmedBookingCommand> = {
  cancel: { ...envelope, kind: "cancel", reason: null, category: null },
  refund: {
    ...envelope,
    kind: "refund",
    reason: "Goodwill refund",
    allocation: { bookingPriceFils: 1_000, bookingServiceFeeFils: 50 },
  },
  no_show: { ...envelope, kind: "no_show", reason: "Nobody arrived" },
  incident: {
    ...envelope,
    kind: "incident",
    category: "conduct",
    narrative: "Noise after midnight",
  },
  place_hold: { ...envelope, kind: "place_hold", reason: "Under review" },
  release_hold: {
    ...envelope,
    kind: "release_hold",
    reason: "Review closed",
    subjectId,
  },
  open_dispute: { ...envelope, kind: "open_dispute", reason: "Damage claim" },
  resolve_dispute: {
    ...envelope,
    kind: "resolve_dispute",
    reason: "Claim unsupported",
    subjectId,
    outcome: "owner_won",
  },
  settle: { ...envelope, kind: "settle", reason: "Stay completed" },
};

const kinds: readonly Kind[] = [
  "cancel",
  "refund",
  "no_show",
  "incident",
  "place_hold",
  "release_hold",
  "open_dispute",
  "resolve_dispute",
  "settle",
];

const refusedRoleCommands: readonly (readonly [
  BookingParticipantRole,
  Kind,
])[] = [
  ["customer", "refund"],
  ["customer", "no_show"],
  ["customer", "incident"],
  ["customer", "place_hold"],
  ["customer", "release_hold"],
  ["customer", "open_dispute"],
  ["customer", "resolve_dispute"],
  ["customer", "settle"],
  ["cottage_owner", "refund"],
  ["cottage_owner", "no_show"],
  ["cottage_owner", "place_hold"],
  ["cottage_owner", "release_hold"],
  ["cottage_owner", "open_dispute"],
  ["cottage_owner", "resolve_dispute"],
  ["cottage_owner", "settle"],
];

const customer: AccountContext = { userId: signedInUserId, role: "customer" };
const administrator: AccountContext = {
  userId: signedInUserId,
  role: "platform_administrator",
};
const owner = (
  approvalState: Extract<
    AccountContext,
    { role: "cottage_owner" }
  >["approvalState"],
): AccountContext => ({
  userId: signedInUserId,
  role: "cottage_owner",
  approvalState,
});

// Every later check passes by default, so a refusal can only come from the check under test.
function sessionWith(
  overrides: {
    readonly userId?: string | undefined;
    readonly context?: AccountContext | undefined;
    readonly assuranceLevel?: string | undefined;
    readonly booking?: { readonly bookingRequestId: string } | null;
  } = {},
) {
  const given = {
    userId: signedInUserId,
    context: customer,
    assuranceLevel: "aal2",
    booking: { bookingRequestId },
    ...overrides,
  };
  const ports = {
    cancel: vi.fn().mockResolvedValue(undefined),
    requestRefundException: vi.fn().mockResolvedValue(undefined),
    recordNoShow: vi.fn().mockResolvedValue(undefined),
    recordIncident: vi.fn().mockResolvedValue(undefined),
    recordPayout: vi.fn().mockResolvedValue(undefined),
    settle: vi.fn().mockResolvedValue({ status: "settled" }),
  };
  const session: ConfirmedBookingManagementSession = {
    userId: vi.fn().mockResolvedValue(given.userId),
    accountContext: vi.fn().mockResolvedValue(given.context),
    assuranceLevel: vi.fn().mockResolvedValue(given.assuranceLevel),
    booking: vi.fn().mockResolvedValue(given.booking),
    ...ports,
  };
  const openSession = vi.fn().mockResolvedValue(session);
  return {
    management: createConfirmedBookingManagement(openSession),
    openSession,
    ports,
  };
}

function expectNoCommand(
  ports: ReturnType<typeof sessionWith>["ports"],
  label: string,
) {
  for (const [name, port] of Object.entries(ports))
    expect(port, `${label}: ${name}`).not.toHaveBeenCalled();
}

describe("Confirmed Booking management", () => {
  it.each(refusedRoleCommands)(
    "refuses a role a Confirmed Booking command it may not run: %s cannot %s",
    async (actorRole, kind) => {
      const { management, openSession, ports } = sessionWith({
        context: actorRole === "customer" ? customer : owner("approved"),
      });

      await expect(management.run(actorRole, commands[kind])).resolves.toEqual({
        status: "access-required",
      });
      expect(openSession).not.toHaveBeenCalled();
      expectNoCommand(ports, `${actorRole} ${kind}`);
    },
  );

  it("refuses a visitor with no signed-in account", async () => {
    const visitors = [
      {
        label: "no user and no account",
        userId: undefined,
        context: undefined,
      },
      { label: "no user", userId: undefined, context: customer },
      { label: "no account", userId: signedInUserId, context: undefined },
    ];
    for (const { label, userId, context } of visitors) {
      const { management, ports } = sessionWith({ userId, context });

      expect(await management.run("customer", commands.cancel), label).toEqual({
        status: "access-required",
      });
      expectNoCommand(ports, label);
    }
  });

  it("refuses an account acting in a role it does not hold", async () => {
    const claims: readonly {
      readonly label: string;
      readonly actorRole: BookingParticipantRole;
      readonly context: AccountContext;
    }[] = [
      {
        label: "owner claimed by a customer",
        actorRole: "cottage_owner",
        context: customer,
      },
      {
        label: "owner claimed by a prospective owner",
        actorRole: "cottage_owner",
        context: owner("prospective"),
      },
      {
        label: "owner claimed by an expired owner",
        actorRole: "cottage_owner",
        context: owner("expired"),
      },
      {
        label: "owner claimed by a suspended owner",
        actorRole: "cottage_owner",
        context: owner("suspended"),
      },
      {
        label: "administrator claimed by a customer",
        actorRole: "platform_administrator",
        context: customer,
      },
      {
        label: "administrator claimed by an owner",
        actorRole: "platform_administrator",
        context: owner("approved"),
      },
      {
        label: "customer claimed by an administrator",
        actorRole: "customer",
        context: administrator,
      },
    ];
    for (const { label, actorRole, context } of claims) {
      const { management, ports } = sessionWith({ context });

      expect(await management.run(actorRole, commands.cancel), label).toEqual({
        status: "access-required",
      });
      expectNoCommand(ports, label);
    }
  });

  it("refuses an account whose identity does not match the signed-in user", async () => {
    const { management, ports } = sessionWith({
      context: {
        userId: "00000000-0000-4000-8000-000000000579",
        role: "customer",
      },
    });

    await expect(management.run("customer", commands.cancel)).resolves.toEqual({
      status: "access-required",
    });
    expectNoCommand(ports, "identity mismatch");
  });

  it("lets an owner account of any approval state act as the customer on its own booking", async () => {
    for (const approvalState of [
      "prospective",
      "approved",
      "expired",
      "suspended",
    ] as const) {
      const { management, ports } = sessionWith({
        context: owner(approvalState),
      });

      expect(
        await management.run("customer", commands.cancel),
        approvalState,
      ).toEqual({ status: "cancelled" });
      expect(ports.cancel, approvalState).toHaveBeenCalledTimes(1);
    }
  });

  it("refuses a Platform Administrator without second-factor assurance", async () => {
    for (const kind of kinds) {
      const { management, ports } = sessionWith({
        context: administrator,
        assuranceLevel: "aal1",
      });

      expect(
        await management.run("platform_administrator", commands[kind]),
        `${kind} at aal1`,
      ).toEqual({ status: "access-required" });
      expectNoCommand(ports, `${kind} at aal1`);
    }

    const { management, ports } = sessionWith({
      context: administrator,
      assuranceLevel: undefined,
    });

    await expect(
      management.run("platform_administrator", commands.settle),
    ).resolves.toEqual({ status: "access-required" });
    expectNoCommand(ports, "assurance unreadable");
  });

  it("refuses a role that has no view of the booking", async () => {
    const actors: readonly (readonly [
      BookingParticipantRole,
      AccountContext,
    ])[] = [
      ["customer", customer],
      ["cottage_owner", owner("approved")],
      ["platform_administrator", administrator],
    ];
    for (const [actorRole, context] of actors) {
      const { management, ports } = sessionWith({ context, booking: null });

      expect(
        await management.run(actorRole, commands.cancel),
        actorRole,
      ).toEqual({ status: "access-required" });
      expectNoCommand(ports, actorRole);
    }
  });
});
