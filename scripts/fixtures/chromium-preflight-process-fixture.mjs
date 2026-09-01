import { spawn } from "node:child_process";
import { fstatSync, writeFileSync } from "node:fs";

const [
  mode,
  statePath,
  markerDescriptorValue,
  deadmanDescriptorValue,
  markerDescriptorFingerprint,
  deadmanDescriptorFingerprint,
] = process.argv.slice(2);

const testEnvironmentKeys = [
  "CHROMIUM_PREFLIGHT_TEST_SPAWN_BOUNDARY_FD",
  "CHROMIUM_PREFLIGHT_TEST_DEADMAN_FD",
  "CHROMIUM_PREFLIGHT_TEST_KILL_FAILURE",
];

function holdOpen() {
  setInterval(() => {}, 1_000);
}

function descriptorIsOpen(value, expectedFingerprint) {
  const descriptor = Number(value);
  if (!Number.isSafeInteger(descriptor) || !expectedFingerprint) return false;
  try {
    const stat = fstatSync(descriptor);
    return `${stat.dev}:${stat.ino}` === expectedFingerprint;
  } catch (error) {
    if (error.code === "EBADF") return false;
    throw error;
  }
}

function recordReadyDescendant(descendantPid, onRecorded) {
  const ownerPid = Number.parseInt(
    process.env.CHROMIUM_PREFLIGHT_GROUP_OWNER_PID ?? "",
    10,
  );
  const state = {
    deadmanDescriptorOpen: descriptorIsOpen(
      deadmanDescriptorValue,
      deadmanDescriptorFingerprint,
    ),
    descendantPid,
    fixtureTestEnvironmentLeaked: testEnvironmentKeys.some(
      (key) => process.env[key] !== undefined,
    ),
    fixtureLeaderPid: process.pid,
    groupOwnerPid: Number.isSafeInteger(ownerPid) ? ownerPid : null,
    markerDescriptorOpen: descriptorIsOpen(
      markerDescriptorValue,
      markerDescriptorFingerprint,
    ),
  };
  writeFileSync(statePath, JSON.stringify(state));
  if (process.send) {
    process.send({ type: "fixture-ready", ...state }, onRecorded);
  } else {
    onRecorded();
  }
}

function spawnTermIgnoringDescendant(onReady) {
  const descendant = spawn(
    process.execPath,
    [process.argv[1], "term-ignoring-descendant"],
    { stdio: ["ignore", "ignore", "ignore", "ipc"] },
  );
  descendant.once("error", (error) => {
    console.error(`Fixture descendant failed to start: ${error.message}`);
    process.exit(1);
  });
  descendant.once("message", (message) => {
    if (message?.type !== "descendant-ready") return;
    recordReadyDescendant(descendant.pid, () => onReady(descendant));
  });
}

if (mode === "succeeds") {
  process.exitCode = 0;
} else if (mode === "fails") {
  console.error("Chromium launch denied by the local sandbox.");
  process.exitCode = 7;
} else if (mode === "succeeds-with-descendant") {
  spawnTermIgnoringDescendant((descendant) => {
    descendant.disconnect();
    descendant.unref();
    process.exit(0);
  });
} else if (mode === "fails-with-descendant") {
  spawnTermIgnoringDescendant((descendant) => {
    descendant.disconnect();
    descendant.unref();
    console.error("Chromium launch denied after starting a descendant.");
    process.exit(7);
  });
} else if (mode === "leader-exits-on-term-with-descendant") {
  process.on("SIGTERM", () => process.exit(0));
  spawnTermIgnoringDescendant(() => holdOpen());
} else if (mode === "ignores-term-with-descendant") {
  process.on("SIGTERM", () => {});
  spawnTermIgnoringDescendant(() => holdOpen());
} else if (mode === "observes-term-with-descendant") {
  process.on("SIGTERM", () => {
    process.send?.({ type: "fixture-term-observed" });
  });
  spawnTermIgnoringDescendant(() => holdOpen());
} else if (mode === "term-ignoring-descendant") {
  process.on("SIGTERM", () => {});
  process.send?.({ type: "descendant-ready" });
  holdOpen();
} else {
  throw new Error(`Unknown fixture mode: ${mode}`);
}
