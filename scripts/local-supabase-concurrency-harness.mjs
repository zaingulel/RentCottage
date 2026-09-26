import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

const defaultMessages = {
  invalidGuard: "The guarded local Supabase database identity is invalid.",
  unavailable: "The guarded local Supabase database container is unavailable.",
  wrongOwner:
    "The Supabase database container does not belong to this disposable local checkout.",
  sessionExitedBeforeMarker: (marker, stderr) =>
    `PostgreSQL session exited before ${marker}: ${stderr}`,
  markerTimeout: (marker) => `PostgreSQL session did not reach ${marker}.`,
  contenderExitedBeforeLock: (_applicationName, stderr) =>
    `Contender exited before waiting: ${stderr}`,
  lockTimeout: () =>
    "The concurrent contender never reached a PostgreSQL lock.",
  expectedStateFailure: (expectedState, stderr) =>
    `Expected ${expectedState}, received: ${stderr}`,
  unexpectedSessionFailure: (stderr) =>
    `Transaction unexpectedly failed: ${stderr}`,
};

function fail(message, cause) {
  throw new Error(message, cause ? { cause } : undefined);
}

export function createLocalSupabaseConcurrencyHarness({
  environment = process.env,
  messages: messageOverrides = {},
  spawnProcess = spawn,
  spawnSyncProcess = spawnSync,
  waitLimitMilliseconds = 15_000,
  workingDirectory = environment.SUPABASE_LOCAL_WORKDIR ?? process.cwd(),
  timing,
  monotonicNow = () => performance.now(),
  utcNow = () => new Date().toISOString(),
  stdout = (line) => console.log(line),
} = {}) {
  const container = environment.SUPABASE_DB_CONTAINER;
  const project = environment.SUPABASE_LOCAL_PROJECT;
  const messages = { ...defaultMessages, ...messageOverrides };
  if (
    timing !== undefined &&
    (typeof timing?.check !== "string" ||
      !timing.check.trim() ||
      timing.isolation !== "serial")
  ) {
    fail("Concurrency timing requires a nonblank check and serial isolation.");
  }
  const startedAt = timing ? utcNow() : undefined;
  const totals = { setup: null, execution: null, cleanup: null };
  let currentPhase;
  let phaseStarted;
  let timingFinished = false;

  function changeTimingPhase(phase) {
    if (!timing || timingFinished) return;
    const tick = monotonicNow();
    const timestamp = utcNow();
    if (currentPhase) {
      const elapsedMs = tick - phaseStarted.tick;
      totals[currentPhase] += elapsedMs;
      stdout(
        JSON.stringify({
          type: "concurrency-phase",
          check: timing.check,
          isolation: timing.isolation,
          phase: currentPhase,
          startedAt: phaseStarted.timestamp,
          completedAt: timestamp,
          elapsedMs,
        }),
      );
    }
    currentPhase = phase;
    phaseStarted = { tick, timestamp };
    if (phase && totals[phase] === null) totals[phase] = 0;
  }

  function markTimingPhase(phase) {
    changeTimingPhase(phase);
  }

  function finishTiming({ outcome, cleanupDisposition }) {
    if (!timing || timingFinished) return;
    changeTimingPhase(undefined);
    timingFinished = true;
    const phaseReasons = {};
    for (const phase of ["setup", "execution", "cleanup"]) {
      if (totals[phase] === null) {
        phaseReasons[phase] =
          phase === "cleanup" && cleanupDisposition === "project-teardown"
            ? "Cleanup is deferred to disposable project teardown."
            : "Phase was not reached.";
      }
    }
    stdout(
      JSON.stringify({
        type: "concurrency-summary",
        check: timing.check,
        isolation: timing.isolation,
        startedAt,
        completedAt: phaseStarted.timestamp,
        setupMs: totals.setup,
        executionMs: totals.execution,
        cleanupMs: totals.cleanup,
        outcome,
        cleanupDisposition,
        phaseReasons,
      }),
    );
  }

  function validateGuardIdentity() {
    if (
      !/^rentcottage(?:-[a-z0-9]+)*$/.test(project ?? "") ||
      container !== `supabase_db_${project}` ||
      !/^supabase_db_[a-z0-9_-]+$/.test(container)
    ) {
      fail(messages.invalidGuard);
    }
  }

  function guardInspectionArguments() {
    return [
      "inspect",
      container,
      "--format",
      '{{ index .Config.Labels "com.supabase.cli.project" }}|{{ index .Config.Labels "com.supabase.cli.workdir" }}',
    ];
  }

  function validateGuardInspection(inspected) {
    if (inspected.error)
      fail("Unable to execute local Docker.", inspected.error);
    if (inspected.status !== 0) fail(messages.unavailable);
    const [labelProject, labelWorkdir] = inspected.stdout.trim().split("|");
    if (
      labelProject !== project ||
      resolve(labelWorkdir) !== resolve(workingDirectory)
    ) {
      fail(messages.wrongOwner);
    }
  }

  function runDocker(args, input) {
    const result = spawnSyncProcess("docker", args, {
      encoding: "utf8",
      input,
      maxBuffer: 1024 * 1024,
    });
    if (result.error) fail("Unable to execute local Docker.", result.error);
    return result;
  }

  function psqlArguments() {
    return [
      "exec",
      "-i",
      container,
      "psql",
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
    ];
  }

  function runSql(sql) {
    const result = runDocker(psqlArguments(), `${sql}\n`);
    if (result.status !== 0) {
      fail(`Local PostgreSQL verification failed: ${result.stderr.trim()}`);
    }
    return result.stdout.trim();
  }

  function guardDisposableLocalDatabase() {
    validateGuardIdentity();
    validateGuardInspection(runDocker(guardInspectionArguments()));
  }

  async function guardDisposableLocalDatabaseAsync(execute) {
    validateGuardIdentity();
    const inspected = await execute("docker", guardInspectionArguments(), {
      encoding: "utf8",
      input: undefined,
      maxBuffer: 1024 * 1024,
    });
    validateGuardInspection(inspected);
  }

  function startSession(sql, closeInput = false) {
    const child = spawnProcess("docker", psqlArguments(), {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const session = { child, stdout: "", stderr: "", exit: undefined };
    session.exited = new Promise((resolveExit) => {
      child.on("close", (code, signal) => {
        session.exit = { code, signal };
        resolveExit(session.exit);
      });
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      session.stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      session.stderr += chunk;
    });
    child.on("error", (error) => {
      session.stderr += error.message;
    });
    const input = `\\set VERBOSITY verbose\n${sql}\n`;
    if (closeInput) child.stdin.end(input);
    else child.stdin.write(input);
    return session;
  }

  async function waitForMarker(session, marker) {
    const started = Date.now();
    while (!session.stdout.includes(marker)) {
      if (session.exit) {
        fail(messages.sessionExitedBeforeMarker(marker, session.stderr.trim()));
      }
      if (Date.now() - started > waitLimitMilliseconds) {
        fail(messages.markerTimeout(marker));
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
  }

  async function cleanUpOwnedSession(session, error) {
    markTimingPhase("cleanup");
    const cleanupErrors = [];
    try {
      if (!session.exit) session.child.kill("SIGTERM");
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    try {
      await session.exited;
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length) error.cleanupErrors = cleanupErrors;
  }

  async function startSessionAfterSetup(setupSql, sql, closeInput = false) {
    const savedPhase = currentPhase;
    markTimingPhase("setup");
    const marker = "RC330_SQL_SETUP_READY";
    const session = startSession(`${setupSql}\nselect '${marker}';`);
    try {
      await new Promise((resolveSetup, rejectSetup) => {
        function removeSetupListeners() {
          session.child.stdout.removeListener("data", onSetupData);
          session.child.removeListener("error", onSetupError);
          session.child.removeListener("close", onSetupClose);
        }
        function onSetupData() {
          if (!session.stdout.includes(marker)) return;
          removeSetupListeners();
          resolveSetup();
        }
        function onSetupError(error) {
          removeSetupListeners();
          rejectSetup(error);
        }
        function onSetupClose() {
          removeSetupListeners();
          rejectSetup(
            new Error(
              messages.sessionExitedBeforeMarker(marker, session.stderr.trim()),
            ),
          );
        }
        session.child.stdout.on("data", onSetupData);
        session.child.on("error", onSetupError);
        session.child.on("close", onSetupClose);
      });
      session.setupStdout = session.stdout.slice(
        0,
        session.stdout.indexOf(marker),
      );
      session.stdout = "";
      changeTimingPhase(savedPhase);
      if (closeInput) session.child.stdin.end(`${sql}\n`);
      else session.child.stdin.write(`${sql}\n`);
      return session;
    } catch (error) {
      await cleanUpOwnedSession(session, error);
      throw error;
    }
  }

  async function runSqlAfterSetup(setupSql, sql) {
    const session = await startSessionAfterSetup(setupSql, sql, true);
    try {
      await finishSession(session);
      return session.stdout.trim();
    } catch (error) {
      await cleanUpOwnedSession(session, error);
      throw error;
    }
  }

  async function waitForLock(applicationName, session) {
    const started = Date.now();
    while (true) {
      const waiting = runSql(`
        select count(*)::integer
        from pg_catalog.pg_stat_activity
        where application_name = '${applicationName}'
          and wait_event_type = 'Lock';
      `);
      if (waiting === "1") return;
      if (session.exit) {
        fail(
          messages.contenderExitedBeforeLock(
            applicationName,
            session.stderr.trim(),
          ),
        );
      }
      if (Date.now() - started > waitLimitMilliseconds) {
        fail(messages.lockTimeout(applicationName));
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
  }

  async function finishSession(
    session,
    {
      action,
      expectedState,
      expectedStateFailure = messages.expectedStateFailure,
      unexpectedSessionFailure = messages.unexpectedSessionFailure,
    } = {},
  ) {
    if (
      action &&
      !session.child.stdin.destroyed &&
      !session.child.stdin.writableEnded
    ) {
      session.child.stdin.end(`${action};\n`);
    }
    const result = await session.exited;
    if (expectedState) {
      if (result.code === 0 || !session.stderr.includes(expectedState)) {
        fail(expectedStateFailure(expectedState, session.stderr.trim()));
      }
    } else if (result.code !== 0) {
      fail(unexpectedSessionFailure(session.stderr.trim()));
    }
  }

  return {
    cleanUpOwnedSession,
    finishTiming,
    finishSession,
    guardDisposableLocalDatabase,
    guardDisposableLocalDatabaseAsync,
    psqlArguments,
    markTimingPhase,
    runDocker,
    runSql,
    runSqlAfterSetup,
    startSession,
    startSessionAfterSetup,
    waitForLock,
    waitForMarker,
  };
}
