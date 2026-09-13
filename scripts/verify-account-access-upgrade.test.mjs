import { describe, it, expect, vi } from "vitest";
import { verifyAccountAccessUpgrade } from "./verify-account-access-upgrade.mjs";
const environment = {
  SUPABASE_LOCAL_PROJECT: "rentcottage-job-214",
  SUPABASE_LOCAL_WORKDIR: "/private/tmp/exact-214",
};

const accountContexts = [
  {
    user_id: "10000000-0000-4000-8000-000000002141",
    role: "cottage_owner",
    owner_approval_state: "approved",
  },
  {
    user_id: "10000000-0000-4000-8000-000000002142",
    role: "customer",
    owner_approval_state: null,
  },
  {
    user_id: "10000000-0000-4000-8000-000000002143",
    role: "cottage_owner",
    owner_approval_state: "prospective",
  },
  {
    user_id: "10000000-0000-4000-8000-000000002144",
    role: "cottage_owner",
    owner_approval_state: "suspended",
  },
  {
    user_id: "10000000-0000-4000-8000-000000002145",
    role: "platform_administrator",
    owner_approval_state: null,
  },
];

const tableCounts = {
  "auth.users": 5,
  "public.account_contexts": 5,
  "public.owner_application_cottage_profiles": 1,
  "public.booking_requests": 2,
  "public.booking_snapshots": 2,
  "public.cottage_booking_period_commitments": 2,
  "public.booking_request_capture_work": 1,
  "public.booking_confirmations": 1,
  "public.booking_receipts": 2,
  "public.cottage_shift_schedule_revisions": 1,
  "public.cottage_shifts": 2,
  "public.cottage_inventory_commitments": 2,
  "public.cottage_booking_period_occupancies": 2,
  "public.booking_request_submission_attempts": 2,
  "public.booking_request_authorization_claims": 2,
  "public.booking_request_authorization_claim_items": 2,
  "public.booking_request_authorization_claim_occupancies": 2,
  "public.payment_provider_operations": 1,
  "public.payment_provider_observations": 1,
};

function successfulAccountProof({ currentRestoreFailure } = {}) {
  let enrolled = false;
  let migrated = false;
  let incompatible = false;
  let priorResets = 0;
  const runSupabase = vi.fn((args) => {
    if (args.includes("--version")) {
      priorResets += 1;
      enrolled = false;
      migrated = false;
      incompatible = false;
    } else if (args[0] === "migration") {
      if (incompatible) throw Error("booking_requests_distinct_participants");
      migrated = true;
    } else if (currentRestoreFailure) {
      throw currentRestoreFailure;
    }
  });
  const guardDisposableLocalDatabase = vi.fn();
  const runSql = vi.fn((sql) => {
    if (sql.includes("select max(version)")) return "20260909221736";
    if (sql.includes("update public.booking_requests set customer_user_id")) {
      incompatible = true;
      return "";
    }
    if (sql.includes("-- authored account fixture")) return "";
    if (sql.includes("row_to_json(public.claim_marketplace_role")) {
      enrolled = true;
      return JSON.stringify({
        user_id: "10000000-0000-4000-8000-000000002142",
        role: "cottage_owner",
        owner_approval_state: "prospective",
      });
    }
    if (sql.includes("owner_approval_state; rollback")) return "approved";
    if (sql.includes("owner_approval_state='suspended'")) return "";
    if (sql.includes("000000002145")) {
      throw Error("verified phone identity");
    }
    if (sql.includes("get_confirmed_booking_access") && sql.includes("is null"))
      return "t";
    if (sql.includes("get_confirmed_booking_access")) return "customer";
    const table = sql.match(/ from ([\w.]+) r;/)?.[1];
    if (table === "public.account_contexts") {
      return JSON.stringify(
        accountContexts.map((row) =>
          enrolled && row.user_id === "10000000-0000-4000-8000-000000002142"
            ? {
                ...row,
                role: "cottage_owner",
                owner_approval_state: "prospective",
              }
            : row,
        ),
      );
    }
    if (table === "public.booking_requests") {
      return JSON.stringify(
        [
          {
            id: "60000000-0000-4000-8000-000000002141",
            booking_request_reference: "RC-REQ-0000000000002141",
            customer_user_id: "10000000-0000-4000-8000-000000002142",
            owner_user_id: "10000000-0000-4000-8000-000000002141",
            status: "accepted",
          },
          {
            id: "60000000-0000-4000-8000-000000002142",
            booking_request_reference: "RC-REQ-0000000000002142",
            customer_user_id: incompatible
              ? "10000000-0000-4000-8000-000000002141"
              : "10000000-0000-4000-8000-000000002142",
            owner_user_id: "10000000-0000-4000-8000-000000002141",
            status: "pending",
          },
        ].map((row) =>
          migrated ? { ...row, refund_last_scheduled_at: null } : row,
        ),
      );
    }
    if (table) {
      return JSON.stringify(
        Array.from({ length: tableCounts[table] }, (_, index) => ({
          id: `${table}-${index}`,
        })),
      );
    }
    throw Error(`Unexpected account proof SQL: ${sql}`);
  });
  return {
    get priorResets() {
      return priorResets;
    },
    harness: { guardDisposableLocalDatabase, runSql },
    runSupabase,
  };
}

describe("account migration disposable boundary", () => {
  it.each([
    { deferSuccessfulRestore: false, currentRestores: 1, ownershipChecks: 2 },
    { deferSuccessfulRestore: true, currentRestores: 0, ownershipChecks: 1 },
  ])(
    "preserves the complete account proof and restores $currentRestores times when deferral is $deferSuccessfulRestore",
    ({ deferSuccessfulRestore, currentRestores, ownershipChecks }) => {
      const proof = successfulAccountProof();

      expect(() =>
        verifyAccountAccessUpgrade({
          environment,
          harness: proof.harness,
          runSupabase: proof.runSupabase,
          readFixture: () => "-- authored account fixture",
          deferSuccessfulRestore,
        }),
      ).not.toThrow();

      expect(proof.priorResets).toBe(2);
      expect(
        proof.runSupabase.mock.calls.filter(
          ([args]) => args.join(" ") === "db reset --local",
        ),
      ).toHaveLength(currentRestores);
      expect(
        proof.runSupabase.mock.calls.filter(
          ([args]) => args.join(" ") === "migration up --local",
        ),
      ).toHaveLength(2);
      expect(proof.harness.guardDisposableLocalDatabase).toHaveBeenCalledTimes(
        ownershipChecks,
      );
    },
  );

  it("does not reset or restore after initial ownership rejection", () => {
    const runSupabase = vi.fn();
    const guardDisposableLocalDatabase = vi.fn(() => {
      throw Error("wrong owner");
    });
    expect(() =>
      verifyAccountAccessUpgrade({
        deferSuccessfulRestore: true,
        environment,
        harness: { guardDisposableLocalDatabase },
        runSupabase,
      }),
    ).toThrow("wrong owner");
    expect(runSupabase).not.toHaveBeenCalled();
  });
  it("restores current schema after proof failure with deferral requested", () => {
    const runSupabase = vi.fn();
    const guardDisposableLocalDatabase = vi.fn();
    const harness = {
      guardDisposableLocalDatabase,
      runSql: vi.fn().mockReturnValue("incorrect predecessor"),
    };
    expect(() =>
      verifyAccountAccessUpgrade({
        environment,
        harness,
        runSupabase,
        deferSuccessfulRestore: true,
      }),
    ).toThrow("Upgrade starts on the exact predecessor");
    expect(runSupabase.mock.calls).toEqual([
      [["db", "reset", "--local", "--version", "20260909221736"]],
      [["db", "reset", "--local"]],
    ]);
    expect(guardDisposableLocalDatabase).toHaveBeenCalledTimes(2);
  });
  it.each([
    {
      name: "historical reset",
      configure: ({ runSupabase }) =>
        runSupabase.mockImplementationOnce(() => {
          throw Error("prior reset unavailable");
        }),
      message: "prior reset unavailable",
    },
    {
      name: "fixture read",
      configure: ({ readFixture }) =>
        readFixture.mockImplementationOnce(() => {
          throw Error("fixture unavailable");
        }),
      message: "fixture unavailable",
    },
  ])(
    "restores after $name failure with deferral requested",
    ({ configure, message }) => {
      const runSupabase = vi.fn();
      const readFixture = vi.fn(() => "-- fixture");
      const harness = {
        guardDisposableLocalDatabase: vi.fn(),
        runSql: vi.fn().mockReturnValue("20260909221736"),
      };
      configure({ readFixture, runSupabase });

      expect(() =>
        verifyAccountAccessUpgrade({
          environment,
          harness,
          runSupabase,
          readFixture,
          deferSuccessfulRestore: true,
        }),
      ).toThrow(message);
      expect(runSupabase.mock.calls.at(-1)).toEqual([
        ["db", "reset", "--local"],
      ]);
      expect(harness.guardDisposableLocalDatabase).toHaveBeenCalledTimes(2);
    },
  );

  it("does not run an unguarded restore when ownership is lost", () => {
    const runSupabase = vi.fn();
    const proofFailure = Error("proof failed");
    const ownershipFailure = Error("restore ownership lost");
    const harness = {
      guardDisposableLocalDatabase: vi
        .fn()
        .mockImplementationOnce(() => {})
        .mockImplementationOnce(() => {
          throw ownershipFailure;
        }),
      runSql: vi.fn(() => {
        throw proofFailure;
      }),
    };

    let failure;
    try {
      verifyAccountAccessUpgrade({
        environment,
        harness,
        runSupabase,
        deferSuccessfulRestore: true,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([proofFailure, ownershipFailure]);
    expect(runSupabase.mock.calls).toEqual([
      [["db", "reset", "--local", "--version", "20260909221736"]],
    ]);
  });

  it("preserves proof and restore failure identities together", () => {
    const proofFailure = Error("proof unavailable");
    const restoreFailure = Error("restore unavailable");
    const runSupabase = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw restoreFailure;
      });
    const harness = {
      guardDisposableLocalDatabase: vi.fn(),
      runSql: vi.fn(() => {
        throw proofFailure;
      }),
    };
    let failure;
    try {
      verifyAccountAccessUpgrade({
        environment,
        harness,
        runSupabase,
        deferSuccessfulRestore: true,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([proofFailure, restoreFailure]);
  });

  it("reports a standalone restoration failure after a successful proof", () => {
    const restoreFailure = Error("standalone restore unavailable");
    const proof = successfulAccountProof({
      currentRestoreFailure: restoreFailure,
    });

    let failure;
    try {
      verifyAccountAccessUpgrade({
        environment,
        harness: proof.harness,
        runSupabase: proof.runSupabase,
        readFixture: () => "-- authored account fixture",
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toEqual([restoreFailure]);
  });
});
