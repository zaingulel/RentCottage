import { spawn } from "node:child_process";
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
import { StringDecoder } from "node:string_decoder";
import { pathToFileURL } from "node:url";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const FIXTURE_CONTRACT_MODE = "--fixture-contract";
const DATABASE_MODE = "--database";
const BROWSER_MODE = "--browser";
const USAGE = `Usage: npm run verify:access [${DATABASE_MODE}|${BROWSER_MODE}|${FIXTURE_CONTRACT_MODE}]`;
const LOCAL_PROJECT_PATTERN = /^rentcottage(?:-[a-z0-9]+)*$/;
const EXCLUDED_SERVICES =
  "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";

const GRACEFUL_EXIT_LIMIT_MS = 5_000;
const FORCED_EXIT_LIMIT_MS = 2_000;
const MAX_CAPTURE_BYTES = 1024 * 1024;
const CLEANUP_COMMAND_LIMIT_MS = 30_000;

function processGroupExists(group) {
  if (!Number.isInteger(group) || group <= 1) return false;
  try {
    process.kill(-group, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

function inspectProcessGroup(group) {
  return new Promise((resolveInspection, rejectInspection) => {
    const child = spawn("/bin/ps", ["-axo", "pid=,pgid=,lstart=,command="], {
      env: { ...process.env, LANG: "C", LC_ALL: "C" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let settled = false;
    const finish = (action, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(
        rejectInspection,
        new Error(`Timed out inspecting owned process group ${group}.`),
      );
    }, 1_000);
    child.stdout.on("data", (chunk) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_CAPTURE_BYTES) {
        child.kill("SIGKILL");
        finish(
          rejectInspection,
          new Error(`Owned process group ${group} inspection was too large.`),
        );
        return;
      }
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => finish(rejectInspection, error));
    child.once("close", (status) => {
      if (settled) return;
      if (status !== 0) {
        if (!processGroupExists(group)) {
          finish(resolveInspection, []);
          return;
        }
        finish(
          rejectInspection,
          new Error(
            `Unable to inspect owned process group ${group}: ${stderr}`,
          ),
        );
        return;
      }
      try {
        finish(
          resolveInspection,
          stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.{24})\s+(.+)$/);
              if (!match) {
                throw new Error(
                  `Unable to parse owned process group ${group} identity.`,
                );
              }
              return {
                command: match[4],
                group: Number(match[2]),
                pid: Number(match[1]),
                started: match[3],
              };
            })
            .filter((member) => member.group === group),
        );
      } catch (error) {
        finish(rejectInspection, error);
      }
    });
  });
}

function sameProcessIdentity(left, right) {
  return (
    left.pid === right.pid &&
    left.group === right.group &&
    left.started === right.started
  );
}

async function captureLeaderIdentity(invocation) {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline && processGroupExists(invocation.group)) {
    const members = await inspectProcessGroup(invocation.group);
    const leader = members.find(
      (member) =>
        member.pid === invocation.child.pid &&
        member.group === invocation.group,
    );
    if (leader) {
      invocation.knownMembers = [leader];
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}

async function refreshOwnedProcessGroup(invocation) {
  const members = await inspectProcessGroup(invocation.group);
  const retainedIdentity = members.some((member) =>
    invocation.knownMembers.some((known) => sameProcessIdentity(member, known)),
  );
  if (!retainedIdentity) return false;
  invocation.knownMembers = members;
  return true;
}

async function waitForProcessGroupExit(group, limit) {
  const deadline = Date.now() + limit;
  while (processGroupExists(group) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  return !processGroupExists(group);
}

async function stopProcessGroup(invocation, signal) {
  await invocation.identityReady;
  if (invocation.retentionError) throw invocation.retentionError;
  if (!(await refreshOwnedProcessGroup(invocation))) {
    throw new Error(
      `Unable to reidentify owned command process group ${invocation.group}.`,
    );
  }
  try {
    process.kill(-invocation.group, signal);
  } catch (error) {
    if (error.code === "ESRCH") return;
    throw error;
  }
  if (await waitForProcessGroupExit(invocation.group, GRACEFUL_EXIT_LIMIT_MS)) {
    return;
  }
  if (!(await refreshOwnedProcessGroup(invocation))) {
    throw new Error(
      `Unable to reidentify owned command process group ${invocation.group} before forced termination.`,
    );
  }
  try {
    process.kill(-invocation.group, "SIGKILL");
  } catch (error) {
    if (error.code === "ESRCH") return;
    throw error;
  }
  if (
    !(await waitForProcessGroupExit(invocation.group, FORCED_EXIT_LIMIT_MS))
  ) {
    throw new Error(
      `Owned command process group ${invocation.group} did not exit.`,
    );
  }
}

function runStep(command, args, options, onSpawn) {
  return new Promise((resolveRun) => {
    const lifecycleLimit = options.lifecycleLimit;
    const maxBuffer = options.maxBuffer ?? MAX_CAPTURE_BYTES;
    const spawnOptions = { ...options };
    delete spawnOptions.encoding;
    delete spawnOptions.input;
    delete spawnOptions.lifecycleLimit;
    delete spawnOptions.maxBuffer;
    const child = spawn(command, args, { ...spawnOptions, detached: true });
    const invocation = {
      child,
      command,
      group: child.pid,
      knownMembers: [],
    };
    const retain = (error) => {
      invocation.retentionError = error;
      lifecycleError = error;
      child.stdin?.unref();
      child.stdout?.unref();
      child.stderr?.unref();
      child.unref();
      finish(null, null);
    };
    invocation.stop = (signal) =>
      (invocation.stopping ??= stopProcessGroup(invocation, signal).catch(
        retain,
      ));
    if (Number.isInteger(child.pid)) {
      invocation.identityReady =
        captureLeaderIdentity(invocation).catch(retain);
      onSpawn(invocation);
    } else {
      invocation.identityReady = Promise.resolve();
    }
    let stdout = "";
    let stderr = "";
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let capturedBytes = 0;
    let bufferError;
    const capture = (stream, decoder, chunk) => {
      if (settled) return stream;
      capturedBytes += Buffer.byteLength(chunk);
      if (capturedBytes > maxBuffer) {
        if (!bufferError) {
          bufferError = new Error("spawn output exceeded maxBuffer");
          bufferError.code = "ENOBUFS";
          void invocation.stop("SIGTERM");
        }
        return stream;
      }
      return stream + decoder.write(chunk);
    };
    child.stdout?.on("data", (chunk) => {
      stdout = capture(stdout, stdoutDecoder, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = capture(stderr, stderrDecoder, chunk);
    });
    let spawnError;
    let lifecycleError;
    let settled = false;
    let lifecycleTimer;
    const finish = (status, signal) => {
      if (settled) return;
      settled = true;
      if (lifecycleTimer) clearTimeout(lifecycleTimer);
      if (!bufferError) {
        stdout += stdoutDecoder.end();
        stderr += stderrDecoder.end();
      }
      resolveRun({
        error: spawnError ?? bufferError ?? lifecycleError,
        signal,
        status,
        stderr,
        stdout,
      });
    };
    lifecycleTimer = lifecycleLimit
      ? setTimeout(async () => {
          lifecycleError = new Error(
            `Command did not exit within ${lifecycleLimit}ms.`,
          );
          lifecycleError.code = "ETIMEDOUT";
          await invocation.stop("SIGTERM");
          finish(null, null);
        }, lifecycleLimit)
      : undefined;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", async (status, signal) => {
      await invocation.identityReady;
      await invocation.stopping;
      finish(status, signal);
    });
  });
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
  symlinkSync(join(source, "schemas"), join(target, "schemas"), "dir");
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

export async function main(
  args,
  {
    environment = process.env,
    makeTemp = () => mkdtempSync(join(tmpdir(), "rentcottage-docker-config-")),
    prepareProject = prepareIsolatedSupabaseWorkdir,
    removeTemp = defaultRemoveTemp,
    run,
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
  let startupAttempted = false;
  let exitCode = 0;
  let activeInvocation;
  let interruptedSignal;
  let cleaningUp = false;
  let interruptionCleanup = Promise.resolve();

  const runCommand =
    run ??
    ((command, commandArgs, options) =>
      runStep(command, commandArgs, options, (invocation) => {
        activeInvocation = invocation;
      }));

  const handleSignal = (signal) => {
    if (interruptedSignal) return;
    interruptedSignal = signal;
    if (activeInvocation && !cleaningUp) {
      interruptionCleanup = activeInvocation.stop(signal);
    }
  };
  const handleSigint = () => handleSignal("SIGINT");
  const handleSigterm = () => handleSignal("SIGTERM");
  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);

  const execute = async (
    command,
    commandArgs,
    { cleanup = false, ...options } = {},
  ) => {
    if (interruptedSignal && !cleanup) {
      return { status: interruptedSignal === "SIGINT" ? 130 : 143 };
    }
    const invocationBeforeRun = activeInvocation;
    const result = await runCommand(command, commandArgs, {
      env: supabaseEnvironment,
      stdio: "inherit",
      ...options,
    });
    await activeInvocation?.stopping;
    if (
      activeInvocation !== invocationBeforeRun &&
      !processGroupExists(activeInvocation.group)
    ) {
      activeInvocation = undefined;
    }
    if (interruptedSignal && !cleanup) {
      return {
        ...result,
        status: interruptedSignal === "SIGINT" ? 130 : 143,
      };
    }
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

  const verify = async () => {
    startupAttempted = true;
    let result = await execute(
      "npx",
      supabaseArguments(["supabase", "start", "-x", EXCLUDED_SERVICES]),
      { encoding: "utf8", stdio: "pipe" },
    );
    if (result.status !== 0) return result.status;
    try {
      await createLocalSupabaseConcurrencyHarness({
        environment: databaseConcurrencyEnvironment,
        workingDirectory: localWorkdir,
      }).guardDisposableLocalDatabaseAsync((command, args, options) =>
        runCommand(command, args, {
          ...options,
          env: databaseConcurrencyEnvironment,
        }),
      );
    } catch (error) {
      stderr(
        `Unable to verify disposable local Supabase ownership: ${error.message}`,
      );
      return 1;
    }
    started = true;

    result = await execute(
      "npx",
      supabaseArguments(["supabase", "db", "reset", "--local"]),
    );
    if (result.status !== 0) return result.status;

    // The declared schema files must describe exactly what the migration chain builds; any diff is drift.
    const verifyDeclaredSchema = async () => {
      result = await execute(
        "npx",
        supabaseArguments([
          "supabase",
          "db",
          "diff",
          "--local",
          "--output-format",
          "json",
        ]),
        { encoding: "utf8", stdio: "pipe" },
      );
      if (result.status !== 0) return result.status;
      let report;
      try {
        report = JSON.parse(String(result.stdout));
      } catch {
        report = undefined;
      }
      if (!report || typeof report.diff !== "string") {
        stderr("Supabase returned an unreadable declared schema diff.");
        return 1;
      }
      if (report.diff.trim()) {
        stderr("Declared schema drifts from the migration chain:");
        stderr(report.diff.trimEnd());
        return 1;
      }
      return 0;
    };

    const verifyDatabasePreflight = async () => {
      const declaredSchemaStatus = await verifyDeclaredSchema();
      if (declaredSchemaStatus !== 0) return declaredSchemaStatus;
      result = await execute(
        "npx",
        supabaseArguments(["supabase", "test", "db"]),
      );
      if (result.status !== 0) return result.status;
      // Each deferred verifier is followed by one that resets the database; standalone and failed runs still restore themselves.
      result = await execute(
        "node",
        [
          "scripts/verify-cottage-profile-draft-concurrency.mjs",
          "--verify-migration-preflight",
          "--defer-successful-restore",
        ],
        { env: databaseConcurrencyEnvironment, stdio: "inherit" },
      );
      if (result.status !== 0) return result.status;
      result = await execute(
        "node",
        [
          "scripts/verify-booking-period-hold-concurrency.mjs",
          "--verify-migration-preflight",
        ],
        { env: databaseConcurrencyEnvironment, stdio: "inherit" },
      );
      if (result.status !== 0) return result.status;
      result = await execute(
        "node",
        [
          "scripts/verify-booking-request-lifecycle-upgrade.mjs",
          "--defer-successful-restore",
        ],
        { env: databaseConcurrencyEnvironment, stdio: "inherit" },
      );
      if (result.status !== 0) return result.status;
      result = await execute(
        "node",
        ["scripts/verify-booking-request-capture-work-upgrade.mjs"],
        { env: databaseConcurrencyEnvironment, stdio: "inherit" },
      );
      if (result.status !== 0) return result.status;
      result = await execute(
        "node",
        ["scripts/verify-booking-request-payment-required-expiry-upgrade.mjs"],
        { env: databaseConcurrencyEnvironment, stdio: "inherit" },
      );
      if (result.status !== 0) return result.status;
      result = await execute(
        "node",
        ["scripts/verify-booking-request-payment-history-upgrade.mjs"],
        { env: databaseConcurrencyEnvironment, stdio: "inherit" },
      );
      if (result.status !== 0) return result.status;
      return 0;
    };
    if (databaseMode) {
      const preflightStatus = await verifyDatabasePreflight();
      if (preflightStatus !== 0) return preflightStatus;
    }

    const status = await execute(
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
    const verifyFixtureContract = async () => {
      const fixtureContract = await execute(
        "node",
        ["scripts/verify-access-fixture-contract.mjs"],
        {
          env: { ...accessEnvironment, ...databaseConcurrencyEnvironment },
          stdio: "inherit",
        },
      );
      return fixtureContract.status;
    };
    if (focusedFixtureContract) return await verifyFixtureContract();

    const verifyDatabaseChecks = async () => {
      const fixtureContractStatus = await verifyFixtureContract();
      if (fixtureContractStatus !== 0) return fixtureContractStatus;
      const createDraftConcurrencyFixture = await execute(
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
      const draftConcurrency = await execute(
        "node",
        ["scripts/verify-cottage-profile-draft-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      if (draftConcurrency.status !== 0) return draftConcurrency.status;
      const scheduleConcurrency = await execute(
        "node",
        ["scripts/verify-cottage-shift-schedule-concurrency.mjs"],
        { env: scheduleConcurrencyEnvironment, stdio: "inherit" },
      );
      if (scheduleConcurrency.status !== 0) return scheduleConcurrency.status;
      const inventoryConcurrency = await execute(
        "node",
        ["scripts/verify-cottage-inventory-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      if (inventoryConcurrency.status !== 0) return inventoryConcurrency.status;
      const bookingPeriodHoldConcurrency = await execute(
        "node",
        ["scripts/verify-booking-period-hold-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      if (bookingPeriodHoldConcurrency.status !== 0) {
        return bookingPeriodHoldConcurrency.status;
      }
      const bookingRequestConcurrency = await execute(
        "node",
        ["scripts/verify-booking-request-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      if (bookingRequestConcurrency.status !== 0) {
        return bookingRequestConcurrency.status;
      }
      const bookingRequestLifecycleConcurrency = await execute(
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
      const bookingRequestCaptureConcurrency = await execute(
        "node",
        ["scripts/verify-booking-request-capture-concurrency.mjs"],
        {
          env: {
            ...inventoryConcurrencyEnvironment,
            SUPABASE_SECRET_KEY: secretKey,
          },
          stdio: "inherit",
        },
      );
      if (bookingRequestCaptureConcurrency.status !== 0)
        return bookingRequestCaptureConcurrency.status;
      const bookingRequestRecoveryConcurrency = await execute(
        "node",
        ["scripts/verify-booking-request-payment-recovery-concurrency.mjs"],
        {
          env: inventoryConcurrencyEnvironment,
          stdio: "inherit",
        },
      );
      if (bookingRequestRecoveryConcurrency.status !== 0)
        return bookingRequestRecoveryConcurrency.status;
      const paymentHistoryConcurrency = await execute(
        "node",
        ["scripts/verify-booking-request-payment-history-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      if (paymentHistoryConcurrency.status !== 0)
        return paymentHistoryConcurrency.status;
      return (
        await execute(
          "node",
          [
            "scripts/verify-booking-request-payment-required-expiry-concurrency.mjs",
          ],
          { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
        )
      ).status;
    };
    if (databaseMode) {
      const databaseStatus = await verifyDatabaseChecks();
      if (databaseStatus !== 0) return databaseStatus;
    }
    if (!browserMode) return 0;
    const verifyBrowserJourneys = async () => {
      const createNextFixtures = await execute(
        "node",
        ["scripts/prepare-access-test.mjs", "create", "mobile", "desktop"],
        {
          env: accessEnvironment,
          stdio: "inherit",
        },
      );
      if (createNextFixtures.status !== 0) return createNextFixtures.status;
      const validateNextFixtures = await execute(
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
        ...databaseConcurrencyEnvironment,
        ...accessEnvironment,
        APP_ENVIRONMENT: "test",
        NEXTJS_ENV: "test",
        SUPABASE_PROJECT_REF: "local-test",
        PLAYWRIGHT_SERVER: "next",
      };
      const browser = await execute(
        "npx",
        [
          "playwright",
          "test",
          "tests/access.spec.ts",
          "tests/booking-request-access.spec.ts",
          "tests/administrator-payment-history.spec.ts",
          "--project=mobile",
          "--project=desktop",
          "--workers=1",
          "--output=playwright-report/access-next",
        ],
        { env: browserEnvironment, stdio: "inherit" },
      );
      if (browser.status !== 0) return browser.status;

      const createWorkerFixtures = await execute(
        "node",
        ["scripts/prepare-access-test.mjs", "create", "worker"],
        { env: accessEnvironment, stdio: "inherit" },
      );
      if (createWorkerFixtures.status !== 0) {
        return createWorkerFixtures.status;
      }
      const validateWorkerFixtures = await execute(
        "node",
        ["scripts/prepare-access-test.mjs", "validate", "worker"],
        { env: accessEnvironment, stdio: "inherit" },
      );
      if (validateWorkerFixtures.status !== 0) {
        return validateWorkerFixtures.status;
      }

      const workerEnvironment = {
        ...databaseConcurrencyEnvironment,
        ...browserEnvironment,
        PLAYWRIGHT_SERVER: "worker",
      };
      const workerBuild = await execute("npm", ["run", "build:worker"], {
        env: workerEnvironment,
        stdio: "inherit",
      });
      if (workerBuild.status !== 0) return workerBuild.status;

      const workerBrowser = await execute(
        "npx",
        [
          "playwright",
          "test",
          "tests/access.spec.ts",
          "tests/booking-request-access.spec.ts",
          "tests/administrator-payment-history.spec.ts",
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
      const scheduledExpirySeed = await execute(
        "node",
        ["scripts/verify-booking-request-scheduled-expiry.mjs", "--seed"],
        { env: databaseConcurrencyEnvironment, stdio: "inherit" },
      );
      if (scheduledExpirySeed.status !== 0) return scheduledExpirySeed.status;
      const scheduledExpiry = await execute(
        "npx",
        [
          "playwright",
          "test",
          "tests/worker-scheduled-expiry.spec.ts",
          "tests/worker-scheduled-capture.spec.ts",
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
      const scheduledExpiryVerify = await execute(
        "node",
        ["scripts/verify-booking-request-scheduled-expiry.mjs", "--verify"],
        { env: databaseConcurrencyEnvironment, stdio: "inherit" },
      );
      if (scheduledExpiryVerify.status !== 0) {
        return scheduledExpiryVerify.status;
      }
      return 0;
    };
    return await verifyBrowserJourneys();
  };

  let retainedResources = false;
  try {
    exitCode = await verify();
  } finally {
    cleaningUp = true;
    await interruptionCleanup;
    if (activeInvocation?.retentionError) {
      retainedResources = true;
    }
    if (startupAttempted && !started) retainedResources = true;
    if (started && !retainedResources) {
      try {
        await createLocalSupabaseConcurrencyHarness({
          environment: databaseConcurrencyEnvironment,
          workingDirectory: localWorkdir,
        }).guardDisposableLocalDatabaseAsync((command, args, options) =>
          runCommand(command, args, {
            ...options,
            env: databaseConcurrencyEnvironment,
            lifecycleLimit: CLEANUP_COMMAND_LIMIT_MS,
          }),
        );
      } catch (error) {
        retainedResources = true;
        if (exitCode === 0) exitCode = 1;
        stderr(
          `Unable to reverify disposable local Supabase ownership before cleanup: ${error.message}`,
        );
      }
      if (!retainedResources) {
        const stopped = await execute(
          "npx",
          supabaseArguments([
            "supabase",
            "stop",
            "--no-backup",
            ...(isolatedProject ? ["--project-id", localProject] : []),
          ]),
          {
            cleanup: true,
            encoding: "utf8",
            lifecycleLimit: CLEANUP_COMMAND_LIMIT_MS,
            stdio: "pipe",
          },
        );
        if (stopped.status !== 0) {
          retainedResources = true;
          stderr("Local Supabase cleanup failed.");
          if (exitCode === 0) exitCode = stopped.status;
        } else {
          started = false;
        }
      }
    }
    if (activeInvocation?.retentionError) {
      retainedResources = true;
      if (exitCode === 0) exitCode = 1;
      stderr(
        `Retained command process group ${activeInvocation.group} (${activeInvocation.command}); last verified identities: ${activeInvocation.knownMembers.map((member) => `PID ${member.pid}, started ${member.started}`).join("; ") || "none"}. Exact termination could not be confirmed: ${activeInvocation.retentionError.message}`,
      );
    }
    if (retainedResources) {
      stderr(
        `Retained local Supabase project ${localProject} in ${localWorkdir} because exact cleanup could not be completed; temporary state ${dockerConfig}.`,
      );
    }
    if (!retainedResources) removeTemp(dockerConfig);
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
  }
  if (interruptedSignal) return interruptedSignal === "SIGINT" ? 130 : 143;
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
