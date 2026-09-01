import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  createGroupOwnerController,
  SPAWN_BOUNDARY_MARKER,
  TEST_DEADMAN_FD,
  TEST_DEADMAN_MARKER,
  TEST_KILL_ATTEMPTED_MARKER,
  TEST_KILL_FAILURE,
  TEST_SPAWN_BOUNDARY_FD,
} from "./verify-chromium-preflight-group-owner.mjs";
import { runChromiumPreflight } from "./verify-chromium-preflight.mjs";

const groupOwnerPath = resolve(
  process.cwd(),
  "scripts/verify-chromium-preflight-group-owner.mjs",
);
const processFixturePath = resolve(
  process.cwd(),
  "scripts/fixtures/chromium-preflight-process-fixture.mjs",
);
const markerTypes = new Set([
  SPAWN_BOUNDARY_MARKER,
  TEST_KILL_ATTEMPTED_MARKER,
  TEST_DEADMAN_MARKER,
]);
const supervisorTiming = {
  absenceProbeIntervalMs: 1,
  cleanupVerificationTimeoutMs: 60,
  disconnectObservationTimeoutMs: 50,
  forceKillDelayMs: 20,
  killArmTimeoutMs: 30,
  ownerCloseWaitMs: 40,
  termResultTimeoutMs: 10,
  timeoutMs: 100,
};

function processError(code, message = code) {
  return Object.assign(new Error(message), { code });
}

function withWatchdog(promise, description, timeoutMs = 4_000) {
  return new Promise((resolveWait, rejectWait) => {
    const watchdog = setTimeout(
      () => rejectWait(new Error(`${description} timed out`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(watchdog);
        resolveWait(value);
      },
      (error) => {
        clearTimeout(watchdog);
        rejectWait(error);
      },
    );
  });
}

function manualTimers() {
  const tasks = [];
  const scheduleTimer = vi.fn((callback, delay) => {
    const task = { active: true, callback, delay };
    tasks.push(task);
    return task;
  });
  const cancelTimer = vi.fn((task) => {
    if (task) task.active = false;
  });
  const run = (delay) => {
    const task = tasks.find(
      (candidate) => candidate.active && candidate.delay === delay,
    );
    if (!task) throw new Error(`No active ${delay}ms timer`);
    task.active = false;
    task.callback();
  };
  const runAll = (delay) => {
    for (const task of tasks.filter(
      (candidate) => candidate.active && candidate.delay === delay,
    )) {
      task.active = false;
      task.callback();
    }
  };
  return { cancelTimer, run, runAll, scheduleTimer, tasks };
}

function createOwnerControllerHarness({
  sendImpl,
  signalOwnGroup = vi.fn(),
  spawnWorker = vi.fn(),
} = {}) {
  const timers = manualTimers();
  const sent = [];
  let disconnectHandler;
  let messageHandler;
  const send =
    sendImpl ??
    vi.fn((message, callback) => {
      sent.push({ callback, message });
      return true;
    });
  const controller = createGroupOwnerController({
    cancelTimer: timers.cancelTimer,
    disconnectForceDelayMs: 15,
    environment: {},
    onDisconnect: (handler) => {
      disconnectHandler = handler;
    },
    onMessage: (handler) => {
      messageHandler = handler;
    },
    onSigterm: () => {},
    ownerPid: 9123,
    scheduleTimer: timers.scheduleTimer,
    send,
    signalOwnGroup,
    spawnWorker,
    workerArguments: [],
    workerPath: "/fixture-worker.mjs",
  });
  controller.start();
  if (sent[0]) sent[0].callback?.(null);
  sent.length = 0;
  return {
    controller,
    disconnect: () => disconnectHandler(),
    message: (message) => messageHandler(message),
    sent,
    signalOwnGroup,
    timers,
  };
}

function prepareOwnerKill(harness, { termStatus = "dispatched" } = {}) {
  harness.message({ phase: "term", requestId: 1, type: "cleanup-request" });
  const termMessage = harness.sent.at(-1);
  expect(termMessage.message).toMatchObject({
    requestId: 1,
    status: termStatus,
    type: "cleanup-term-result",
  });
  termMessage.callback?.(null);
  harness.sent.length = 0;
  harness.message({ phase: "kill", requestId: 2, type: "cleanup-request" });
  const acknowledgement = harness.sent.at(-1);
  expect(acknowledgement.message).toEqual({
    requestId: 2,
    type: "cleanup-kill-armed",
  });
  return acknowledgement;
}

function createIndependentDeadman() {
  let activated = false;
  let attempts = 0;
  return {
    activate: () => {
      if (activated) return;
      activated = true;
      attempts += 1;
    },
    snapshot: () => ({ activated, attempts }),
  };
}

class FakeOwner extends EventEmitter {
  constructor(pid = 4321) {
    super();
    this.channel = { unref: vi.fn() };
    this.connected = true;
    this.disconnect = vi.fn(() => {
      this.connected = false;
    });
    this.kill = vi.fn(() => {
      throw new Error("Parent-side kill is forbidden");
    });
    this.pid = pid;
    this.sent = [];
    this.stderr = new EventEmitter();
    this.stderr.destroy = vi.fn();
    this.unref = vi.fn();
  }

  send(message, callback) {
    this.sent.push({ callback, message });
    return true;
  }
}

function createSupervisorHarness({
  owner = new FakeOwner(),
  observeLifecycle = vi.fn(),
  probeGroup = vi.fn(() => {
    throw processError("ESRCH");
  }),
  testCancellationSignal,
} = {}) {
  const timers = manualTimers();
  const result = runChromiumPreflight({
    ...supervisorTiming,
    cancelTimer: timers.cancelTimer,
    observeLifecycle,
    probeGroup,
    scheduleTimer: timers.scheduleTimer,
    spawnOwner: () => owner,
    testCancellationSignal,
  });
  return { observeLifecycle, owner, probeGroup, result, timers };
}

function ownerReady(harness) {
  harness.owner.emit("message", { type: "owner-ready" });
}

function workerOutcome(harness, code = 0, stderr = "") {
  harness.owner.emit("message", { code, stderr, type: "worker-outcome" });
}

function latestRequest(harness, phase) {
  return harness.owner.sent
    .map((entry) => entry.message)
    .findLast(
      (message) =>
        message.type === "cleanup-request" && message.phase === phase,
    );
}

async function finishSupervisorCleanup(harness, termStatus = "dispatched") {
  const term = latestRequest(harness, "term");
  harness.owner.emit("message", {
    ...(termStatus === "failed" ? { diagnostic: "fixed TERM failure" } : {}),
    requestId: term.requestId,
    status: termStatus,
    type: "cleanup-term-result",
  });
  harness.timers.run(supervisorTiming.forceKillDelayMs);
  const kill = latestRequest(harness, "kill");
  harness.owner.emit("message", {
    requestId: kill.requestId,
    type: "cleanup-kill-armed",
  });
  harness.owner.emit("exit", null, "SIGKILL");
  return harness.result;
}

function observeGroupAbsence(
  groupId,
  probeGroup = (targetGroupId, signal) => process.kill(-targetGroupId, signal),
) {
  try {
    probeGroup(groupId, 0);
    return { absent: false };
  } catch (error) {
    if (error.code === "ESRCH") return { absent: true };
    return { absent: false, observation: error };
  }
}

async function requireGroupAbsent(
  groupId,
  {
    attemptLimit = 200,
    probeGroup,
    wait = () => new Promise((resolveWait) => setTimeout(resolveWait, 10)),
  } = {},
) {
  let latestObservation;
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    const observation = observeGroupAbsence(groupId, probeGroup);
    if (observation.absent) return;
    if (observation.observation !== undefined) {
      latestObservation = observation.observation;
    }
    await wait();
  }
  const diagnostic = latestObservation
    ? ` Last non-ESRCH signal-zero observation: ${latestObservation.code ?? "unknown"}: ${latestObservation.message ?? String(latestObservation)}.`
    : "";
  throw new Error(
    `Chromium owner group ${groupId} remained present.${diagnostic}`,
    latestObservation === undefined ? undefined : { cause: latestObservation },
  );
}

function createMarkerReader(stream) {
  const counts = new Map([...markerTypes].map((marker) => [marker, 0]));
  const waiters = new Map();
  let buffer = "";
  let failure;
  let ended = false;
  let resolveEnd;
  const endPromise = new Promise((resolve) => {
    resolveEnd = resolve;
  });
  const fail = (error) => {
    failure ??= error;
    for (const waiting of waiters.values()) waiting.reject(failure);
    waiters.clear();
  };
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const marker = buffer.slice(0, newline + 1);
      buffer = buffer.slice(newline + 1);
      if (!markerTypes.has(marker)) {
        fail(new Error(`Unexpected Chromium test marker: ${marker}`));
        return;
      }
      const count = counts.get(marker) + 1;
      counts.set(marker, count);
      if (count > 1) {
        fail(new Error(`Duplicate Chromium test marker: ${marker}`));
        return;
      }
      waiters.get(marker)?.resolve();
      waiters.delete(marker);
      newline = buffer.indexOf("\n");
    }
  });
  stream.once("end", () => {
    ended = true;
    if (buffer.length > 0) {
      fail(new Error(`Partial Chromium test marker: ${buffer}`));
    }
    for (const [marker, waiting] of waiters) {
      waiting.reject(new Error(`Missing Chromium test marker: ${marker}`));
    }
    waiters.clear();
    resolveEnd();
  });
  return {
    count: (marker) => counts.get(marker),
    end: async () => {
      await endPromise;
      if (failure) throw failure;
    },
    waitFor: (marker) => {
      if (failure) return Promise.reject(failure);
      if (counts.get(marker) === 1) return Promise.resolve();
      if (ended) {
        return Promise.reject(
          new Error(`Missing Chromium test marker: ${marker}`),
        );
      }
      return new Promise((resolveMarker, rejectMarker) => {
        waiters.set(marker, { reject: rejectMarker, resolve: resolveMarker });
      });
    },
  };
}

function waitForOwnerMessage(owner, predicate, description) {
  return withWatchdog(
    new Promise((resolveMessage, rejectMessage) => {
      const cleanup = () => {
        owner.off("message", onMessage);
        owner.off("error", onError);
        owner.off("exit", onExit);
      };
      const onMessage = (message) => {
        if (!predicate(message)) return;
        cleanup();
        resolveMessage(message);
      };
      const onError = (error) => {
        cleanup();
        rejectMessage(error);
      };
      const onExit = () => {
        cleanup();
        rejectMessage(new Error(`${description} owner exited first`));
      };
      owner.on("message", onMessage);
      owner.once("error", onError);
      owner.once("exit", onExit);
    }),
    description,
  );
}

function createRealOwner({
  killFailure = false,
  mode = "succeeds",
  sourceEnvironment = process.env,
} = {}) {
  const stateRoot = mkdtempSync(
    join(tmpdir(), "rentcottage-issue-147-chromium-"),
  );
  const statePath = join(stateRoot, "processes.json");
  const ownerEnvironment = { ...sourceEnvironment };
  delete ownerEnvironment[TEST_KILL_FAILURE];
  ownerEnvironment[TEST_DEADMAN_FD] = "5";
  ownerEnvironment[TEST_SPAWN_BOUNDARY_FD] = "4";
  if (killFailure) ownerEnvironment[TEST_KILL_FAILURE] = "1";
  const owner = spawn(
    process.execPath,
    [groupOwnerPath, processFixturePath, mode, statePath, "4", "5"],
    {
      detached: true,
      env: ownerEnvironment,
      stdio: ["ignore", "ignore", "pipe", "ipc", "pipe", "pipe"],
    },
  );
  const markers = createMarkerReader(owner.stdio[4]);
  const control = owner.stdio[5];
  control.on("error", () => {});
  let deadmanActivated = false;
  let primaryFailureRecorded = false;
  const terminated = withWatchdog(
    new Promise((resolveTermination) => owner.once("exit", resolveTermination)),
    "Chromium group-owner termination",
  );
  return {
    activateDeadman: async () => {
      if (!primaryFailureRecorded) {
        throw new Error(
          "Chromium test deadman requires a recorded primary failure",
        );
      }
      if (
        deadmanActivated ||
        owner.exitCode !== null ||
        owner.signalCode !== null
      ) {
        return;
      }
      deadmanActivated = true;
      const marker = markers.waitFor(TEST_DEADMAN_MARKER);
      control.end();
      await marker;
    },
    control,
    deadmanActivated: () => deadmanActivated,
    markers,
    owner,
    recordPrimaryFailure: () => {
      primaryFailureRecorded = true;
    },
    statePath,
    stateRoot,
    terminated,
  };
}

async function runRealOwnerCase(options, operation) {
  const fixture = createRealOwner(options);
  let cleanupFailure;
  let primaryFailure;
  try {
    await operation(fixture);
  } catch (error) {
    primaryFailure = error;
    fixture.recordPrimaryFailure();
  }
  try {
    if (fixture.owner.exitCode === null && fixture.owner.signalCode === null) {
      if (!primaryFailure) {
        primaryFailure = new Error(
          "Chromium group owner remained live after the test operation",
        );
        fixture.recordPrimaryFailure();
      }
      await fixture.activateDeadman();
    }
    await fixture.terminated;
    await fixture.markers.end();
    await requireGroupAbsent(fixture.owner.pid);
  } catch (error) {
    cleanupFailure = error;
  } finally {
    fixture.control.destroy();
    fixture.owner.stderr.destroy();
    if (!cleanupFailure)
      rmSync(fixture.stateRoot, { force: true, recursive: true });
  }
  if (primaryFailure && cleanupFailure) {
    throw new AggregateError(
      [primaryFailure, cleanupFailure],
      "Chromium real-owner assertion and cleanup failed",
    );
  }
  if (primaryFailure) throw primaryFailure;
  if (cleanupFailure) throw cleanupFailure;
}

describe("real owner absence observation helper", () => {
  it("keeps polling after a non-ESRCH observation and passes only on ESRCH", async () => {
    const probeGroup = vi
      .fn()
      .mockImplementationOnce(() => {
        throw processError("EPERM", "transient permission observation");
      })
      .mockReturnValueOnce(undefined)
      .mockImplementationOnce(() => {
        throw processError("ESRCH", "group is absent");
      });
    const wait = vi.fn(async () => {});

    await expect(
      requireGroupAbsent(9123, { attemptLimit: 3, probeGroup, wait }),
    ).resolves.toBeUndefined();

    expect(probeGroup.mock.calls).toEqual([
      [9123, 0],
      [9123, 0],
      [9123, 0],
    ]);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it("fails at the bounded deadline with the latest non-ESRCH observation", async () => {
    const firstObservation = processError("EPERM", "first observation");
    const latestObservation = processError("EACCES", "latest observation");
    const probeGroup = vi
      .fn()
      .mockImplementationOnce(() => {
        throw firstObservation;
      })
      .mockImplementationOnce(() => {
        throw latestObservation;
      });
    const wait = vi.fn(async () => {});
    let failure;

    try {
      await requireGroupAbsent(9123, {
        attemptLimit: 2,
        probeGroup,
        wait,
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      cause: latestObservation,
      message: expect.stringContaining(
        "Last non-ESRCH signal-zero observation: EACCES: latest observation",
      ),
    });
    expect(probeGroup).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(2);
  });
});

describe("Chromium group-owner controller", () => {
  it("caches an exact TERM result and arms one KILL attempt", () => {
    const harness = createOwnerControllerHarness();

    harness.message({ phase: "term", requestId: 1, type: "cleanup-request" });
    harness.message({ phase: "term", requestId: 1, type: "cleanup-request" });

    expect(harness.signalOwnGroup.mock.calls).toEqual([["SIGTERM"]]);
    expect(harness.sent.map(({ message }) => message)).toEqual([
      { requestId: 1, status: "dispatched", type: "cleanup-term-result" },
      { requestId: 1, status: "dispatched", type: "cleanup-term-result" },
    ]);
    harness.sent.at(-1).callback(null);
    harness.sent.length = 0;
    harness.message({ phase: "kill", requestId: 2, type: "cleanup-request" });

    expect(harness.controller.snapshot()).toMatchObject({
      killArmed: true,
      killAttempted: false,
      startGateClosed: true,
      termAttempted: true,
    });
    harness.sent[0].callback(null);
    expect(harness.signalOwnGroup.mock.calls).toEqual([
      ["SIGTERM"],
      ["SIGKILL"],
    ]);
    expect(harness.controller.snapshot()).toMatchObject({
      killArmed: true,
      killAttempted: true,
    });
  });

  it.each([
    "callback-then-disconnect",
    "disconnect-then-callback",
    "callback-error-then-disconnect",
    "disconnect-then-callback-error",
    "duplicate-callback",
  ])("dispatches one production KILL for %s", (order) => {
    const harness = createOwnerControllerHarness();
    const acknowledgement = prepareOwnerKill(harness);
    const callback = (error = null) => acknowledgement.callback(error);

    if (order === "callback-then-disconnect") {
      callback();
      harness.disconnect();
    } else if (order === "disconnect-then-callback") {
      harness.disconnect();
      callback();
    } else if (order === "callback-error-then-disconnect") {
      callback(new Error("fixed callback failure"));
      harness.disconnect();
    } else if (order === "disconnect-then-callback-error") {
      harness.disconnect();
      callback(new Error("fixed callback failure"));
    } else {
      callback();
      callback();
    }

    expect(
      harness.signalOwnGroup.mock.calls.filter(
        ([signal]) => signal === "SIGKILL",
      ),
    ).toHaveLength(1);
    expect(harness.controller.snapshot()).toMatchObject({
      killArmed: true,
      killAttempted: true,
    });
  });

  it("uses the disconnect force timer once and ignores a late KILL request", () => {
    const harness = createOwnerControllerHarness();
    harness.message({ phase: "term", requestId: 1, type: "cleanup-request" });
    harness.sent.at(-1).callback(null);
    harness.sent.length = 0;
    harness.disconnect();
    harness.timers.run(15);
    harness.message({ phase: "kill", requestId: 2, type: "cleanup-request" });

    expect(harness.signalOwnGroup.mock.calls).toEqual([
      ["SIGTERM"],
      ["SIGKILL"],
    ]);
    expect(harness.sent).toEqual([]);
  });

  it.each(
    [
      "force-before-callback",
      "callback-before-force",
      "callback-before-force-with-stale-timer",
    ].flatMap((order) =>
      [false, true].map((killThrows) => [order, killThrows]),
    ),
  )("keeps one production KILL when %s and thrown=%s", (order, killThrows) => {
    const failure = new Error("fixed retained-callback KILL failure");
    const signalOwnGroup = vi.fn((signal) => {
      if (signal === "SIGKILL" && killThrows) throw failure;
    });
    const harness = createOwnerControllerHarness({ signalOwnGroup });
    harness.message({
      phase: "term",
      requestId: 1,
      type: "cleanup-request",
    });
    const retainedCallback = harness.sent.at(-1).callback;
    harness.disconnect();
    const forceTimer = harness.timers.tasks.find(({ delay }) => delay === 15);

    if (order === "force-before-callback") {
      harness.timers.run(15);
      retainedCallback(null);
    } else {
      retainedCallback(null);
      harness.timers.run(15);
    }
    if (order === "callback-before-force-with-stale-timer") {
      forceTimer.callback();
    }

    expect(
      signalOwnGroup.mock.calls.filter(([signal]) => signal === "SIGKILL"),
    ).toHaveLength(1);
    expect(harness.controller.snapshot()).toMatchObject({
      disconnectObserved: true,
      killArmed: true,
      killAttempted: true,
      killFailure: killThrows ? failure : undefined,
      termAttempted: true,
    });
  });

  it.each([
    "callback-then-disconnect",
    "disconnect-then-callback",
    "callback-error-then-disconnect",
    "disconnect-then-callback-error",
    "duplicate-callback",
  ])("never retries a thrown production KILL for %s", (order) => {
    const failure = new Error("fixed KILL failure");
    const signalOwnGroup = vi.fn((signal) => {
      if (signal === "SIGKILL") throw failure;
    });
    const harness = createOwnerControllerHarness({ signalOwnGroup });
    const acknowledgement = prepareOwnerKill(harness);
    const callback = (error = null) => acknowledgement.callback(error);

    if (order === "callback-then-disconnect") {
      callback();
      harness.disconnect();
    } else if (order === "disconnect-then-callback") {
      harness.disconnect();
      callback();
    } else if (order === "callback-error-then-disconnect") {
      callback(new Error("fixed callback failure"));
      harness.disconnect();
    } else if (order === "disconnect-then-callback-error") {
      harness.disconnect();
      callback(new Error("fixed callback failure"));
    } else {
      callback();
      callback();
    }
    harness.timers.runAll(15);

    expect(
      signalOwnGroup.mock.calls.filter(([signal]) => signal === "SIGKILL"),
    ).toHaveLength(1);
    expect(harness.controller.snapshot().killFailure).toBe(failure);
  });

  it.each(
    [
      "deadman-before-late-callback",
      "production-dispatch-before-deadman",
    ].flatMap((order) =>
      [false, true].map((killThrows) => [order, killThrows]),
    ),
  )(
    "separates independent deadman order %s with thrown=%s",
    (order, killThrows) => {
      const failure = new Error("fixed deadman-order KILL failure");
      const signalOwnGroup = vi.fn((signal) => {
        if (signal === "SIGKILL" && killThrows) throw failure;
      });
      const harness = createOwnerControllerHarness({ signalOwnGroup });
      const deadman = createIndependentDeadman();
      const acknowledgement = prepareOwnerKill(harness);

      if (order === "deadman-before-late-callback") {
        deadman.activate();
        acknowledgement.callback(null);
      } else {
        harness.disconnect();
        deadman.activate();
        acknowledgement.callback(null);
      }

      expect(
        signalOwnGroup.mock.calls.filter(([signal]) => signal === "SIGKILL"),
      ).toHaveLength(1);
      expect(deadman.snapshot()).toEqual({ activated: true, attempts: 1 });
      expect(harness.controller.snapshot()).toMatchObject({
        killArmed: true,
        killAttempted: true,
        killFailure: killThrows ? failure : undefined,
      });
      expect(harness.signalOwnGroup.mock.calls).not.toContainEqual([0]);
    },
  );

  it("reports malformed and out-of-order requests without acquiring authority", () => {
    const harness = createOwnerControllerHarness();

    harness.message({ phase: "kill", requestId: 1, type: "cleanup-request" });
    harness.message({ phase: "term", requestId: 0, type: "cleanup-request" });

    expect(harness.signalOwnGroup).not.toHaveBeenCalled();
    expect(harness.sent.map(({ message }) => message.type)).toEqual([
      "cleanup-protocol-error",
      "cleanup-protocol-error",
    ]);
  });

  it.each([undefined, null, 0, false])(
    "retains a falsy owner signal failure %#",
    (failure) => {
      const signalOwnGroup = vi.fn(() => {
        throw failure;
      });
      const harness = createOwnerControllerHarness({ signalOwnGroup });

      harness.message({ phase: "term", requestId: 1, type: "cleanup-request" });

      expect(harness.sent.at(-1).message).toEqual({
        diagnostic: `Chromium preflight owner could not send SIGTERM: ${String(failure)}`,
        requestId: 1,
        status: "failed",
        type: "cleanup-term-result",
      });
      expect(harness.controller.snapshot().termAttempted).toBe(true);
    },
  );

  it("safely reports a hostile owner signal failure", () => {
    const hostile = new Proxy(Object.create(null), {
      get() {
        throw new Error("property trap");
      },
      getPrototypeOf() {
        throw new Error("prototype trap");
      },
    });
    const harness = createOwnerControllerHarness({
      signalOwnGroup: () => {
        throw hostile;
      },
    });

    harness.message({ phase: "term", requestId: 1, type: "cleanup-request" });

    expect(harness.sent.at(-1).message.diagnostic).toContain(
      "<unprintable thrown value>",
    );
  });

  it.each([undefined, null, 0, false])(
    "treats a falsy owner-send throw as disconnect cleanup %#",
    (failure) => {
      const signalOwnGroup = vi.fn();
      const harness = createOwnerControllerHarness({
        sendImpl: () => {
          throw failure;
        },
        signalOwnGroup,
      });

      harness.timers.run(15);

      expect(signalOwnGroup.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
      expect(harness.controller.snapshot()).toMatchObject({
        disconnectObserved: true,
        killArmed: true,
        killAttempted: true,
        termAttempted: true,
      });
    },
  );
});

describe("Chromium preflight supervisor protocol", () => {
  it("uses only owner IPC when cleanup starts before readiness", () => {
    const harness = createSupervisorHarness();

    harness.timers.run(supervisorTiming.timeoutMs);

    expect(harness.owner.sent.map(({ message }) => message)).toEqual([
      { phase: "term", requestId: 1, type: "cleanup-request" },
    ]);
    expect(harness.owner.kill).not.toHaveBeenCalled();
  });

  it("preserves the worker outcome through exact TERM/KILL acknowledgements", async () => {
    const harness = createSupervisorHarness();
    ownerReady(harness);
    workerOutcome(harness, 7, "launch denied");

    await finishSupervisorCleanup(harness);

    await expect(harness.result).resolves.toEqual({
      code: 7,
      stderr: "launch denied",
    });
    expect(harness.owner.sent.map(({ message }) => message)).toEqual([
      { type: "start" },
      { phase: "term", requestId: 1, type: "cleanup-request" },
      { phase: "kill", requestId: 2, type: "cleanup-request" },
    ]);
    expect(harness.probeGroup).toHaveBeenCalledExactlyOnceWith(
      harness.owner.pid,
      0,
    );
    expect(harness.owner.kill).not.toHaveBeenCalled();
  });

  it("keeps timeout as the first cause and ignores a late outcome/readiness", async () => {
    const harness = createSupervisorHarness();
    harness.timers.run(supervisorTiming.timeoutMs);
    ownerReady(harness);
    workerOutcome(harness, 7, "late launch failure");

    await finishSupervisorCleanup(harness);
    const result = await harness.result;

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("timed out after 100ms");
    expect(result.stderr).not.toContain("late launch failure");
    expect(
      harness.owner.sent.filter(({ message }) => message.type === "start"),
    ).toHaveLength(0);
  });

  it("retains a TERM failure while completing one KILL arm", async () => {
    const harness = createSupervisorHarness();
    ownerReady(harness);
    workerOutcome(harness);

    await finishSupervisorCleanup(harness, "failed");
    const result = await harness.result;

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("fixed TERM failure");
  });

  it("reports a stale acknowledgement once, then disconnects without signalling", async () => {
    const harness = createSupervisorHarness();
    ownerReady(harness);

    harness.owner.emit("message", {
      requestId: 99,
      status: "dispatched",
      type: "cleanup-term-result",
    });

    await expect(harness.result).resolves.toMatchObject({ code: 1 });
    expect(harness.owner.sent.map(({ message }) => message)).toEqual([
      { type: "start" },
      {
        diagnostic: "received a stale or malformed SIGTERM result.",
        type: "cleanup-protocol-error",
      },
    ]);
    expect(harness.owner.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.owner.kill).not.toHaveBeenCalled();
  });

  it.each([
    ["TERM result", supervisorTiming.termResultTimeoutMs],
    ["SIGKILL acknowledgement", supervisorTiming.killArmTimeoutMs],
    ["group-owner termination", supervisorTiming.ownerCloseWaitMs],
  ])("fails loudly when the %s deadline expires", async (phase, delay) => {
    const harness = createSupervisorHarness();
    ownerReady(harness);
    workerOutcome(harness);
    if (phase !== "TERM result") {
      const term = latestRequest(harness, "term");
      harness.owner.emit("message", {
        requestId: term.requestId,
        status: "dispatched",
        type: "cleanup-term-result",
      });
      harness.timers.run(supervisorTiming.forceKillDelayMs);
    }
    if (phase === "group-owner termination") {
      const kill = latestRequest(harness, "kill");
      harness.owner.emit("message", {
        requestId: kill.requestId,
        type: "cleanup-kill-armed",
      });
    }

    harness.timers.run(delay);
    await harness.result;

    expect(harness.owner.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.owner.kill).not.toHaveBeenCalled();
  });

  it("synchronously records handoff before test-cancellation side effects", async () => {
    const cancellation = new AbortController();
    const harness = createSupervisorHarness({
      testCancellationSignal: cancellation.signal,
    });
    ownerReady(harness);

    cancellation.abort();

    const events = harness.observeLifecycle.mock.calls.map(([event]) => event);
    const handoff = events.find((event) => event.type === "handoff-occurred");
    expect(handoff).toMatchObject({ handoffOccurred: true });
    expect(
      harness.observeLifecycle.mock.invocationCallOrder[
        events.indexOf(handoff)
      ],
    ).toBeLessThan(harness.owner.disconnect.mock.invocationCallOrder[0]);
    expect(harness.owner.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.owner.channel.unref).toHaveBeenCalledTimes(1);
    expect(harness.owner.stderr.destroy).toHaveBeenCalledTimes(1);
    expect(harness.owner.unref).toHaveBeenCalledTimes(1);
    expect(harness.owner.kill).not.toHaveBeenCalled();
    await expect(harness.result).resolves.toMatchObject({ code: 1 });
  });

  it.each([undefined, null, 0, false])(
    "treats a falsy cleanup-send throw as failure %#",
    async (failure) => {
      const owner = new FakeOwner();
      owner.send = vi.fn((message) => {
        if (message.type === "cleanup-request") throw failure;
        return true;
      });
      const harness = createSupervisorHarness({ owner });
      ownerReady(harness);
      workerOutcome(harness);

      const result = await harness.result;

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(String(failure));
      expect(owner.disconnect).toHaveBeenCalledTimes(1);
      expect(owner.kill).not.toHaveBeenCalled();
    },
  );

  it.each(
    ["disconnect", "channel-unref", "stderr-destroy", "owner-unref"].flatMap(
      (operation) =>
        [undefined, null, 0, false].map((failure) => [operation, failure]),
    ),
  )("retains a falsy %s cleanup throw %#", async (operation, failure) => {
    const cancellation = new AbortController();
    const owner = new FakeOwner();
    const throwingOperation = () => {
      throw failure;
    };
    if (operation === "disconnect") owner.disconnect = throwingOperation;
    if (operation === "channel-unref") {
      owner.channel.unref = throwingOperation;
    }
    if (operation === "stderr-destroy") {
      owner.stderr.destroy = throwingOperation;
    }
    if (operation === "owner-unref") owner.unref = throwingOperation;
    const harness = createSupervisorHarness({
      owner,
      testCancellationSignal: cancellation.signal,
    });

    cancellation.abort();
    const result = await harness.result;

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(String(failure));
    expect(owner.kill).not.toHaveBeenCalled();
  });

  it("uses only signal-zero probes and waits through present, present, ESRCH", async () => {
    const probeGroup = vi
      .fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockImplementationOnce(() => {
        throw processError("ESRCH");
      });
    const harness = createSupervisorHarness({ probeGroup });
    ownerReady(harness);
    workerOutcome(harness);
    const cleanup = finishSupervisorCleanup(harness);
    harness.timers.run(supervisorTiming.absenceProbeIntervalMs);
    harness.timers.run(supervisorTiming.absenceProbeIntervalMs);

    await cleanup;
    expect(probeGroup.mock.calls).toEqual([
      [harness.owner.pid, 0],
      [harness.owner.pid, 0],
      [harness.owner.pid, 0],
    ]);
  });

  it("keeps a hostile signal-zero failure conservative until its deadline", async () => {
    const hostile = new Proxy(Object.create(null), {
      get() {
        throw new Error("property trap");
      },
      getPrototypeOf() {
        throw new Error("prototype trap");
      },
    });
    const harness = createSupervisorHarness({
      probeGroup: () => {
        throw hostile;
      },
    });
    ownerReady(harness);
    workerOutcome(harness);
    const term = latestRequest(harness, "term");
    harness.owner.emit("message", {
      requestId: term.requestId,
      status: "dispatched",
      type: "cleanup-term-result",
    });
    harness.timers.run(supervisorTiming.forceKillDelayMs);
    const kill = latestRequest(harness, "kill");
    harness.owner.emit("message", {
      requestId: kill.requestId,
      type: "cleanup-kill-armed",
    });
    harness.owner.emit("close", null, "SIGKILL");
    harness.timers.run(supervisorTiming.cleanupVerificationTimeoutMs);

    const result = await harness.result;
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("<unprintable thrown value>");
  });

  it("strips every test seam from the default detached spawn", async () => {
    const owner = new FakeOwner();
    const spawnProcess = vi.fn(() => owner);
    const cancellation = new AbortController();
    const result = runChromiumPreflight({
      ...supervisorTiming,
      environment: {
        SAFE_VALUE: "kept",
        [TEST_DEADMAN_FD]: "5",
        [TEST_KILL_FAILURE]: "1",
        [TEST_SPAWN_BOUNDARY_FD]: "4",
      },
      probeGroup: () => {
        throw processError("ESRCH");
      },
      spawnProcess,
      testCancellationSignal: cancellation.signal,
    });

    const spawnOptions = spawnProcess.mock.calls[0][2];
    expect(spawnOptions.stdio).toEqual(["ignore", "ignore", "pipe", "ipc"]);
    expect(spawnOptions.env).toEqual({ SAFE_VALUE: "kept" });
    cancellation.abort();
    await result;
  });
});

describe("strict Chromium supervisor protocol values", () => {
  it.each([
    [0, "fixed success diagnostic"],
    [255, "fixed maximum failure"],
  ])("accepts worker exit code %i without remapping", async (code, stderr) => {
    const harness = createSupervisorHarness();
    ownerReady(harness);

    workerOutcome(harness, code, stderr);
    await finishSupervisorCleanup(harness);

    await expect(harness.result).resolves.toEqual({ code, stderr });
    expect(harness.owner.sent.map(({ message }) => message)).toEqual([
      { type: "start" },
      { phase: "term", requestId: 1, type: "cleanup-request" },
      { phase: "kill", requestId: 2, type: "cleanup-request" },
    ]);
    expect(harness.owner.kill).not.toHaveBeenCalled();
    expect(harness.probeGroup).toHaveBeenCalledExactlyOnceWith(
      harness.owner.pid,
      0,
    );
  });

  it.each([
    ["null", null, "received a malformed owner message."],
    ["missing type", {}, "received a malformed owner message."],
    ["non-string type", { type: 42 }, "received a malformed owner message."],
    ["empty type", { type: "" }, "received a malformed owner message."],
    ["whitespace type", { type: " \t" }, "received a malformed owner message."],
    [
      "unknown type",
      { type: "not-a-real-owner-message" },
      "received an unknown owner message type.",
    ],
  ])(
    "rejects a %s without silent settlement",
    async (_, message, diagnostic) => {
      const probeGroup = vi
        .fn()
        .mockReturnValueOnce(undefined)
        .mockImplementationOnce(() => {
          throw processError("ESRCH");
        });
      const harness = createSupervisorHarness({ probeGroup });

      harness.owner.emit("message", message);
      harness.owner.emit("exit", 1, null);
      harness.timers.run(supervisorTiming.absenceProbeIntervalMs);

      const result = await harness.result;
      expect(result).toEqual({
        code: 1,
        stderr: `Chromium preflight cleanup protocol error: ${diagnostic}`,
      });
      expect(result.stderr.trim()).not.toBe("");
      expect(harness.owner.sent.map(({ message: sent }) => sent)).toEqual([
        { diagnostic, type: "cleanup-protocol-error" },
      ]);
      expect(harness.owner.disconnect).toHaveBeenCalledTimes(1);
      expect(harness.owner.kill).not.toHaveBeenCalled();
      expect(harness.probeGroup.mock.calls).toEqual([
        [harness.owner.pid, 0],
        [harness.owner.pid, 0],
      ]);
    },
  );

  it.each([
    ["missing code", { stderr: "fixed worker failure" }],
    ["non-integer code", { code: 1.5, stderr: "fixed worker failure" }],
    ["negative code", { code: -1, stderr: "fixed worker failure" }],
    ["negative wrapped code", { code: -256, stderr: "fixed worker failure" }],
    ["code above 255", { code: 256, stderr: "fixed worker failure" }],
    ["large wrapped code", { code: 65536, stderr: "fixed worker failure" }],
    ["missing stderr", { code: 7 }],
    ["non-string stderr", { code: 7, stderr: 42 }],
  ])("rejects a worker outcome with %s", async (_, outcome) => {
    const probeGroup = vi
      .fn()
      .mockReturnValueOnce(undefined)
      .mockImplementationOnce(() => {
        throw processError("ESRCH");
      });
    const harness = createSupervisorHarness({ probeGroup });
    ownerReady(harness);

    harness.owner.emit("message", { ...outcome, type: "worker-outcome" });
    harness.owner.emit("exit", 1, null);
    harness.timers.run(supervisorTiming.absenceProbeIntervalMs);

    await expect(harness.result).resolves.toEqual({
      code: 1,
      stderr:
        "Chromium preflight cleanup protocol error: received a malformed worker outcome.",
    });
    expect(harness.owner.sent.map(({ message }) => message)).toEqual([
      { type: "start" },
      {
        diagnostic: "received a malformed worker outcome.",
        type: "cleanup-protocol-error",
      },
    ]);
    expect(harness.owner.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.owner.kill).not.toHaveBeenCalled();
    expect(harness.probeGroup.mock.calls).toEqual([
      [harness.owner.pid, 0],
      [harness.owner.pid, 0],
    ]);
  });

  it.each(["", " \t"])(
    "uses a stable diagnostic for non-zero worker stderr %#",
    async (stderr) => {
      const harness = createSupervisorHarness();
      ownerReady(harness);

      workerOutcome(harness, 7, stderr);
      harness.owner.emit("exit", 1, null);

      await expect(harness.result).resolves.toEqual({
        code: 7,
        stderr: "Chromium preflight worker failed without a diagnostic.",
      });
      expect(harness.owner.kill).not.toHaveBeenCalled();
      expect(harness.probeGroup.mock.calls).toEqual([[harness.owner.pid, 0]]);
    },
  );

  it.each([
    ["missing", {}],
    ["non-string", { diagnostic: 42 }],
    ["empty", { diagnostic: "" }],
    ["whitespace", { diagnostic: " \t" }],
  ])("uses a stable diagnostic for a %s TERM failure", async (_, detail) => {
    const harness = createSupervisorHarness();
    ownerReady(harness);
    workerOutcome(harness);
    const term = latestRequest(harness, "term");

    harness.owner.emit("message", {
      ...detail,
      requestId: term.requestId,
      status: "failed",
      type: "cleanup-term-result",
    });
    harness.timers.run(supervisorTiming.forceKillDelayMs);
    const kill = latestRequest(harness, "kill");
    harness.owner.emit("message", {
      requestId: kill.requestId,
      type: "cleanup-kill-armed",
    });
    harness.owner.emit("exit", null, "SIGKILL");

    await expect(harness.result).resolves.toEqual({
      code: 1,
      stderr:
        "Chromium preflight group owner reported SIGTERM failure without a diagnostic.",
    });
    expect(harness.owner.kill).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", {}],
    ["non-string", { diagnostic: 42 }],
    ["empty", { diagnostic: "" }],
    ["whitespace", { diagnostic: " \t" }],
  ])("uses a stable diagnostic for a %s KILL failure", async (_, detail) => {
    const probeGroup = vi
      .fn()
      .mockReturnValueOnce(undefined)
      .mockImplementationOnce(() => {
        throw processError("ESRCH");
      });
    const harness = createSupervisorHarness({ probeGroup });
    ownerReady(harness);
    workerOutcome(harness);
    const term = latestRequest(harness, "term");
    harness.owner.emit("message", {
      requestId: term.requestId,
      status: "dispatched",
      type: "cleanup-term-result",
    });
    harness.timers.run(supervisorTiming.forceKillDelayMs);
    const kill = latestRequest(harness, "kill");

    harness.owner.emit("message", {
      ...detail,
      requestId: kill.requestId,
      type: "cleanup-kill-failed",
    });
    harness.owner.emit("exit", 1, null);
    harness.timers.run(supervisorTiming.absenceProbeIntervalMs);

    await expect(harness.result).resolves.toEqual({
      code: 1,
      stderr:
        "Chromium preflight group owner reported SIGKILL failure without a diagnostic.",
    });
    expect(harness.owner.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.owner.kill).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", {}],
    ["non-string", { diagnostic: 42 }],
    ["empty", { diagnostic: "" }],
    ["whitespace", { diagnostic: " \t" }],
  ])(
    "uses a stable diagnostic for a %s owner protocol error",
    async (_, detail) => {
      const probeGroup = vi
        .fn()
        .mockReturnValueOnce(undefined)
        .mockImplementationOnce(() => {
          throw processError("ESRCH");
        });
      const harness = createSupervisorHarness({ probeGroup });
      ownerReady(harness);

      harness.owner.emit("message", {
        ...detail,
        type: "cleanup-protocol-error",
      });
      harness.owner.emit("exit", 1, null);
      harness.timers.run(supervisorTiming.absenceProbeIntervalMs);

      await expect(harness.result).resolves.toEqual({
        code: 1,
        stderr:
          "Chromium preflight cleanup protocol error: the group owner reported a cleanup protocol error without a diagnostic.",
      });
      expect(harness.owner.disconnect).toHaveBeenCalledTimes(1);
      expect(harness.owner.kill).not.toHaveBeenCalled();
    },
  );

  it("reports only the truthful worker-wait timeout before TERM delivery", async () => {
    const harness = createSupervisorHarness();

    harness.timers.run(supervisorTiming.timeoutMs);
    const term = latestRequest(harness, "term");
    expect(term).toEqual({
      phase: "term",
      requestId: 1,
      type: "cleanup-request",
    });
    harness.owner.emit("exit", null, "SIGTERM");

    const result = await harness.result;
    expect(result).toEqual({
      code: 1,
      stderr:
        "Chromium preflight timed out after 100ms while waiting for its worker outcome.",
    });
    expect(result.stderr).not.toMatch(/was (?:terminated|removed|cleaned)/);
    expect(harness.owner.kill).not.toHaveBeenCalled();
    expect(harness.probeGroup.mock.calls).toEqual([[harness.owner.pid, 0]]);
  });

  it.each(
    ["exit", "close"].flatMap((terminationEvent) =>
      ["termination-before-callback", "callback-before-termination"].map(
        (order) => [terminationEvent, order],
      ),
    ),
  )(
    "revokes parent authority for %s with %s",
    async (terminationEvent, order) => {
      const probeGroup = vi
        .fn()
        .mockReturnValueOnce(undefined)
        .mockImplementationOnce(() => {
          throw processError("ESRCH");
        });
      const harness = createSupervisorHarness({ probeGroup });
      ownerReady(harness);
      workerOutcome(harness, 7, "fixed worker failure");
      const termSend = harness.owner.sent.findLast(
        ({ message }) =>
          message.type === "cleanup-request" && message.phase === "term",
      );
      const callbackFailure = new Error("fixed late TERM send failure");
      const emitTermination = () => {
        harness.owner.emit(terminationEvent, null, "SIGTERM");
        harness.owner.emit(
          terminationEvent === "exit" ? "close" : "exit",
          null,
          "SIGTERM",
        );
      };

      if (order === "termination-before-callback") {
        emitTermination();
        termSend.callback(callbackFailure);
      } else {
        termSend.callback(callbackFailure);
        emitTermination();
      }
      harness.timers.run(supervisorTiming.absenceProbeIntervalMs);

      const result = await harness.result;
      expect(result.code).toBe(7);
      expect(result.stderr.split("\n")[0]).toBe("fixed worker failure");
      expect(harness.owner.sent).toHaveLength(2);
      expect(harness.owner.disconnect).toHaveBeenCalledTimes(
        order === "callback-before-termination" ? 1 : 0,
      );
      expect(harness.owner.kill).not.toHaveBeenCalled();
      expect(
        harness.observeLifecycle.mock.calls
          .map(([event]) => event.type)
          .filter((type) => type === "owner-exited"),
      ).toHaveLength(1);
      expect(harness.probeGroup.mock.calls).toEqual([
        [harness.owner.pid, 0],
        [harness.owner.pid, 0],
      ]);
      expect(
        harness.timers.tasks.filter(
          ({ active, delay }) =>
            active && delay === supervisorTiming.termResultTimeoutMs,
        ),
      ).toHaveLength(0);
    },
  );
});

describe("real Chromium group owner", () => {
  it("proves owner-side TERM/KILL, descriptor isolation, and descendant cleanup", async () => {
    await runRealOwnerCase(
      { mode: "observes-term-with-descendant" },
      async (fixture) => {
        await waitForOwnerMessage(
          fixture.owner,
          (message) => message?.type === "owner-ready",
          "Chromium owner readiness",
        );
        const ready = waitForOwnerMessage(
          fixture.owner,
          (message) => message?.message?.type === "fixture-ready",
          "Chromium fixture readiness",
        );
        const spawnMarker = fixture.markers.waitFor(SPAWN_BOUNDARY_MARKER);
        fixture.owner.send({ type: "start" });
        await spawnMarker;
        const readyMessage = await ready;
        expect(readyMessage.message).toMatchObject({
          deadmanDescriptorOpen: false,
          fixtureTestEnvironmentLeaked: false,
          markerDescriptorOpen: false,
        });

        const termResult = waitForOwnerMessage(
          fixture.owner,
          (message) =>
            message?.type === "cleanup-term-result" && message.requestId === 1,
          "Chromium owner TERM result",
        );
        const termObserved = waitForOwnerMessage(
          fixture.owner,
          (message) => message?.message?.type === "fixture-term-observed",
          "Chromium fixture TERM observation",
        );
        fixture.owner.send({
          phase: "term",
          requestId: 1,
          type: "cleanup-request",
        });
        await expect(termResult).resolves.toMatchObject({
          status: "dispatched",
        });
        await termObserved;

        const killArmed = waitForOwnerMessage(
          fixture.owner,
          (message) =>
            message?.type === "cleanup-kill-armed" && message.requestId === 2,
          "Chromium owner KILL acknowledgement",
        );
        fixture.owner.send({
          phase: "kill",
          requestId: 2,
          type: "cleanup-request",
        });
        await killArmed;
        await fixture.terminated;
        expect(fixture.markers.count(TEST_DEADMAN_MARKER)).toBe(0);
        expect(fixture.deadmanActivated()).toBe(false);
        expect(readFileSync(fixture.statePath, "utf8")).toContain(
          readyMessage.message.descendantPid,
        );
      },
    );
  });

  it("holds the pre-start gate and disconnects without a spawn marker", async () => {
    await runRealOwnerCase({}, async (fixture) => {
      await waitForOwnerMessage(
        fixture.owner,
        (message) => message?.type === "owner-ready",
        "Chromium owner readiness",
      );
      const token = "pre-start-proof";
      const held = waitForOwnerMessage(
        fixture.owner,
        (message) =>
          message?.type === "before-start-held" && message.token === token,
        "Chromium pre-start barrier",
      );
      fixture.owner.send({ token, type: "hold-before-start" });
      await expect(held).resolves.toEqual({
        spawnBoundaryCrossed: false,
        token,
        type: "before-start-held",
      });
      fixture.owner.disconnect();
      await fixture.terminated;
      expect(fixture.markers.count(SPAWN_BOUNDARY_MARKER)).toBe(0);
      expect(fixture.markers.count(TEST_DEADMAN_MARKER)).toBe(0);
    });
  });

  it("separates one injected production KILL attempt from deadman cleanup", async () => {
    await runRealOwnerCase({ killFailure: true }, async (fixture) => {
      await waitForOwnerMessage(
        fixture.owner,
        (message) => message?.type === "owner-ready",
        "Chromium owner readiness",
      );
      fixture.owner.send({
        phase: "term",
        requestId: 1,
        type: "cleanup-request",
      });
      await waitForOwnerMessage(
        fixture.owner,
        (message) =>
          message?.type === "cleanup-term-result" && message.requestId === 1,
        "Chromium owner TERM result",
      );
      const killFailed = waitForOwnerMessage(
        fixture.owner,
        (message) =>
          message?.type === "cleanup-kill-failed" && message.requestId === 2,
        "Chromium owner KILL failure",
      );
      fixture.owner.send({
        phase: "kill",
        requestId: 2,
        type: "cleanup-request",
      });
      await fixture.markers.waitFor(TEST_KILL_ATTEMPTED_MARKER);
      await expect(killFailed).resolves.toMatchObject({
        diagnostic: expect.stringContaining("fixed owner SIGKILL failure"),
      });
      fixture.recordPrimaryFailure();
      await fixture.activateDeadman();
      await fixture.terminated;
      expect(fixture.markers.count(TEST_KILL_ATTEMPTED_MARKER)).toBe(1);
      expect(fixture.markers.count(TEST_DEADMAN_MARKER)).toBe(1);
      expect(fixture.deadmanActivated()).toBe(true);
    });
  });

  it("strips ambient KILL failure injection from an ordinary real-owner helper", async () => {
    await runRealOwnerCase(
      {
        mode: "ignores-term-with-descendant",
        sourceEnvironment: {
          ...process.env,
          [TEST_KILL_FAILURE]: "1",
        },
      },
      async (fixture) => {
        await waitForOwnerMessage(
          fixture.owner,
          (message) => message?.type === "owner-ready",
          "Chromium owner readiness",
        );
        fixture.owner.send({ type: "start" });
        await waitForOwnerMessage(
          fixture.owner,
          (message) => message?.message?.type === "fixture-ready",
          "Chromium fixture readiness",
        );
        fixture.owner.send({
          phase: "term",
          requestId: 1,
          type: "cleanup-request",
        });
        await waitForOwnerMessage(
          fixture.owner,
          (message) =>
            message?.type === "cleanup-term-result" && message.requestId === 1,
          "Chromium owner TERM result",
        );
        fixture.owner.send({
          phase: "kill",
          requestId: 2,
          type: "cleanup-request",
        });
        await waitForOwnerMessage(
          fixture.owner,
          (message) =>
            message?.type === "cleanup-kill-armed" && message.requestId === 2,
          "Chromium owner KILL acknowledgement",
        );

        const terminationOutcome = await Promise.race([
          fixture.terminated.then(() => "terminated"),
          fixture.markers.waitFor(TEST_KILL_ATTEMPTED_MARKER).then(
            () => "ambient-kill-failure",
            () => "marker-ended",
          ),
        ]);
        expect(terminationOutcome).not.toBe("ambient-kill-failure");
        await fixture.terminated;
        expect(fixture.markers.count(TEST_KILL_ATTEMPTED_MARKER)).toBe(0);
        expect(fixture.markers.count(TEST_DEADMAN_MARKER)).toBe(0);
      },
    );
  });
});
