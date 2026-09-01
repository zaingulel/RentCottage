import { spawn } from "node:child_process";
import { createReadStream, fstatSync, writeSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { capture, describeThrown } from "./lib/trap-safe-diagnostics.mjs";

export const TEST_SPAWN_BOUNDARY_FD =
  "CHROMIUM_PREFLIGHT_TEST_SPAWN_BOUNDARY_FD";
export const TEST_DEADMAN_FD = "CHROMIUM_PREFLIGHT_TEST_DEADMAN_FD";
export const TEST_KILL_FAILURE = "CHROMIUM_PREFLIGHT_TEST_KILL_FAILURE";
export const TEST_ENVIRONMENT_KEYS = [
  TEST_SPAWN_BOUNDARY_FD,
  TEST_DEADMAN_FD,
  TEST_KILL_FAILURE,
];

export const SPAWN_BOUNDARY_MARKER = "chromium-preflight-worker-spawn\n";
export const TEST_KILL_ATTEMPTED_MARKER =
  "chromium-preflight-test-kill-attempted\n";
export const TEST_DEADMAN_MARKER = "chromium-preflight-test-deadman\n";

const DISCONNECT_FORCE_DELAY_MS = 1_000;

function callbackFailed(value) {
  return value !== undefined && value !== null;
}

function validRequestId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function createGroupOwnerController({
  allowPreStartBarrier = false,
  cancelTimer = clearTimeout,
  disconnectForceDelayMs = DISCONNECT_FORCE_DELAY_MS,
  environment = process.env,
  onDisconnect,
  onMessage,
  onSigterm,
  ownerPid,
  scheduleTimer = setTimeout,
  send,
  signalOwnGroup,
  spawnWorker,
  workerArguments = [],
  workerPath,
  writeSpawnBoundaryMarker = () => {},
}) {
  let disconnectForceTimer;
  let disconnectObserved = false;
  let killArmed = false;
  let killAttempted = false;
  let killFailure;
  let killRequestId;
  let outcomeSent = false;
  let preStartBarrierHeld = false;
  let startGateClosed = false;
  let startReceived = false;
  let termAttempted = false;
  let termRequestId;
  let termResult;

  const snapshot = () => ({
    disconnectObserved,
    killArmed,
    killAttempted,
    killFailure,
    killRequestId,
    preStartBarrierHeld,
    startGateClosed,
    startReceived,
    termAttempted,
    termRequestId,
    termResult,
  });

  const clearDisconnectForceTimer = () => {
    if (disconnectForceTimer === undefined) return;
    cancelTimer(disconnectForceTimer);
    disconnectForceTimer = undefined;
  };

  let beginDisconnectCleanup = () => {};

  const sendMessage = (message, onComplete = () => {}) => {
    if (disconnectObserved) return false;
    const sent = capture(() =>
      send(message, (error) => {
        if (callbackFailed(error)) {
          beginDisconnectCleanup();
        }
        onComplete(error);
      }),
    );
    if (sent.threw) {
      beginDisconnectCleanup();
      onComplete(sent.error);
      return false;
    }
    return true;
  };

  const sendProtocolError = (diagnostic, requestId) => {
    const message = {
      diagnostic,
      type: "cleanup-protocol-error",
    };
    if (validRequestId(requestId)) message.requestId = requestId;
    sendMessage(message);
  };

  const attemptTerm = (requestId) => {
    startGateClosed = true;
    if (!termAttempted) {
      termAttempted = true;
      const result = capture(() => signalOwnGroup("SIGTERM"));
      termResult = result.threw
        ? {
            diagnostic: `Chromium preflight owner could not send SIGTERM: ${describeThrown(result.error)}`,
            requestId,
            status: "failed",
            type: "cleanup-term-result",
          }
        : {
            requestId,
            status: "dispatched",
            type: "cleanup-term-result",
          };
    }
    if (validRequestId(requestId) && termResult) sendMessage(termResult);
  };

  const dispatchKillOnce = () => {
    if (!killArmed || killAttempted) return;
    killAttempted = true;
    clearDisconnectForceTimer();
    const result = capture(() => signalOwnGroup("SIGKILL"));
    if (!result.threw) return;
    killFailure = result.error;
    sendMessage({
      diagnostic: `Chromium preflight owner could not send SIGKILL: ${describeThrown(result.error)}`,
      requestId: killRequestId,
      type: "cleanup-kill-failed",
    });
  };

  beginDisconnectCleanup = () => {
    if (!disconnectObserved) {
      disconnectObserved = true;
      startGateClosed = true;
    }
    if (!termAttempted) attemptTerm(undefined);
    if (killArmed) {
      dispatchKillOnce();
      return;
    }
    if (disconnectForceTimer !== undefined || killAttempted) return;
    disconnectForceTimer = scheduleTimer(() => {
      disconnectForceTimer = undefined;
      killArmed = true;
      dispatchKillOnce();
    }, disconnectForceDelayMs);
  };

  const sendOutcome = (outcome) => {
    if (outcomeSent) return;
    outcomeSent = true;
    sendMessage({ type: "worker-outcome", ...outcome });
  };

  const startWorker = () => {
    if (startGateClosed || startReceived) return;
    startReceived = true;
    if (!workerPath) {
      sendOutcome({
        code: 1,
        stderr: "Chromium preflight worker path is unavailable.",
      });
      return;
    }

    const markerResult = capture(writeSpawnBoundaryMarker);
    if (markerResult.threw) {
      sendOutcome({
        code: 1,
        stderr: `Chromium preflight spawn-boundary marker failed: ${describeThrown(markerResult.error)}`,
      });
      return;
    }

    const workerEnvironment = {
      ...environment,
      CHROMIUM_PREFLIGHT_GROUP_OWNER_PID: String(ownerPid),
    };
    for (const key of TEST_ENVIRONMENT_KEYS) delete workerEnvironment[key];
    const spawned = capture(() =>
      spawnWorker({
        environment: workerEnvironment,
        workerArguments,
        workerPath,
      }),
    );
    if (spawned.threw) {
      sendOutcome({
        code: 1,
        stderr: `Chromium preflight could not start its worker: ${describeThrown(spawned.error)}`,
      });
      return;
    }
    const worker = spawned.value;
    if (!worker || typeof worker.once !== "function") {
      sendOutcome({
        code: 1,
        stderr:
          "Chromium preflight could not start its worker: worker process is unavailable",
      });
      return;
    }

    let workerStderr = "";
    worker.stderr?.on("data", (chunk) => {
      workerStderr += chunk;
    });
    worker.on("message", (message) => {
      sendMessage({ message, type: "worker-message" });
    });
    worker.once("error", (error) => {
      sendOutcome({
        code: 1,
        stderr: `Chromium preflight could not start its worker: ${describeThrown(error)}`,
      });
    });
    worker.once("close", (code) => {
      sendOutcome({
        code: Number.isInteger(code) ? code : 1,
        stderr: workerStderr.trimEnd(),
      });
    });
  };

  const handleCleanupRequest = (message) => {
    const requestId = capture(() => message.requestId);
    const phase = capture(() => message.phase);
    if (
      requestId.threw ||
      phase.threw ||
      !validRequestId(requestId.value) ||
      (phase.value !== "term" && phase.value !== "kill")
    ) {
      sendProtocolError(
        "Chromium preflight owner rejected a malformed cleanup request.",
      );
      return;
    }

    if (phase.value === "term") {
      if (termRequestId === requestId.value && termResult) {
        sendMessage(termResult);
        return;
      }
      if (termAttempted || termRequestId !== undefined || killArmed) {
        sendProtocolError(
          "Chromium preflight owner rejected a conflicting TERM request.",
          requestId.value,
        );
        return;
      }
      termRequestId = requestId.value;
      attemptTerm(requestId.value);
      return;
    }

    if (
      !termAttempted ||
      !validRequestId(termRequestId) ||
      requestId.value <= termRequestId ||
      killArmed ||
      killRequestId !== undefined
    ) {
      sendProtocolError(
        "Chromium preflight owner rejected an out-of-order KILL request.",
        requestId.value,
      );
      return;
    }
    startGateClosed = true;
    killRequestId = requestId.value;
    killArmed = true;
    sendMessage(
      {
        requestId: requestId.value,
        type: "cleanup-kill-armed",
      },
      dispatchKillOnce,
    );
  };

  const handleMessage = (message) => {
    const type = capture(() => message?.type);
    if (type.threw || typeof type.value !== "string") {
      sendProtocolError(
        "Chromium preflight owner rejected a malformed message.",
      );
      return;
    }
    if (type.value === "start") {
      if (preStartBarrierHeld) return;
      startWorker();
      return;
    }
    if (type.value === "hold-before-start") {
      const token = capture(() => message.token);
      if (
        !allowPreStartBarrier ||
        preStartBarrierHeld ||
        startReceived ||
        startGateClosed ||
        token.threw ||
        typeof token.value !== "string" ||
        token.value.length === 0
      ) {
        sendProtocolError(
          "Chromium preflight owner rejected a pre-start test barrier.",
        );
        return;
      }
      preStartBarrierHeld = true;
      sendMessage({
        spawnBoundaryCrossed: false,
        token: token.value,
        type: "before-start-held",
      });
      return;
    }
    if (type.value === "cleanup-request") {
      handleCleanupRequest(message);
      return;
    }
    if (type.value === "cleanup-protocol-error") {
      beginDisconnectCleanup();
      return;
    }
    sendProtocolError("Chromium preflight owner rejected an unknown message.");
  };

  const start = () => {
    onSigterm(() => {});
    onMessage(handleMessage);
    onDisconnect(beginDisconnectCleanup);
    sendMessage({ type: "owner-ready" });
  };

  return Object.freeze({
    handleDisconnect: beginDisconnectCleanup,
    handleMessage,
    snapshot,
    start,
  });
}

function parseTestDescriptor(environment, key) {
  const configured = environment[key];
  if (configured === undefined || !/^(?:[4-9]|[1-9][0-9]+)$/.test(configured)) {
    throw new Error(`Chromium preflight ${key} descriptor is invalid.`);
  }
  const descriptor = Number(configured);
  if (!Number.isSafeInteger(descriptor)) {
    throw new Error(`Chromium preflight ${key} descriptor is invalid.`);
  }
  const stat = fstatSync(descriptor);
  if (!stat.isFIFO() && !stat.isSocket()) {
    throw new Error(`Chromium preflight ${key} descriptor is not a pipe.`);
  }
  return {
    descriptor,
    fingerprint: `${stat.dev}:${stat.ino}`,
  };
}

function createTestBootstrap(environment) {
  const configured = TEST_ENVIRONMENT_KEYS.some(
    (key) => environment[key] !== undefined,
  );
  if (!configured) {
    return {
      augmentWorkerArguments: (workerArguments) => workerArguments,
      enabled: false,
      installDeadman: () => {},
      killFailure: false,
      writeMarker: () => {},
    };
  }
  const marker = parseTestDescriptor(environment, TEST_SPAWN_BOUNDARY_FD);
  const controlPipe = parseTestDescriptor(environment, TEST_DEADMAN_FD);
  if (marker.descriptor === controlPipe.descriptor) {
    throw new Error("Chromium preflight test descriptors must be distinct.");
  }

  let emergencyAttempted = false;
  const writeMarker = (value) => writeSync(marker.descriptor, value);
  const installDeadman = () => {
    const controlStream = createReadStream(null, {
      autoClose: false,
      fd: controlPipe.descriptor,
    });
    const activate = () => {
      if (emergencyAttempted) return;
      emergencyAttempted = true;
      capture(() => writeMarker(TEST_DEADMAN_MARKER));
      capture(() => process.kill(-process.pid, "SIGKILL"));
    };
    controlStream.once("end", activate);
    controlStream.once("close", activate);
    controlStream.resume();
  };
  return {
    augmentWorkerArguments: (workerArguments) => [
      ...workerArguments,
      marker.fingerprint,
      controlPipe.fingerprint,
    ],
    enabled: true,
    installDeadman,
    killFailure: environment[TEST_KILL_FAILURE] !== undefined,
    writeMarker,
  };
}

function defaultSpawnWorker({
  closeTestDescriptors = false,
  environment,
  workerArguments,
  workerPath,
}) {
  return spawn(process.execPath, [workerPath, ...workerArguments], {
    detached: false,
    env: environment,
    stdio: closeTestDescriptors
      ? ["ignore", "ignore", "pipe", "ipc", "ignore", "ignore"]
      : ["ignore", "ignore", "pipe", "ipc"],
  });
}

export function runGroupOwnerCommand({
  environment = process.env,
  processImpl = process,
  spawnWorker = defaultSpawnWorker,
} = {}) {
  const [workerPath, ...workerArguments] = processImpl.argv.slice(2);
  try {
    const testBootstrap = createTestBootstrap(environment);
    testBootstrap.installDeadman();
    const controller = createGroupOwnerController({
      allowPreStartBarrier: testBootstrap.enabled,
      environment,
      onDisconnect: (handler) => processImpl.once("disconnect", handler),
      onMessage: (handler) => processImpl.on("message", handler),
      onSigterm: (handler) => processImpl.on("SIGTERM", handler),
      ownerPid: processImpl.pid,
      send: (message, callback) => processImpl.send(message, callback),
      signalOwnGroup: (signal) => {
        if (signal === "SIGKILL" && testBootstrap.killFailure) {
          testBootstrap.writeMarker(TEST_KILL_ATTEMPTED_MARKER);
          throw Object.assign(new Error("fixed owner SIGKILL failure"), {
            code: "EPERM",
          });
        }
        processImpl.kill(-processImpl.pid, signal);
      },
      spawnWorker: (options) =>
        spawnWorker({
          ...options,
          closeTestDescriptors: testBootstrap.enabled,
        }),
      workerArguments: testBootstrap.augmentWorkerArguments(workerArguments),
      workerPath,
      writeSpawnBoundaryMarker: () =>
        testBootstrap.writeMarker(SPAWN_BOUNDARY_MARKER),
    });
    controller.start();
    return controller;
  } catch (error) {
    console.error(
      `Chromium preflight group owner failed: ${describeThrown(error)}`,
    );
    processImpl.exitCode = 1;
    return undefined;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runGroupOwnerCommand();
}
