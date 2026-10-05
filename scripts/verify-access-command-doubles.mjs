import { join } from "node:path";

import { expect, vi } from "vitest";

import { main } from "./verify-access.mjs";

export const localCredentials = JSON.stringify({
  API_URL: "http://127.0.0.1:54331",
  PUBLISHABLE_KEY: "local-publishable",
  SECRET_KEY: "local-secret",
});

export const startCommand = [
  "npx",
  [
    "supabase",
    "start",
    "-x",
    "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
    "--workdir",
    expect.any(String),
  ],
];
export const ownershipCommand = [
  "docker",
  [
    "inspect",
    "supabase_db_rentcottage-verification",
    "--format",
    '{{ index .Config.Labels "com.supabase.cli.project" }}|{{ index .Config.Labels "com.supabase.cli.workdir" }}',
  ],
];
export const resetCommand = [
  "npx",
  ["supabase", "db", "reset", "--local", "--workdir", expect.any(String)],
];
export const statusCommand = [
  "npx",
  ["supabase", "status", "-o", "json", "--workdir", expect.any(String)],
];
export const stopCommand = [
  "npx",
  [
    "supabase",
    "stop",
    "--no-backup",
    "--project-id",
    "rentcottage-verification",
    "--workdir",
    expect.any(String),
  ],
];
export function withWorkdir([command, args]) {
  return [command, [...args, "--workdir", expect.any(String)]];
}
export const declaredSchemaDiffStep = [
  "npx",
  ["supabase", "db", "diff", "--local", "--output-format", "json"],
];
export const declaredSchemaDiffCommand = withWorkdir(declaredSchemaDiffStep);
export const emptyDeclaredSchemaDiff = JSON.stringify({
  diff: "",
  file: null,
  files: [],
  schemas: [],
  engine: "pg-delta",
  dropStatements: [],
  message: "Diff complete.",
});
export const sqlTestsStep = ["npx", ["supabase", "test", "db"]];
export const sqlTestsCommand = withWorkdir(sqlTestsStep);
export const databasePreflightCommands = [
  declaredSchemaDiffCommand,
  sqlTestsCommand,
];
export const fixtureContractCommands = [
  ["node", ["scripts/verify-access-fixture-contract.mjs"]],
  [
    "npx",
    [
      "playwright",
      "test",
      "--config=scripts/access-journey-fixture.config.ts",
      "--workers=1",
      "--retries=0",
      "--grep",
      "owned access readiness uses production account and application readers",
    ],
  ],
];
export const databaseCheckCommands = [
  ...fixtureContractCommands,
  ["node", ["scripts/verify-account-access-concurrency.mjs"]],
  ["node", ["scripts/prepare-access-test.mjs", "create", "mobile"]],
  ["node", ["scripts/verify-cottage-profile-draft-concurrency.mjs"]],
  ["node", ["scripts/verify-cottage-shift-schedule-concurrency.mjs"]],
  ["node", ["scripts/verify-cottage-inventory-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-period-hold-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-request-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-request-lifecycle-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-request-capture-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-request-payment-recovery-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-request-payment-history-concurrency.mjs"]],
  [
    "node",
    ["scripts/verify-booking-confirmation-notification-concurrency.mjs"],
  ],
  ["node", ["scripts/verify-booking-event-notification-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-request-notification-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-preparation-reminder-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-cancellation-concurrency.mjs"]],
  ["node", ["scripts/verify-messaging-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-completion-concurrency.mjs"]],
  ["node", ["scripts/verify-customer-review-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-refund-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-payout-concurrency.mjs"]],
  [
    "node",
    ["scripts/verify-booking-request-payment-required-expiry-concurrency.mjs"],
  ],
];
export const nextFixtureCommands = [
  ["node", ["scripts/prepare-access-test.mjs", "create", "mobile", "desktop"]],
  [
    "node",
    ["scripts/prepare-access-test.mjs", "validate", "mobile", "desktop"],
  ],
];
export const nextJourneyCommand = [
  "npx",
  [
    "playwright",
    "test",
    "tests/access.spec.ts",
    "tests/booking-request-access.spec.ts",
    "tests/administrator-payment-history.spec.ts",
    "tests/administrator-records.spec.ts",
    "tests/booking-history.spec.ts",
    "tests/messaging.spec.ts",
    "tests/customer-reviews.spec.ts",
    "--project=mobile",
    "--project=desktop",
    "--workers=1",
    "--output=playwright-report/access-next",
  ],
];
export const workerPreparationCommands = [
  ["node", ["scripts/prepare-access-test.mjs", "create", "worker"]],
  ["node", ["scripts/prepare-access-test.mjs", "validate", "worker"]],
  ["npm", ["run", "build:worker"]],
];
export const workerJourneyCommand = [
  "npx",
  [
    "playwright",
    "test",
    "tests/access.spec.ts",
    "tests/booking-request-access.spec.ts",
    "tests/administrator-payment-history.spec.ts",
    "tests/administrator-records.spec.ts",
    "tests/booking-cancellation-refund.spec.ts",
    "tests/messaging.spec.ts",
    "tests/customer-reviews.spec.ts",
    "--project=worker",
    "--config=playwright.worker-prebuilt.config.ts",
    "--workers=1",
    "--output=playwright-report/access-worker",
  ],
];
export const scheduledJourneyCommand = [
  "npx",
  [
    "playwright",
    "test",
    "tests/worker-scheduled-expiry.spec.ts",
    "tests/worker-scheduled-capture.spec.ts",
    "tests/worker-scheduled-refund.spec.ts",
    "tests/worker-scheduled-completion.spec.ts",
    "tests/worker-scheduled-reminder.spec.ts",
    "tests/worker-scheduled-request-notification.spec.ts",
    "--project=worker",
    "--config=playwright.worker-prebuilt.config.ts",
    "--workers=1",
    "--output=playwright-report/scheduled-expiry-worker",
  ],
];
export const scheduledExpiryVerifyCommand = [
  "node",
  ["scripts/verify-booking-request-scheduled-expiry.mjs", "--verify"],
];
export const browserCommands = [
  ...nextFixtureCommands,
  nextJourneyCommand,
  ...workerPreparationCommands,
  workerJourneyCommand,
  scheduledJourneyCommand,
  scheduledExpiryVerifyCommand,
];

export function ownedRun(
  implementation,
  { project = "rentcottage-verification", workdir } = {},
) {
  return vi.fn((command, args, options) => {
    if (command === "docker" && args[0] === "inspect") {
      const ownedWorkdir =
        typeof workdir === "function"
          ? workdir()
          : (workdir ?? options.env.SUPABASE_LOCAL_WORKDIR);
      return { status: 0, stdout: `${project}|${ownedWorkdir}\n`, stderr: "" };
    }
    if (
      command === "npx" &&
      args.slice(0, 6).join(" ") ===
        "supabase db diff --local --output-format json"
    ) {
      const result = implementation(command, args, options);
      return result.stdout
        ? result
        : { ...result, stdout: emptyDeclaredSchemaDiff };
    }
    return implementation(command, args, options);
  });
}

export function successfulRun({
  project = "rentcottage-verification",
  workdir,
} = {}) {
  return ownedRun(
    (command, args) => ({
      status: 0,
      stdout:
        command === "npx" &&
        args.slice(0, 4).join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }),
    { project, workdir },
  );
}

export function mainWithPreparedProject(args, options = {}) {
  return main(args, {
    prepareProject: ({ stateRoot }) => join(stateRoot, "project"),
    ...options,
  });
}

export function commands(run) {
  return run.mock.calls.map(([command, args]) => [command, args]);
}

export function plannedCommands(steps) {
  return steps.map(({ group, command, args }) => [group, command, args]);
}

export function inGroup(group, commandList) {
  return commandList.map(([command, args]) => [group, command, args]);
}
