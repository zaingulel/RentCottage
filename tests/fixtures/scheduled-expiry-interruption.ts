import { once } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";

import { expect, test as base } from "@playwright/test";

import {
  paymentEvidenceSql,
  readScheduledExpiryBaseline,
  test as expiryTest,
  type ScheduledExpiryBaseline,
} from "./scheduled-expiry";
import { triggerScheduled } from "./trigger-scheduled";

const { createLocalSupabaseConcurrencyHarness } = createRequire(
  import.meta.url,
)("../../scripts/local-supabase-concurrency-harness.mjs") as {
  createLocalSupabaseConcurrencyHarness(): SqlHarness & {
    guardDisposableLocalDatabase(): void;
  };
};
type SqlHarness = { runSql(sql: string): string };

function guardedHarness() {
  const harness = createLocalSupabaseConcurrencyHarness();
  harness.guardDisposableLocalDatabase();
  return harness;
}

function snapshotPath(metadata: Record<string, unknown>): string {
  const path = metadata.scheduledExpirySnapshot;
  if (
    typeof path !== "string" ||
    !path.startsWith("/tmp/rentcottage-370-evidence/")
  ) {
    throw new Error("Scheduled expiry evidence snapshot path is missing.");
  }
  return path;
}

function cleanSnapshot(path: string): ScheduledExpiryBaseline {
  const snapshot: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    !("definitions" in snapshot) ||
    !Array.isArray(snapshot.definitions) ||
    snapshot.definitions.length !== 11 ||
    !("ordinary" in snapshot) ||
    typeof snapshot.ordinary !== "string" ||
    !("captureDefinitions" in snapshot) ||
    !Array.isArray(snapshot.captureDefinitions) ||
    snapshot.captureDefinitions.length !== 4 ||
    !("recoveryDefinitions" in snapshot) ||
    !Array.isArray(snapshot.recoveryDefinitions) ||
    snapshot.recoveryDefinitions.length !== 4 ||
    !("paymentDefaults" in snapshot) ||
    !Array.isArray(snapshot.paymentDefaults) ||
    snapshot.paymentDefaults.length !== 5
  ) {
    throw new Error("Scheduled expiry evidence snapshot is malformed.");
  }
  return snapshot as ScheduledExpiryBaseline;
}

type PendingScheduled = {
  baseURL: string;
  arrived: Promise<void>;
};

const test = expiryTest.extend<object, { pendingScheduled: PendingScheduled }>({
  pendingScheduled: [
    async ({}, use) => {
      let arrive: () => void;
      const arrived = new Promise<void>((resolve) => {
        arrive = resolve;
      });
      const sockets = new Set<import("node:net").Socket>();
      const server = createServer(() => arrive());
      server.on("connection", (socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      try {
        const address = server.address();
        if (!address || typeof address === "string") {
          throw new Error("Pending scheduled server has no local port.");
        }
        // Playwright's use owns fixture lifetime; this is not a React Hook.
        // eslint-disable-next-line react-hooks/rules-of-hooks
        await use({ baseURL: `http://127.0.0.1:${address.port}`, arrived });
      } finally {
        const closed = once(server, "close");
        server.close();
        for (const socket of sockets) socket.destroy();
        await closed;
      }
    },
    { scope: "worker" },
  ],
});

test("scheduled expiry times out with a pending trigger", async ({
  scheduledExpiry,
  pendingScheduled,
}, testInfo) => {
  const path = snapshotPath(testInfo.config.metadata);
  writeFileSync(
    path,
    JSON.stringify({
      definitions: scheduledExpiry.definitions,
      ordinary: scheduledExpiry.ordinary,
      captureDefinitions: scheduledExpiry.captureDefinitions,
      recoveryDefinitions: scheduledExpiry.recoveryDefinitions,
      paymentDefaults: scheduledExpiry.paymentDefaults,
    }),
  );
  scheduledExpiry.harness.runSql(
    paymentEvidenceSql +
      "create function public.scheduled_payment_expiry_now() returns timestamptz language sql volatile security definer set search_path='' as $$select clock_timestamp()$$;",
  );
  scheduledExpiry.setPaymentClock("public.scheduled_payment_expiry_now()");
  for (const definition of scheduledExpiry.clocked) {
    scheduledExpiry.harness.runSql(paymentEvidenceSql + definition);
  }
  const pending = scheduledExpiry.triggerScheduled(
    pendingScheduled.baseURL,
    "/__scheduled",
  );
  await pendingScheduled.arrived;
  testInfo.setTimeout(1);
  await pending;
});

base(
  "the next scheduled Worker starts with the real payment clock",
  async ({ baseURL }, testInfo) => {
    const expected = cleanSnapshot(snapshotPath(testInfo.config.metadata));
    const harness = guardedHarness();
    expect(readScheduledExpiryBaseline(harness)).toEqual(expected);
    expect((await triggerScheduled(baseURL, "/__scheduled")).ok).toBe(true);
    expect(readScheduledExpiryBaseline(harness)).toEqual(expected);
  },
);

const corruptTest = base.extend<{ missingDefault: void }>({
  missingDefault: async ({}, use) => {
    const harness = guardedHarness();
    const expression = harness.runSql(
      `select pg_get_expr(defaults.adbin,defaults.adrelid) from pg_attrdef defaults
       join pg_attribute attributes on attributes.attrelid=defaults.adrelid and attributes.attnum=defaults.adnum
       where defaults.adrelid='public.payment_provider_operations'::regclass and attributes.attname='created_at';`,
    );
    if (expression !== "clock_timestamp()") {
      throw new Error(
        `Unexpected payment_provider_operations.created_at default: ${expression || "missing"}.`,
      );
    }
    try {
      harness.runSql(
        "alter table public.payment_provider_operations alter column created_at drop default;",
      );
      // Playwright's use owns fixture lifetime; this is not a React Hook.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      await use();
    } finally {
      harness.runSql(
        `alter table public.payment_provider_operations alter column created_at set default ${expression};`,
      );
    }
  },
});

corruptTest(
  "scheduled expiry refuses a missing payment default",
  async ({ missingDefault }, testInfo) => {
    void missingDefault;
    const harness = guardedHarness();
    expect(() => readScheduledExpiryBaseline(harness)).toThrow(
      /payment_provider_operations\.created_at.*missing default/,
    );
    const expected = cleanSnapshot(snapshotPath(testInfo.config.metadata));
    expect(
      harness.runSql(
        "select to_regprocedure('public.scheduled_payment_expiry_now()');",
      ),
    ).toBe("");
    expect(
      harness.runSql(
        paymentEvidenceSql +
          "select pg_get_functiondef('public.claim_due_booking_request_payment_required_expiries(integer,jsonb)'::regprocedure);",
      ),
    ).toBe(expected.definitions[0]);
  },
);

base(
  "the corruption probe restores the real payment default",
  async ({}, testInfo) => {
    const expected = cleanSnapshot(snapshotPath(testInfo.config.metadata));
    expect(readScheduledExpiryBaseline(guardedHarness())).toEqual(expected);
  },
);
