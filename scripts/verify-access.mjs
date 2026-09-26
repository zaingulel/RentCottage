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
import { addAccessJourneyTestOtps } from "./lib/access-journey-fixtures.mjs";

const FIXTURE_CONTRACT_MODE = "--fixture-contract";
const OWNED_JOURNEYS_MODE = "--owned-journeys";
const OWNED_JOURNEYS_GREP =
  "(?:shared sign-in from the homepage returns a prospective owner to their private application|a Cottage Owner saves, resumes and submits a complete private application|Owner Application keeps evidence controls aligned and accessible in every locale|one account returns to customer bookings, enrolls explicitly and signs out only this device)$";
const OWNED_SUBMISSION_GREP =
  "a Cottage Owner saves, resumes and submits a complete private application$";
const DATABASE_MODE = "--database";
const BROWSER_MODE = "--browser";
const USAGE = `Usage: npm run verify:access [${DATABASE_MODE}|${BROWSER_MODE}|${FIXTURE_CONTRACT_MODE}|${OWNED_JOURNEYS_MODE}]`;
const LOCAL_PROJECT_PATTERN = /^rentcottage(?:-[a-z0-9]+)*$/;
const EXCLUDED_SERVICES =
  "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";

const GRACEFUL_EXIT_LIMIT_MS = 5_000;
const FORCED_EXIT_LIMIT_MS = 2_000;
const MAX_CAPTURE_BYTES = 1024 * 1024;
const CLEANUP_COMMAND_LIMIT_MS = 30_000;

function probeProcessGroup(group) {
  if (!Number.isInteger(group) || group <= 1) return false;
  try {
    process.kill(-group, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw error;
  }
}

async function processGroupExists(group) {
  try {
    return probeProcessGroup(group);
  } catch (error) {
    if (error.code !== "EPERM") throw error;
    // Darwin reports EPERM for zombie-only groups until their parent reaps them.
    const members = await inspectProcessGroup(group);
    if (members.every((member) => /^Z[<N+Ls-]*$/.test(member.state))) {
      return false;
    }
    throw error;
  }
}

function inspectProcessGroup(group) {
  return new Promise((resolveInspection, rejectInspection) => {
    const child = spawn(
      "/bin/ps",
      ["-axo", "pid=,pgid=,stat=,lstart=,command="],
      {
        env: { ...process.env, LANG: "C", LC_ALL: "C" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
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
      try {
        if (status !== 0) {
          if (!probeProcessGroup(group)) {
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
        finish(
          resolveInspection,
          stdout
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => {
              const match = line.match(
                /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.{24})\s+(.+)$/,
              );
              if (!match) {
                throw new Error(
                  `Unable to parse owned process group ${group} identity.`,
                );
              }
              return {
                command: match[5],
                group: Number(match[2]),
                pid: Number(match[1]),
                state: match[3],
                started: match[4],
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
  while (
    Date.now() < deadline &&
    (await processGroupExists(invocation.group))
  ) {
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
  while ((await processGroupExists(group)) && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  return !(await processGroupExists(group));
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
  config = addAccessJourneyTestOtps(config);
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
    cleanupCommandLimitMs = CLEANUP_COMMAND_LIMIT_MS,
    monotonicNow = () => performance.now(),
    utcNow = () => new Date().toISOString(),
    stdout = console.log,
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
      mode !== FIXTURE_CONTRACT_MODE &&
      mode !== OWNED_JOURNEYS_MODE)
  ) {
    stderr(USAGE);
    return 2;
  }
  const focusedFixtureContract = mode === FIXTURE_CONTRACT_MODE;
  const ownedJourneysMode = mode === OWNED_JOURNEYS_MODE;
  const phase = ownedJourneysMode
    ? (environment.ACCESS_JOURNEY_PHASE ?? "forward")
    : "ordinary";
  if (
    (ownedJourneysMode &&
      !["forward", "reverse", "retry-proof"].includes(phase)) ||
    (!ownedJourneysMode &&
      environment.ACCESS_JOURNEY_PHASE !== undefined &&
      environment.ACCESS_JOURNEY_PHASE !== "ordinary")
  ) {
    stderr("ACCESS_JOURNEY_PHASE must match the finite owned-journeys mode.");
    return 2;
  }
  const databaseMode = mode === undefined || mode === DATABASE_MODE;
  const browserMode =
    mode === undefined || mode === BROWSER_MODE || ownedJourneysMode;

  const localProject =
    environment.SUPABASE_LOCAL_PROJECT ?? "rentcottage-verification";
  if (
    localProject === "rentcottage" ||
    !LOCAL_PROJECT_PATTERN.test(localProject)
  ) {
    stderr(
      "SUPABASE_LOCAL_PROJECT must name a disposable RentCottage local project.",
    );
    return 2;
  }

  const originalRecipe = focusedFixtureContract
    ? ["node", "scripts/verify-access.mjs", FIXTURE_CONTRACT_MODE]
    : [
        "npm",
        "run",
        mode === DATABASE_MODE
          ? "verify:access:database"
          : mode === BROWSER_MODE
            ? "verify:access:browser"
            : "verify:access",
      ];
  const lifecycleStart = { startedAt: utcNow(), tick: monotonicNow() };
  let sharedSetupMs = 0;
  let checksMs = 0;
  let lastAttemptedCommand = null;
  let group = "shared-setup";
  const startTiming = () => ({ startedAt: utcNow(), tick: monotonicNow() });
  const commandOutcome = (result) =>
    result.error
      ? { type: "spawn-failure", code: result.error.code ?? null }
      : result.signal
        ? { type: "signal", signal: result.signal }
        : { type: "exit", status: result.status ?? 1 };
  const finishTiming = (
    start,
    name,
    scope,
    command,
    outcome,
    inclusive = false,
  ) => {
    const durationMs = monotonicNow() - start.tick;
    if (!inclusive && scope === "shared-setup") sharedSetupMs += durationMs;
    if (!inclusive && scope === "check") checksMs += durationMs;
    stdout(
      JSON.stringify({
        type: "access-phase",
        name,
        scope,
        command,
        startedAt: start.startedAt,
        completedAt: utcNow(),
        durationMs,
        outcome,
        inclusive,
      }),
    );
    return durationMs;
  };
  const reportFailure = (failedGroup, attemptedCommand) => {
    const reproduceGroup =
      failedGroup === "database"
        ? ["npm", "run", "verify:access:database"]
        : failedGroup === "browser"
          ? ["npm", "run", "verify:access:browser"]
          : failedGroup === "fixture"
            ? ["node", "scripts/verify-access.mjs", FIXTURE_CONTRACT_MODE]
            : originalRecipe;
    stdout(
      JSON.stringify({
        type: "verification-failure",
        attemptedCommand,
        reproduceGroup,
      }),
    );
  };
  const finishLifecycle = (status, signal, cleanupMs, cleanupReason) => {
    stdout(
      JSON.stringify({
        type: "access-lifecycle",
        command: ["node", "scripts/verify-access.mjs", ...args],
        startedAt: lifecycleStart.startedAt,
        completedAt: utcNow(),
        durationMs: monotonicNow() - lifecycleStart.tick,
        inclusive: true,
        sharedSetupMs,
        checksMs,
        cleanupMs,
        cleanupReason,
        outcome: signal ? { type: "signal", signal } : { type: "exit", status },
      }),
    );
  };

  const preparationStart = startTiming();
  let dockerConfig;
  try {
    dockerConfig = makeTemp();
  } catch (error) {
    finishTiming(
      preparationStart,
      "project-preparation",
      "shared-setup",
      null,
      { type: "exit", status: 1 },
    );
    reportFailure("shared-setup", null);
    finishLifecycle(
      1,
      undefined,
      null,
      "Cleanup was not entered because temporary project state was not created.",
    );
    throw error;
  }
  let localWorkdir;
  try {
    localWorkdir = prepareProject({
      localProject,
      stateRoot: dockerConfig,
      workingDirectory: resolve(workingDirectory),
    });
  } catch (error) {
    finishTiming(
      preparationStart,
      "project-preparation",
      "shared-setup",
      null,
      { type: "exit", status: 1 },
    );
    reportFailure("shared-setup", null);
    const cleanupStart = startTiming();
    let cleanupFailed = false;
    try {
      removeTemp(dockerConfig);
    } catch (cleanupError) {
      cleanupFailed = true;
      reportFailure("shared-cleanup", null);
      throw cleanupError;
    } finally {
      const cleanupMs = finishTiming(
        cleanupStart,
        "outer-cleanup",
        "shared-cleanup",
        null,
        { type: "exit", status: cleanupFailed ? 1 : 0 },
        true,
      );
      finishLifecycle(
        1,
        undefined,
        cleanupFailed ? null : cleanupMs,
        cleanupFailed
          ? "Exact cleanup could not be completed; resources may be retained."
          : null,
      );
    }
    stderr(
      `Unable to prepare the disposable local Supabase project: ${error.message}`,
    );
    return 1;
  }
  finishTiming(preparationStart, "project-preparation", "shared-setup", null, {
    type: "exit",
    status: 0,
  });
  const supabaseArguments = (commandArgs) => [
    ...commandArgs,
    "--workdir",
    localWorkdir,
  ];
  const supabaseEnvironment = {
    ...environment,
    ACCESS_JOURNEY_PHASE: phase,
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

  const executeUntimed = async (
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
      !activeInvocation.retentionError
    ) {
      try {
        if (!(await processGroupExists(activeInvocation.group))) {
          activeInvocation = undefined;
        }
      } catch (error) {
        activeInvocation.retentionError = error;
      }
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
    return {
      ...result,
      status:
        result.status === 0 && activeInvocation?.retentionError
          ? 1
          : (result.status ?? 1),
    };
  };

  const execute = async (command, commandArgs, options = {}) => {
    if (interruptedSignal && !options.cleanup) {
      return executeUntimed(command, commandArgs, options);
    }
    const commandVector = [command, ...commandArgs];
    lastAttemptedCommand = commandVector;
    const start = startTiming();
    let outcome;
    try {
      const result = await executeUntimed(command, commandArgs, options);
      outcome =
        result.error || options.cleanup || !interruptedSignal
          ? commandOutcome(result)
          : { type: "signal", signal: interruptedSignal };
      return result;
    } catch (error) {
      outcome = { type: "exit", status: 1 };
      throw error;
    } finally {
      const name =
        commandArgs[0] === "supabase"
          ? `supabase-${commandArgs[1]}${commandArgs[1] === "db" ? `-${commandArgs[2]}` : ""}`
          : commandArgs[0] === "playwright"
            ? commandArgs.includes("--project=mobile")
              ? "access-next"
              : commandArgs.includes("tests/worker-scheduled-expiry.spec.ts")
                ? "scheduled-expiry-worker"
                : "access-worker"
            : command === "npm"
              ? commandArgs[1]
              : commandArgs[0];
      finishTiming(
        start,
        name,
        options.cleanup
          ? "shared-cleanup"
          : group === "shared-setup"
            ? "shared-setup"
            : "check",
        commandVector,
        outcome,
      );
    }
  };

  const databaseConcurrencyEnvironment = {
    ...supabaseEnvironment,
    SUPABASE_DB_CONTAINER: `supabase_db_${localProject}`,
    SUPABASE_LOCAL_PROJECT: localProject,
    SUPABASE_LOCAL_WORKDIR: localWorkdir,
  };
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
    const ownershipStart = startTiming();
    let ownershipOutcome = { type: "exit", status: 0 };
    try {
      await createLocalSupabaseConcurrencyHarness({
        environment: databaseConcurrencyEnvironment,
        workingDirectory: localWorkdir,
      }).guardDisposableLocalDatabaseAsync(async (command, args, options) => {
        lastAttemptedCommand = [command, ...args];
        const guarded = await runCommand(command, args, {
          ...options,
          env: databaseConcurrencyEnvironment,
        });
        ownershipOutcome = commandOutcome(guarded);
        return guarded;
      });
    } catch (error) {
      if (ownershipOutcome.type === "exit" && ownershipOutcome.status === 0)
        ownershipOutcome = { type: "exit", status: 1 };
      stderr(
        `Unable to verify disposable local Supabase ownership: ${error.message}`,
      );
      return 1;
    } finally {
      finishTiming(
        ownershipStart,
        "startup-ownership",
        "shared-setup",
        lastAttemptedCommand,
        ownershipOutcome,
      );
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
      const customerReviewUpgrade = await execute(
        "node",
        ["scripts/verify-customer-review-upgrade.mjs"],
        { stdio: "inherit" },
      );
      if (customerReviewUpgrade.status !== 0) {
        return customerReviewUpgrade.status;
      }
      result = await execute(
        "npx",
        supabaseArguments(["supabase", "test", "db"]),
      );
      return result.status;
    };
    if (databaseMode) {
      group = "database";
      const preflightStatus = await verifyDatabasePreflight();
      if (preflightStatus !== 0) return preflightStatus;
    }

    group = "shared-setup";
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
          env: {
            ...accessEnvironment,
            ...databaseConcurrencyEnvironment,
            ACCESS_JOURNEY_PHASE: "boundary",
          },
          stdio: "inherit",
        },
      );
      if (fixtureContract.status !== 0) return fixtureContract.status;
      const journeyReadiness = await execute(
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
        {
          env: {
            ...accessEnvironment,
            ...databaseConcurrencyEnvironment,
            ACCESS_JOURNEY_PHASE: "boundary",
          },
          stdio: "inherit",
        },
      );
      return journeyReadiness.status;
    };
    if (focusedFixtureContract) {
      group = "fixture";
      return await verifyFixtureContract();
    }

    const verifyDatabaseChecks = async () => {
      const fixtureContractStatus = await verifyFixtureContract();
      if (fixtureContractStatus !== 0) return fixtureContractStatus;
      const accountConcurrency = await execute(
        "node",
        ["scripts/verify-account-access-concurrency.mjs"],
        { env: databaseConcurrencyEnvironment, stdio: "inherit" },
      );
      if (accountConcurrency.status !== 0) return accountConcurrency.status;
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
      const notificationConcurrency = await execute(
        "node",
        ["scripts/verify-booking-confirmation-notification-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      if (notificationConcurrency.status !== 0)
        return notificationConcurrency.status;
      const eventNotificationConcurrency = await execute(
        "node",
        ["scripts/verify-booking-event-notification-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      if (eventNotificationConcurrency.status !== 0)
        return eventNotificationConcurrency.status;
      const requestNotificationConcurrency = await execute(
        "node",
        ["scripts/verify-booking-request-notification-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      if (requestNotificationConcurrency.status !== 0)
        return requestNotificationConcurrency.status;
      const preparationReminderConcurrency = await execute(
        "node",
        ["scripts/verify-booking-preparation-reminder-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      if (preparationReminderConcurrency.status !== 0)
        return preparationReminderConcurrency.status;
      const cancellationConcurrency = await execute(
        "node",
        ["scripts/verify-booking-cancellation-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      if (cancellationConcurrency.status !== 0)
        return cancellationConcurrency.status;
      const messagingConcurrency = await execute(
        "node",
        ["scripts/verify-messaging-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      if (messagingConcurrency.status !== 0) return messagingConcurrency.status;
      const completionConcurrency = await execute(
        "node",
        ["scripts/verify-booking-completion-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      if (completionConcurrency.status !== 0)
        return completionConcurrency.status;
      const customerReviewConcurrency = await execute(
        "node",
        ["scripts/verify-customer-review-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      if (customerReviewConcurrency.status !== 0) {
        return customerReviewConcurrency.status;
      }
      const refundConcurrency = await execute(
        "node",
        ["scripts/verify-booking-refund-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      if (refundConcurrency.status !== 0) return refundConcurrency.status;
      const payoutConcurrency = await execute(
        "node",
        ["scripts/verify-booking-payout-concurrency.mjs"],
        { env: inventoryConcurrencyEnvironment, stdio: "inherit" },
      );
      if (payoutConcurrency.status !== 0) return payoutConcurrency.status;
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
      group = "database";
      const databaseStatus = await verifyDatabaseChecks();
      if (databaseStatus !== 0) return databaseStatus;
    }
    if (!browserMode) return 0;
    if (ownedJourneysMode) {
      const readinessStatus = await verifyFixtureContract();
      if (readinessStatus !== 0) return readinessStatus;
    }
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
        ownedJourneysMode
          ? [
              "playwright",
              "test",
              "tests/access.spec.ts",
              "--project=mobile",
              "--project=desktop",
              "--workers=1",
              phase === "retry-proof" ? "--retries=1" : "--retries=0",
              "--grep",
              phase === "retry-proof"
                ? OWNED_SUBMISSION_GREP
                : OWNED_JOURNEYS_GREP,
              `--output=playwright-report/owned-next-${phase}`,
            ]
          : [
              "playwright",
              "test",
              "tests/access.spec.ts",
              "tests/booking-request-access.spec.ts",
              "tests/administrator-payment-history.spec.ts",
              "tests/booking-history.spec.ts",
              "tests/request-notification-details.spec.ts",
              "tests/messaging.spec.ts",
              "tests/customer-reviews.spec.ts",
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
        ownedJourneysMode
          ? [
              "playwright",
              "test",
              "tests/access.spec.ts",
              "--project=worker",
              "--config=playwright.worker-prebuilt.config.ts",
              "--workers=1",
              phase === "retry-proof" ? "--retries=1" : "--retries=0",
              "--grep",
              phase === "retry-proof"
                ? OWNED_SUBMISSION_GREP
                : OWNED_JOURNEYS_GREP,
              `--output=playwright-report/owned-worker-${phase}`,
            ]
          : [
              "playwright",
              "test",
              "tests/access.spec.ts",
              "tests/booking-request-access.spec.ts",
              "tests/administrator-payment-history.spec.ts",
              "tests/booking-cancellation-refund.spec.ts",
              "tests/messaging.spec.ts",
              "tests/customer-reviews.spec.ts",
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
      if (ownedJourneysMode) return 0;
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
          "tests/worker-scheduled-refund.spec.ts",
          "tests/worker-scheduled-completion.spec.ts",
          "tests/worker-scheduled-reminder.spec.ts",
          "tests/worker-scheduled-request-notification.spec.ts",
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
    group = "browser";
    return await verifyBrowserJourneys();
  };

  let retainedResources = false;
  let failedCleanup = false;
  let verificationThrew = false;
  try {
    exitCode = await verify();
    if (exitCode !== 0) reportFailure(group, lastAttemptedCommand);
  } catch (error) {
    verificationThrew = true;
    reportFailure(group, lastAttemptedCommand);
    throw error;
  } finally {
    const cleanupStart = startTiming();
    try {
      cleaningUp = true;
      lastAttemptedCommand = null;
      await interruptionCleanup;
      if (activeInvocation?.retentionError) {
        retainedResources = true;
      }
      if (startupAttempted && !started) retainedResources = true;
      if (started && !retainedResources) {
        const ownershipStart = startTiming();
        let ownershipOutcome = { type: "exit", status: 0 };
        try {
          await createLocalSupabaseConcurrencyHarness({
            environment: databaseConcurrencyEnvironment,
            workingDirectory: localWorkdir,
          }).guardDisposableLocalDatabaseAsync(
            async (command, args, options) => {
              lastAttemptedCommand = [command, ...args];
              const guarded = await runCommand(command, args, {
                ...options,
                env: databaseConcurrencyEnvironment,
                lifecycleLimit: cleanupCommandLimitMs,
              });
              ownershipOutcome = commandOutcome(guarded);
              return guarded;
            },
          );
        } catch (error) {
          if (ownershipOutcome.type === "exit" && ownershipOutcome.status === 0)
            ownershipOutcome = { type: "exit", status: 1 };
          retainedResources = true;
          if (exitCode === 0) exitCode = 1;
          stderr(
            `Unable to reverify disposable local Supabase ownership before cleanup: ${error.message}`,
          );
        } finally {
          finishTiming(
            ownershipStart,
            "cleanup-ownership",
            "shared-cleanup",
            lastAttemptedCommand,
            ownershipOutcome,
          );
        }
        if (!retainedResources) {
          const stopped = await execute(
            "npx",
            supabaseArguments([
              "supabase",
              "stop",
              "--no-backup",
              "--project-id",
              localProject,
            ]),
            {
              cleanup: true,
              encoding: "utf8",
              lifecycleLimit: cleanupCommandLimitMs,
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
        reportFailure("shared-cleanup", lastAttemptedCommand);
        stderr(
          `Retained local Supabase project ${localProject} in ${localWorkdir} because exact cleanup could not be completed; temporary state ${dockerConfig}.`,
        );
      }
      if (!retainedResources) {
        lastAttemptedCommand = null;
        removeTemp(dockerConfig);
      }
    } catch (error) {
      failedCleanup = true;
      reportFailure("shared-cleanup", lastAttemptedCommand);
      throw error;
    } finally {
      process.off("SIGINT", handleSigint);
      process.off("SIGTERM", handleSigterm);
      const cleanupReason =
        retainedResources || failedCleanup
          ? "Exact cleanup could not be completed; resources may be retained."
          : null;
      const observedCleanupMs = finishTiming(
        cleanupStart,
        "outer-cleanup",
        "shared-cleanup",
        null,
        { type: "exit", status: cleanupReason ? 1 : 0 },
        true,
      );
      finishLifecycle(
        verificationThrew || failedCleanup ? 1 : exitCode,
        interruptedSignal,
        cleanupReason ? null : observedCleanupMs,
        cleanupReason,
      );
    }
  }
  if (interruptedSignal) return interruptedSignal === "SIGINT" ? 130 : 143;
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
