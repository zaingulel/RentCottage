import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const FIXTURE_CONTRACT_MODE = "--fixture-contract";
const DATABASE_MODE = "--database";
const BROWSER_MODE = "--browser";
const USAGE = `Usage: npm run verify:access [${DATABASE_MODE}|${BROWSER_MODE}|${FIXTURE_CONTRACT_MODE}]`;
const LOCAL_PROJECT_PATTERN = /^rentcottage(?:-[a-z0-9]+)*$/;
const EXCLUDED_SERVICES =
  "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";

function runStep(command, args, options) {
  return spawnSync(command, args, options);
}

function defaultRemoveTemp(path) {
  rmSync(path, { recursive: true, force: true });
}

export function prepareIsolatedSupabaseWorkdir({
  localProject,
  stateRoot,
  workingDirectory,
}) {
  if (localProject === "rentcottage") return workingDirectory;

  const workdir = join(stateRoot, "project");
  const source = join(workingDirectory, "supabase");
  const target = join(workdir, "supabase");
  mkdirSync(target, { recursive: true });
  let config = readFileSync(join(source, "config.toml"), "utf8");
  const replacements = [
    ['project_id = "rentcottage"', `project_id = "${localProject}"`],
    ["port = 54331", "port = 55331"],
    ["port = 54332", "port = 55332"],
    ["shadow_port = 54330", "shadow_port = 55330"],
    ["port = 54339", "port = 55339"],
    ["port = 54333", "port = 55333"],
    ["port = 54334", "port = 55334"],
    ["inspector_port = 8083", "inspector_port = 8183"],
    ["port = 54337", "port = 55337"],
  ];
  for (const [current, replacement] of replacements) {
    if (!config.includes(current)) {
      throw new Error(`Local Supabase config is missing ${current}.`);
    }
    config = config.replace(current, replacement);
  }
  writeFileSync(join(target, "config.toml"), config);
  symlinkSync(join(source, "migrations"), join(target, "migrations"), "dir");
  symlinkSync(join(source, "tests"), join(target, "tests"), "dir");
  return realpathSync(workdir);
}

function localCredentials(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const credentials = value;
  if (
    typeof credentials.API_URL !== "string" ||
    typeof credentials.PUBLISHABLE_KEY !== "string" ||
    typeof credentials.SECRET_KEY !== "string" ||
    !credentials.PUBLISHABLE_KEY ||
    !credentials.SECRET_KEY
  ) {
    return undefined;
  }
  try {
    const url = new URL(credentials.API_URL);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.hostname !== "127.0.0.1"
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return credentials;
}

export function main(
  args,
  {
    environment = process.env,
    makeTemp = () => mkdtempSync(join(tmpdir(), "rentcottage-docker-config-")),
    prepareProject = prepareIsolatedSupabaseWorkdir,
    removeTemp = defaultRemoveTemp,
    run = runStep,
    stderr = console.error,
    workingDirectory = process.cwd(),
  } = {},
) {
  const mode = args.length === 1 ? args[0] : undefined;
  if (
    args.length > 1 ||
    (mode !== undefined &&
      mode !== DATABASE_MODE &&
      mode !== BROWSER_MODE &&
      mode !== FIXTURE_CONTRACT_MODE)
  ) {
    stderr(USAGE);
    return 2;
  }
  const focusedFixtureContract = mode === FIXTURE_CONTRACT_MODE;
  const databaseMode = mode === undefined || mode === DATABASE_MODE;
  const browserMode = mode === undefined || mode === BROWSER_MODE;

  const localProject = environment.SUPABASE_LOCAL_PROJECT ?? "rentcottage";
  if (!LOCAL_PROJECT_PATTERN.test(localProject)) {
    stderr(
      "SUPABASE_LOCAL_PROJECT must name a disposable RentCottage local project.",
    );
    return 2;
  }

  const dockerConfig = makeTemp();
  let localWorkdir;
  try {
    localWorkdir = prepareProject({
      localProject,
      stateRoot: dockerConfig,
      workingDirectory: resolve(workingDirectory),
    });
  } catch (error) {
    removeTemp(dockerConfig);
    stderr(
      `Unable to prepare the disposable local Supabase project: ${error.message}`,
    );
    return 1;
  }
  const isolatedProject = localProject !== "rentcottage";
  const supabaseArguments = (commandArgs) =>
    isolatedProject ? [...commandArgs, "--workdir", localWorkdir] : commandArgs;
  const supabaseEnvironment = {
    ...environment,
    DOCKER_CONFIG: dockerConfig,
    SUPABASE_TELEMETRY_DISABLED: "1",
    DO_NOT_TRACK: "1",
  };
  let started = false;
  let exitCode = 0;

  const execute = (command, commandArgs, options = {}) => {
    const result = run(command, commandArgs, {
      env: supabaseEnvironment,
      stdio: "inherit",
      ...options,
    });
    if (result.error) {
      stderr(`Unable to run ${command}: ${result.error.message}`);
      return { ...result, status: 1 };
    }
    if (result.status !== 0) {
      if (result.stdout) stderr(String(result.stdout).trimEnd());
      if (result.stderr) stderr(String(result.stderr).trimEnd());
      stderr(
        `Failed: ${command} ${commandArgs.join(" ")} (status ${result.status ?? 1}).`,
      );
    }
    return { ...result, status: result.status ?? 1 };
  };

  const databaseConcurrencyEnvironment = {
    ...supabaseEnvironment,
    SUPABASE_DB_CONTAINER: `supabase_db_${localProject}`,
    SUPABASE_LOCAL_PROJECT: localProject,
  };
  if (isolatedProject) {
    databaseConcurrencyEnvironment.SUPABASE_LOCAL_WORKDIR = localWorkdir;
  }
  delete databaseConcurrencyEnvironment.SUPABASE_URL;
  delete databaseConcurrencyEnvironment.SUPABASE_PUBLISHABLE_KEY;
  delete databaseConcurrencyEnvironment.SUPABASE_SECRET_KEY;

  const verify = () => {
    let result = execute(
      "npx",
      supabaseArguments(["supabase", "start", "-x", EXCLUDED_SERVICES]),
      { encoding: "utf8", stdio: "pipe" },
    );
    if (result.status !== 0) return result.status;
    try {
      createLocalSupabaseConcurrencyHarness({
        environment: databaseConcurrencyEnvironment,
        spawnSyncProcess: (command, args, options) =>
          run(command, args, {
            ...options,
            env: databaseConcurrencyEnvironment,
          }),
        workingDirectory: localWorkdir,
      }).guardDisposableLocalDatabase();
    } catch (error) {
      stderr(
        `Unable to verify disposable local Supabase ownership: ${error.message}`,
      );
      return 1;
    }
    started = true;

    result = execute(
      "npx",
      supabaseArguments(["supabase", "db", "reset", "--local"]),
    );
    if (result.status !== 0) return result.status;

    const verifyDatabasePreflight = () => {
      result = execute("npx", supabaseArguments(["supabase", "test", "db"]));
      if (result.status !== 0) return result.status;
      // Each deferred verifier is followed by one that resets the database; standalone and failed runs still restore themselves.
      result = execute(
        "node",
        [
          "scripts/verify-cottage-profile-draft-concurrency.mjs",
          "--verify-migration-preflight",
          "--defer-successful-restore",
        ],
        { env: databaseConcurrencyEnvironment, stdio: "inherit" },
      );
      if (result.status !== 0) return result.status;
      result = execute(
        "node",
        [
          "scripts/verify-booking-period-hold-concurrency.mjs",
          "--verify-migration-preflight",
        ],
        { env: databaseConcurrencyEnvironment, stdio: "inherit" },
      );
      if (result.status !== 0) return result.status;
      result = execute(
        "node",
        [
          "scripts/verify-booking-request-lifecycle-upgrade.mjs",
          "--defer-successful-restore",
        ],
        { env: databaseConcurrencyEnvironment, stdio: "inherit" },
      );
      if (result.status !== 0) return result.status;
      result = execute(
        "node",
        ["scripts/verify-booking-request-capture-work-upgrade.mjs"],
        { env: databaseConcurrencyEnvironment, stdio: "inherit" },
      );
      if (result.status !== 0) return result.status;
      return 0;
    };
    if (databaseMode) {
      const preflightStatus = verifyDatabasePreflight();
      if (preflightStatus !== 0) return preflightStatus;
    }

    const status = execute(
      "npx",
      supabaseArguments(["supabase", "status", "-o", "json"]),
      {
        encoding: "utf8",
        stdio: "pipe",
      },
    );
    if (status.status !== 0) return status.status;

    let parsedCredentials;
    try {
      parsedCredentials = JSON.parse(status.stdout);
    } catch {
      stderr("Supabase returned unreadable local test credentials.");
      return 1;
    }
    const credentials = localCredentials(parsedCredentials);
    if (!credentials) {
      stderr("Supabase did not return valid local test credentials.");
      return 1;
    }
    const supabaseUrl = credentials.API_URL;
    const publishableKey = credentials.PUBLISHABLE_KEY;
    const secretKey = credentials.SECRET_KEY;
    const accessEnvironment = {
      ...supabaseEnvironment,
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: supabaseUrl,
      SUPABASE_PUBLISHABLE_KEY: publishableKey,
      SUPABASE_SECRET_KEY: secretKey,
      PRIVILEGED_AUDIT_HMAC_KEY: "local-test-audit-hmac-key-32-characters",
    };
    const verifyFixtureContract = () => {
      const fixtureContract = execute(
        "node",
        ["scripts/verify-access-fixture-contract.mjs"],
        {
          env: { ...accessEnvironment, ...databaseConcurrencyEnvironment },
          stdio: "inherit",
        },
      );
      return fixtureContract.status;
    };
    if (focusedFixtureContract) return verifyFixtureContract();

    const verifyDatabaseChecks = () => {
      const fixtureContractStatus = verifyFixtureContract();
      if (fixtureContractStatus !== 0) return fixtureContractStatus;
      const createDraftConcurrencyFixture = execute(
        "node",
        ["scripts/prepare-access-test.mjs", "create", "mobile"],
        { env: accessEnvironment, stdio: "inherit" },
      );
      if (createDraftConcurrencyFixture.status !== 0) {
        return createDraftConcurrencyFixture.status;
      }
      const scheduleConcurrencyEnvironment = { ...accessEnvironment };
      delete scheduleConcurrencyEnvironment.SUPABASE_SECRET_KEY;
      const inventoryConcurrencyEnvironment = {
        ...scheduleConcurrencyEnvironment,
        ...databaseConcurrencyEnvironment,
      };
      const draftConcurrency = execute(
        "node",
        ["scripts/verify-cottage-profile-draft-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      if (draftConcurrency.status !== 0) return draftConcurrency.status;
      const scheduleConcurrency = execute(
        "node",
        ["scripts/verify-cottage-shift-schedule-concurrency.mjs"],
        { env: scheduleConcurrencyEnvironment, stdio: "inherit" },
      );
      if (scheduleConcurrency.status !== 0) return scheduleConcurrency.status;
      const inventoryConcurrency = execute(
        "node",
        ["scripts/verify-cottage-inventory-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      if (inventoryConcurrency.status !== 0) return inventoryConcurrency.status;
      const bookingPeriodHoldConcurrency = execute(
        "node",
        ["scripts/verify-booking-period-hold-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      if (bookingPeriodHoldConcurrency.status !== 0) {
        return bookingPeriodHoldConcurrency.status;
      }
      const bookingRequestConcurrency = execute(
        "node",
        ["scripts/verify-booking-request-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      if (bookingRequestConcurrency.status !== 0) {
        return bookingRequestConcurrency.status;
      }
      const bookingRequestLifecycleConcurrency = execute(
        "node",
        ["scripts/verify-booking-request-lifecycle-concurrency.mjs"],
        {
          env: {
            ...inventoryConcurrencyEnvironment,
            SUPABASE_SECRET_KEY: secretKey,
          },
          stdio: "inherit",
        },
      );
      if (bookingRequestLifecycleConcurrency.status !== 0) {
        return bookingRequestLifecycleConcurrency.status;
      }
      const bookingRequestCaptureConcurrency = execute(
        "node",
        ["scripts/verify-booking-request-capture-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      return bookingRequestCaptureConcurrency.status;
    };
    if (databaseMode) {
      const databaseStatus = verifyDatabaseChecks();
      if (databaseStatus !== 0) return databaseStatus;
    }
    if (!browserMode) return 0;
    const verifyBrowserJourneys = () => {
      const createNextFixtures = execute(
        "node",
        ["scripts/prepare-access-test.mjs", "create", "mobile", "desktop"],
        {
          env: accessEnvironment,
          stdio: "inherit",
        },
      );
      if (createNextFixtures.status !== 0) return createNextFixtures.status;
      const validateNextFixtures = execute(
        "node",
        ["scripts/prepare-access-test.mjs", "validate", "mobile", "desktop"],
        {
          env: accessEnvironment,
          stdio: "inherit",
        },
      );
      if (validateNextFixtures.status !== 0) {
        return validateNextFixtures.status;
      }
      const browserEnvironment = {
        ...accessEnvironment,
        APP_ENVIRONMENT: "test",
        NEXTJS_ENV: "test",
        SUPABASE_PROJECT_REF: "local-test",
        PLAYWRIGHT_SERVER: "next",
      };
      const browser = execute(
        "npx",
        [
          "playwright",
          "test",
          "tests/access.spec.ts",
          "tests/booking-request-access.spec.ts",
          "--project=mobile",
          "--project=desktop",
          "--workers=1",
          "--output=playwright-report/access-next",
        ],
        { env: browserEnvironment, stdio: "inherit" },
      );
      if (browser.status !== 0) return browser.status;

      const createWorkerFixtures = execute(
        "node",
        ["scripts/prepare-access-test.mjs", "create", "worker"],
        { env: accessEnvironment, stdio: "inherit" },
      );
      if (createWorkerFixtures.status !== 0) {
        return createWorkerFixtures.status;
      }
      const validateWorkerFixtures = execute(
        "node",
        ["scripts/prepare-access-test.mjs", "validate", "worker"],
        { env: accessEnvironment, stdio: "inherit" },
      );
      if (validateWorkerFixtures.status !== 0) {
        return validateWorkerFixtures.status;
      }

      const workerEnvironment = {
        ...browserEnvironment,
        PLAYWRIGHT_SERVER: "worker",
      };
      const workerBuild = execute("npm", ["run", "build:worker"], {
        env: workerEnvironment,
        stdio: "inherit",
      });
      if (workerBuild.status !== 0) return workerBuild.status;

      const workerBrowser = execute(
        "npx",
        [
          "playwright",
          "test",
          "tests/access.spec.ts",
          "tests/booking-request-access.spec.ts",
          "--project=worker",
          "--config=playwright.worker-prebuilt.config.ts",
          "--workers=1",
          "--output=playwright-report/access-worker",
        ],
        {
          env: workerEnvironment,
          stdio: "inherit",
        },
      );
      if (workerBrowser.status !== 0) return workerBrowser.status;
      const scheduledExpirySeed = execute(
        "node",
        ["scripts/verify-booking-request-scheduled-expiry.mjs", "--seed"],
        { env: databaseConcurrencyEnvironment, stdio: "inherit" },
      );
      if (scheduledExpirySeed.status !== 0) return scheduledExpirySeed.status;
      const scheduledExpiry = execute(
        "npx",
        [
          "playwright",
          "test",
          "tests/worker-scheduled-expiry.spec.ts",
          "--project=worker",
          "--config=playwright.worker-prebuilt.config.ts",
          "--workers=1",
          "--output=playwright-report/scheduled-expiry-worker",
        ],
        {
          env: workerEnvironment,
          stdio: "inherit",
        },
      );
      if (scheduledExpiry.status !== 0) return scheduledExpiry.status;
      const scheduledExpiryVerify = execute(
        "node",
        ["scripts/verify-booking-request-scheduled-expiry.mjs", "--verify"],
        { env: databaseConcurrencyEnvironment, stdio: "inherit" },
      );
      if (scheduledExpiryVerify.status !== 0) {
        return scheduledExpiryVerify.status;
      }
      return 0;
    };
    return verifyBrowserJourneys();
  };

  try {
    exitCode = verify();
  } finally {
    if (started) {
      const stopped = execute(
        "npx",
        supabaseArguments([
          "supabase",
          "stop",
          "--no-backup",
          ...(isolatedProject ? ["--project-id", localProject] : []),
        ]),
        {
          encoding: "utf8",
          stdio: "pipe",
        },
      );
      if (exitCode === 0 && stopped.status !== 0) {
        stderr("Local Supabase cleanup failed.");
        exitCode = stopped.status;
      }
    }
    removeTemp(dockerConfig);
  }
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
