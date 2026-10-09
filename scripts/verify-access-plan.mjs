export const FIXTURE_CONTRACT_MODE = "--fixture-contract";
export const OWNED_JOURNEYS_MODE = "--owned-journeys";
const OWNED_JOURNEYS_GREP =
  "(?:shared sign-in from the homepage returns a prospective owner to their private application|a Cottage Owner saves, resumes and submits a complete private application|Owner Application keeps evidence controls aligned and accessible in every locale|one account returns to customer bookings, enrolls explicitly and signs out only this device)$";
const OWNED_SUBMISSION_GREP =
  "a Cottage Owner saves, resumes and submits a complete private application$";
export const DATABASE_MODE = "--database";
export const DATABASE_TESTS_MODE = "--database-tests";
export const BROWSER_MODE = "--browser";

const CONCURRENCY_PROGRAMS = [
  {
    script: "scripts/verify-cottage-profile-draft-concurrency.mjs",
    environment: "inventory",
  },
  {
    script: "scripts/verify-cottage-shift-schedule-concurrency.mjs",
    environment: "schedule",
  },
  {
    script: "scripts/verify-cottage-inventory-concurrency.mjs",
    environment: "inventory",
  },
  {
    script: "scripts/verify-booking-period-hold-concurrency.mjs",
    environment: "inventory",
  },
  {
    script: "scripts/verify-booking-request-concurrency.mjs",
    environment: "inventory",
  },
  {
    script: "scripts/verify-booking-request-lifecycle-concurrency.mjs",
    environment: "secret-inventory",
  },
  {
    script: "scripts/verify-booking-request-capture-concurrency.mjs",
    environment: "secret-inventory",
  },
  {
    script: "scripts/verify-booking-request-payment-recovery-concurrency.mjs",
    environment: "inventory",
  },
  {
    script: "scripts/verify-booking-request-payment-history-concurrency.mjs",
    environment: "inventory",
  },
  {
    script: "scripts/verify-booking-confirmation-notification-concurrency.mjs",
    environment: "inventory",
  },
  {
    script: "scripts/verify-booking-event-notification-concurrency.mjs",
    environment: "inventory",
  },
  {
    script: "scripts/verify-booking-request-notification-concurrency.mjs",
    environment: "inventory",
  },
  {
    script: "scripts/verify-booking-preparation-reminder-concurrency.mjs",
    environment: "inventory",
  },
  {
    script: "scripts/verify-booking-cancellation-concurrency.mjs",
    environment: "inventory",
  },
  {
    script: "scripts/verify-messaging-concurrency.mjs",
    environment: "inventory",
  },
  {
    script: "scripts/verify-booking-completion-concurrency.mjs",
    environment: "inventory",
  },
  {
    script: "scripts/verify-customer-review-concurrency.mjs",
    environment: "inventory",
  },
  {
    script: "scripts/verify-booking-refund-concurrency.mjs",
    environment: "inventory",
  },
  {
    script: "scripts/verify-booking-payout-concurrency.mjs",
    environment: "inventory",
  },
  {
    script:
      "scripts/verify-booking-request-payment-required-expiry-concurrency.mjs",
    environment: "inventory",
  },
];
const PARTITION_PROGRAMS = {
  "booking-request": [
    "scripts/verify-booking-request-concurrency.mjs",
    "scripts/verify-booking-request-lifecycle-concurrency.mjs",
  ],
  "booking-capture": ["scripts/verify-booking-request-capture-concurrency.mjs"],
  "payment-required-expiry": [
    "scripts/verify-booking-request-payment-required-expiry-concurrency.mjs",
  ],
};

function fixtureContract(group) {
  return [
    {
      group,
      command: "node",
      args: ["scripts/verify-access-fixture-contract.mjs"],
      environment: "fixture",
    },
    {
      group,
      command: "npx",
      args: [
        "playwright",
        "test",
        "--config=scripts/access-journey-fixture.config.ts",
        "--workers=1",
        "--retries=0",
        "--grep",
        "owned access readiness uses production account and application readers",
      ],
      environment: "fixture",
    },
  ];
}

function databasePreflight(partition) {
  const steps = [];
  if (!partition || partition === "booking-request") {
    steps.push({
      group: "database",
      command: "npx",
      args: ["supabase", "db", "diff", "--local", "--output-format", "json"],
      environment: "supabase",
      declaredSchemaDiff: true,
    });
  }
  if (!partition || partition === "database-core") {
    steps.push({
      group: "database",
      command: "npx",
      args: ["supabase", "test", "db"],
      environment: "supabase",
    });
  }
  return steps;
}

function databaseChecks(mode, partition) {
  const steps = [];
  if (!partition || partition === "database-core") {
    steps.push(...fixtureContract("database"), {
      group: "database",
      command: "node",
      args: ["scripts/verify-account-access-concurrency.mjs"],
      environment: "database",
    });
  }
  steps.push({
    group: "database",
    command: "node",
    args: [
      "scripts/prepare-access-test.mjs",
      "create",
      "mobile",
      // The cross-Cottage observer needs both published fixtures.
      ...(partition === "booking-request" ? ["worker"] : []),
    ],
    environment: "access",
  });
  const excludedCorePrograms = Object.values(PARTITION_PROGRAMS).flat();
  for (const { script, environment } of CONCURRENCY_PROGRAMS) {
    if (
      mode === DATABASE_TESTS_MODE &&
      script.startsWith("scripts/verify-booking-")
    )
      continue;
    if (partition) {
      const selectedScripts = PARTITION_PROGRAMS[partition];
      if (
        selectedScripts
          ? !selectedScripts.includes(script)
          : excludedCorePrograms.includes(script)
      )
        continue;
    }
    steps.push({
      group: "database",
      command: "node",
      args: [script],
      environment,
    });
  }
  return steps;
}

function browserJourneys({ ownedJourneys, phase, partition, shard }) {
  const steps = [];
  const builtOnce = !partition && !ownedJourneys;
  const workerBuild = {
    group: "browser",
    command: "npm",
    args: ["run", "build:worker"],
    environment: "worker",
  };
  if (!partition || partition === "next") {
    for (const action of ["create", "validate"]) {
      steps.push({
        group: "browser",
        command: "node",
        args: ["scripts/prepare-access-test.mjs", action, "mobile", "desktop"],
        environment: "access",
      });
    }
    const nextArgs = ownedJourneys
      ? [
          "playwright",
          "test",
          "tests/access.spec.ts",
          "--project=mobile",
          "--project=desktop",
          "--workers=1",
          phase === "retry-proof" ? "--retries=1" : "--retries=0",
          "--grep",
          phase === "retry-proof" ? OWNED_SUBMISSION_GREP : OWNED_JOURNEYS_GREP,
          `--output=playwright-report/owned-next-${phase}`,
        ]
      : [
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
          ...(builtOnce ? ["--config=playwright.next-prebuilt.config.ts"] : []),
          "--workers=1",
          "--output=playwright-report/access-next",
        ];
    if (partition === "next") {
      steps.push(
        {
          group: "browser",
          command: "npx",
          args: [...nextArgs, "--list"],
          environment: "next",
        },
        {
          group: "browser",
          command: "npx",
          args: [...nextArgs, `--shard=${shard}`],
          environment: "next",
        },
      );
      return steps;
    }
    if (builtOnce) {
      steps.push(workerBuild, {
        group: "browser",
        command: "npm",
        args: ["run", "scan:client-secrets"],
        environment: "worker",
      });
    }
    steps.push({
      group: "browser",
      command: "npx",
      args: nextArgs,
      environment: "next",
    });
  }

  steps.push(
    {
      group: "browser",
      command: "node",
      args: ["scripts/prepare-access-test.mjs", "create", "worker"],
      environment: "access",
    },
    {
      group: "browser",
      command: "node",
      args: ["scripts/prepare-access-test.mjs", "validate", "worker"],
      environment: "access",
    },
  );
  if (!builtOnce) steps.push(workerBuild);

  if (partition !== "scheduled") {
    let workerArgs;
    if (ownedJourneys) {
      workerArgs = [
        "playwright",
        "test",
        "tests/access.spec.ts",
        "--project=worker",
        "--config=playwright.worker-prebuilt.config.ts",
        "--workers=1",
        phase === "retry-proof" ? "--retries=1" : "--retries=0",
        "--grep",
        phase === "retry-proof" ? OWNED_SUBMISSION_GREP : OWNED_JOURNEYS_GREP,
        `--output=playwright-report/owned-worker-${phase}`,
      ];
    } else {
      const workerFiles = [
        "tests/access.spec.ts",
        "tests/booking-request-access.spec.ts",
        "tests/administrator-payment-history.spec.ts",
        "tests/administrator-records.spec.ts",
        "tests/booking-cancellation-refund.spec.ts",
        "tests/messaging.spec.ts",
        "tests/customer-reviews.spec.ts",
      ];
      const selectedWorkerFiles = workerFiles.filter((file) => {
        if (partition !== "worker") return true;
        const requestFile =
          file === "tests/booking-request-access.spec.ts" ||
          file === "tests/booking-cancellation-refund.spec.ts";
        return shard === "2/2" ? requestFile : !requestFile;
      });
      workerArgs = [
        "playwright",
        "test",
        ...selectedWorkerFiles,
        "--project=worker",
        "--config=playwright.worker-prebuilt.config.ts",
        "--workers=1",
        "--output=playwright-report/access-worker",
      ];
    }
    if (partition === "worker") {
      steps.push({
        group: "browser",
        command: "npx",
        args: [...workerArgs, "--list"],
        environment: "worker",
      });
    }
    steps.push({
      group: "browser",
      command: "npx",
      args: workerArgs,
      environment: "worker",
    });
  }
  if (ownedJourneys || partition === "worker") return steps;
  steps.push(
    {
      group: "browser",
      command: "npx",
      args: [
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
      environment: "worker",
    },
    {
      group: "browser",
      command: "node",
      args: ["scripts/verify-booking-request-scheduled-expiry.mjs", "--verify"],
      environment: "database",
      // The exactly-once check reports even after a failed scheduled test; the test failure stays authoritative.
      runsAfterFailure: true,
    },
  );
  return steps;
}

export function accessStepPlan({ mode, phase, partition, shard }) {
  if (mode === FIXTURE_CONTRACT_MODE)
    return { preflight: [], checks: fixtureContract("fixture") };
  const ownedJourneys = mode === OWNED_JOURNEYS_MODE;
  const database =
    mode === undefined ||
    mode === DATABASE_MODE ||
    mode === DATABASE_TESTS_MODE;
  const browser = mode === undefined || mode === BROWSER_MODE || ownedJourneys;
  return {
    preflight: database ? databasePreflight(partition) : [],
    checks: [
      ...(database ? databaseChecks(mode, partition) : []),
      ...(ownedJourneys ? fixtureContract("shared-setup") : []),
      ...(browser
        ? browserJourneys({ ownedJourneys, phase, partition, shard })
        : []),
    ],
  };
}
