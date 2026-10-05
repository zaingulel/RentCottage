import { describe, expect, it, vi } from "vitest";

import type { AccountContext } from "@/access/account-access";
import type { PlatformAdministratorAccess } from "@/access/platform-administrator-gate";
import type { BookingParticipantRole } from "./booking-financial-view";
import {
  createConfirmedBookingManagement,
  type ConfirmedBookingCommand,
  type ConfirmedBookingManagementSession,
} from "./confirmed-booking-management";
import { BookingLifecycleConflict } from "./supabase-booking-lifecycle";

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
    readonly platformAdministratorAccess?: PlatformAdministratorAccess;
    readonly booking?: { readonly bookingRequestId: string } | null;
  } = {},
) {
  const given = {
    userId: signedInUserId,
    context: customer,
    platformAdministratorAccess: "allowed",
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
    platformAdministratorAccess: vi
      .fn()
      .mockResolvedValue(given.platformAdministratorAccess),
    booking: vi.fn().mockResolvedValue(given.booking),
    ...ports,
  };
  const openSession = vi.fn().mockResolvedValue(session);
  return {
    management: createConfirmedBookingManagement(openSession),
    openSession,
    session,
    ports,
  };
}

type Ports = ReturnType<typeof sessionWith>["ports"];

function expectNoCommand(ports: Ports, label: string) {
  for (const [name, port] of Object.entries(ports))
    expect(port, `${label}: ${name}`).not.toHaveBeenCalled();
}

// Expected service commands are transcribed from the form handler this module replaced, never built from the command.
const permittedRuns: readonly (readonly [
  Kind,
  BookingParticipantRole,
  {
    readonly context: AccountContext;
    readonly command: ConfirmedBookingCommand;
    readonly port: keyof Ports;
    readonly expected: Record<string, unknown>;
    readonly status: string;
  },
])[] = [
  [
    "cancel",
    "customer",
    {
      context: customer,
      command: commands.cancel,
      port: "cancel",
      expected: {
        bookingRequestId,
        commandId,
        actorRole: "customer",
        reason: null,
        category: null,
      },
      status: "cancelled",
    },
  ],
  [
    "cancel",
    "cottage_owner",
    {
      context: owner("approved"),
      command: {
        ...envelope,
        kind: "cancel",
        reason: "Cottage flooded",
        category: null,
      },
      port: "cancel",
      expected: {
        bookingRequestId,
        commandId,
        actorRole: "cottage_owner",
        reason: "Cottage flooded",
        category: null,
      },
      status: "cancelled",
    },
  ],
  [
    "cancel",
    "platform_administrator",
    {
      context: administrator,
      command: {
        ...envelope,
        kind: "cancel",
        reason: "Unsafe wiring reported",
        category: "safety",
      },
      port: "cancel",
      expected: {
        bookingRequestId,
        commandId,
        actorRole: "platform_administrator",
        reason: "Unsafe wiring reported",
        category: "safety",
      },
      status: "cancelled",
    },
  ],
  [
    "incident",
    "cottage_owner",
    {
      context: owner("approved"),
      command: commands.incident,
      port: "recordIncident",
      expected: {
        bookingRequestId,
        commandId,
        actorRole: "cottage_owner",
        category: "conduct",
        narrative: "Noise after midnight",
      },
      status: "recorded",
    },
  ],
  [
    "incident",
    "platform_administrator",
    {
      context: administrator,
      command: commands.incident,
      port: "recordIncident",
      expected: {
        bookingRequestId,
        commandId,
        actorRole: "platform_administrator",
        category: "conduct",
        narrative: "Noise after midnight",
      },
      status: "recorded",
    },
  ],
  [
    "refund",
    "platform_administrator",
    {
      context: administrator,
      command: commands.refund,
      port: "requestRefundException",
      expected: {
        bookingRequestId,
        commandId,
        reason: "Goodwill refund",
        allocation: { bookingPriceFils: 1_000, bookingServiceFeeFils: 50 },
      },
      status: "requested",
    },
  ],
  [
    "no_show",
    "platform_administrator",
    {
      context: administrator,
      command: commands.no_show,
      port: "recordNoShow",
      expected: { bookingRequestId, commandId, reason: "Nobody arrived" },
      status: "no_show",
    },
  ],
  [
    "place_hold",
    "platform_administrator",
    {
      context: administrator,
      command: commands.place_hold,
      port: "recordPayout",
      expected: {
        bookingRequestId,
        commandId,
        action: "place_hold",
        reason: "Under review",
      },
      status: "recorded",
    },
  ],
  [
    "release_hold",
    "platform_administrator",
    {
      context: administrator,
      command: commands.release_hold,
      port: "recordPayout",
      expected: {
        bookingRequestId,
        commandId,
        action: "release_hold",
        reason: "Review closed",
        subjectId,
      },
      status: "recorded",
    },
  ],
  [
    "open_dispute",
    "platform_administrator",
    {
      context: administrator,
      command: commands.open_dispute,
      port: "recordPayout",
      expected: {
        bookingRequestId,
        commandId,
        action: "open_dispute",
        reason: "Damage claim",
      },
      status: "recorded",
    },
  ],
  [
    "resolve_dispute",
    "platform_administrator",
    {
      context: administrator,
      command: commands.resolve_dispute,
      port: "recordPayout",
      expected: {
        bookingRequestId,
        commandId,
        action: "resolve_dispute",
        reason: "Claim unsupported",
        subjectId,
        outcome: "owner_won",
      },
      status: "recorded",
    },
  ],
  [
    "resolve_dispute",
    "platform_administrator",
    {
      context: administrator,
      command: {
        ...envelope,
        kind: "resolve_dispute",
        reason: "Claim partly upheld",
        subjectId,
        outcome: "partial_customer_award",
        allocation: { bookingPriceFils: 1_000, bookingServiceFeeFils: 50 },
      },
      port: "recordPayout",
      expected: {
        bookingRequestId,
        commandId,
        action: "resolve_dispute",
        reason: "Claim partly upheld",
        subjectId,
        outcome: "partial_customer_award",
        allocation: { bookingPriceFils: 1_000, bookingServiceFeeFils: 50 },
      },
      status: "recorded",
    },
  ],
  [
    "settle",
    "platform_administrator",
    {
      context: administrator,
      command: commands.settle,
      port: "settle",
      expected: { bookingRequestId, commandId, reason: "Stay completed" },
      status: "settled",
    },
  ],
];

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

  it("refuses every command to a session the Platform Administrator gate refuses", async () => {
    for (const kind of kinds) {
      const { management, ports } = sessionWith({
        context: administrator,
        platformAdministratorAccess: "refused",
      });

      expect(
        await management.run("platform_administrator", commands[kind]),
        `${kind} refused by the gate`,
      ).toEqual({ status: "access-required" });
      expectNoCommand(ports, `${kind} refused by the gate`);
    }
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

  it.each(permittedRuns)(
    "runs %s as %s once with the command identifier unchanged",
    async (_kind, actorRole, { context, command, port, expected, status }) => {
      const { management, ports } = sessionWith({
        context,
        ...(actorRole === "platform_administrator"
          ? {}
          : { platformAdministratorAccess: "refused" }),
      });

      await expect(management.run(actorRole, command)).resolves.toEqual({
        status,
      });
      // Strict, so an absent key cannot pass as an undefined one.
      expect(ports[port].mock.calls).toStrictEqual([[expected]]);
      for (const [name, other] of Object.entries(ports))
        if (name !== port) expect(other, name).not.toHaveBeenCalled();
    },
  );

  it("passes each settlement outcome through unchanged", async () => {
    for (const status of [
      "settled",
      "blocked",
      "attention-required",
      "processing",
    ]) {
      const { management, ports } = sessionWith({ context: administrator });
      ports.settle.mockResolvedValue({ status });

      expect(
        await management.run("platform_administrator", commands.settle),
        status,
      ).toEqual({ status });
    }
  });

  it("reports a conflict when the booking's outcome changed underneath the command", async () => {
    const { management, ports } = sessionWith();
    ports.cancel.mockRejectedValue(new BookingLifecycleConflict());

    await expect(management.run("customer", commands.cancel)).resolves.toEqual({
      status: "conflict",
    });
  });

  it("reports unavailable and logs no private detail when a step fails", async () => {
    const failure = new Error("PRIVATE record");
    const failingSteps: readonly (readonly [
      string,
      (stubs: ReturnType<typeof sessionWith>) => void,
    ])[] = [
      [
        "session open",
        ({ openSession }) => openSession.mockRejectedValue(failure),
      ],
      [
        "account lookup",
        ({ session }) =>
          vi.mocked(session.accountContext).mockRejectedValue(failure),
      ],
      [
        "booking lookup",
        ({ session }) => vi.mocked(session.booking).mockRejectedValue(failure),
      ],
      ["command port", ({ ports }) => ports.cancel.mockRejectedValue(failure)],
    ];
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const [label, fail] of failingSteps) {
        log.mockClear();
        const stubs = sessionWith();
        fail(stubs);

        expect(
          await stubs.management.run("customer", commands.cancel),
          label,
        ).toEqual({ status: "unavailable" });
        expect(log.mock.calls, label).toStrictEqual([
          [
            "Booking management command failed",
            { code: "booking_management_unavailable" },
          ],
        ]);
        expect(JSON.stringify(log.mock.calls), label).not.toContain("PRIVATE");
      }
    } finally {
      log.mockRestore();
    }
  });
});
