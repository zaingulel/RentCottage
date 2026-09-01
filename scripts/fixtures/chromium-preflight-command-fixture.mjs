import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
  SPAWN_BOUNDARY_MARKER,
  TEST_DEADMAN_FD,
  TEST_DEADMAN_MARKER,
  TEST_KILL_FAILURE,
  TEST_SPAWN_BOUNDARY_FD,
} from "../verify-chromium-preflight-group-owner.mjs";
import { capture, describeThrown } from "../lib/trap-safe-diagnostics.mjs";
import { runChromiumPreflight } from "../verify-chromium-preflight.mjs";

const [mode, statePath, abortToken, ownerPreloadPath] = process.argv.slice(2);
const supportedModes = new Set(["cleanup-ack-timeout", "cleanup-send-failure"]);
const processFixturePath = resolve(
  process.cwd(),
  "scripts/fixtures/chromium-preflight-process-fixture.mjs",
);
const groupOwnerPath = resolve(
  process.cwd(),
  "scripts/verify-chromium-preflight-group-owner.mjs",
);

function positivePid(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function processGroupIsAbsent(groupId) {
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
    const observation = processGroupIsAbsent(groupId);
    if (observation.absent) return;
    latestObservation = observation.observation ?? latestObservation;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  const diagnostic = latestObservation
    ? ` Last non-ESRCH signal-zero observation: ${latestObservation.code ?? "unknown"}: ${latestObservation.message ?? describeThrown(latestObservation)}.`
    : "";
  throw new Error(
    `Chromium command fixture group ${groupId} remained present.${diagnostic}`,
  );
}

function processIsAbsent(pid) {
  if (!positivePid(pid)) return { absent: true };
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
    ? ` Last signal-zero observation for PID ${latestObservation[0]}: ${latestObservation[1].observation?.code ?? "unknown"}.`
    : "";
  throw new Error(
    `Chromium command fixture left live PIDs: ${remaining.join(", ")}.${diagnostic}`,
  );
}

function readFixtureState() {
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function withDeadline(promise, description, timeoutMs) {
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

function createMarkerState(stream, observeMarker = () => {}) {
  const counts = {
    [SPAWN_BOUNDARY_MARKER]: 0,
    [TEST_DEADMAN_MARKER]: 0,
  };
  const waiters = new Map();
  let buffer = "";
  let ended = false;
  let failure;
  let resolveEnd;
  const endPromise = new Promise((resolveEndPromise) => {
    resolveEnd = resolveEndPromise;
  });
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const marker = buffer.slice(0, newline + 1);
      buffer = buffer.slice(newline + 1);
      if (!(marker in counts)) {
        failure ??= new Error(`Unexpected Chromium command marker: ${marker}`);
      } else {
        counts[marker] += 1;
        observeMarker(marker);
        if (counts[marker] > 1) {
          failure ??= new Error(`Duplicate Chromium command marker: ${marker}`);
        }
        waiters.get(marker)?.resolve();
        waiters.delete(marker);
      }
      newline = buffer.indexOf("\n");
    }
  });
  stream.once("end", () => {
    ended = true;
    if (buffer.length > 0) {
      failure ??= new Error(`Partial Chromium command marker: ${buffer}`);
    }
    for (const [marker, waiter] of waiters) {
      waiter.reject(new Error(`Missing Chromium command marker: ${marker}`));
    }
    waiters.clear();
    resolveEnd();
  });
  return {
    complete: async () => {
      await endPromise;
      if (failure) throw failure;
    },
    count: (marker) => counts[marker],
    waitFor: (marker) => {
      if (counts[marker] === 1) return Promise.resolve();
      if (ended) {
        return Promise.reject(
          new Error(`Missing Chromium command marker: ${marker}`),
        );
      }
      return new Promise((resolveMarker, rejectMarker) => {
        waiters.set(marker, { reject: rejectMarker, resolve: resolveMarker });
      });
    },
  };
}

function sendOuter(message, { forceCallbackFailure = false } = {}) {
  if (!process.connected) return Promise.resolve(false);
  return new Promise((resolveSend, rejectSend) => {
    try {
      const submitted = process.send(message, (error) => {
        const failure = forceCallbackFailure
          ? new Error("fixed abort acknowledgement callback failure")
          : error;
        if (failure) rejectSend(failure);
        else resolveSend(true);
      });
      if (submitted === false) resolveSend(false);
    } catch (error) {
      rejectSend(error);
    }
  });
}

async function runCommandFixture() {
  const cancellation = new AbortController();
  const lifecycleOrder = [];
  const primaryFailures = [];
  let abortRequestCount = 0;
  let abortTask;
  let abortTaskCreations = 0;
  let abortTaskReuses = 0;
  let absenceConfirmed = false;
  let bridgeFailure;
  let cleanupWatchPromise;
  let cleanupWatchStarts = 0;
  let deadmanActivated = false;
  let deadmanControl;
  let detachmentWindow = false;
  let destroyOwnerMarker;
  let destroyOwnerStderr;
  let finalCleanupComplete = false;
  let finalizationTask;
  let fixtureProcessesAbsent = false;
  let handoffOccurred = false;
  let markerState;
  let outerDisconnected = false;
  let owner;
  let ownerChannelUnreferenced = false;
  let ownerDisconnected = false;
  let ownerStderrDestroyed = false;
  let ownerTerminated = Promise.resolve();
  let ownerUnreferenced = false;
  let resolveHandoff;
  let result = {
    code: 1,
    stderr: "Chromium command fixture did not receive a supervisor result.",
  };
  let readinessAcknowledged;
  let readinessObservationSettled = false;
  let resolveReadinessAcknowledgement;
  let settleSupervisor;
  let supervisorNoStartReason;
  let supervisorObservationComplete = false;
  let supervisorState = "PENDING";
  let supervisorTask;
  let workerDeadline;
  const handoffObserved = new Promise((resolveHandoffPromise) => {
    resolveHandoff = resolveHandoffPromise;
  });
  const supervisorSettled = new Promise((resolveSupervisor) => {
    settleSupervisor = resolveSupervisor;
  });
  readinessAcknowledged = new Promise((resolveReadiness) => {
    resolveReadinessAcknowledgement = resolveReadiness;
  });

  const recordPrimaryFailure = (error) => {
    if (primaryFailures.length === 0) {
      lifecycleOrder.push("primary-failure-recorded");
    }
    primaryFailures.push(error);
  };
  const scheduleSupervisorTimer = (callback, delay) => {
    if (delay === 250 && workerDeadline === undefined) {
      workerDeadline = { active: true, callback };
      return workerDeadline;
    }
    return setTimeout(callback, delay);
  };
  const cancelSupervisorTimer = (timer) => {
    if (timer === workerDeadline) {
      timer.active = false;
      return;
    }
    clearTimeout(timer);
  };
  const releaseWorkerDeadline = () => {
    if (!workerDeadline?.active) return false;
    workerDeadline.active = false;
    workerDeadline.callback();
    return true;
  };
  const settleReadinessAcknowledgement = (observation) => {
    if (readinessObservationSettled) return false;
    readinessObservationSettled = true;
    resolveReadinessAcknowledgement(observation);
    return true;
  };
  const settleSupervisorOnce = () => {
    if (supervisorObservationComplete) return;
    supervisorObservationComplete = true;
    settleSupervisor();
  };
  const skipSupervisorOnce = (reason) => {
    if (supervisorState !== "PENDING") return false;
    supervisorState = "SKIPPED";
    supervisorNoStartReason = reason;
    settleSupervisorOnce();
    return true;
  };
  const ownerIsLive = () =>
    owner && owner.exitCode === null && owner.signalCode === null;
  const activateDeadman = async () => {
    if (primaryFailures.length === 0) {
      throw new Error("Chromium command deadman requires a primary failure");
    }
    if (deadmanActivated || !ownerIsLive()) return;
    deadmanActivated = true;
    const marker = markerState.waitFor(TEST_DEADMAN_MARKER);
    deadmanControl.end();
    await marker;
  };
  const independentCleanupWatch = async () => {
    try {
      await withDeadline(
        Promise.all([ownerTerminated, supervisorSettled]),
        "Chromium command production cleanup",
        1_500,
      );
    } catch (error) {
      recordPrimaryFailure(error);
      await activateDeadman();
    }
    const completed = await Promise.allSettled([
      ownerTerminated,
      supervisorSettled,
    ]);
    for (const completion of completed) {
      if (completion.status === "rejected") {
        recordPrimaryFailure(completion.reason);
      }
    }
  };
  const startCleanupWatch = () => {
    if (cleanupWatchPromise) return cleanupWatchPromise;
    cleanupWatchStarts += 1;
    lifecycleOrder.push("cleanup-watch-armed");
    cleanupWatchPromise = independentCleanupWatch();
    return cleanupWatchPromise;
  };
  const beginAbort = (
    source,
    { acknowledge = false, forceAcknowledgementFailure = false } = {},
  ) => {
    abortRequestCount += 1;
    if (abortTask) {
      abortTaskReuses += 1;
      return abortTask;
    }
    abortTaskCreations += 1;
    abortTask = (async () => {
      recordPrimaryFailure(new Error(`Chromium command fixture ${source}`));
      const cleanupWatch = startCleanupWatch();
      lifecycleOrder.push("cancellation-abort");
      const aborted = capture(() => cancellation.abort());
      if (aborted.threw) recordPrimaryFailure(aborted.error);
      let handoffObservedSuccessfully = false;
      try {
        await withDeadline(
          handoffObserved,
          "Chromium command cancellation handoff",
          250,
        );
        handoffObservedSuccessfully = true;
      } catch (error) {
        bridgeFailure = error;
        recordPrimaryFailure(error);
      }

      let acknowledgementTask = Promise.resolve();
      if (acknowledge && handoffObservedSuccessfully) {
        lifecycleOrder.push("abort-ack-send-start");
        acknowledgementTask = withDeadline(
          sendOuter(
            {
              handoffRecorded: true,
              lifecycleOrder: [...lifecycleOrder],
              token: abortToken,
              type: "test-abort-ack",
            },
            { forceCallbackFailure: forceAcknowledgementFailure },
          ).then((sent) => {
            if (!sent) {
              throw new Error(
                "Chromium command abort acknowledgement IPC was unavailable",
              );
            }
          }),
          "Chromium command abort acknowledgement send",
          250,
        );
      }
      const observeAcknowledgement = async () => {
        try {
          await acknowledgementTask;
        } catch (error) {
          recordPrimaryFailure(error);
        }
      };
      const completions = await Promise.allSettled([
        observeAcknowledgement(),
        cleanupWatch,
      ]);
      for (const completion of completions) {
        if (completion.status === "rejected") {
          recordPrimaryFailure(completion.reason);
        }
      }
    })();
    return abortTask;
  };

  process.on("message", (message) => {
    if (message?.token !== abortToken) return;
    if (message.type === "command-fixture-ready-ack") {
      settleReadinessAcknowledgement({ kind: "acknowledged" });
      return;
    }
    if (message.type === "test-release-worker-deadline") {
      const released = releaseWorkerDeadline();
      void sendOuter({
        released,
        token: abortToken,
        type: "command-fixture-worker-deadline-released",
      }).catch(recordPrimaryFailure);
      return;
    }
    if (message.type !== "test-abort") return;
    void beginAbort("received its test abort", {
      acknowledge: true,
      forceAcknowledgementFailure: message.forceAcknowledgementFailure === true,
    });
  });
  process.once("disconnect", () => {
    if (finalCleanupComplete) return;
    outerDisconnected = true;
    settleReadinessAcknowledgement({ kind: "disconnected-before-ack" });
    void beginAbort("lost its outer IPC channel");
  });

  const spawnOwner = ({ workerArguments, workerPath }) => {
    const ownerEnvironment = { ...process.env };
    delete ownerEnvironment[TEST_KILL_FAILURE];
    ownerEnvironment[TEST_DEADMAN_FD] = "5";
    ownerEnvironment[TEST_SPAWN_BOUNDARY_FD] = "4";
    owner = spawn(
      process.execPath,
      [
        ...(ownerPreloadPath ? ["--import", ownerPreloadPath] : []),
        groupOwnerPath,
        workerPath,
        ...workerArguments,
      ],
      {
        detached: true,
        env: ownerEnvironment,
        stdio: ["ignore", "ignore", "pipe", "ipc", "pipe", "pipe"],
      },
    );
    markerState = createMarkerState(owner.stdio[4], (marker) => {
      process.stderr.write(
        `chromium-command-marker:${JSON.stringify(marker)}\n`,
      );
    });
    deadmanControl = owner.stdio[5];
    deadmanControl.on("error", () => {});
    ownerTerminated = new Promise((resolveTermination) =>
      owner.once("exit", resolveTermination),
    );

    const originalDisconnect = owner.disconnect.bind(owner);
    owner.disconnect = (...args) => {
      ownerDisconnected = true;
      lifecycleOrder.push("owner-disconnect");
      return originalDisconnect(...args);
    };
    const originalChannelUnref = owner.channel.unref.bind(owner.channel);
    owner.channel.unref = (...args) => {
      ownerChannelUnreferenced = true;
      lifecycleOrder.push("owner-channel-unref");
      return originalChannelUnref(...args);
    };
    const originalDestroy = owner.stderr.destroy.bind(owner.stderr);
    destroyOwnerStderr = originalDestroy;
    owner.stderr.destroy = (...args) => {
      ownerStderrDestroyed ||= detachmentWindow;
      lifecycleOrder.push("owner-stderr-destroy");
      return originalDestroy(...args);
    };
    destroyOwnerMarker = owner.stdio[4].destroy.bind(owner.stdio[4]);
    const originalUnref = owner.unref.bind(owner);
    owner.unref = (...args) => {
      ownerUnreferenced = true;
      lifecycleOrder.push("owner-unref");
      return originalUnref(...args);
    };
    const originalSend = owner.send.bind(owner);
    let cleanupRequestIntercepted = false;
    owner.send = (message, callback) => {
      if (message?.type === "cleanup-request" && !cleanupRequestIntercepted) {
        cleanupRequestIntercepted = true;
        queueMicrotask(() => {
          if (mode === "cleanup-send-failure") {
            callback?.(new Error("fixed cleanup request send failure"));
          } else {
            callback?.(null);
          }
        });
        return true;
      }
      return originalSend(message, callback);
    };
    return owner;
  };

  const finalizeCommandFixture = () => {
    if (finalizationTask) return finalizationTask;
    finalizationTask = (async () => {
      if (ownerIsLive()) {
        if (primaryFailures.length === 0) {
          recordPrimaryFailure(
            new Error(
              "Chromium command fixture entered final cleanup with a live owner",
            ),
          );
        }
        await Promise.allSettled([
          beginAbort("entered its final cleanup with a live owner"),
        ]);
      } else if (abortTask) {
        await Promise.allSettled([abortTask]);
      }

      if (owner) {
        try {
          await withDeadline(
            ownerTerminated,
            "Chromium command final owner termination",
            3_000,
          );
        } catch (error) {
          recordPrimaryFailure(error);
          await activateDeadman();
          await ownerTerminated;
        }
        await withDeadline(
          markerState.complete(),
          "Chromium command marker completion",
          1_000,
        );
        await requireGroupAbsent(owner.pid);
        const state = readFixtureState();
        await requireProcessesAbsent([
          owner.pid,
          state.descendantPid,
          state.fixtureLeaderPid,
          state.groupOwnerPid,
        ]);
        fixtureProcessesAbsent = true;
      }
      deadmanControl?.destroy();
      destroyOwnerMarker?.();
      destroyOwnerStderr?.();
      finalCleanupComplete = true;
    })().catch((error) => {
      recordPrimaryFailure(error);
    });
    return finalizationTask;
  };

  const startSupervisorOnce = () => {
    if (supervisorState !== "PENDING") return supervisorTask;
    supervisorState = "RUNNING";
    supervisorTask = (async () => {
      try {
        return await runChromiumPreflight({
          absenceProbeIntervalMs: 5,
          cleanupVerificationTimeoutMs: 2_000,
          disconnectObservationTimeoutMs: 1_500,
          forceKillDelayMs: 20,
          killArmTimeoutMs: 50,
          observeLifecycle: (event) => {
            absenceConfirmed ||= event.absenceConfirmed;
            handoffOccurred ||= event.handoffOccurred;
            if (event.type === "handoff-occurred") {
              detachmentWindow = true;
              queueMicrotask(() => {
                detachmentWindow = false;
              });
              lifecycleOrder.push("handoff-observed");
              resolveHandoff();
            }
          },
          onWorkerMessage: (message) => {
            if (message?.type !== "fixture-ready") return;
            void sendOuter({
              token: abortToken,
              type: "command-fixture-worker-ready",
            }).catch(recordPrimaryFailure);
          },
          ownerCloseWaitMs: 100,
          cancelTimer: cancelSupervisorTimer,
          scheduleTimer: scheduleSupervisorTimer,
          spawnOwner,
          termResultTimeoutMs: 50,
          testCancellationSignal: cancellation.signal,
          timeoutMs: 250,
          workerArguments: ["ignores-term-with-descendant", statePath],
          workerPath: processFixturePath,
        });
      } finally {
        if (supervisorState === "RUNNING") supervisorState = "SETTLED";
        settleSupervisorOnce();
      }
    })();
    return supervisorTask;
  };

  try {
    const readySent = await sendOuter({
      token: abortToken,
      type: "command-fixture-ready",
    });
    if (!readySent) {
      throw new Error("Chromium command readiness send was unavailable");
    }
    const readiness = await withDeadline(
      readinessAcknowledged,
      "Chromium command readiness acknowledgement",
      250,
    );
    if (readiness.kind === "disconnected-before-ack") {
      throw new Error(
        "Chromium command fixture disconnected before its readiness acknowledgement",
      );
    }
    const supervisor = startSupervisorOnce();
    result = await supervisor;
  } catch (error) {
    skipSupervisorOnce(describeThrown(error));
    recordPrimaryFailure(error);
    result = {
      code: 1,
      stderr: `Chromium command fixture failed: ${describeThrown(error)}`,
    };
  } finally {
    skipSupervisorOnce("Chromium command fixture did not start its supervisor");
    await finalizeCommandFixture();
  }

  const message = {
    abortRequestCount,
    abortTaskCreations,
    abortTaskReuses,
    absenceConfirmed,
    bridgeFailure: bridgeFailure ? describeThrown(bridgeFailure) : undefined,
    cleanupWatchStarts,
    deadmanActivated,
    deadmanMarkerCount: markerState?.count(TEST_DEADMAN_MARKER) ?? 0,
    finalCleanupComplete,
    fixtureProcessesAbsent,
    handoffOccurred,
    lifecycleOrder,
    outerDisconnected,
    ownerChannelUnreferenced,
    ownerConnected: owner?.connected,
    ownerDisconnected,
    ownerPid: owner?.pid,
    ownerStderrDestroyed,
    ownerUnreferenced,
    primaryFailureCount: primaryFailures.length,
    primaryFailures: primaryFailures.map(describeThrown),
    result,
    spawnMarkerCount: markerState?.count(SPAWN_BOUNDARY_MARKER) ?? 0,
    supervisorNoStartReason,
    supervisorObservationComplete,
    supervisorState,
    type: "command-result",
  };
  let resultDelivered = false;
  try {
    resultDelivered = await sendOuter(message);
  } catch (error) {
    recordPrimaryFailure(error);
  }
  if (!resultDelivered) {
    process.stderr.write(
      `chromium-command-result:${JSON.stringify(message)}\n`,
    );
  }
  if (process.connected) process.disconnect();
}

if (
  !supportedModes.has(mode) ||
  !statePath ||
  typeof abortToken !== "string" ||
  abortToken.length === 0 ||
  (ownerPreloadPath !== undefined &&
    (typeof ownerPreloadPath !== "string" ||
      !isAbsolute(ownerPreloadPath) ||
      ownerPreloadPath.length === 0)) ||
  process.argv.slice(2).length > 4
) {
  console.error(
    "Usage: node scripts/fixtures/chromium-preflight-command-fixture.mjs <cleanup-send-failure|cleanup-ack-timeout> <state-path> <abort-token> [owner-preload-path]",
  );
  process.exitCode = 2;
} else {
  await runCommandFixture();
}
