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
import {
  addAccessJourneyTestOtps,
  LOCAL_PROJECT_PATTERN,
} from "./lib/access-journey-fixtures.mjs";
import {
  claimDatabaseSlot,
  classifyPlaceDatabase,
  isHostedCheck,
  isLocalCheckSlotProject,
  LOCAL_CHECK_LIMIT_MESSAGE,
  localCheckServerBusyMessage,
  localCheckSettings,
  localCheckSlotBusyMessage,
  loopbackPortAnswers,
  parseLocalCheckSlot,
  PLACE_DATABASE_LISTING_FORMAT,
  removeStaleLocalCheckFolders,
} from "./lib/local-check-slot.mjs";
import {
  accessStepPlan,
  BROWSER_MODE,
  DATABASE_MODE,
  DATABASE_TESTS_MODE,
  FIXTURE_CONTRACT_MODE,
  OWNED_JOURNEYS_MODE,
} from "./verify-access-plan.mjs";

const USAGE = `Usage: npm run verify:access [${DATABASE_MODE}|${DATABASE_TESTS_MODE}|${BROWSER_MODE}|${FIXTURE_CONTRACT_MODE}|${OWNED_JOURNEYS_MODE}]`;
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
  ports = localCheckSettings().ports,
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
    ["port = 54331", `port = ${ports.api}`],
    ["port = 54332", `port = ${ports.database}`],
    ["shadow_port = 54330", `shadow_port = ${ports.shadowDatabase}`],
    ["port = 54339", `port = ${ports.pooler}`],
    ["port = 54333", `port = ${ports.studio}`],
    ["port = 54334", `port = ${ports.mail}`],
    [
      'site_url = "http://127.0.0.1:3000"',
      `site_url = "http://127.0.0.1:${ports.next}"`,
    ],
    [
      'additional_redirect_urls = ["http://127.0.0.1:3000"]',
      `additional_redirect_urls = ["http://127.0.0.1:${ports.next}"]`,
    ],
    ["inspector_port = 8083", `inspector_port = ${ports.edgeInspector}`],
    ["port = 54337", `port = ${ports.analytics}`],
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
    claimDatabaseSlot,
    cleanupCommandLimitMs = CLEANUP_COMMAND_LIMIT_MS,
    monotonicNow = () => performance.now(),
    utcNow = () => new Date().toISOString(),
    stdout = console.log,
    makeTemp = (prefix) => mkdtempSync(join(tmpdir(), prefix)),
    portAnswers,
    prepareProject = prepareIsolatedSupabaseWorkdir,
    removeStaleFolders,
    removeTemp = defaultRemoveTemp,
    run,
    stderr = console.error,
    stepPlan = accessStepPlan,
    workingDirectory = process.cwd(),
  } = {},
) {
  const mode = args.length === 1 ? args[0] : undefined;
  if (
    args.length > 1 ||
    (mode !== undefined &&
      mode !== DATABASE_MODE &&
      mode !== DATABASE_TESTS_MODE &&
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
  const bookingConcurrency = mode !== DATABASE_TESTS_MODE;
  const databaseRecipe = bookingConcurrency
    ? "verify:access:database"
    : "verify:access:database-tests";
  const partition = environment.VERIFY_CI_PARTITION;
  const shard = environment.VERIFY_CI_SHARD;
  if (partition !== undefined || shard !== undefined) {
    const databasePartitions = [
      "database-core",
      "booking-request",
      "booking-capture",
      "payment-required-expiry",
    ];
    const browserPartitions = ["next", "worker", "scheduled"];
    if (environment.GITHUB_ACTIONS !== "true") {
      stderr(
        "VERIFY_CI_PARTITION and VERIFY_CI_SHARD require GITHUB_ACTIONS=true.",
      );
      return 2;
    }
    if (
      !partition ||
      (mode === DATABASE_MODE && !databasePartitions.includes(partition)) ||
      (mode === BROWSER_MODE && !browserPartitions.includes(partition)) ||
      (mode !== DATABASE_MODE && mode !== BROWSER_MODE)
    ) {
      stderr(
        "VERIFY_CI_PARTITION must match an explicit --database or --browser mode.",
      );
      return 2;
    }
    if (
      (["next", "worker"].includes(partition) &&
        !["1/2", "2/2"].includes(shard)) ||
      (!["next", "worker"].includes(partition) &&
        shard !== undefined &&
        shard !== "")
    ) {
      stderr(
        "VERIFY_CI_SHARD must be 1/2 or 2/2 for next or worker, and absent for other partitions.",
      );
      return 2;
    }
    stdout(
      JSON.stringify({
        type: "access-partition",
        evidence: "partial",
        partition,
        shard: shard || null,
      }),
    );
  }

  const explicitProject = environment.SUPABASE_LOCAL_PROJECT;
  if (
    explicitProject !== undefined &&
    (explicitProject === "rentcottage" ||
      !LOCAL_PROJECT_PATTERN.test(explicitProject))
  ) {
    stderr(
      "SUPABASE_LOCAL_PROJECT must name a disposable RentCottage local project.",
    );
    return 2;
  }
  if (isLocalCheckSlotProject(explicitProject)) {
    stderr(
      `SUPABASE_LOCAL_PROJECT must not name a place of the full local check; the check assigns ${explicitProject} itself.`,
    );
    return 2;
  }
  const disposableCi = isHostedCheck(environment);
  let slot;
  if (claimDatabaseSlot && !disposableCi && explicitProject === undefined) {
    let inheritedSlot;
    try {
      inheritedSlot = parseLocalCheckSlot(environment.VERIFY_LOCAL_SLOT);
    } catch (error) {
      stderr(error.message);
      return 2;
    }
    slot = await claimDatabaseSlot(inheritedSlot);
    if (slot === undefined) {
      stderr(
        inheritedSlot === undefined
          ? LOCAL_CHECK_LIMIT_MESSAGE
          : localCheckSlotBusyMessage(inheritedSlot),
      );
      return 4;
    }
    const servers = localCheckSettings(slot).ports;
    for (const port of [servers.next, servers.worker]) {
      if (await portAnswers(port)) {
        stderr(localCheckServerBusyMessage(slot, port));
        return 4;
      }
    }
  }
  const { ports, project, tempPrefix } = localCheckSettings(slot);
  const localProject = explicitProject ?? project;

  const plan = stepPlan({ mode, phase, partition, shard });
  const originalRecipe = focusedFixtureContract
    ? ["node", "scripts/verify-access.mjs", FIXTURE_CONTRACT_MODE]
    : [
        "npm",
        "run",
        mode === DATABASE_MODE || mode === DATABASE_TESTS_MODE
          ? databaseRecipe
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
        ? ["npm", "run", databaseRecipe]
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
    dockerConfig = makeTemp(tempPrefix);
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
      ports,
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
    ...(slot === undefined
      ? {}
      : {
          PLAYWRIGHT_NEXT_PORT: String(ports.next),
          PLAYWRIGHT_WORKER_PORT: String(ports.worker),
        }),
  };
  let freshStart = false;
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

  const stopArguments = supabaseArguments([
    "supabase",
    "stop",
    "--no-backup",
    "--project-id",
    localProject,
  ]);

  const clearPlace = async () => {
    const container = databaseConcurrencyEnvironment.SUPABASE_DB_CONTAINER;
    const refuse = (message) => {
      if (!interruptedSignal) stderr(message);
      return 4;
    };
    const listed = await execute(
      "docker",
      [
        "ps",
        "--all",
        "--filter",
        `name=${container}`,
        "--format",
        PLACE_DATABASE_LISTING_FORMAT,
      ],
      {
        encoding: "utf8",
        lifecycleLimit: cleanupCommandLimitMs,
        stdio: "pipe",
      },
    );
    if (listed.status !== 0 || typeof listed.stdout !== "string") {
      return refuse(
        `Unable to see what an earlier check left in place ${slot} of the full local check: Docker did not list the place's database container. Nothing was removed and nothing ran.`,
      );
    }
    const leftover = classifyPlaceDatabase({
      slot,
      container,
      listing: listed.stdout,
      ownWorkdir: localWorkdir,
    });
    if (leftover.state === "unproven") {
      return refuse(
        `Place ${slot} of the full local check holds a database container, ${container}, that this check cannot show it made: ${leftover.found}. Nothing was removed and nothing ran. Look at that container and remove it yourself if nothing is using it.`,
      );
    }
    const removed = [];
    if (leftover.state === "made-here") {
      // Not a cleanup command, so an interrupt still stops it.
      const stopped = await execute("npx", stopArguments, {
        encoding: "utf8",
        lifecycleLimit: cleanupCommandLimitMs,
        stdio: "pipe",
      });
      if (stopped.status !== 0) {
        return refuse(
          `Unable to stop the database an earlier check left in place ${slot} of the full local check. Its folders were kept and nothing ran.`,
        );
      }
      removed.push(`database ${localProject}`);
    }
    try {
      removed.push(...removeStaleFolders(slot, dockerConfig));
    } catch (error) {
      return refuse(
        `Unable to remove a folder an earlier check left in place ${slot} of the full local check: ${error.message}. Nothing ran. Remove that folder, then run it again.`,
      );
    }
    if (removed.length > 0) {
      stdout(
        `Place ${slot}: removed what an earlier check left behind: ${removed.join(", ")}.`,
      );
    }
    return 0;
  };

  const verify = async () => {
    if (slot !== undefined) {
      const clearingStart = startTiming();
      let clearingStatus = 1;
      try {
        clearingStatus = await clearPlace();
      } finally {
        finishTiming(
          clearingStart,
          "place-clearing",
          "shared-setup",
          null,
          { type: "exit", status: clearingStatus },
          true,
        );
      }
      if (clearingStatus !== 0) return clearingStatus;
    }
    if (disposableCi || slot !== undefined) {
      freshStart = true;
      const inventoryScope = disposableCi
        ? []
        : [
            "--filter",
            `name=${databaseConcurrencyEnvironment.SUPABASE_DB_CONTAINER}`,
          ];
      // Empty inventory means start builds a new database with migrations and seed; any retained resource requires reset.
      for (const inventoryArgs of [
        ["container", "ls", "--all", "--quiet"],
        ["volume", "ls", "--quiet"],
      ]) {
        const inventory = await execute(
          "docker",
          [...inventoryArgs, ...inventoryScope],
          { encoding: "utf8", stdio: "pipe" },
        );
        if (inventory.status !== 0 || typeof inventory.stdout !== "string") {
          if (!interruptedSignal)
            stderr(
              `Unable to verify Docker ${inventoryArgs[0]} inventory. Check Docker daemon access before retrying ${disposableCi ? "hosted" : "local"} verification.`,
            );
          return inventory.status || 1;
        }
        freshStart = freshStart && !inventory.stdout.trim();
      }
    }
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

    if (!freshStart) {
      result = await execute(
        "npx",
        supabaseArguments(["supabase", "db", "reset", "--local"]),
      );
      if (result.status !== 0) return result.status;
    }

    const plannedArguments = (step) =>
      step.args[0] === "supabase" ? supabaseArguments(step.args) : step.args;
    const runPlannedStep = async (step, environments) => {
      group = step.group;
      if (!Object.hasOwn(environments, step.environment)) {
        lastAttemptedCommand = [step.command, ...plannedArguments(step)];
        stderr(
          `Access step ${lastAttemptedCommand.join(" ")} names unknown environment ${step.environment}.`,
        );
        return 1;
      }
      const env = environments[step.environment];
      if (!step.declaredSchemaDiff) {
        const completed = await execute(step.command, plannedArguments(step), {
          env,
          stdio: "inherit",
        });
        return completed.status;
      }
      // The declared schema files must describe exactly what the migration chain builds; any diff is drift.
      const diffed = await execute(step.command, plannedArguments(step), {
        env,
        encoding: "utf8",
        stdio: "pipe",
      });
      if (diffed.status !== 0) return diffed.status;
      let report;
      try {
        report = JSON.parse(String(diffed.stdout));
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
    const runPlannedSteps = async (steps, environments) => {
      for (const [index, step] of steps.entries()) {
        const status = await runPlannedStep(step, environments);
        if (status === 0) continue;
        const next = steps[index + 1];
        if (next?.runsAfterFailure) {
          await runPlannedStep(next, environments);
          lastAttemptedCommand = [step.command, ...plannedArguments(step)];
        }
        return status;
      }
      return 0;
    };
    const preflightStatus = await runPlannedSteps(plan.preflight, {
      supabase: supabaseEnvironment,
    });
    if (preflightStatus !== 0) return preflightStatus;

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
    const scheduleConcurrencyEnvironment = { ...accessEnvironment };
    delete scheduleConcurrencyEnvironment.SUPABASE_SECRET_KEY;
    const inventoryConcurrencyEnvironment = {
      ...scheduleConcurrencyEnvironment,
      ...databaseConcurrencyEnvironment,
    };
    const browserEnvironment = {
      ...databaseConcurrencyEnvironment,
      ...accessEnvironment,
      APP_ENVIRONMENT: "test",
      NEXTJS_ENV: "test",
      SUPABASE_PROJECT_REF: "local-test",
      PLAYWRIGHT_SERVER: "next",
    };
    return await runPlannedSteps(plan.checks, {
      database: databaseConcurrencyEnvironment,
      access: accessEnvironment,
      fixture: {
        ...accessEnvironment,
        ...databaseConcurrencyEnvironment,
        ACCESS_JOURNEY_PHASE: "boundary",
      },
      schedule: scheduleConcurrencyEnvironment,
      inventory: inventoryConcurrencyEnvironment,
      "secret-inventory": {
        ...inventoryConcurrencyEnvironment,
        SUPABASE_SECRET_KEY: secretKey,
      },
      next: browserEnvironment,
      worker: {
        ...databaseConcurrencyEnvironment,
        ...browserEnvironment,
        PLAYWRIGHT_SERVER: "worker",
      },
    });
  };

  let retainedResources = false;
  let failedCleanup = false;
  let stopDeferred = false;
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
        if (!retainedResources && disposableCi) {
          // Hosted runner disposal owns resource teardown.
          stopDeferred = true;
        } else if (!retainedResources) {
          const stopped = await execute("npx", stopArguments, {
            cleanup: true,
            encoding: "utf8",
            lifecycleLimit: cleanupCommandLimitMs,
            stdio: "pipe",
          });
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
      // eslint-disable-next-line no-unsafe-finally -- a cleanup that threw must fail loudly after it is reported
      throw error;
    } finally {
      process.off("SIGINT", handleSigint);
      process.off("SIGTERM", handleSigterm);
      const cleanupFailed = retainedResources || failedCleanup;
      const cleanupReason = cleanupFailed
        ? "Exact cleanup could not be completed; resources may be retained."
        : stopDeferred
          ? "Supabase stop is deferred to disposal of the GitHub-hosted runner."
          : null;
      const observedCleanupMs = finishTiming(
        cleanupStart,
        "outer-cleanup",
        "shared-cleanup",
        null,
        { type: "exit", status: cleanupFailed ? 1 : 0 },
        true,
      );
      finishLifecycle(
        verificationThrew || failedCleanup ? 1 : exitCode,
        interruptedSignal,
        cleanupFailed ? null : observedCleanupMs,
        cleanupReason,
      );
    }
  }
  if (interruptedSignal) return interruptedSignal === "SIGINT" ? 130 : 143;
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), {
    claimDatabaseSlot,
    portAnswers: loopbackPortAnswers,
    removeStaleFolders: removeStaleLocalCheckFolders,
  });
}
