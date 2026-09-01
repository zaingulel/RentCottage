import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { createSourceMutationPreload } from "./test-support/source-mutation-preload.mjs";
import {
  SPAWN_BOUNDARY_MARKER,
  TEST_DEADMAN_FD,
  TEST_DEADMAN_MARKER,
  TEST_KILL_ATTEMPTED_MARKER,
  TEST_KILL_FAILURE,
  TEST_SPAWN_BOUNDARY_FD,
} from "./verify-chromium-preflight-group-owner.mjs";
import { runChromiumPreflight } from "./verify-chromium-preflight.mjs";

const processFixture = resolve(
  process.cwd(),
  "scripts/fixtures/chromium-preflight-process-fixture.mjs",
);
const commandFixture = resolve(
  process.cwd(),
  "scripts/fixtures/chromium-preflight-command-fixture.mjs",
);
const groupOwnerPath = resolve(
  process.cwd(),
  "scripts/verify-chromium-preflight-group-owner.mjs",
);
const supervisorPath = resolve(
  process.cwd(),
  "scripts/verify-chromium-preflight.mjs",
);
const workerPath = resolve(
  process.cwd(),
  "scripts/verify-chromium-preflight-worker.mjs",
);
const commandFixtureUrl = pathToFileURL(commandFixture).href;
const groupOwnerUrl = pathToFileURL(groupOwnerPath).href;
const supervisorUrl = pathToFileURL(supervisorPath).href;
const sourceMutationHelperPath = resolve(
  process.cwd(),
  "scripts/test-support/source-mutation-preload.mjs",
);
const sourceMutationHelperUrl = pathToFileURL(sourceMutationHelperPath).href;
let commandSequence = 0;

const generatedPreloadSafeguardMutations = {
  exactAnchor: {
    anchor: `      if (occurrences !== 1) {
        throw new Error(\`Mutation anchor mismatch: \${mutation.label}\`);
      }`,
    label: "generated preload exact-one guard",
    replacement: `      if (false) {
        throw new Error(\`Mutation anchor mismatch: \${mutation.label}\`);
      }`,
  },
  exactUrl: {
    anchor:
      "    const selected = mutations.filter((mutation) => mutation.targetUrl === url);",
    label: "generated preload exact URL filter",
    replacement: "    const selected = mutations;",
  },
  callerOrder: {
    anchor: "    for (const mutation of selected) {",
    label: "generated preload caller-order iteration",
    replacement: "    for (const mutation of [...selected].reverse()) {",
  },
};
const supervisorStartObservationMutation = {
  anchor: "        return await runChromiumPreflight({",
  label: "command fixture supervisor-start observation",
  replacement: `        void sendOuter({
          token: abortToken,
          type: "command-fixture-supervisor-start",
        }).catch(recordPrimaryFailure);
        return await runChromiumPreflight({`,
  targetUrl: commandFixtureUrl,
};
const readyCallAnchor = `    const readySent = await sendOuter({
      token: abortToken,
      type: "command-fixture-ready",
    });`;
const preStartAnchor = "    const supervisor = startSupervisorOnce();";
const readinessDeadlineAnchor = `    const readiness = await withDeadline(
      readinessAcknowledged,
      "Chromium command readiness acknowledgement",
      250,
    );`;
const readinessBeforeSupervisorAnchor = `    const readiness = await withDeadline(
      readinessAcknowledged,
      "Chromium command readiness acknowledgement",
      250,
    );
    if (readiness.kind === "disconnected-before-ack") {
      throw new Error(
        "Chromium command fixture disconnected before its readiness acknowledgement",
      );
    }
    const supervisor = startSupervisorOnce();`;

function runSourceMutationTarget({
  mutations,
  preloadMutations = [],
  source,
  targetMatches = true,
}) {
  const root = mkdtempSync(
    join(tmpdir(), "rentcottage-issue-147-preload-support-"),
  );
  const targetPath = join(root, "target.mjs");
  const otherPath = join(root, "other.mjs");
  writeFileSync(targetPath, source, { flag: "wx" });
  writeFileSync(otherPath, 'console.log("other");\n', { flag: "wx" });
  const targetUrl = pathToFileURL(realpathSync(targetPath)).href;
  const selectedUrl = targetMatches
    ? targetUrl
    : pathToFileURL(realpathSync(otherPath)).href;
  let result;
  let rootRemoved = false;
  try {
    const preloadPath = createSourceMutationPreload({
      filename: "target-source-mutation.mjs",
      mutations: mutations.map((mutation) => ({
        ...mutation,
        targetUrl: selectedUrl,
      })),
      root,
    });
    const preloadArguments = [];
    if (preloadMutations.length > 0) {
      const safeguardPreloadPath = createSourceMutationPreload({
        filename: "preload-safeguard-mutation.mjs",
        mutations: preloadMutations.map((mutation) => ({
          ...mutation,
          targetUrl: pathToFileURL(realpathSync(preloadPath)).href,
        })),
        root,
      });
      preloadArguments.push("--import", safeguardPreloadPath);
    }
    preloadArguments.push("--import", preloadPath);
    result = spawnSync(process.execPath, [...preloadArguments, targetPath], {
      encoding: "utf8",
      env: process.env,
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
    rootRemoved = !existsSync(root);
  }
  return { result, rootRemoved };
}

function mutationAnchorDiagnostic(stderr) {
  return stderr.match(/^Error: (Mutation anchor mismatch: [^\n]+)$/m)?.[1];
}

function runExclusiveCreateMutant() {
  const root = mkdtempSync(
    join(tmpdir(), "rentcottage-issue-147-preload-exclusive-"),
  );
  const runnerPath = join(root, "exclusive-create-runner.mjs");
  writeFileSync(
    runnerPath,
    `import { readFileSync } from "node:fs";
import { createSourceMutationPreload } from ${JSON.stringify(sourceMutationHelperUrl)};

const root = process.argv[2];
const filename = "collision-preload.mjs";
const firstPath = createSourceMutationPreload({
  filename,
  mutations: [{ anchor: "first", label: "first", replacement: "one", targetUrl: "file:///first" }],
  root,
});
const before = readFileSync(firstPath, "utf8");
let collision = false;
try {
  createSourceMutationPreload({
    filename,
    mutations: [{ anchor: "second", label: "second", replacement: "two", targetUrl: "file:///second" }],
    root,
  });
} catch (error) {
  collision = error?.code === "EEXIST";
}
const after = readFileSync(firstPath, "utf8");
console.log(JSON.stringify({ collision, overwritten: before !== after }));
`,
    { flag: "wx" },
  );
  let result;
  let rootRemoved = false;
  try {
    const mutationPreloadPath = createSourceMutationPreload({
      filename: "exclusive-flag-mutation.mjs",
      mutations: [
        {
          anchor: '    { flag: "wx" },',
          label: "source mutation preload exclusive-create flag",
          replacement: '    { flag: "w" },',
          targetUrl: sourceMutationHelperUrl,
        },
      ],
      root,
    });
    result = spawnSync(
      process.execPath,
      ["--import", mutationPreloadPath, runnerPath, root],
      { encoding: "utf8", env: process.env },
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
    rootRemoved = !existsSync(root);
  }
  return { result, rootRemoved };
}

function positivePid(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function processIsAbsent(pid) {
  if (!positivePid(pid)) return true;
  try {
    process.kill(pid, 0);
    return { absent: false };
  } catch (error) {
    if (error.code === "ESRCH") return { absent: true };
    return { absent: false, observation: error };
  }
}

async function requireProcessesAbsent(pids) {
  const exactPids = [...new Set(pids.filter(positivePid))];
  let latestObservation;
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const observations = exactPids.map((pid) => [pid, processIsAbsent(pid)]);
    if (observations.every(([, observation]) => observation.absent)) return;
    latestObservation = observations.find(
      ([, observation]) => observation.observation !== undefined,
    );
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  const remaining = exactPids.filter((pid) => !processIsAbsent(pid).absent);
  const diagnostic = latestObservation
    ? ` Last non-ESRCH observation for PID ${latestObservation[0]}: ${latestObservation[1].observation?.code ?? "unknown"}.`
    : "";
  throw new Error(
    `Chromium process-fixture cleanup left live PIDs: ${remaining.join(", ")}.${diagnostic}`,
  );
}

function groupIsAbsent(groupId) {
  if (!positivePid(groupId)) return { absent: true };
  try {
    process.kill(-groupId, 0);
    return { absent: false };
  } catch (error) {
    if (error.code === "ESRCH") return { absent: true };
    return { absent: false, observation: error };
  }
}

async function requireGroupAbsent(groupId) {
  let latestObservation;
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const observation = groupIsAbsent(groupId);
    if (observation.absent) return;
    latestObservation = observation.observation ?? latestObservation;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  const diagnostic = latestObservation
    ? ` Last non-ESRCH observation: ${latestObservation.code ?? "unknown"}.`
    : "";
  throw new Error(
    `Chromium process-fixture group ${groupId} remained present.${diagnostic}`,
  );
}

function readFixtureState(statePath) {
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function withDeadline(promise, description, timeoutMs = 5_000) {
  return new Promise((resolveWait, rejectWait) => {
    const deadline = setTimeout(
      () => rejectWait(new Error(`${description} timed out`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(deadline);
        resolveWait(value);
      },
      (error) => {
        clearTimeout(deadline);
        rejectWait(error);
      },
    );
  });
}

function createHeldWorkerDeadline(timeoutMs) {
  const delegatedDelays = [];
  let capturedDeadline;
  let fired = false;
  let fixtureReadyRecordedBeforeFire = false;
  const scheduleTimer = (callback, delay) => {
    if (delay === timeoutMs && capturedDeadline === undefined) {
      capturedDeadline = { active: true, callback };
      return capturedDeadline;
    }
    delegatedDelays.push(delay);
    return setTimeout(callback, delay);
  };
  const cancelTimer = (timer) => {
    if (timer === capturedDeadline) {
      timer.active = false;
      return;
    }
    clearTimeout(timer);
  };
  return {
    cancelTimer,
    evidence: () => ({
      captured: capturedDeadline !== undefined,
      delegatedDelays,
      fired,
      fixtureReadyRecordedBeforeFire,
    }),
    fireAfterFixtureReady: (fixtureReadyRecorded) => {
      if (!capturedDeadline?.active || fired) {
        throw new Error(
          "Chromium worker deadline was unavailable at fixture readiness",
        );
      }
      fixtureReadyRecordedBeforeFire = fixtureReadyRecorded;
      fired = true;
      capturedDeadline.active = false;
      capturedDeadline.callback();
    },
    scheduleTimer,
  };
}

function createMarkerState(stream) {
  const counts = {
    [SPAWN_BOUNDARY_MARKER]: 0,
    [TEST_DEADMAN_MARKER]: 0,
  };
  let buffer = "";
  let failure;
  let resolveEnd;
  const ended = new Promise((resolve) => {
    resolveEnd = resolve;
  });
  const waiters = new Map();
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const marker = buffer.slice(0, newline + 1);
      buffer = buffer.slice(newline + 1);
      if (!(marker in counts)) {
        failure ??= new Error(`Unexpected Chromium fixture marker: ${marker}`);
      } else {
        counts[marker] += 1;
        if (counts[marker] > 1) {
          failure ??= new Error(`Duplicate Chromium fixture marker: ${marker}`);
        }
        waiters.get(marker)?.();
        waiters.delete(marker);
      }
      newline = buffer.indexOf("\n");
    }
  });
  stream.once("end", () => {
    if (buffer.length > 0) {
      failure ??= new Error(`Partial Chromium fixture marker: ${buffer}`);
    }
    resolveEnd();
  });
  return {
    complete: async () => {
      await ended;
      if (failure) throw failure;
    },
    count: (marker) => counts[marker],
    waitFor: (marker) => {
      if (counts[marker] === 1) return Promise.resolve();
      return new Promise((resolveMarker) => waiters.set(marker, resolveMarker));
    },
  };
}

function createRealSupervisorFixture({ sourceEnvironment = process.env } = {}) {
  const stateRoot = mkdtempSync(
    join(tmpdir(), "rentcottage-issue-147-chromium-"),
  );
  const statePath = join(stateRoot, "processes.json");
  const cancellation = new AbortController();
  const lifecycle = [];
  let resolveHandoff;
  const handoffObserved = new Promise((resolve) => {
    resolveHandoff = resolve;
  });
  let deadmanActivated = false;
  let markerState;
  let owner;
  let ownerTerminated = Promise.resolve();
  let primaryFailureRecorded = false;
  let control;
  const spawnOwner = ({ workerArguments, workerPath }) => {
    const ownerEnvironment = { ...sourceEnvironment };
    delete ownerEnvironment[TEST_KILL_FAILURE];
    ownerEnvironment[TEST_DEADMAN_FD] = "5";
    ownerEnvironment[TEST_SPAWN_BOUNDARY_FD] = "4";
    owner = spawn(
      process.execPath,
      [groupOwnerPath, workerPath, ...workerArguments, "4", "5"],
      {
        detached: true,
        env: ownerEnvironment,
        stdio: ["ignore", "ignore", "pipe", "ipc", "pipe", "pipe"],
      },
    );
    markerState = createMarkerState(owner.stdio[4]);
    control = owner.stdio[5];
    control.on("error", () => {});
    ownerTerminated = new Promise((resolveTermination) =>
      owner.once("exit", resolveTermination),
    );
    return owner;
  };
  return {
    activateDeadman: async () => {
      if (!primaryFailureRecorded) {
        throw new Error("Chromium fixture deadman requires a primary failure");
      }
      if (
        deadmanActivated ||
        !owner ||
        owner.exitCode !== null ||
        owner.signalCode !== null
      ) {
        return;
      }
      deadmanActivated = true;
      const marker = markerState.waitFor(TEST_DEADMAN_MARKER);
      control.end();
      await marker;
    },
    cancellation,
    cleanup: async () => {
      await withDeadline(
        ownerTerminated,
        "Chromium fixture owner termination",
        2_000,
      );
      await withDeadline(
        markerState?.complete() ?? Promise.resolve(),
        "Chromium fixture marker completion",
        1_000,
      );
      const state = readFixtureState(statePath);
      await requireProcessesAbsent([
        owner?.pid,
        state.descendantPid,
        state.fixtureLeaderPid,
        state.groupOwnerPid,
      ]);
      control?.destroy();
      owner?.stderr?.destroy();
      rmSync(stateRoot, { force: true, recursive: true });
      return state;
    },
    deadmanActivated: () => deadmanActivated,
    handoffObserved,
    lifecycle,
    markerState: () => markerState,
    observeLifecycle: (event) => {
      lifecycle.push(event);
      if (event.type === "handoff-occurred") resolveHandoff();
    },
    owner: () => owner,
    recordPrimaryFailure: () => {
      primaryFailureRecorded = true;
    },
    spawnOwner,
    statePath,
  };
}

async function runRealSupervisor(
  mode,
  { holdWorkerDeadline = false, sourceEnvironment, timeoutMs = 1_000 } = {},
) {
  const fixture = createRealSupervisorFixture({ sourceEnvironment });
  const workerMessages = [];
  const workerDeadline = holdWorkerDeadline
    ? createHeldWorkerDeadline(timeoutMs)
    : undefined;
  let cleanupFailure;
  let primaryFailure;
  let result;
  let state;
  try {
    result = await withDeadline(
      runChromiumPreflight({
        absenceProbeIntervalMs: 5,
        ...(workerDeadline
          ? {
              cancelTimer: workerDeadline.cancelTimer,
              scheduleTimer: workerDeadline.scheduleTimer,
            }
          : {}),
        cleanupVerificationTimeoutMs: 2_000,
        disconnectObservationTimeoutMs: 1_500,
        forceKillDelayMs: 20,
        killArmTimeoutMs: 100,
        observeLifecycle: fixture.observeLifecycle,
        onWorkerMessage: (message) => {
          workerMessages.push(message);
          if (message?.type === "fixture-ready" && workerDeadline) {
            workerDeadline.fireAfterFixtureReady(
              workerMessages.includes(message),
            );
          }
        },
        ownerCloseWaitMs: 200,
        spawnOwner: fixture.spawnOwner,
        termResultTimeoutMs: 100,
        testCancellationSignal: fixture.cancellation.signal,
        timeoutMs,
        workerArguments: [mode, fixture.statePath],
        workerPath: processFixture,
      }),
      "Chromium real supervisor result",
    );
  } catch (error) {
    primaryFailure = error;
    fixture.recordPrimaryFailure();
    fixture.cancellation.abort();
    try {
      await withDeadline(
        fixture.handoffObserved,
        "Chromium test cancellation handoff",
        250,
      );
    } catch {
      await fixture.activateDeadman();
    }
  }
  try {
    state = await fixture.cleanup();
  } catch (error) {
    if (!primaryFailure) primaryFailure = error;
    else cleanupFailure = error;
    fixture.recordPrimaryFailure();
    try {
      await fixture.activateDeadman();
      state = await fixture.cleanup();
    } catch (deadmanFailure) {
      cleanupFailure ??= deadmanFailure;
    }
  }
  if (primaryFailure && cleanupFailure) {
    throw new AggregateError(
      [primaryFailure, cleanupFailure],
      "Chromium supervisor assertion and cleanup failed",
    );
  }
  if (primaryFailure) throw primaryFailure;
  if (cleanupFailure) throw cleanupFailure;
  return {
    deadmanActivated: fixture.deadmanActivated(),
    lifecycle: fixture.lifecycle,
    markerCounts: {
      deadman: fixture.markerState().count(TEST_DEADMAN_MARKER),
      spawn: fixture.markerState().count(SPAWN_BOUNDARY_MARKER),
    },
    result,
    state,
    workerDeadline: workerDeadline?.evidence(),
    workerMessages,
  };
}

function createCommandObserver(
  child,
  token,
  { holdReadyAcknowledgement = false } = {},
) {
  let abortAcknowledgement;
  let commandResult;
  let deadlineReleased;
  let ready;
  let supervisorStart;
  let workerReady;
  let readyAcknowledgementStarted = false;
  let readyAcknowledgementResult = { kind: "not-started" };
  let readyObserved = false;
  let supervisorStartObserved = false;
  let workerReadyObserved = false;
  const waiters = {
    abort: new Promise((resolve) => {
      abortAcknowledgement = resolve;
    }),
    result: new Promise((resolve) => {
      commandResult = resolve;
    }),
    deadlineReleased: new Promise((resolve) => {
      deadlineReleased = resolve;
    }),
    ready: new Promise((resolve) => {
      ready = resolve;
    }),
    supervisorStart: new Promise((resolve) => {
      supervisorStart = resolve;
    }),
    workerReady: new Promise((resolve) => {
      workerReady = resolve;
    }),
  };
  const releaseReadyAcknowledgement = () => {
    if (readyAcknowledgementStarted) return;
    readyAcknowledgementStarted = true;
    try {
      const submitted = child.send(
        { token, type: "command-fixture-ready-ack" },
        (error) => {
          readyAcknowledgementResult = error
            ? { error, kind: "callback-failed" }
            : { kind: "completed", submitted };
        },
      );
      readyAcknowledgementResult = { kind: "submitted", submitted };
    } catch (error) {
      readyAcknowledgementResult = { error, kind: "threw" };
    }
  };
  child.on("message", (message) => {
    if (message?.token !== undefined && message.token !== token) return;
    if (message?.type === "command-fixture-ready") {
      readyObserved = true;
      ready(message);
      if (!holdReadyAcknowledgement) releaseReadyAcknowledgement();
    }
    if (message?.type === "command-fixture-supervisor-start") {
      supervisorStartObserved = true;
      supervisorStart(message);
    }
    if (message?.type === "command-fixture-worker-ready") {
      workerReadyObserved = true;
      workerReady(message);
    }
    if (message?.type === "command-fixture-worker-deadline-released") {
      deadlineReleased(message);
    }
    if (message?.type === "test-abort-ack") abortAcknowledgement(message);
    if (message?.type === "command-result") commandResult(message);
  });
  return {
    ...waiters,
    evidence: () => ({
      readyAcknowledgementResult,
      readyAcknowledgementStarted,
      readyObserved,
      supervisorStartObserved,
      workerReadyObserved,
    }),
    releaseReadyAcknowledgement,
  };
}

function commandResultFromStderr(stderr) {
  const prefix = "chromium-command-result:";
  const line = stderr
    .split("\n")
    .findLast((candidate) => candidate.startsWith(prefix));
  return line ? JSON.parse(line.slice(prefix.length)) : undefined;
}

function commandMarkerCounts(stderr) {
  const prefix = "chromium-command-marker:";
  const counts = new Map([
    [SPAWN_BOUNDARY_MARKER, 0],
    [TEST_KILL_ATTEMPTED_MARKER, 0],
    [TEST_DEADMAN_MARKER, 0],
  ]);
  for (const line of stderr.split("\n")) {
    if (!line.startsWith(prefix)) continue;
    const marker = JSON.parse(line.slice(prefix.length));
    if (!counts.has(marker)) {
      throw new Error(`Unexpected Chromium command marker: ${marker}`);
    }
    counts.set(marker, counts.get(marker) + 1);
  }
  return {
    deadman: counts.get(TEST_DEADMAN_MARKER),
    killAttempted: counts.get(TEST_KILL_ATTEMPTED_MARKER),
    spawn: counts.get(SPAWN_BOUNDARY_MARKER),
  };
}

async function runCommandFixture(
  mode,
  {
    abortAfterReady = false,
    abortAfterAcknowledgementProbe = false,
    commandMutations = [],
    disconnectBeforeReadyAcknowledgement = false,
    disconnectAfterAcknowledgement = false,
    expectWorkerReady = true,
    forceAcknowledgementFailure = false,
    holdReadyAcknowledgement = false,
    observeSupervisorStart = false,
    expectSupervisorStart = observeSupervisorStart,
    omitReadyAcknowledgement = false,
    ownerMutations = [],
    probeBeforeReadyAcknowledgement = false,
    readyExpectation = "required",
    resultTimeoutMs = 5_000,
    sourceEnvironment = process.env,
  } = {},
) {
  const stateRoot = mkdtempSync(
    join(tmpdir(), "rentcottage-issue-147-command-"),
  );
  const statePath = join(stateRoot, "processes.json");
  const token = `command-${process.pid}-${++commandSequence}`;
  const effectiveCommandMutations = [
    ...(observeSupervisorStart ? [supervisorStartObservationMutation] : []),
    ...commandMutations,
  ];
  const commandPreloadPath =
    effectiveCommandMutations.length > 0
      ? createSourceMutationPreload({
          filename: "command-source-mutation.mjs",
          mutations: effectiveCommandMutations,
          root: stateRoot,
        })
      : undefined;
  const ownerPreloadPath =
    ownerMutations.length > 0
      ? createSourceMutationPreload({
          filename: "owner-source-mutation.mjs",
          mutations: ownerMutations,
          root: stateRoot,
        })
      : undefined;
  const child = spawn(
    process.execPath,
    [
      ...(commandPreloadPath ? ["--import", commandPreloadPath] : []),
      commandFixture,
      mode,
      statePath,
      token,
      ...(ownerPreloadPath ? [ownerPreloadPath] : []),
    ],
    {
      env: { ...sourceEnvironment },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
  const observer = createCommandObserver(child, token, {
    holdReadyAcknowledgement:
      holdReadyAcknowledgement ||
      disconnectBeforeReadyAcknowledgement ||
      omitReadyAcknowledgement,
  });
  const exit = new Promise((resolveExit) =>
    child.once("exit", (code, signal) => resolveExit({ code, signal })),
  );
  const stderrEnded = new Promise((resolveEnd, rejectEnd) => {
    child.stderr.once("end", resolveEnd);
    child.stderr.once("error", rejectEnd);
  });
  let abortFailure;
  let absenceProven = false;
  let cleanupFailure;
  let commandExit;
  let harnessFailure;
  let markerEofProven = false;
  let preAcknowledgementEvidence;
  let processState = {};
  let received;
  let abortAcknowledgement;
  let resultFailure;
  let rootRemoved = false;
  let stderr = "";
  let watchdogFired = false;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const requestAbort = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      child.send({
        forceAcknowledgementFailure,
        token,
        type: "test-abort",
      });
      abortAcknowledgement = await withDeadline(
        observer.abort,
        "Chromium command abort acknowledgement",
        700,
      );
    } catch (error) {
      abortFailure = error;
    }
    if (disconnectAfterAcknowledgement || abortFailure) {
      if (child.connected) child.disconnect();
      child.channel?.unref?.();
      child.unref();
    }
  };
  try {
    if (readyExpectation === "required") {
      await withDeadline(observer.ready, "Chromium command readiness", 1_000);
    }
    if (probeBeforeReadyAcknowledgement) {
      child.send({
        token,
        type: "test-release-worker-deadline",
      });
      const deadlineRelease = await withDeadline(
        observer.deadlineReleased,
        "Chromium command worker deadline release",
        1_000,
      );
      preAcknowledgementEvidence = {
        deadlineRelease,
        observer: observer.evidence(),
        processStateExists: existsSync(statePath),
        markerCounts: commandMarkerCounts(stderr),
      };
      observer.releaseReadyAcknowledgement();
      if (abortAfterAcknowledgementProbe) await requestAbort();
    } else if (disconnectBeforeReadyAcknowledgement) {
      if (child.connected) child.disconnect();
      child.channel?.unref?.();
      child.unref();
    } else if (holdReadyAcknowledgement && !omitReadyAcknowledgement) {
      observer.releaseReadyAcknowledgement();
    }
    if (expectSupervisorStart && !disconnectBeforeReadyAcknowledgement) {
      await withDeadline(
        observer.supervisorStart,
        "Chromium command supervisor start",
        1_000,
      );
    }
    if (expectWorkerReady) {
      await withDeadline(
        observer.workerReady,
        "Chromium command worker readiness",
        1_000,
      );
      if (abortAfterReady) {
        await requestAbort();
      } else if (!probeBeforeReadyAcknowledgement) {
        child.send({
          token,
          type: "test-release-worker-deadline",
        });
        const deadlineRelease = await withDeadline(
          observer.deadlineReleased,
          "Chromium command worker deadline release",
          1_000,
        );
        if (deadlineRelease.released !== true) {
          throw new Error("Chromium command worker deadline was unavailable");
        }
      }
    }
    if (
      !disconnectAfterAcknowledgement &&
      !disconnectBeforeReadyAcknowledgement
    ) {
      try {
        received = await withDeadline(
          observer.result,
          "Chromium command result",
          resultTimeoutMs,
        );
      } catch (error) {
        watchdogFired = true;
        resultFailure = error;
        if (!abortAfterReady) await requestAbort();
        if (child.connected) child.disconnect();
        child.channel?.unref?.();
        child.unref();
      }
    }
    commandExit = await withDeadline(
      exit,
      "Chromium command natural exit",
      5_000,
    );
  } catch (error) {
    harnessFailure = error;
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        if (!abortAfterReady) await requestAbort();
        if (child.connected) child.disconnect();
        child.channel?.unref?.();
        child.unref();
        commandExit = await withDeadline(
          exit,
          "Chromium command failure cleanup",
          5_000,
        );
      } catch (error) {
        cleanupFailure = error;
      }
    }
    try {
      await withDeadline(
        stderrEnded,
        "Chromium command marker end-of-file",
        1_000,
      );
      markerEofProven = true;
      const state = readFixtureState(statePath);
      processState = state;
      received ??= commandResultFromStderr(stderr);
      await requireGroupAbsent(received?.ownerPid ?? state.groupOwnerPid);
      await requireProcessesAbsent([
        child.pid,
        received?.ownerPid,
        state.descendantPid,
        state.fixtureLeaderPid,
        state.groupOwnerPid,
      ]);
      absenceProven = true;
      rmSync(stateRoot, { force: true, recursive: true });
      rootRemoved = !existsSync(stateRoot);
      child.stderr.destroy();
    } catch (error) {
      cleanupFailure ??= error;
    }
  }
  if (harnessFailure && cleanupFailure) {
    throw new AggregateError(
      [harnessFailure, cleanupFailure],
      `Chromium command failed and cleanup failed: ${stderr.trim()}`,
    );
  }
  if (harnessFailure) throw harnessFailure;
  if (cleanupFailure) throw cleanupFailure;
  return {
    absenceProven,
    abortAcknowledgement,
    abortFailure,
    commandExit,
    markerCounts: commandMarkerCounts(stderr),
    markerEofProven,
    message: received,
    observerEvidence: observer.evidence(),
    preAcknowledgementEvidence,
    processState,
    resultFailure,
    rootRemoved,
    stderr,
    watchdogFired,
  };
}

async function runExecutableWorkerCode(
  workerCode,
  { restoreIntegerOnlyPredicate = false } = {},
) {
  const stateRoot = mkdtempSync(
    join(tmpdir(), "rentcottage-issue-147-executable-code-"),
  );
  const statePath = join(stateRoot, "owner-state.json");
  const ownerPath = join(stateRoot, "generated-owner.mjs");
  const preloadPath = join(stateRoot, "supervisor-source-mutation.mjs");
  const ownerSource = `import { writeFileSync } from "node:fs";

const statePath = ${JSON.stringify(statePath)};
const workerCode = ${JSON.stringify(workerCode)};
const supervisorPreloadPath = ${JSON.stringify(preloadPath)};
const state = {
  argv: [...process.argv],
  cleanupProtocolErrorReceived: false,
  deadlineActivated: false,
  execArgv: [...process.execArgv],
  mutationSelectorEnvironment: Object.entries(process.env)
    .filter(([key, value]) =>
      key === "RENTCOTTAGE_EXIT_CODE_MUTATION" ||
      value === supervisorPreloadPath,
    )
    .map(([key]) => key),
  normalExitObserved: false,
  ownerPid: process.pid,
  readySent: false,
  receivedMessages: [],
  sendCallbackFailures: [],
  termResultSent: false,
  terminationRoute: "pending",
};

function persist() {
  writeFileSync(statePath, JSON.stringify(state));
}

function recordMessage(message) {
  state.receivedMessages.push({
    ...(typeof message?.phase === "string" ? { phase: message.phase } : {}),
    type: typeof message?.type === "string" ? message.type : "malformed",
  });
  persist();
}

function recordSendFailure(error) {
  if (!error) return;
  state.sendCallbackFailures.push(
    error instanceof Error ? error.message : String(error),
  );
  persist();
}

let selfExitDeadline;
process.on("message", (message) => {
  recordMessage(message);
  if (message?.type === "start") {
    process.send(
      {
        code: workerCode,
        stderr: "fixed generated owner worker stderr",
        type: "worker-outcome",
      },
      recordSendFailure,
    );
    return;
  }
  if (message?.type === "cleanup-protocol-error") {
    state.cleanupProtocolErrorReceived = true;
    persist();
    return;
  }
  if (message?.type === "cleanup-request" && message.phase === "term") {
    state.termResultSent = true;
    persist();
    process.send(
      {
        requestId: message.requestId,
        status: "dispatched",
        type: "cleanup-term-result",
      },
      (error) => {
        recordSendFailure(error);
        clearTimeout(selfExitDeadline);
        state.terminationRoute = "term-result-disconnect";
        persist();
        if (process.connected) process.disconnect();
      },
    );
  }
});
process.on("disconnect", () => {
  state.receivedMessages.push({ type: "disconnect" });
  clearTimeout(selfExitDeadline);
  if (state.cleanupProtocolErrorReceived) {
    state.terminationRoute = "cleanup-protocol-error-disconnect";
  } else if (state.termResultSent) {
    state.terminationRoute = "term-result-disconnect";
  } else {
    state.terminationRoute = "unexpected-disconnect";
  }
  persist();
  process.exitCode = 0;
});
process.on("exit", () => {
  state.normalExitObserved = true;
  persist();
});
selfExitDeadline = setTimeout(() => {
  state.deadlineActivated = true;
  state.terminationRoute = "self-exit-deadline";
  persist();
  if (process.connected) process.disconnect();
  process.exitCode = 97;
}, 4_000);
state.readySent = true;
persist();
process.send({ type: "owner-ready" }, recordSendFailure);
`;
  writeFileSync(ownerPath, ownerSource, { flag: "wx" });
  const mutations = [
    {
      anchor: "  const result = await runChromiumPreflight();",
      label: "executable supervisor generated owner",
      replacement: `  const result = await runChromiumPreflight({ groupOwnerPath: ${JSON.stringify(ownerPath)} });`,
      targetUrl: supervisorUrl,
    },
    ...(restoreIntegerOnlyPredicate
      ? [
          {
            anchor: "validWorkerExitCode(code.value)",
            label: "supervisor integer-only worker exit code",
            replacement: "Number.isInteger(code.value)",
            targetUrl: supervisorUrl,
          },
        ]
      : []),
  ];
  createSourceMutationPreload({
    filename: "supervisor-source-mutation.mjs",
    mutations,
    root: stateRoot,
  });
  const child = spawn(
    process.execPath,
    ["--import", preloadPath, supervisorPath],
    {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  let stdout = "";
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  const exited = new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
  const stderrEnded = new Promise((resolveEnd, rejectEnd) => {
    child.stderr.once("end", resolveEnd);
    child.stderr.once("error", rejectEnd);
  });
  const stdoutEnded = new Promise((resolveEnd, rejectEnd) => {
    child.stdout.once("end", resolveEnd);
    child.stdout.once("error", rejectEnd);
  });
  const exit = await withDeadline(
    exited,
    "Chromium executable exit-code fixture",
    10_000,
  );
  await Promise.all([stderrEnded, stdoutEnded]);
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  await requireProcessesAbsent([child.pid, state.ownerPid]);
  const ownerAbsent = processIsAbsent(state.ownerPid).absent;
  const preloadPropagated = JSON.stringify(state).includes(preloadPath);
  rmSync(stateRoot, { force: true, recursive: true });
  return {
    exit,
    ownerAbsent,
    ownerPath,
    preloadPath,
    preloadPropagated,
    rootRemoved: !existsSync(stateRoot),
    state,
    stderr,
    stdout,
    streamsEnded: true,
  };
}

const commandFixtureMutants = [
  {
    cleanupRoute: "descriptor deadman after production-cleanup deadline",
    expectedDeadmanCount: 1,
    id: "owner-disconnect-noop",
    mutation: {
      anchor: "            owner.disconnect(),",
      label: "supervisor owner disconnect",
      replacement: "            undefined,",
      targetUrl: supervisorUrl,
    },
    redObservable: "production cleanup deadline and required deadman",
    target: "command",
    verifyRed: (run) => {
      expect(run.message).toMatchObject({
        deadmanActivated: true,
        finalCleanupComplete: true,
      });
      expect(run.message.primaryFailures).toContain(
        "Chromium command production cleanup timed out",
      );
    },
  },
  {
    cleanupRoute: "descriptor deadman after missing cancellation handoff",
    expectedDeadmanCount: 1,
    id: "cancellation-listener-noop",
    mutation: {
      anchor: "testCancellationSignal.addEventListener(",
      label: "supervisor cancellation registration",
      replacement: "(() => undefined)(",
      targetUrl: supervisorUrl,
    },
    redObservable: "missing cancellation handoff and abort acknowledgement",
    target: "command",
    verifyRed: (run) => {
      expect(run.abortAcknowledgement).toBeUndefined();
      expect(run.abortFailure?.message).toContain(
        "abort acknowledgement timed out",
      );
      expect(run.message?.bridgeFailure).toContain(
        "cancellation handoff timed out",
      );
    },
  },
  {
    cleanupRoute: "production cleanup, then outer IPC release",
    expectedDeadmanCount: 0,
    id: "abort-ack-await-never-settles",
    mutation: {
      anchor: "          await acknowledgementTask;",
      label: "command abort acknowledgement await",
      replacement: "          await new Promise(() => {});",
      targetUrl: commandFixtureUrl,
    },
    redObservable:
      "natural result deadline after a stuck acknowledgement await",
    target: "command",
    verifyRed: (run) => {
      expect(run.abortAcknowledgement).toMatchObject({
        handoffRecorded: true,
      });
      expect(run.resultFailure?.message).toContain("command result timed out");
      expect(run.message).toBeUndefined();
    },
  },
  {
    cleanupRoute: "normal owner disconnect cleanup",
    expectedDeadmanCount: 0,
    id: "owner-channel-unref-removed",
    mutation: {
      anchor: "          ownerChannel.unref(),",
      label: "supervisor owner channel unref",
      replacement: "          undefined,",
      targetUrl: supervisorUrl,
    },
    redObservable: "missing owner-channel detachment flag",
    target: "command",
    verifyRed: (run) => {
      expect(run.message).toMatchObject({
        finalCleanupComplete: true,
        ownerChannelUnreferenced: false,
      });
    },
  },
  {
    cleanupRoute: "normal owner disconnect cleanup",
    expectedDeadmanCount: 0,
    id: "owner-stderr-destroy-removed",
    mutation: {
      anchor: "          ownerStderrStream.destroy(),",
      label: "supervisor owner stderr destroy",
      replacement: "          undefined,",
      targetUrl: supervisorUrl,
    },
    redObservable: "missing owner-stderr detachment flag",
    target: "command",
    verifyRed: (run) => {
      expect(run.message).toMatchObject({
        finalCleanupComplete: true,
        ownerStderrDestroyed: false,
      });
    },
  },
  {
    cleanupRoute: "normal owner disconnect cleanup",
    expectedDeadmanCount: 0,
    id: "owner-handle-unref-removed",
    mutation: {
      anchor:
        'runCleanupOperation("unreference its group owner", () => owner.unref());',
      label: "supervisor owner handle unref",
      replacement:
        'runCleanupOperation("unreference its group owner", () => undefined);',
      targetUrl: supervisorUrl,
    },
    redObservable: "missing owner-handle detachment flag",
    target: "command",
    verifyRed: (run) => {
      expect(run.message).toMatchObject({
        finalCleanupComplete: true,
        ownerUnreferenced: false,
      });
    },
  },
  {
    cleanupRoute: "descriptor deadman after production-cleanup deadline",
    expectedDeadmanCount: 1,
    id: "owner-disconnect-listener-noop",
    mutation: {
      anchor: "    onDisconnect(beginDisconnectCleanup);",
      label: "owner disconnect cleanup listener",
      replacement: "    onDisconnect(() => {});",
      targetUrl: groupOwnerUrl,
    },
    redObservable: "production cleanup deadline and required deadman",
    target: "owner",
    verifyRed: (run) => {
      expect(run.message).toMatchObject({
        deadmanActivated: true,
        finalCleanupComplete: true,
      });
      expect(run.message.primaryFailures).toContain(
        "Chromium command production cleanup timed out",
      );
    },
  },
  {
    cleanupRoute: "normal production cleanup, outer absence verification",
    expectedDeadmanCount: 0,
    id: "unconditional-finalize-removed",
    mutation: {
      anchor: "    await finalizeCommandFixture();",
      label: "command unconditional finalization",
      replacement: "    await Promise.resolve();",
      targetUrl: commandFixtureUrl,
    },
    redObservable: "missing finalization and fixture-absence claim",
    target: "command",
    verifyRed: (run) => {
      expect(run.message).toMatchObject({
        finalCleanupComplete: false,
        fixtureProcessesAbsent: false,
      });
    },
  },
  {
    cleanupRoute: "normal production cleanup after acknowledgement release",
    expectedDeadmanCount: 0,
    expectedSpawnCounts: [0, 1],
    id: "acknowledgement-order-reversed",
    mutation: {
      anchor: readinessBeforeSupervisorAnchor,
      label: "command readiness before supervisor start",
      replacement: `    const supervisor = startSupervisorOnce();
    const readiness = await withDeadline(
      readinessAcknowledged,
      "Chromium command readiness acknowledgement",
      250,
    );
    if (readiness.kind === "disconnected-before-ack") {
      throw new Error(
        "Chromium command fixture disconnected before its readiness acknowledgement",
      );
    }`,
      targetUrl: commandFixtureUrl,
    },
    redObservable: "supervisor start before parent receipt acknowledgement",
    runOptions: {
      abortAfterAcknowledgementProbe: true,
      expectWorkerReady: false,
      holdReadyAcknowledgement: true,
      observeSupervisorStart: true,
      probeBeforeReadyAcknowledgement: true,
    },
    target: "command",
    verifyRed: (run) => {
      expect(run.preAcknowledgementEvidence).toMatchObject({
        observer: { supervisorStartObserved: true },
      });
      expect(
        typeof run.preAcknowledgementEvidence.deadlineRelease.released,
      ).toBe("boolean");
    },
  },
];

describe("source mutation preload support", () => {
  it.each([
    [
      "zero",
      'console.log("target-executed");\n',
      { anchor: "missing", label: "zero-anchor", replacement: "changed" },
      "Mutation anchor mismatch: zero-anchor",
    ],
    [
      "duplicate",
      'console.log("duplicate"); console.log("duplicate");\n',
      {
        anchor: "duplicate",
        label: "duplicate-anchor",
        replacement: "changed",
      },
      "Mutation anchor mismatch: duplicate-anchor",
    ],
  ])(
    "rejects a %s-occurrence anchor before target execution",
    (_, source, mutation, diagnostic) => {
      const run = runSourceMutationTarget({ mutations: [mutation], source });

      expect(run.result.status).toBe(1);
      expect(run.result.signal).toBeNull();
      expect(run.result.stdout).toBe("");
      expect(mutationAnchorDiagnostic(run.result.stderr)).toBe(diagnostic);
      expect(run.rootRemoved).toBe(true);
    },
  );

  it("leaves an exact non-target URL unchanged", () => {
    const run = runSourceMutationTarget({
      mutations: [
        { anchor: "unchanged", label: "wrong URL", replacement: "mutated" },
      ],
      source: 'console.log("unchanged");\n',
      targetMatches: false,
    });

    expect(run.result).toMatchObject({
      signal: null,
      status: 0,
      stderr: "",
      stdout: "unchanged\n",
    });
    expect(run.rootRemoved).toBe(true);
  });

  it("applies mutations against one URL in caller order", () => {
    const run = runSourceMutationTarget({
      mutations: [
        { anchor: "first", label: "first step", replacement: "second" },
        { anchor: "second", label: "second step", replacement: "final" },
      ],
      source: 'console.log("first");\n',
    });

    expect(run.result).toMatchObject({
      signal: null,
      status: 0,
      stderr: "",
      stdout: "final\n",
    });
    expect(run.rootRemoved).toBe(true);
  });

  it("fails an exclusive-create collision without overwriting the first preload", () => {
    const root = mkdtempSync(
      join(tmpdir(), "rentcottage-issue-147-preload-collision-"),
    );
    let rootRemoved = false;
    try {
      const filename = "collision-preload.mjs";
      const firstPath = createSourceMutationPreload({
        filename,
        mutations: [
          {
            anchor: "first",
            label: "first",
            replacement: "one",
            targetUrl: "file:///first",
          },
        ],
        root,
      });
      const before = readFileSync(firstPath, "utf8");

      expect(() =>
        createSourceMutationPreload({
          filename,
          mutations: [
            {
              anchor: "second",
              label: "second",
              replacement: "two",
              targetUrl: "file:///second",
            },
          ],
          root,
        }),
      ).toThrow(expect.objectContaining({ code: "EEXIST" }));
      expect(readFileSync(firstPath, "utf8")).toBe(before);
    } finally {
      rmSync(root, { force: true, recursive: true });
      rootRemoved = !existsSync(root);
    }
    expect(rootRemoved).toBe(true);
  });

  it.each([
    [
      "exact-one guard for zero and duplicate anchors",
      () => [
        runSourceMutationTarget({
          mutations: [
            {
              anchor: "missing",
              label: "zero-anchor",
              replacement: "changed",
            },
          ],
          preloadMutations: [generatedPreloadSafeguardMutations.exactAnchor],
          source: 'console.log("target-executed");\n',
        }),
        runSourceMutationTarget({
          mutations: [
            {
              anchor: "duplicate",
              label: "duplicate-anchor",
              replacement: "changed",
            },
          ],
          preloadMutations: [generatedPreloadSafeguardMutations.exactAnchor],
          source: 'console.log("duplicate"); console.log("duplicate");\n',
        }),
      ],
      (runs) => {
        for (const run of runs) {
          expect(run.result.status).toBe(0);
          expect(run.result.signal).toBeNull();
          expect(run.rootRemoved).toBe(true);
        }
      },
    ],
    [
      "exact URL filter",
      () => [
        runSourceMutationTarget({
          mutations: [
            {
              anchor: "unchanged",
              label: "wrong URL",
              replacement: "mutated",
            },
          ],
          preloadMutations: [generatedPreloadSafeguardMutations.exactUrl],
          source: 'console.log("unchanged");\n',
          targetMatches: false,
        }),
      ],
      ([run]) => {
        expect(run.result).toMatchObject({
          signal: null,
          status: 0,
          stdout: "mutated\n",
        });
        expect(run.rootRemoved).toBe(true);
      },
    ],
    [
      "caller-order iteration",
      () => [
        runSourceMutationTarget({
          mutations: [
            { anchor: "first", label: "first step", replacement: "second" },
            { anchor: "second", label: "second step", replacement: "final" },
          ],
          preloadMutations: [generatedPreloadSafeguardMutations.callerOrder],
          source: 'console.log("first");\n',
        }),
      ],
      ([run]) => {
        expect(run.result.status).toBe(1);
        expect(run.result.signal).toBeNull();
        expect(mutationAnchorDiagnostic(run.result.stderr)).toBe(
          "Mutation anchor mismatch: second step",
        );
        expect(run.rootRemoved).toBe(true);
      },
    ],
    [
      "exclusive-create flag",
      () => [runExclusiveCreateMutant()],
      ([run]) => {
        expect(run.result).toMatchObject({ signal: null, status: 0 });
        expect(JSON.parse(run.result.stdout)).toEqual({
          collision: false,
          overwritten: true,
        });
        expect(run.rootRemoved).toBe(true);
      },
    ],
  ])("observes removal of the %s as red", (_, runMutant, verifyRed) => {
    verifyRed(runMutant());
  });
});

describe("command fixture readiness receipt and lifecycle", () => {
  it("keeps supervisor and owner start behind the received acknowledgement", async () => {
    const run = await runCommandFixture("cleanup-ack-timeout", {
      abortAfterReady: true,
      holdReadyAcknowledgement: true,
      observeSupervisorStart: true,
      probeBeforeReadyAcknowledgement: true,
    });

    expect(run.preAcknowledgementEvidence).toEqual({
      deadlineRelease: expect.objectContaining({ released: false }),
      markerCounts: { deadman: 0, killAttempted: 0, spawn: 0 },
      observer: expect.objectContaining({
        readyObserved: true,
        supervisorStartObserved: false,
        workerReadyObserved: false,
      }),
      processStateExists: false,
    });
    expect(run.observerEvidence).toMatchObject({
      readyAcknowledgementStarted: true,
      supervisorStartObserved: true,
      workerReadyObserved: true,
    });
    expect(run.message).toMatchObject({
      deadmanActivated: false,
      finalCleanupComplete: true,
      supervisorState: "SETTLED",
    });
    expect(run.markerCounts).toEqual({
      deadman: 0,
      killAttempted: 0,
      spawn: 1,
    });
    expect(run.markerEofProven).toBe(true);
    expect(run.absenceProven).toBe(true);
    expect(run.rootRemoved).toBe(true);
  });

  it.each([
    [
      "ready send returns false",
      {
        commandMutations: [
          {
            anchor: readyCallAnchor,
            label: "command native ready send returns false",
            replacement: `    const nativeProcessSend = process.send.bind(process);
    process.send = (...arguments_) => {
      process.send = nativeProcessSend;
      nativeProcessSend(...arguments_);
      return false;
    };
${readyCallAnchor}`,
            targetUrl: commandFixtureUrl,
          },
        ],
      },
      "Chromium command readiness send was unavailable",
      true,
    ],
    [
      "ready send throws",
      {
        commandMutations: [
          {
            anchor: readyCallAnchor,
            label: "command ready send throws",
            replacement:
              '    const readySent = await (() => { throw new Error("fixed command readiness send throw"); })();',
            targetUrl: commandFixtureUrl,
          },
        ],
        readyExpectation: "optional",
      },
      "fixed command readiness send throw",
      false,
    ],
    [
      "ready send callback fails",
      {
        commandMutations: [
          {
            anchor: readyCallAnchor,
            label: "command ready callback failure",
            replacement: `    const readySent = await sendOuter(
      { token: abortToken, type: "command-fixture-ready" },
      { forceCallbackFailure: true },
    );`,
            targetUrl: commandFixtureUrl,
          },
        ],
      },
      "fixed abort acknowledgement callback failure",
      false,
    ],
    [
      "parent disconnects before acknowledgement",
      { disconnectBeforeReadyAcknowledgement: true },
      "disconnected before its readiness acknowledgement",
      false,
    ],
  ])(
    "skips supervisor start when %s",
    async (_, options, diagnostic, exactPrimaryFailure) => {
      const run = await runCommandFixture("cleanup-ack-timeout", {
        ...options,
        expectSupervisorStart: false,
        expectWorkerReady: false,
        observeSupervisorStart: true,
        resultTimeoutMs: 2_000,
      });

      expect(run.message).toMatchObject({
        deadmanActivated: false,
        finalCleanupComplete: true,
        supervisorObservationComplete: true,
        supervisorState: "SKIPPED",
      });
      expect(run.message.primaryFailures.join("\n")).toContain(diagnostic);
      if (exactPrimaryFailure) {
        expect(run.message.primaryFailures).toEqual([diagnostic]);
        expect(run.message.supervisorNoStartReason).toBe(diagnostic);
        expect(run.observerEvidence).toMatchObject({
          readyAcknowledgementStarted: true,
          readyObserved: true,
        });
      }
      expect(run.observerEvidence.supervisorStartObserved).toBe(false);
      expect(run.markerCounts).toEqual({
        deadman: 0,
        killAttempted: 0,
        spawn: 0,
      });
      expect(run.processState).toEqual({});
      expect(run.markerEofProven).toBe(true);
      expect(run.absenceProven).toBe(true);
      expect(run.commandExit.signal).toBeNull();
      expect(run.rootRemoved).toBe(true);
    },
    12_000,
  );

  it("skips supervisor start when the readiness acknowledgement remains silent", async () => {
    const diagnostic = "Chromium command readiness acknowledgement timed out";
    const run = await runCommandFixture("cleanup-ack-timeout", {
      expectSupervisorStart: false,
      expectWorkerReady: false,
      observeSupervisorStart: true,
      omitReadyAcknowledgement: true,
      resultTimeoutMs: 1_000,
    });

    expect(run.message).toMatchObject({
      deadmanActivated: false,
      finalCleanupComplete: true,
      primaryFailures: [diagnostic],
      supervisorNoStartReason: diagnostic,
      supervisorObservationComplete: true,
      supervisorState: "SKIPPED",
    });
    expect(run.observerEvidence).toMatchObject({
      readyAcknowledgementStarted: false,
      readyObserved: true,
      supervisorStartObserved: false,
      workerReadyObserved: false,
    });
    expect(run.markerCounts).toEqual({
      deadman: 0,
      killAttempted: 0,
      spawn: 0,
    });
    expect(run.processState).toEqual({});
    expect(run.resultFailure).toBeUndefined();
    expect(run.watchdogFired).toBe(false);
    expect(run.markerEofProven).toBe(true);
    expect(run.absenceProven).toBe(true);
    expect(run.commandExit.signal).toBeNull();
    expect(run.rootRemoved).toBe(true);
  });

  it("observes removal of the readiness acknowledgement deadline as red and cleans naturally", async () => {
    const run = await runCommandFixture("cleanup-ack-timeout", {
      commandMutations: [
        {
          anchor: readinessDeadlineAnchor,
          label: "command readiness acknowledgement deadline",
          replacement: "    const readiness = await readinessAcknowledged;",
          targetUrl: commandFixtureUrl,
        },
      ],
      expectSupervisorStart: false,
      expectWorkerReady: false,
      observeSupervisorStart: true,
      omitReadyAcknowledgement: true,
      resultTimeoutMs: 500,
    });

    expect(run.watchdogFired).toBe(true);
    expect(run.resultFailure?.message).toBe(
      "Chromium command result timed out",
    );
    expect(run.message).toMatchObject({
      deadmanActivated: false,
      finalCleanupComplete: true,
      supervisorObservationComplete: true,
      supervisorState: "SKIPPED",
    });
    expect(run.observerEvidence).toMatchObject({
      readyAcknowledgementStarted: false,
      readyObserved: true,
      supervisorStartObserved: false,
      workerReadyObserved: false,
    });
    expect(run.markerCounts).toEqual({
      deadman: 0,
      killAttempted: 0,
      spawn: 0,
    });
    expect(run.processState).toEqual({});
    expect(run.markerEofProven).toBe(true);
    expect(run.absenceProven).toBe(true);
    expect(run.commandExit.signal).toBeNull();
    expect(run.rootRemoved).toBe(true);
  });

  it("settles an already-aborted supervisor without spawning an owner", async () => {
    const run = await runCommandFixture("cleanup-ack-timeout", {
      commandMutations: [
        {
          anchor: preStartAnchor,
          label: "command fixture pre-start cancellation",
          replacement:
            "    cancellation.abort();\n    const supervisor = startSupervisorOnce();",
          targetUrl: commandFixtureUrl,
        },
      ],
      expectWorkerReady: false,
      observeSupervisorStart: true,
      resultTimeoutMs: 2_000,
    });

    expect(run.message).toMatchObject({
      deadmanActivated: false,
      finalCleanupComplete: true,
      supervisorObservationComplete: true,
      supervisorState: "SETTLED",
    });
    expect(run.observerEvidence.supervisorStartObserved).toBe(true);
    expect(run.markerCounts).toEqual({
      deadman: 0,
      killAttempted: 0,
      spawn: 0,
    });
    expect(run.processState).toEqual({});
    expect(run.markerEofProven).toBe(true);
    expect(run.absenceProven).toBe(true);
    expect(run.commandExit.signal).toBeNull();
    expect(run.rootRemoved).toBe(true);
  });
});

describe("Chromium executable worker exit-code boundary", () => {
  it.each([256, -256, 65536])(
    "rejects generated owner worker code %i before main assigns process.exitCode",
    async (workerCode) => {
      const run = await runExecutableWorkerCode(workerCode);

      expect(run.exit).toEqual({ code: 1, signal: null });
      expect(run.stdout).toBe("");
      expect(run.stderr).toBe(
        "Chromium preflight cleanup protocol error: received a malformed worker outcome.\n",
      );
      expect(run.state).toMatchObject({
        argv: [process.execPath, run.ownerPath, workerPath],
        cleanupProtocolErrorReceived: true,
        deadlineActivated: false,
        execArgv: [],
        mutationSelectorEnvironment: [],
        normalExitObserved: true,
        readySent: true,
        receivedMessages: [
          { type: "start" },
          { type: "cleanup-protocol-error" },
          { type: "disconnect" },
        ],
        sendCallbackFailures: [],
        termResultSent: false,
        terminationRoute: "cleanup-protocol-error-disconnect",
      });
      expect(run.preloadPropagated).toBe(false);
      expect(run.ownerAbsent).toBe(true);
      expect(run.streamsEnded).toBe(true);
      expect(run.rootRemoved).toBe(true);
    },
    15_000,
  );

  it.each([256, -256, 65536])(
    "observes the integer-only predicate mutant for worker code %i",
    async (workerCode) => {
      const run = await runExecutableWorkerCode(workerCode, {
        restoreIntegerOnlyPredicate: true,
      });

      expect(run.exit).toEqual({ code: 0, signal: null });
      expect(run.stdout).toBe("");
      expect(run.stderr).toBe("fixed generated owner worker stderr\n");
      expect(run.state).toMatchObject({
        argv: [process.execPath, run.ownerPath, workerPath],
        cleanupProtocolErrorReceived: false,
        deadlineActivated: false,
        execArgv: [],
        mutationSelectorEnvironment: [],
        normalExitObserved: true,
        readySent: true,
        receivedMessages: [
          { type: "start" },
          { phase: "term", type: "cleanup-request" },
          { type: "disconnect" },
        ],
        sendCallbackFailures: [],
        termResultSent: true,
        terminationRoute: "term-result-disconnect",
      });
      expect(run.preloadPropagated).toBe(false);
      expect(run.ownerAbsent).toBe(true);
      expect(run.streamsEnded).toBe(true);
      expect(run.rootRemoved).toBe(true);
    },
    15_000,
  );
});

describe("Chromium preflight", () => {
  it.each([
    ["succeeds", 0, ""],
    ["fails", 7, "Chromium launch denied"],
  ])(
    "returns the %s worker outcome after owner cleanup",
    async (mode, code, text) => {
      const run = await runRealSupervisor(mode);

      expect(run.result.code).toBe(code);
      expect(run.result.stderr).toContain(text);
      expect(run.markerCounts).toEqual({ deadman: 0, spawn: 1 });
      expect(run.deadmanActivated).toBe(false);
    },
  );

  it.each([
    ["succeeds-with-descendant", 0, false],
    ["fails-with-descendant", 7, false],
    ["leader-exits-on-term-with-descendant", 1, true],
    ["ignores-term-with-descendant", 1, true],
  ])(
    "removes the %s fixture tree before resolving",
    async (mode, code, holdWorkerDeadline) => {
      const run = await runRealSupervisor(mode, {
        holdWorkerDeadline,
        timeoutMs: holdWorkerDeadline ? 250 : 1_000,
      });

      expect(run.result.code).toBe(code);
      expect(run.markerCounts).toEqual({ deadman: 0, spawn: 1 });
      expect(run.deadmanActivated).toBe(false);
      expect(
        run.workerMessages.some((message) => message?.type === "fixture-ready"),
      ).toBe(true);
      if (holdWorkerDeadline) {
        expect(run.workerDeadline).toMatchObject({
          captured: true,
          fired: true,
          fixtureReadyRecordedBeforeFire: true,
        });
        expect(run.workerDeadline.delegatedDelays).toEqual(
          expect.arrayContaining([20, 100, 200]),
        );
      } else {
        expect(run.workerDeadline).toBeUndefined();
      }
    },
  );

  it.each([
    ["cleanup-send-failure", "could not send its SIGTERM cleanup request"],
    ["cleanup-ack-timeout", "did not report the SIGTERM result"],
  ])(
    "hands off %s cleanup and lets the command exit naturally",
    async (mode, diagnostic) => {
      const run = await runCommandFixture(mode);

      expect(run.watchdogFired).toBe(false);
      expect(run.message.result.code).toBe(1);
      expect(run.message.result.stderr).toContain("timed out after 250ms");
      expect(run.message.result.stderr).toContain(diagnostic);
      expect(run.message).toMatchObject({
        absenceConfirmed: true,
        deadmanActivated: false,
        deadmanMarkerCount: 0,
        handoffOccurred: true,
        ownerChannelUnreferenced: true,
        ownerConnected: false,
        ownerDisconnected: true,
        ownerStderrDestroyed: true,
        ownerUnreferenced: true,
        primaryFailureCount: 0,
        spawnMarkerCount: 1,
      });
      expect(run.markerEofProven).toBe(true);
      expect(
        run.message.lifecycleOrder.indexOf("handoff-occurred"),
      ).toBeLessThan(run.message.lifecycleOrder.indexOf("owner-disconnect"));
    },
  );

  it("acknowledges an outer abort only after cancellation handoff", async () => {
    const run = await runCommandFixture("cleanup-ack-timeout", {
      abortAfterReady: true,
    });

    expect(run.watchdogFired).toBe(false);
    expect(run.abortAcknowledgement).toMatchObject({
      handoffRecorded: true,
      token: expect.stringMatching(/^command-/),
      type: "test-abort-ack",
    });
    const order = run.abortAcknowledgement.lifecycleOrder;
    expect(order.indexOf("primary-failure-recorded")).toBeLessThan(
      order.indexOf("cleanup-watch-armed"),
    );
    expect(order.indexOf("cleanup-watch-armed")).toBeLessThan(
      order.indexOf("cancellation-abort"),
    );
    expect(order.indexOf("cancellation-abort")).toBeLessThan(
      order.indexOf("handoff-observed"),
    );
    expect(order.indexOf("handoff-observed")).toBeLessThan(
      order.indexOf("abort-ack-send-start"),
    );
    expect(run.message).toMatchObject({
      abortTaskCreations: 1,
      cleanupWatchStarts: 1,
      finalCleanupComplete: true,
      fixtureProcessesAbsent: true,
    });
    expect(run.markerCounts.deadman).toBe(0);
    expect(run.rootRemoved).toBe(true);
  });

  it("keeps cleanup watching after abort acknowledgement callback failure", async () => {
    const run = await runCommandFixture("cleanup-ack-timeout", {
      abortAfterReady: true,
      disconnectAfterAcknowledgement: true,
      forceAcknowledgementFailure: true,
      resultTimeoutMs: 1_000,
    });

    expect(run.abortAcknowledgement).toMatchObject({
      handoffRecorded: true,
      type: "test-abort-ack",
    });
    const order = run.abortAcknowledgement.lifecycleOrder;
    expect(order.indexOf("cleanup-watch-armed")).toBeLessThan(
      order.indexOf("abort-ack-send-start"),
    );
    expect(run.message).toMatchObject({
      abortRequestCount: 2,
      abortTaskCreations: 1,
      abortTaskReuses: 1,
      cleanupWatchStarts: 1,
      finalCleanupComplete: true,
      fixtureProcessesAbsent: true,
      outerDisconnected: true,
    });
    expect(run.message.primaryFailures).toContain(
      "fixed abort acknowledgement callback failure",
    );
    expect(run.markerCounts).toEqual({
      deadman: 0,
      killAttempted: 0,
      spawn: 1,
    });
    expect(run.absenceProven).toBe(true);
    expect(run.commandExit.signal).toBeNull();
    expect(run.rootRemoved).toBe(true);
  });

  it.each(commandFixtureMutants)(
    "observes the $id real-process mutant as red and still cleans its tree",
    async (mutant) => {
      const run = await runCommandFixture("cleanup-ack-timeout", {
        abortAfterReady: true,
        commandMutations: mutant.target === "command" ? [mutant.mutation] : [],
        ownerMutations: mutant.target === "owner" ? [mutant.mutation] : [],
        resultTimeoutMs: 1_000,
        ...mutant.runOptions,
      });

      mutant.verifyRed(run);
      expect(run.markerCounts.deadman).toBe(mutant.expectedDeadmanCount);
      expect(run.markerCounts.killAttempted).toBe(0);
      expect(mutant.expectedSpawnCounts ?? [1]).toContain(
        run.markerCounts.spawn,
      );
      expect(run.markerEofProven).toBe(true);
      expect(run.absenceProven).toBe(true);
      expect(run.commandExit.signal).toBeNull();
      expect(run.rootRemoved).toBe(true);
    },
    12_000,
  );

  it("strips ambient KILL failure injection in ordinary command and supervisor helpers", async () => {
    const sourceEnvironment = {
      ...process.env,
      [TEST_KILL_FAILURE]: "1",
    };

    const [commandRun, supervisorRun] = await Promise.all([
      runCommandFixture("cleanup-ack-timeout", { sourceEnvironment }),
      runRealSupervisor("succeeds", { sourceEnvironment }),
    ]);

    expect(commandRun.markerCounts).toEqual({
      deadman: 0,
      killAttempted: 0,
      spawn: 1,
    });
    expect(commandRun.message).toMatchObject({
      deadmanActivated: false,
      finalCleanupComplete: true,
      fixtureProcessesAbsent: true,
    });
    expect(commandRun.absenceProven).toBe(true);
    expect(commandRun.rootRemoved).toBe(true);
    expect(supervisorRun.result).toEqual({ code: 0, stderr: "" });
    expect(supervisorRun.markerCounts).toEqual({ deadman: 0, spawn: 1 });
    expect(supervisorRun.deadmanActivated).toBe(false);
  });
});
