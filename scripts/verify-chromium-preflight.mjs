import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { capture, describeThrown } from "./lib/trap-safe-diagnostics.mjs";
import { TEST_ENVIRONMENT_KEYS } from "./verify-chromium-preflight-group-owner.mjs";

const TIMEOUT_MS = 15_000;
const TERM_RESULT_TIMEOUT_MS = 1_000;
const FORCE_KILL_DELAY_MS = 1_000;
const KILL_ARM_TIMEOUT_MS = 1_000;
const OWNER_TERMINATION_TIMEOUT_MS = 2_000;
const DISCONNECT_OBSERVATION_TIMEOUT_MS = 2_000;
const CLEANUP_VERIFICATION_TIMEOUT_MS = 2_000;
const ABSENCE_PROBE_INTERVAL_MS = 20;
const WORKER_PATH = resolve(
  process.cwd(),
  "scripts/verify-chromium-preflight-worker.mjs",
);
const GROUP_OWNER_PATH = resolve(
  process.cwd(),
  "scripts/verify-chromium-preflight-group-owner.mjs",
);
const OWNER_MESSAGE_TYPES = new Set([
  "owner-ready",
  "worker-message",
  "worker-outcome",
  "cleanup-term-result",
  "cleanup-kill-armed",
  "cleanup-kill-failed",
  "cleanup-protocol-error",
]);

function thrownCode(value) {
  const code = capture(() => value?.code);
  return code.threw ? undefined : code.value;
}

function callbackFailed(value) {
  return value !== undefined && value !== null;
}

function validWorkerExitCode(value) {
  // POSIX wait status exposes only the low eight exit-code bits.
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

function readOwnerMessageType(message) {
  const type = capture(() => message?.type);
  if (
    type.threw ||
    typeof type.value !== "string" ||
    type.value.trim().length === 0
  ) {
    return { kind: "malformed" };
  }
  if (!OWNER_MESSAGE_TYPES.has(type.value)) return { kind: "unknown" };
  return { kind: "known", type: type.value };
}

function nonEmptyDiagnostic(value, fallback) {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : fallback;
}

function positivePid(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function defaultProbeGroup(pid, signal) {
  if (signal !== 0) {
    throw new Error("Chromium preflight group probes must use signal zero.");
  }
  process.kill(-pid, 0);
}

function defaultSpawnOwner({
  environment,
  groupOwnerPath,
  spawnProcess,
  workerArguments,
  workerPath,
}) {
  const ownerEnvironment = { ...environment };
  for (const key of TEST_ENVIRONMENT_KEYS) delete ownerEnvironment[key];
  return spawnProcess(
    process.execPath,
    [groupOwnerPath, workerPath, ...workerArguments],
    {
      detached: true,
      env: ownerEnvironment,
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    },
  );
}

export function runChromiumPreflight({
  absenceProbeIntervalMs = ABSENCE_PROBE_INTERVAL_MS,
  cancelTimer = clearTimeout,
  cleanupVerificationTimeoutMs = CLEANUP_VERIFICATION_TIMEOUT_MS,
  disconnectObservationTimeoutMs = DISCONNECT_OBSERVATION_TIMEOUT_MS,
  environment = process.env,
  forceKillDelayMs = FORCE_KILL_DELAY_MS,
  groupOwnerPath = GROUP_OWNER_PATH,
  killArmTimeoutMs = KILL_ARM_TIMEOUT_MS,
  observeLifecycle = () => {},
  onWorkerMessage = () => {},
  ownerCloseWaitMs = OWNER_TERMINATION_TIMEOUT_MS,
  probeGroup = defaultProbeGroup,
  scheduleTimer = setTimeout,
  spawnOwner,
  spawnProcess = spawn,
  termResultTimeoutMs = TERM_RESULT_TIMEOUT_MS,
  testCancellationSignal,
  timeoutMs = TIMEOUT_MS,
  workerArguments = [],
  workerPath = WORKER_PATH,
} = {}) {
  if (process.platform === "win32") {
    return Promise.resolve({
      code: 1,
      stderr:
        "Chromium preflight requires POSIX process-group cancellation on this platform.",
    });
  }

  return new Promise((resolveResult) => {
    let absenceConfirmed = false;
    let groupId;
    let handoffOccurred = false;
    let owner;
    let ownerDisconnectCalled = false;
    let ownerReady = false;
    let ownerStderr = "";
    let ownerTerminated = false;
    let ownership = "UNCONFIRMED";
    let pendingKillRequestId;
    let pendingTermRequestId;
    let probeFailure;
    let requestId = 0;
    let startGateClosed = false;
    let state = "SPAWNING_OWNER";
    let terminalCause;
    const cleanupFailures = [];
    const timers = {
      absenceDeadline: undefined,
      absenceProbe: undefined,
      disconnectObservation: undefined,
      force: undefined,
      killArm: undefined,
      ownerTermination: undefined,
      termResult: undefined,
      worker: undefined,
    };

    const clearNamedTimer = (name) => {
      if (timers[name] === undefined) return;
      cancelTimer(timers[name]);
      timers[name] = undefined;
    };
    const clearMessageTimers = () => {
      for (const name of [
        "termResult",
        "force",
        "killArm",
        "ownerTermination",
      ]) {
        clearNamedTimer(name);
      }
    };
    const clearAllTimers = () => {
      for (const name of Object.keys(timers)) clearNamedTimer(name);
    };
    const addCleanupFailure = (message) => {
      if (!cleanupFailures.includes(message)) cleanupFailures.push(message);
    };
    const emitLifecycle = (type, detail = {}) => {
      observeLifecycle(
        Object.freeze({
          ...detail,
          absenceConfirmed,
          handoffOccurred,
          owner,
          ownerPid: groupId,
          ownership,
          state,
          type,
        }),
      );
    };
    const removeCancellationListener = () => {
      if (!testCancellationSignal) return;
      capture(() =>
        testCancellationSignal.removeEventListener(
          "abort",
          handleTestCancellation,
        ),
      );
    };
    const settle = () => {
      if (state === "SETTLED") return;
      state = "SETTLED";
      clearAllTimers();
      removeCancellationListener();
      const cause = terminalCause ?? {
        code: 1,
        stderr: "Chromium preflight ended without a worker outcome.",
      };
      const code =
        cause.code === 0 && cleanupFailures.length > 0 ? 1 : cause.code;
      const lines = [];
      if (cause.code === 0) {
        if (typeof cause.stderr === "string" && cause.stderr.length > 0) {
          lines.push(cause.stderr);
        }
      } else {
        lines.push(
          nonEmptyDiagnostic(
            cause.stderr,
            "Chromium preflight failed without a diagnostic.",
          ),
        );
      }
      for (const failure of cleanupFailures) {
        lines.push(
          nonEmptyDiagnostic(
            failure,
            "Chromium preflight cleanup failed without a diagnostic.",
          ),
        );
      }
      if (code !== 0 && lines.length === 0) {
        lines.push("Chromium preflight failed without a diagnostic.");
      }
      resolveResult({
        code,
        stderr: lines.join("\n"),
      });
    };
    const addOperationFailure = (operation, error) => {
      addCleanupFailure(
        `Chromium preflight could not ${operation} during cleanup: ${describeThrown(error)}`,
      );
    };
    const runCleanupOperation = (operation, callback) => {
      const result = capture(callback);
      if (result.threw) addOperationFailure(operation, result.error);
      return result;
    };
    const detachOwnerReferences = ({ disconnect }) => {
      const ownerChannel = owner?.channel;
      const ownerStderrStream = owner?.stderr;
      if (disconnect && !ownerDisconnectCalled && !ownerTerminated) {
        const connected = capture(() => owner?.connected);
        if (connected.threw) {
          addOperationFailure(
            "inspect its group-owner IPC channel",
            connected.error,
          );
        } else if (connected.value && typeof owner?.disconnect === "function") {
          ownerDisconnectCalled = true;
          runCleanupOperation("disconnect its group owner", () =>
            owner.disconnect(),
          );
        }
      }
      if (typeof ownerChannel?.unref === "function") {
        runCleanupOperation("unreference its group-owner IPC channel", () =>
          ownerChannel.unref(),
        );
      }
      if (typeof ownerStderrStream?.destroy === "function") {
        runCleanupOperation("destroy its group-owner stderr", () =>
          ownerStderrStream.destroy(),
        );
      }
      if (typeof owner?.unref === "function") {
        runCleanupOperation("unreference its group owner", () => owner.unref());
      }
    };

    const confirmAbsence = () => {
      if (state === "SETTLED" || absenceConfirmed) return;
      absenceConfirmed = true;
      ownership = "RELEASED";
      if (!ownerTerminated) {
        addCleanupFailure(
          "Chromium preflight cleanup could not observe group-owner termination.",
        );
      }
      emitLifecycle("absence-confirmed");
      settle();
    };
    const beginAbsenceVerification = () => {
      if (
        state === "SETTLED" ||
        state === "VERIFYING_ABSENCE" ||
        absenceConfirmed
      ) {
        return;
      }
      state = "VERIFYING_ABSENCE";
      clearMessageTimers();
      if (!positivePid(groupId)) {
        addCleanupFailure(
          "Chromium preflight cleanup incomplete: group ownership is unavailable.",
        );
        settle();
        return;
      }
      timers.absenceDeadline = scheduleTimer(() => {
        if (state !== "VERIFYING_ABSENCE") return;
        const observation = probeFailure
          ? ` Last signal-zero observation failed: ${describeThrown(probeFailure)}.`
          : "";
        addCleanupFailure(
          `Chromium preflight cleanup incomplete: worker process group ${groupId} remained present after ${cleanupVerificationTimeoutMs}ms.${observation}`,
        );
        settle();
      }, cleanupVerificationTimeoutMs);

      const probe = () => {
        if (state !== "VERIFYING_ABSENCE") return;
        const result = capture(() => probeGroup(groupId, 0));
        if (result.threw && thrownCode(result.error) === "ESRCH") {
          confirmAbsence();
          return;
        }
        if (result.threw) probeFailure = result.error;
        timers.absenceProbe = scheduleTimer(probe, absenceProbeIntervalMs);
      };
      probe();
    };
    const handoffByDisconnect = (reason) => {
      if (
        state === "SETTLED" ||
        handoffOccurred ||
        absenceConfirmed ||
        ownerTerminated ||
        !owner
      ) {
        return false;
      }
      handoffOccurred = true;
      startGateClosed = true;
      state = "DISCONNECT_HANDOFF";
      emitLifecycle("handoff-occurred", { reason });
      clearMessageTimers();
      detachOwnerReferences({ disconnect: true });
      timers.disconnectObservation = scheduleTimer(() => {
        timers.disconnectObservation = undefined;
        if (!ownerTerminated && !absenceConfirmed && state !== "SETTLED") {
          addCleanupFailure(
            `Chromium preflight cleanup did not observe owner termination after disconnect: ${reason}.`,
          );
        }
      }, disconnectObservationTimeoutMs);
      beginAbsenceVerification();
      return true;
    };
    const cleanupRequestFailure = (phase, error) => {
      addCleanupFailure(
        `Chromium preflight could not send its ${phase} cleanup request: ${describeThrown(error)}`,
      );
      handoffByDisconnect(`${phase} cleanup request failed`);
    };
    const sendOwnerMessage = (message, onFailure) => {
      if (ownerTerminated || handoffOccurred || state === "SETTLED") {
        return false;
      }
      const result = capture(() =>
        owner.send(message, (error) => {
          if (
            callbackFailed(error) &&
            state !== "SETTLED" &&
            !ownerTerminated &&
            !handoffOccurred
          ) {
            onFailure(error);
          }
        }),
      );
      if (result.threw) {
        onFailure(result.error);
        return false;
      }
      return true;
    };

    const sendKillRequest = () => {
      timers.force = undefined;
      if (state !== "TERM_GRACE" || ownerTerminated || handoffOccurred) return;
      state = "WAITING_KILL_ARM";
      pendingKillRequestId = ++requestId;
      timers.killArm = scheduleTimer(() => {
        if (state !== "WAITING_KILL_ARM") return;
        addCleanupFailure(
          "Chromium preflight cleanup incomplete: its group owner did not arm SIGKILL.",
        );
        handoffByDisconnect("SIGKILL acknowledgement timed out");
      }, killArmTimeoutMs);
      sendOwnerMessage(
        {
          phase: "kill",
          requestId: pendingKillRequestId,
          type: "cleanup-request",
        },
        (error) => cleanupRequestFailure("SIGKILL", error),
      );
    };
    const beginForceDelay = () => {
      if (state === "SETTLED" || ownerTerminated || handoffOccurred) return;
      state = "TERM_GRACE";
      timers.force = scheduleTimer(sendKillRequest, forceKillDelayMs);
    };
    const sendTermRequest = () => {
      if (state === "SETTLED" || ownerTerminated || handoffOccurred || !owner) {
        return;
      }
      startGateClosed = true;
      state = "WAITING_TERM_RESULT";
      pendingTermRequestId = ++requestId;
      timers.termResult = scheduleTimer(() => {
        if (state !== "WAITING_TERM_RESULT") return;
        addCleanupFailure(
          "Chromium preflight cleanup incomplete: its group owner did not report the SIGTERM result.",
        );
        handoffByDisconnect("SIGTERM result timed out");
      }, termResultTimeoutMs);
      sendOwnerMessage(
        {
          phase: "term",
          requestId: pendingTermRequestId,
          type: "cleanup-request",
        },
        (error) => cleanupRequestFailure("SIGTERM", error),
      );
    };
    const recordTerminalCause = (cause) => {
      if (terminalCause || state === "SETTLED") return false;
      terminalCause = cause;
      startGateClosed = true;
      clearNamedTimer("worker");
      if (ownerTerminated) beginAbsenceVerification();
      else sendTermRequest();
      return true;
    };
    const protocolFailure = (diagnostic) => {
      const text = `Chromium preflight cleanup protocol error: ${diagnostic}`;
      if (!terminalCause) {
        terminalCause = { code: 1, stderr: text };
        clearNamedTimer("worker");
      } else {
        addCleanupFailure(text);
      }
      startGateClosed = true;
      sendOwnerMessage(
        { diagnostic, type: "cleanup-protocol-error" },
        (error) =>
          addCleanupFailure(
            `Chromium preflight could not report its cleanup protocol error: ${describeThrown(error)}`,
          ),
      );
      handoffByDisconnect("cleanup protocol error");
    };
    const handleOwnerTermination = (source) => {
      if (state === "SETTLED" || ownerTerminated) return;
      ownerTerminated = true;
      ownership = "RELEASED";
      clearMessageTimers();
      clearNamedTimer("disconnectObservation");
      if (!terminalCause) {
        terminalCause = {
          code: 1,
          stderr: `Chromium preflight group owner exited before its worker outcome.${ownerStderr.trim() ? ` ${ownerStderr.trim()}` : ""}`,
        };
        clearNamedTimer("worker");
      }
      emitLifecycle("owner-exited", { source });
      beginAbsenceVerification();
    };

    function handleTestCancellation() {
      if (state === "SETTLED") return;
      if (!terminalCause) {
        terminalCause = {
          code: 1,
          stderr: "Chromium preflight was cancelled by its test harness.",
        };
      }
      clearNamedTimer("worker");
      startGateClosed = true;
      if (owner && !ownerTerminated) {
        handoffByDisconnect("test cancellation");
      } else if (ownerTerminated) {
        beginAbsenceVerification();
      } else {
        settle();
      }
    }

    if (testCancellationSignal) {
      const registered = capture(() =>
        testCancellationSignal.addEventListener(
          "abort",
          handleTestCancellation,
          { once: true },
        ),
      );
      if (registered.threw) {
        terminalCause = {
          code: 1,
          stderr: `Chromium preflight could not register test cancellation: ${describeThrown(registered.error)}`,
        };
        settle();
        return;
      }
      if (testCancellationSignal.aborted) {
        handleTestCancellation();
        return;
      }
    }

    const ownerSpawner =
      spawnOwner ??
      ((options) => defaultSpawnOwner({ ...options, spawnProcess }));
    const spawned = capture(() =>
      ownerSpawner({
        environment,
        groupOwnerPath,
        workerArguments,
        workerPath,
      }),
    );
    if (spawned.threw) {
      terminalCause = {
        code: 1,
        stderr: `Chromium preflight could not start its group owner: ${describeThrown(spawned.error)}`,
      };
      settle();
      return;
    }
    owner = spawned.value;
    groupId = capture(() => owner?.pid).value;
    if (!owner || typeof owner.on !== "function" || !positivePid(groupId)) {
      terminalCause = {
        code: 1,
        stderr:
          "Chromium preflight could not start its group owner: group owner process is unavailable",
      };
      detachOwnerReferences({ disconnect: true });
      settle();
      return;
    }

    state = "WAITING_READY";
    emitLifecycle("owner-spawned");
    timers.worker = scheduleTimer(() => {
      recordTerminalCause({
        code: 1,
        stderr: `Chromium preflight timed out after ${timeoutMs}ms while waiting for its worker outcome.`,
      });
    }, timeoutMs);
    owner.stderr?.on("data", (chunk) => {
      ownerStderr += chunk;
    });
    owner.on("message", (message) => {
      if (state === "SETTLED") return;
      const messageType = readOwnerMessageType(message);
      if (messageType.kind === "malformed") {
        protocolFailure("received a malformed owner message.");
        return;
      }
      if (messageType.kind === "unknown") {
        protocolFailure("received an unknown owner message type.");
        return;
      }
      if (messageType.type === "worker-message") {
        const workerMessage = capture(() => message.message);
        if (!workerMessage.threw) onWorkerMessage(workerMessage.value);
        return;
      }
      if (messageType.type === "owner-ready") {
        if (ownerReady || state !== "WAITING_READY" || startGateClosed) return;
        ownerReady = true;
        ownership = "HELD";
        state = "RUNNING_WORKER";
        sendOwnerMessage({ type: "start" }, (error) => {
          recordTerminalCause({
            code: 1,
            stderr: `Chromium preflight could not start its worker: ${describeThrown(error)}`,
          });
        });
        return;
      }
      if (messageType.type === "worker-outcome") {
        if (!ownerReady || state !== "RUNNING_WORKER") return;
        const code = capture(() => message.code);
        const stderr = capture(() => message.stderr);
        if (
          code.threw ||
          !validWorkerExitCode(code.value) ||
          stderr.threw ||
          typeof stderr.value !== "string"
        ) {
          protocolFailure("received a malformed worker outcome.");
          return;
        }
        recordTerminalCause({
          code: code.value,
          stderr:
            code.value === 0
              ? stderr.value
              : nonEmptyDiagnostic(
                  stderr.value,
                  "Chromium preflight worker failed without a diagnostic.",
                ),
        });
        return;
      }
      if (messageType.type === "cleanup-term-result") {
        const responseId = capture(() => message.requestId);
        const status = capture(() => message.status);
        if (
          state !== "WAITING_TERM_RESULT" ||
          responseId.threw ||
          responseId.value !== pendingTermRequestId ||
          status.threw ||
          (status.value !== "dispatched" && status.value !== "failed")
        ) {
          protocolFailure("received a stale or malformed SIGTERM result.");
          return;
        }
        clearNamedTimer("termResult");
        if (status.value === "failed") {
          const diagnostic = capture(() => message.diagnostic);
          addCleanupFailure(
            nonEmptyDiagnostic(
              diagnostic.threw ? undefined : diagnostic.value,
              "Chromium preflight group owner reported SIGTERM failure without a diagnostic.",
            ),
          );
        }
        beginForceDelay();
        return;
      }
      if (messageType.type === "cleanup-kill-armed") {
        const responseId = capture(() => message.requestId);
        if (
          state !== "WAITING_KILL_ARM" ||
          responseId.threw ||
          responseId.value !== pendingKillRequestId
        ) {
          protocolFailure(
            "received a stale or malformed SIGKILL acknowledgement.",
          );
          return;
        }
        clearNamedTimer("killArm");
        state = "WAITING_OWNER_TERMINATION";
        timers.ownerTermination = scheduleTimer(() => {
          if (state !== "WAITING_OWNER_TERMINATION") return;
          addCleanupFailure(
            "Chromium preflight cleanup incomplete: its group owner did not terminate after SIGKILL was armed.",
          );
          handoffByDisconnect("group-owner termination timed out");
        }, ownerCloseWaitMs);
        return;
      }
      if (messageType.type === "cleanup-kill-failed") {
        const responseId = capture(() => message.requestId);
        const diagnostic = capture(() => message.diagnostic);
        if (
          (state !== "WAITING_KILL_ARM" &&
            state !== "WAITING_OWNER_TERMINATION") ||
          responseId.threw ||
          responseId.value !== pendingKillRequestId
        ) {
          protocolFailure("received a stale or malformed SIGKILL failure.");
          return;
        }
        clearNamedTimer("killArm");
        clearNamedTimer("ownerTermination");
        addCleanupFailure(
          nonEmptyDiagnostic(
            diagnostic.threw ? undefined : diagnostic.value,
            "Chromium preflight group owner reported SIGKILL failure without a diagnostic.",
          ),
        );
        handoffByDisconnect("SIGKILL dispatch failed");
        return;
      }
      if (messageType.type === "cleanup-protocol-error") {
        const diagnostic = capture(() => message.diagnostic);
        protocolFailure(
          nonEmptyDiagnostic(
            diagnostic.threw ? undefined : diagnostic.value,
            "the group owner reported a cleanup protocol error without a diagnostic.",
          ),
        );
      }
    });
    owner.on("error", (error) => {
      if (state === "SETTLED") return;
      if (!terminalCause) {
        recordTerminalCause({
          code: 1,
          stderr: ownerReady
            ? `Chromium preflight group owner failed: ${describeThrown(error)}`
            : `Chromium preflight could not start its group owner: ${describeThrown(error)}`,
        });
      } else if (!ownerTerminated && !handoffOccurred) {
        addCleanupFailure(
          `Chromium preflight group owner failed during cleanup: ${describeThrown(error)}`,
        );
        handoffByDisconnect("group-owner error");
      }
    });
    owner.on("exit", () => {
      handleOwnerTermination("exit");
    });
    owner.on("close", () => {
      handleOwnerTermination("close");
    });
  });
}

export async function main(args, { stderr = console.error } = {}) {
  if (args.length !== 0) return 2;
  const result = await runChromiumPreflight();
  if (result.code !== 0 && result.stderr) stderr(result.stderr);
  return result.code;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main(process.argv.slice(2));
}
