import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { main, prepareIsolatedSupabaseWorkdir } from "./verify-access.mjs";
import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";

const localCredentials = JSON.stringify({
  API_URL: "http://127.0.0.1:54331",
  PUBLISHABLE_KEY: "local-publishable",
  SECRET_KEY: "local-secret",
});

const startCommand = [
  "npx",
  [
    "supabase",
    "start",
    "-x",
    "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
  ],
];
const ownershipCommand = [
  "docker",
  [
    "inspect",
    "supabase_db_rentcottage",
    "--format",
    '{{ index .Config.Labels "com.supabase.cli.project" }}|{{ index .Config.Labels "com.supabase.cli.workdir" }}',
  ],
];
const resetCommand = ["npx", ["supabase", "db", "reset", "--local"]];
const statusCommand = ["npx", ["supabase", "status", "-o", "json"]];
const stopCommand = ["npx", ["supabase", "stop", "--no-backup"]];
const declaredSchemaDiffCommand = [
  "npx",
  ["supabase", "db", "diff", "--local", "--output-format", "json"],
];
const emptyDeclaredSchemaDiff = JSON.stringify({
  diff: "",
  file: null,
  files: [],
  schemas: [],
  engine: "pg-delta",
  dropStatements: [],
  message: "Diff complete.",
});
const databasePreflightCommands = [
  declaredSchemaDiffCommand,
  ["npx", ["supabase", "test", "db"]],
  [
    "node",
    [
      "scripts/verify-cottage-profile-draft-concurrency.mjs",
      "--verify-migration-preflight",
      "--defer-successful-restore",
    ],
  ],
  [
    "node",
    [
      "scripts/verify-booking-period-hold-concurrency.mjs",
      "--verify-migration-preflight",
    ],
  ],
  [
    "node",
    [
      "scripts/verify-booking-request-lifecycle-upgrade.mjs",
      "--defer-successful-restore",
    ],
  ],
  ["node", ["scripts/verify-booking-request-capture-work-upgrade.mjs"]],
  [
    "node",
    ["scripts/verify-booking-request-payment-required-expiry-upgrade.mjs"],
  ],
  ["node", ["scripts/verify-booking-request-payment-history-upgrade.mjs"]],
];
const databaseCheckCommands = [
  ["node", ["scripts/verify-access-fixture-contract.mjs"]],
  ["node", ["scripts/prepare-access-test.mjs", "create", "mobile"]],
  ["node", ["scripts/verify-cottage-profile-draft-concurrency.mjs"]],
  ["node", ["scripts/verify-cottage-shift-schedule-concurrency.mjs"]],
  ["node", ["scripts/verify-cottage-inventory-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-period-hold-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-request-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-request-lifecycle-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-request-capture-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-request-payment-recovery-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-request-payment-history-concurrency.mjs"]],
  [
    "node",
    ["scripts/verify-booking-confirmation-notification-concurrency.mjs"],
  ],
  [
    "node",
    ["scripts/verify-booking-request-payment-required-expiry-concurrency.mjs"],
  ],
];
const browserCommands = [
  ["node", ["scripts/prepare-access-test.mjs", "create", "mobile", "desktop"]],
  [
    "node",
    ["scripts/prepare-access-test.mjs", "validate", "mobile", "desktop"],
  ],
  [
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
  ],
  ["node", ["scripts/prepare-access-test.mjs", "create", "worker"]],
  ["node", ["scripts/prepare-access-test.mjs", "validate", "worker"]],
  ["npm", ["run", "build:worker"]],
  [
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
  ],
  ["node", ["scripts/verify-booking-request-scheduled-expiry.mjs", "--seed"]],
  [
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
  ],
  ["node", ["scripts/verify-booking-request-scheduled-expiry.mjs", "--verify"]],
];

function runUpgradeVerifier(
  script,
  args,
  { failPriorReset = false, failProof = false } = {},
) {
  const fakeBin = mkdtempSync(join(tmpdir(), "rentcottage-upgrade-verifier-"));
  const commandLog = join(fakeBin, "commands.log");
  const npxPath = join(fakeBin, "npx");
  const dockerPath = join(fakeBin, "docker");
  writeFileSync(
    npxPath,
    `#!/bin/sh
printf 'npx %s\\n' "$*" >> "$COMMAND_LOG"
case "$FAIL_PRIOR_RESET:$*" in
  1:*--version*) printf 'forced prior reset failure\\n' >&2; exit 7 ;;
esac
`,
  );
  writeFileSync(
    dockerPath,
    `#!/bin/sh
printf 'docker %s\\n' "$*" >> "$COMMAND_LOG"
if [ "$1" = "inspect" ]; then
  printf '%s|%s\\n' "$SUPABASE_LOCAL_PROJECT" "$PWD"
  exit 0
fi
sql=$(cat)
sql=$(printf '%s\\n' "$sql" | sed '/-- BEGIN PAYMENT EVIDENCE FIXTURE/,/-- END PAYMENT EVIDENCE FIXTURE/d')
if [ "$FAIL_PROOF" = "1" ]; then
  case "$sql" in
    *"select max(version)"*|*"owner_application_cottage_profiles where owner_user_id"*)
      printf 'forced proof failure\\n' >&2
      exit 8
      ;;
  esac
fi
case "$sql" in
  *"select max(version)"*) printf '20260822090100\\n' ;;
  *"bool_and(name = 'Preserved private cottage'"*) printf '1|t|1|2\\n' ;;
  *"owner_application_cottage_profiles where owner_user_id"*) printf '21|Preserved private cottage|Private orchard gate|Turn after the old bridge|Preserved description|Preserved rules|1|2\\n' ;;
  *"begin_booking_request_authorization_claim"*) printf '%s\\n' '{"status":"ready","executionPermit":{"claimId":"96000000-0000-4000-8000-000000000633","generation":1,"idempotencyKey":"booking-request:96000000-0000-4000-8000-000000000633:1","notAfter":"2101-01-01T00:00:00.000Z","purpose":"booking-request-authorization"}}' ;;
  *"reload_booking_request_payment_operation"*) printf 'RC409\\n' >&2; exit 1 ;;
  *"pg_temp.payment_query"*|*"pg_temp.payment_execute"*) printf '%s\\n' '{"outcome":"succeeded","providerRequestId":"request","providerReference":"reference","movementReference":"movement"}' ;;
  *"VERBOSITY verbose"*"create_owner_cottage_profile_draft"*|*"VERBOSITY verbose"*"restore_administrator_cottage_profile_draft"*) printf 'RC420\\n' >&2; exit 1 ;;
esac
`,
  );
  chmodSync(npxPath, 0o755);
  chmodSync(dockerPath, 0o755);

  try {
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts", script), ...args],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          COMMAND_LOG: commandLog,
          FAIL_PRIOR_RESET: failPriorReset ? "1" : "0",
          FAIL_PROOF: failProof ? "1" : "0",
          PATH: `${fakeBin}:${process.env.PATH}`,
          SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-verifier-test",
          SUPABASE_LOCAL_PROJECT: "rentcottage-verifier-test",
        },
      },
    );
    return {
      commands: existsSync(commandLog) ? readFileSync(commandLog, "utf8") : "",
      result,
    };
  } finally {
    rmSync(fakeBin, { recursive: true, force: true });
  }
}

function ownedRun(
  implementation,
  { project = "rentcottage", workdir = process.cwd() } = {},
) {
  return vi.fn((command, args, options) => {
    if (command === "docker" && args[0] === "inspect") {
      const ownedWorkdir = typeof workdir === "function" ? workdir() : workdir;
      return { status: 0, stdout: `${project}|${ownedWorkdir}\n`, stderr: "" };
    }
    if (
      command === "npx" &&
      args.slice(0, 6).join(" ") ===
        "supabase db diff --local --output-format json"
    ) {
      const result = implementation(command, args, options);
      return result.stdout
        ? result
        : { ...result, stdout: emptyDeclaredSchemaDiff };
    }
    return implementation(command, args, options);
  });
}

function successfulRun({
  project = "rentcottage",
  workdir = process.cwd(),
} = {}) {
  return ownedRun(
    (command, args) => ({
      status: 0,
      stdout:
        command === "npx" && args.join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }),
    { project, workdir },
  );
}

function commands(run) {
  return run.mock.calls.map(([command, args]) => [command, args]);
}

function processIdentity(pid) {
  const result = spawnSync(
    "ps",
    ["-o", "pgid=,lstart=,command=", "-p", String(pid)],
    {
      encoding: "utf8",
      env: { ...process.env, LANG: "C", LC_ALL: "C" },
    },
  );
  if (result.error) throw result.error;
  if (result.status === 1 && !result.stdout.trim() && !result.stderr.trim()) {
    return undefined;
  }
  if (result.status !== 0)
    throw new Error(`Process inspection failed: ${result.stderr}`);
  const match = result.stdout.trim().match(/^(\d+)\s+(.{24})\s+(.+)$/);
  if (!match) throw new Error(`Unreadable process identity for PID ${pid}.`);
  return { group: Number(match[1]), started: match[2], command: match[3] };
}

function processIsAlive(pid) {
  return processIdentity(pid) !== undefined;
}

function assertProcessObserverReady() {
  if (!processIdentity(process.pid)) {
    throw new Error("Unable to observe the lifecycle-test process identity.");
  }
}

async function waitForCondition(predicate, label, limit = 4_000) {
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

async function waitForChildExit(child, label, limit = 4_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode };
  }
  return await new Promise((resolveExit, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${label}.`)),
      limit,
    );
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });
}

async function stopExactFixtureProcess(identity) {
  const liveIdentity = processIdentity(identity.pid);
  if (!liveIdentity) return;
  if (!liveIdentity.command.includes(identity.token)) {
    throw new Error(
      `Refusing to stop PID ${identity.pid}; its command does not match ${identity.token}.`,
    );
  }
  process.kill(identity.pid, "SIGTERM");
  try {
    await waitForCondition(
      () => !processIsAlive(identity.pid),
      `${identity.token} to exit gracefully`,
      500,
    );
  } catch {
    const resistantIdentity = processIdentity(identity.pid);
    if (!resistantIdentity) return;
    if (
      !resistantIdentity.command.includes(identity.token) ||
      resistantIdentity.started !== liveIdentity.started ||
      resistantIdentity.group !== liveIdentity.group
    ) {
      throw new Error(
        `Refusing to force PID ${identity.pid}; its command does not match ${identity.token}.`,
      );
    }
    process.kill(identity.pid, "SIGKILL");
    await waitForCondition(
      () => !processIsAlive(identity.pid),
      `${identity.token} to exit forcibly`,
      2_000,
    );
  }
}

async function observeInterruptedAccessVerification(
  signal,
  {
    descendantBehavior = "graceful",
    completedCommandStatus,
    groupPermissionFailure = false,
    hangCleanup = false,
    inspectionFailure,
    interruptStartup = false,
    cleanupStage,
  } = {},
) {
  assertProcessObserverReady();
  const stateRoot = mkdtempSync(
    join(tmpdir(), "rentcottage-access-interruption-"),
  );
  const fakeBin = join(stateRoot, "bin");
  mkdirSync(fakeBin);
  const token = basename(stateRoot);
  const fixtureProcess = join(stateRoot, "fixture-process.mjs");
  const commandBoundary = join(stateRoot, `command-boundary-${token}.mjs`);
  const inspectionBoundary = join(stateRoot, "inspection-boundary.mjs");
  writeFileSync(
    inspectionBoundary,
    `
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { existsSync, writeFileSync } from "node:fs";
const originalSpawn = childProcess.spawn;
const root = process.env.ACCESS_INTERRUPTION_ROOT;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => setImmediate(() => writeFileSync(root + "/signal.handled", signal)));
}
const originalKill = process.kill;
process.kill = (pid, signal) => {
  if (pid < 0 && signal !== 0) {
    writeFileSync(root + "/termination-attempt", String(pid));
    if (process.env.ACCESS_GROUP_PERMISSION_FAILURE === "1") {
      const error = new Error("kill EPERM");
      error.code = "EPERM";
      throw error;
    }
  }
  if (pid < 0 && signal === 0 && ((process.env.ACCESS_GROUP_PERMISSION_FAILURE === "1" && existsSync(root + "/termination-attempt")) || existsSync(root + "/command.completed") || (process.env.ACCESS_INSPECTION_FAILURE === "reidentify-permission" && existsSync(root + "/fail-inspection")))) {
    const error = new Error("kill EPERM");
    error.code = "EPERM";
    throw error;
  }
  return originalKill.call(process, pid, signal);
};
let inspectCommand = false;
childProcess.spawn = (command, args, options) => {
  if (command === "npx" && (process.env.ACCESS_INSPECTION_FAILURE === "overflow"
    ? args[1] === "start" : args[1] === "db" && args[2] === "reset")) inspectCommand = true;
  if (command === "/bin/ps" && inspectCommand) {
    if (process.env.ACCESS_INSPECTION_FAILURE === "initial-timeout") {
      return originalSpawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options);
    }
    if (existsSync(root + "/fail-inspection")) {
      return originalSpawn(process.execPath, ["-e", "process.stderr.write('controlled inspection unavailable'); process.exit(1)"], options);
    }
    const child = originalSpawn(command, args, options);
    child.once("close", () => writeFileSync(root + "/identity.ready", "inspected"));
    return child;
  }
  return originalSpawn(command, args, options);
};
syncBuiltinESMExports();
`,
  );
  writeFileSync(
    fixtureProcess,
    `import { writeFileSync } from "node:fs";
const [readyFile, token, behavior = "graceful"] = process.argv.slice(2);
writeFileSync(readyFile, JSON.stringify({ pid: process.pid, ppid: process.ppid, token }));
const finish = () => process.exit(0);
const ignore = () => { process.title = "retitled-" + token; };
process.on("SIGTERM", behavior === "ignore" ? ignore : finish);
process.on("SIGINT", behavior === "ignore" ? ignore : finish);
setInterval(() => {}, 1000);
`,
  );
  writeFileSync(
    commandBoundary,
    `#!${process.execPath}
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const command = basename(process.argv[1]);
const args = process.argv.slice(2);
const root = process.env.ACCESS_INTERRUPTION_ROOT;
const token = process.env.ACCESS_INTERRUPTION_TOKEN;
const fixtureProcess = process.env.ACCESS_INTERRUPTION_FIXTURE;
const hangCleanup = process.env.ACCESS_INTERRUPTION_HANG_CLEANUP === "1";
const interruptStartup = process.env.ACCESS_INTERRUPTION_STARTUP === "1";
const overflow = process.env.ACCESS_INSPECTION_FAILURE === "overflow";
const cleanupStage = process.env.ACCESS_INTERRUPTION_CLEANUP_STAGE;
const invocation = [command, ...args].join(" ");
appendFileSync(root + "/commands.log", invocation + "\\n");

const alive = (pid) => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
};
const waitFor = async (predicate) => {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error("Fixture readiness timeout.");
};

if (command === "docker" && args[0] === "inspect") {
  if (cleanupStage === "inspection" && existsSync(root + "/inspected")) {
    writeFileSync(root + "/cleanup.ready", JSON.stringify({ pid: process.pid, token: "cleanup-stop-" + token }));
    await waitFor(() => existsSync(root + "/cleanup.release"));
  }
  writeFileSync(root + "/inspected", "inspected");
  process.stdout.write("rentcottage|" + process.cwd() + "\\n");
  process.exit(0);
}
if (args[0] !== "supabase") process.exit(0);
if (args[1] === "start") {
  const serviceToken = "owned-service-" + token;
  const child = spawn(process.execPath, [fixtureProcess, root + "/service.ready", serviceToken], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  await waitFor(() => existsSync(root + "/service.ready"));
  if (!interruptStartup && !overflow) process.exit(0);
}
if (args[1] === "stop") {
  appendFileSync(root + "/stop.log", "stop invoked\\n");
  if (cleanupStage === "stop") {
    writeFileSync(root + "/cleanup.ready", JSON.stringify({ pid: process.pid, token: "cleanup-stop-" + token }));
    await waitFor(() => existsSync(root + "/cleanup.release"));
  }
  if (hangCleanup) {
    writeFileSync(root + "/cleanup.ready", JSON.stringify({
      pid: process.pid,
      ppid: process.ppid,
      token: "cleanup-stop-" + token,
    }));
    const ignore = () => { process.title = "retitled-cleanup-stop-" + token; };
    process.on("SIGTERM", ignore);
    process.on("SIGINT", ignore);
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
  const service = JSON.parse(readFileSync(root + "/service.ready", "utf8"));
  if (alive(service.pid)) process.kill(service.pid, "SIGTERM");
  await waitFor(() => !alive(service.pid));
  process.exit(0);
}
if ((args[1] === "db" && args[2] === "reset") || (args[1] === "start" && (interruptStartup || overflow))) {
  if (hangCleanup || cleanupStage) process.exit(0);
  const descendantToken = "command-descendant-" + token;
  spawn(process.execPath, [fixtureProcess, root + "/descendant.ready", descendantToken, process.env.ACCESS_INTERRUPTION_DESCENDANT_BEHAVIOR], {
    stdio: "ignore",
  });
  await waitFor(() => existsSync(root + "/descendant.ready"));
  writeFileSync(root + "/command.ready", JSON.stringify({
    pid: process.pid,
    ppid: process.ppid,
    token,
  }));
  if (process.env.ACCESS_COMPLETED_COMMAND_STATUS) {
    await waitFor(() => existsSync(root + "/identity.ready") && existsSync(root + "/command.release"));
    const status = Number(process.env.ACCESS_COMPLETED_COMMAND_STATUS);
    if (status !== 0) process.stderr.write("Distinctive command failure before process probe\\n");
    writeFileSync(root + "/command.completed", "completed");
    process.exit(status);
  }
  const finish = () => process.exit(0);
  process.on("SIGTERM", finish);
  process.on("SIGINT", finish);
  setInterval(() => {}, 1000);
  if (overflow) {
    await waitFor(() => existsSync(root + "/identity.ready"));
    writeFileSync(root + "/fail-inspection", "fail");
    process.stdout.write(Buffer.alloc(1024 * 1024 + 1, 97));
  }
}
if (args[1] === "status") {
  process.stdout.write(JSON.stringify({
    API_URL: "http://127.0.0.1:54331",
    PUBLISHABLE_KEY: "fixture-publishable",
    SECRET_KEY: "fixture-secret",
  }));
}
`,
  );
  chmodSync(commandBoundary, 0o755);
  for (const command of ["npx", "docker", "node"]) {
    symlinkSync(commandBoundary, join(fakeBin, command));
  }

  const unrelatedReady = join(stateRoot, "unrelated.ready");
  const unrelatedToken = `unrelated-${token}`;
  const unrelated = spawn(
    process.execPath,
    [fixtureProcess, unrelatedReady, unrelatedToken],
    { detached: true, stdio: "ignore" },
  );
  unrelated.unref();
  let wrapper;
  try {
    await waitForCondition(
      () => existsSync(unrelatedReady),
      "unrelated fixture readiness",
    );
    wrapper = spawn(
      process.execPath,
      [
        ...(inspectionFailure ||
        groupPermissionFailure ||
        cleanupStage ||
        completedCommandStatus !== undefined
          ? ["--import", inspectionBoundary]
          : []),
        resolve(process.cwd(), "scripts/verify-access.mjs"),
        hangCleanup || cleanupStage ? "--fixture-contract" : "--database",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          ACCESS_INTERRUPTION_FIXTURE: fixtureProcess,
          ACCESS_INTERRUPTION_DESCENDANT_BEHAVIOR: descendantBehavior,
          ACCESS_INTERRUPTION_HANG_CLEANUP: hangCleanup ? "1" : "0",
          ACCESS_INTERRUPTION_STARTUP: interruptStartup ? "1" : "0",
          ACCESS_INTERRUPTION_CLEANUP_STAGE: cleanupStage ?? "",
          ACCESS_INTERRUPTION_ROOT: stateRoot,
          ACCESS_INTERRUPTION_TOKEN: token,
          ACCESS_INSPECTION_FAILURE: inspectionFailure ?? "",
          ACCESS_GROUP_PERMISSION_FAILURE: groupPermissionFailure ? "1" : "0",
          ACCESS_COMPLETED_COMMAND_STATUS:
            completedCommandStatus === undefined
              ? ""
              : String(completedCommandStatus),
          PATH: `${fakeBin}:${process.env.PATH}`,
          SUPABASE_LOCAL_PROJECT: "rentcottage",
          TMPDIR: stateRoot,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stderr = [];
    wrapper.stderr.on("data", (chunk) => stderr.push(String(chunk)));
    if (cleanupStage) {
      await waitForCondition(
        () => existsSync(join(stateRoot, "cleanup.ready")),
        "cleanup command readiness",
      );
      process.kill(wrapper.pid, signal);
      await waitForCondition(
        () => existsSync(join(stateRoot, "signal.handled")),
        "wrapper signal handling",
      );
      process.kill(wrapper.pid, signal);
      writeFileSync(join(stateRoot, "cleanup.release"), "finish");
      const wrapperExit = await waitForChildExit(
        wrapper,
        "signalled cleanup wrapper",
      );
      expect(wrapperExit, stderr.join("")).toEqual({
        code: signal === "SIGINT" ? 130 : 143,
        signal: null,
      });
      expect(stderr.join("")).toBe("");
      expect(existsSync(join(stateRoot, "termination-attempt"))).toBe(false);
      expect(readFileSync(join(stateRoot, "stop.log"), "utf8")).toBe(
        "stop invoked\n",
      );
      const service = JSON.parse(
        readFileSync(join(stateRoot, "service.ready"), "utf8"),
      );
      expect(processIsAlive(service.pid)).toBe(false);
      expect(processIsAlive(unrelated.pid)).toBe(true);
      return;
    }
    if (hangCleanup) {
      await waitForCondition(
        () => existsSync(join(stateRoot, "cleanup.ready")),
        "hung cleanup readiness",
      );
      const wrapperExit = await waitForChildExit(
        wrapper,
        "bounded hung-cleanup wrapper exit",
        40_000,
      );
      const service = JSON.parse(
        readFileSync(join(stateRoot, "service.ready"), "utf8"),
      );
      const unrelatedIdentity = JSON.parse(
        readFileSync(unrelatedReady, "utf8"),
      );
      expect(wrapperExit).toEqual({ code: 1, signal: null });
      expect(processIsAlive(service.pid)).toBe(true);
      expect(processIsAlive(unrelatedIdentity.pid)).toBe(true);
      expect(stderr.join("")).toContain("Command did not exit within 30000ms");
      expect(stderr.join("")).toContain("Local Supabase cleanup failed.");
      return;
    }
    await waitForCondition(
      () =>
        existsSync(join(stateRoot, "service.ready")) &&
        existsSync(join(stateRoot, "command.ready")) &&
        existsSync(join(stateRoot, "descendant.ready")),
      "owned process readiness",
    );
    const service = JSON.parse(
      readFileSync(join(stateRoot, "service.ready"), "utf8"),
    );
    const command = JSON.parse(
      readFileSync(join(stateRoot, "command.ready"), "utf8"),
    );
    const descendant = JSON.parse(
      readFileSync(join(stateRoot, "descendant.ready"), "utf8"),
    );
    const unrelatedIdentity = JSON.parse(readFileSync(unrelatedReady, "utf8"));
    expect(processIdentity(command.pid)?.group).toBe(
      processIdentity(descendant.pid)?.group,
    );

    if (inspectionFailure) {
      if (
        inspectionFailure === "reidentify" ||
        inspectionFailure === "reidentify-permission"
      ) {
        await waitForCondition(
          () => existsSync(join(stateRoot, "identity.ready")),
          "initial process inspection",
        );
        writeFileSync(join(stateRoot, "fail-inspection"), "fail");
        process.kill(wrapper.pid, signal);
        process.kill(wrapper.pid, signal);
      }
      const wrapperExit = await waitForChildExit(
        wrapper,
        "failed inspection wrapper",
      );
      expect(wrapperExit, stderr.join("")).toEqual({
        code: signal ? 143 : 1,
        signal: null,
      });
      expect(stderr.join("")).toContain(
        inspectionFailure === "initial-timeout"
          ? "Timed out inspecting owned process group"
          : inspectionFailure === "reidentify-permission"
            ? "Exact termination could not be confirmed: kill EPERM"
            : "controlled inspection unavailable",
      );
      if (inspectionFailure === "overflow")
        expect(stderr.join("")).toContain("spawn output exceeded maxBuffer");
      expect(stderr.join("")).toContain(
        `Retained command process group ${command.pid}`,
      );
      expect(stderr.join("")).not.toContain("at Timeout.");
      expect(stderr.join("")).not.toContain("at processGroupExists");
      expect(processIsAlive(command.pid)).toBe(true);
      expect(processIsAlive(descendant.pid)).toBe(true);
      expect(processIsAlive(service.pid)).toBe(true);
      expect(processIsAlive(unrelatedIdentity.pid)).toBe(true);
      expect(existsSync(join(stateRoot, "stop.log"))).toBe(false);
      return;
    }

    if (completedCommandStatus !== undefined) {
      writeFileSync(join(stateRoot, "command.release"), "finish");
      const wrapperExit = await waitForChildExit(
        wrapper,
        "completed command with unavailable group probe",
      );
      expect(wrapperExit, stderr.join("")).toEqual({
        code: completedCommandStatus || 1,
        signal: null,
      });
      expect(stderr.join("")).toContain(
        `Retained command process group ${command.pid}`,
      );
      expect(stderr.join("")).toContain(
        "Exact termination could not be confirmed: kill EPERM",
      );
      expect(stderr.join("")).not.toContain("at processGroupExists");
      if (completedCommandStatus !== 0) {
        expect(stderr.join("")).toContain(
          "Distinctive command failure before process probe",
        );
        expect(stderr.join("")).toContain(
          `(status ${completedCommandStatus}).`,
        );
      }
      const retainedState = stderr
        .join("")
        .match(/temporary state ([^\n]+)\./)?.[1];
      expect(retainedState).toBeTruthy();
      expect(existsSync(retainedState)).toBe(true);
      expect(processIsAlive(command.pid)).toBe(false);
      expect(processIsAlive(descendant.pid)).toBe(true);
      expect(processIsAlive(service.pid)).toBe(true);
      expect(processIsAlive(unrelatedIdentity.pid)).toBe(true);
      expect(existsSync(join(stateRoot, "stop.log"))).toBe(false);
      expect(existsSync(join(stateRoot, "termination-attempt"))).toBe(false);
      const invoked = readFileSync(join(stateRoot, "commands.log"), "utf8");
      expect(invoked.trimEnd().split("\n").at(-1)).toBe(
        "npx supabase db reset --local",
      );
      expect(invoked.match(/docker inspect/g)).toHaveLength(1);
      return;
    }

    process.kill(wrapper.pid, signal);
    process.kill(wrapper.pid, signal);
    const wrapperExit = await waitForChildExit(
      wrapper,
      "access wrapper exit",
      descendantBehavior === "ignore" ? 9_000 : 4_000,
    );
    if (interruptStartup) {
      expect(wrapperExit, stderr.join("")).toEqual({ code: 143, signal: null });
      expect(processIsAlive(command.pid)).toBe(false);
      expect(processIsAlive(descendant.pid)).toBe(false);
      expect(processIsAlive(service.pid)).toBe(true);
      expect(processIsAlive(unrelatedIdentity.pid)).toBe(true);
      expect(existsSync(join(stateRoot, "stop.log"))).toBe(false);
      expect(stderr.join("")).toContain(
        "Retained local Supabase project rentcottage",
      );
      const retainedState = stderr
        .join("")
        .match(/temporary state ([^\n]+)\./)?.[1];
      expect(retainedState).toBeTruthy();
      expect(existsSync(retainedState)).toBe(true);
      return;
    }
    if (groupPermissionFailure) {
      expect(wrapperExit, stderr.join("")).toEqual({
        code: 143,
        signal: null,
      });
      expect(stderr.join("")).toContain(
        "Exact termination could not be confirmed: kill EPERM",
      );
      expect(processIsAlive(command.pid)).toBe(true);
      expect(processIsAlive(descendant.pid)).toBe(true);
      expect(processIsAlive(service.pid)).toBe(true);
      expect(processIsAlive(unrelatedIdentity.pid)).toBe(true);
      expect(existsSync(join(stateRoot, "stop.log"))).toBe(false);
      return;
    }
    await waitForCondition(
      () =>
        !processIsAlive(command.pid) &&
        !processIsAlive(descendant.pid) &&
        !processIsAlive(service.pid),
      "owned process cleanup",
      descendantBehavior === "ignore" ? 9_000 : 4_000,
    );

    expect(wrapperExit, stderr.join("")).toEqual({
      code: signal === "SIGINT" ? 130 : 143,
      signal: null,
    });
    expect(existsSync(join(stateRoot, "stop.log"))).toBe(true);
    expect(readFileSync(join(stateRoot, "stop.log"), "utf8")).toBe(
      "stop invoked\n",
    );
    expect(processIsAlive(unrelatedIdentity.pid)).toBe(true);
    expect(stderr.join("")).toBe("");
  } finally {
    const cleanupErrors = [];
    const identities = [
      ["command.ready", token],
      ["descendant.ready", `command-descendant-${token}`],
      ["service.ready", `owned-service-${token}`],
      ["cleanup.ready", `cleanup-stop-${token}`],
      ["unrelated.ready", unrelatedToken],
    ];
    for (const [file, expectedToken] of identities) {
      const path = join(stateRoot, file);
      if (!existsSync(path)) continue;
      const identity = JSON.parse(readFileSync(path, "utf8"));
      try {
        expect(identity.token).toBe(expectedToken);
        await stopExactFixtureProcess(identity);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (wrapper && processIsAlive(wrapper.pid)) {
      try {
        process.kill(wrapper.pid, "SIGTERM");
        await waitForCondition(
          () => !processIsAlive(wrapper.pid),
          "access wrapper fixture cleanup",
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        "Fixture process cleanup failed.",
      );
    }
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

describe("local Supabase concurrency harness", () => {
  it("awaits the exact ownership inspection before granting asynchronous access", async () => {
    let resolveInspection;
    let settled = false;
    const execute = vi.fn(
      () =>
        new Promise((resolveResult) => {
          resolveInspection = resolveResult;
        }),
    );
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
      workingDirectory: "/tmp/rentcottage-worktree",
    });

    const guarded = harness
      .guardDisposableLocalDatabaseAsync(execute)
      .then(() => {
        settled = true;
      });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(execute).toHaveBeenCalledWith("docker", ownershipCommand[1], {
      encoding: "utf8",
      input: undefined,
      maxBuffer: 1024 * 1024,
    });
    resolveInspection({
      status: 0,
      stdout: "rentcottage|/tmp/rentcottage-worktree\n",
      stderr: "",
    });
    await guarded;
    expect(settled).toBe(true);
  });

  it("rejects an invalid asynchronous guard before execution", async () => {
    const execute = vi.fn();
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_elsewhere",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
    });

    await expect(
      harness.guardDisposableLocalDatabaseAsync(execute),
    ).rejects.toThrow(
      "The guarded local Supabase database identity is invalid.",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "unavailable inspection",
      result: { status: 1, stdout: "", stderr: "unavailable" },
      message: "The guarded local Supabase database container is unavailable.",
    },
    {
      name: "wrong project",
      result: {
        status: 0,
        stdout: "foreign|/tmp/rentcottage-worktree\n",
        stderr: "",
      },
      message:
        "The Supabase database container does not belong to this disposable local checkout.",
    },
    {
      name: "wrong worktree",
      result: {
        status: 0,
        stdout: "rentcottage|/tmp/foreign-worktree\n",
        stderr: "",
      },
      message:
        "The Supabase database container does not belong to this disposable local checkout.",
    },
    {
      name: "execution error result",
      result: { error: new Error("docker unavailable") },
      message: "Unable to execute local Docker.",
    },
  ])(
    "rejects asynchronous ownership for $name",
    async ({ result, message }) => {
      const harness = createLocalSupabaseConcurrencyHarness({
        environment: {
          SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
          SUPABASE_LOCAL_PROJECT: "rentcottage",
        },
        workingDirectory: "/tmp/rentcottage-worktree",
      });

      await expect(
        harness.guardDisposableLocalDatabaseAsync(async () => result),
      ).rejects.toThrow(message);
    },
  );

  it.each([
    new Error("inspection rejected"),
    Object.assign(new Error("inspection cancelled"), { name: "AbortError" }),
  ])("propagates asynchronous inspection rejection: %s", async (error) => {
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
    });

    await expect(
      harness.guardDisposableLocalDatabaseAsync(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });

  it("fails closed before Docker when the local project identity is invalid", () => {
    const spawnSyncProcess = vi.fn();
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_elsewhere",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
      spawnSyncProcess,
      workingDirectory: "/tmp/rentcottage-worktree",
    });

    expect(() => harness.guardDisposableLocalDatabase()).toThrow(
      "The guarded local Supabase database identity is invalid.",
    );
    expect(spawnSyncProcess).not.toHaveBeenCalled();
  });

  it("fails closed when the guarded database container is unavailable", () => {
    const spawnSyncProcess = vi.fn().mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "container unavailable",
    });
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
      spawnSyncProcess,
      workingDirectory: "/tmp/rentcottage-worktree",
    });

    expect(() => harness.guardDisposableLocalDatabase()).toThrow(
      "The guarded local Supabase database container is unavailable.",
    );
    expect(spawnSyncProcess).toHaveBeenCalledTimes(1);
  });

  it("fails closed when Docker reports a different Supabase project", () => {
    const spawnSyncProcess = vi.fn().mockReturnValue({
      status: 0,
      stdout: "foreign-project|/tmp/rentcottage-worktree\n",
      stderr: "",
    });
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
      spawnSyncProcess,
      workingDirectory: "/tmp/rentcottage-worktree",
    });

    expect(() => harness.guardDisposableLocalDatabase()).toThrow(
      "The Supabase database container does not belong to this disposable local checkout.",
    );
    expect(spawnSyncProcess).toHaveBeenCalledTimes(1);
  });

  it("fails closed when Docker reports a different Supabase worktree", () => {
    const spawnSyncProcess = vi.fn().mockReturnValue({
      status: 0,
      stdout: "rentcottage|/tmp/foreign-worktree\n",
      stderr: "",
    });
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
      spawnSyncProcess,
      workingDirectory: "/tmp/rentcottage-worktree",
    });

    expect(() => harness.guardDisposableLocalDatabase()).toThrow(
      "The Supabase database container does not belong to this disposable local checkout.",
    );
    expect(spawnSyncProcess).toHaveBeenCalledTimes(1);
  });

  it("guards the project and worktree before running exact local psql", () => {
    const spawnSyncProcess = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: "rentcottage|/tmp/rentcottage-worktree\n",
        stderr: "",
      })
      .mockReturnValueOnce({ status: 0, stdout: "1\n", stderr: "" });
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
      spawnSyncProcess,
      workingDirectory: "/tmp/rentcottage-worktree",
    });

    harness.guardDisposableLocalDatabase();
    expect(harness.runSql("select 1;")).toBe("1");
    expect(spawnSyncProcess).toHaveBeenNthCalledWith(
      2,
      "docker",
      [
        "exec",
        "-i",
        "supabase_db_rentcottage",
        "psql",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "postgres",
      ],
      expect.objectContaining({ encoding: "utf8", input: "select 1;\n" }),
    );
  });

  it("guards an isolated RentCottage project against its exact container and worktree", () => {
    const spawnSyncProcess = vi.fn().mockReturnValue({
      status: 0,
      stdout: "rentcottage-issue-32-v3|/tmp/rentcottage-issue-32-worktree\n",
      stderr: "",
    });
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-issue-32-v3",
        SUPABASE_LOCAL_PROJECT: "rentcottage-issue-32-v3",
      },
      spawnSyncProcess,
      workingDirectory: "/tmp/rentcottage-issue-32-worktree",
    });

    expect(() => harness.guardDisposableLocalDatabase()).not.toThrow();
    expect(spawnSyncProcess).toHaveBeenCalledWith(
      "docker",
      [
        "inspect",
        "supabase_db_rentcottage-issue-32-v3",
        "--format",
        '{{ index .Config.Labels "com.supabase.cli.project" }}|{{ index .Config.Labels "com.supabase.cli.workdir" }}',
      ],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });
});

describe("access verification command", () => {
  it("reports an initial process-inspection timeout and retains uncertain resources without an unhandled rejection", async () => {
    await observeInterruptedAccessVerification(undefined, {
      inspectionFailure: "initial-timeout",
    });
  }, 15_000);

  it("finishes cancellation reporting when process reidentification is unavailable while retaining uncertain processes", async () => {
    await observeInterruptedAccessVerification("SIGTERM", {
      inspectionFailure: "reidentify",
    });
  }, 15_000);

  it("retains uncertain processes when process inspection and its group probe both fail", async () => {
    await observeInterruptedAccessVerification("SIGTERM", {
      inspectionFailure: "reidentify-permission",
    });
  }, 15_000);

  it("reports output overflow even when uncertain process identity prevents termination", async () => {
    await observeInterruptedAccessVerification(undefined, {
      inspectionFailure: "overflow",
    });
  }, 15_000);

  it("retains and reports possible startup resources and temporary state when interrupted before ownership is established", async () => {
    await observeInterruptedAccessVerification("SIGTERM", {
      interruptStartup: true,
    });
  }, 15_000);

  it("finishes cancellation reporting when process-group permission is denied", async () => {
    await observeInterruptedAccessVerification("SIGTERM", {
      groupPermissionFailure: true,
    });
  }, 15_000);

  it.each([0, 37])(
    "reports process-group permission denial after command completion with status %s",
    async (completedCommandStatus) => {
      await observeInterruptedAccessVerification(undefined, {
        completedCommandStatus,
      });
    },
    15_000,
  );

  it.each([
    { cleanupStage: "inspection", signal: "SIGTERM" },
    { cleanupStage: "stop", signal: "SIGINT" },
  ])(
    "finishes one actual cleanup when the first $signal arrives during $cleanupStage",
    async ({ cleanupStage, signal }) => {
      await observeInterruptedAccessVerification(signal, { cleanupStage });
    },
    15_000,
  );

  it.each(["SIGTERM", "SIGINT"])(
    "cleans its owned process tree on %s while preserving an unrelated process",
    async (signal) => {
      await observeInterruptedAccessVerification(signal);
    },
    15_000,
  );

  it("forces a known same-group descendant to exit after its leader exits gracefully", async () => {
    await observeInterruptedAccessVerification("SIGTERM", {
      descendantBehavior: "ignore",
    });
  }, 20_000);

  it("bounds a hung cleanup command and reports the retained owned service", async () => {
    await observeInterruptedAccessVerification(undefined, {
      hangCleanup: true,
    });
  }, 45_000);

  it("exposes stable standalone database and browser aliases", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

    expect(packageJson.scripts["verify:access"]).toBe(
      "node scripts/verify-access.mjs",
    );
    expect(packageJson.scripts["verify:access:database"]).toBe(
      "node scripts/verify-access.mjs --database",
    );
    expect(packageJson.scripts["verify:access:browser"]).toBe(
      "node scripts/verify-access.mjs --browser",
    );
  });

  it("cleans the real isolated Supabase workdir on success and retains it after uncertain startup failure", async () => {
    const workingDirectory = process.cwd();
    const sourceConfigPath = join(workingDirectory, "supabase", "config.toml");
    const sourceConfig = readFileSync(sourceConfigPath, "utf8");
    const directState = mkdtempSync(
      join(tmpdir(), "rentcottage-access-workdir-direct-"),
    );
    try {
      const workdir = prepareIsolatedSupabaseWorkdir({
        localProject: "rentcottage-issue-32-constructor",
        stateRoot: directState,
        workingDirectory,
      });
      const generatedConfig = readFileSync(
        join(workdir, "supabase", "config.toml"),
        "utf8",
      );

      expect(generatedConfig).toContain(
        'project_id = "rentcottage-issue-32-constructor"',
      );
      for (const value of [
        "port = 55331",
        "port = 55332",
        "shadow_port = 55330",
        "port = 55339",
        "port = 55333",
        "port = 55334",
        "inspector_port = 8183",
        "port = 55337",
      ]) {
        expect(generatedConfig).toContain(value);
      }
      expect(readlinkSync(join(workdir, "supabase", "migrations"))).toBe(
        join(workingDirectory, "supabase", "migrations"),
      );
      expect(readlinkSync(join(workdir, "supabase", "schemas"))).toBe(
        join(workingDirectory, "supabase", "schemas"),
      );
      expect(readlinkSync(join(workdir, "supabase", "tests"))).toBe(
        join(workingDirectory, "supabase", "tests"),
      );
      expect(readFileSync(sourceConfigPath, "utf8")).toBe(sourceConfig);
    } finally {
      rmSync(directState, { recursive: true, force: true });
    }

    for (const startStatus of [0, 7]) {
      const stateRoot = mkdtempSync(
        join(tmpdir(), `rentcottage-access-workdir-${startStatus}-`),
      );
      const run = ownedRun(
        (command, args) => ({
          status: command === "npx" && args[1] === "start" ? startStatus : 0,
          stdout:
            command === "npx" && args.includes("status")
              ? localCredentials
              : "",
        }),
        {
          project: "rentcottage-issue-32-constructor",
          workdir: () => realpathSync(join(stateRoot, "project")),
        },
      );

      try {
        expect(
          await main([], {
            environment: {
              SUPABASE_LOCAL_PROJECT: "rentcottage-issue-32-constructor",
            },
            makeTemp: () => stateRoot,
            prepareProject: prepareIsolatedSupabaseWorkdir,
            run,
            workingDirectory,
          }),
        ).toBe(startStatus);
        expect(existsSync(stateRoot)).toBe(startStatus !== 0);
        if (startStatus !== 0)
          expect(
            readFileSync(
              join(stateRoot, "project/supabase/config.toml"),
              "utf8",
            ),
          ).toContain('project_id = "rentcottage-issue-32-constructor"');
        expect(readFileSync(sourceConfigPath, "utf8")).toBe(sourceConfig);
      } finally {
        rmSync(stateRoot, { recursive: true, force: true });
      }
    }
  });

  it("rejects Cottage Profile verifier arguments before authentication or database access", () => {
    const verifier = resolve(
      process.cwd(),
      "scripts/verify-cottage-profile-draft-concurrency.mjs",
    );
    const result = spawnSync(process.execPath, [verifier, "--unexpected"], {
      encoding: "utf8",
      env: {},
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Usage: node scripts/verify-cottage-profile-draft-concurrency.mjs [--verify-migration-preflight [--defer-successful-restore]]",
    );
    expect(result.stderr).not.toContain("SUPABASE_URL");
    expect(result.stderr).not.toContain("Docker");
  });

  it.each([
    [
      "verify-cottage-profile-draft-concurrency.mjs",
      ["--defer-successful-restore"],
    ],
    ["verify-booking-request-lifecycle-upgrade.mjs", ["--unexpected"]],
  ])(
    "rejects invalid restore deferral arguments before subprocess work in %s",
    (script, args) => {
      const { commands, result } = runUpgradeVerifier(script, args);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("Usage: node scripts/");
      expect(commands).toBe("");
    },
  );

  it.each([
    [
      "verify-cottage-profile-draft-concurrency.mjs",
      ["--verify-migration-preflight"],
    ],
    ["verify-booking-request-lifecycle-upgrade.mjs", []],
  ])(
    "restores the current schema by default after %s succeeds",
    (script, args) => {
      const { commands, result } = runUpgradeVerifier(script, args);

      expect(result.status, result.stderr).toBe(0);
      expect(commands).toContain("npx supabase db reset --local --version");
      expect(commands.match(/npx supabase db reset --local\n/g)).toHaveLength(
        1,
      );
    },
  );

  it.each([
    [
      "verify-cottage-profile-draft-concurrency.mjs",
      ["--verify-migration-preflight", "--defer-successful-restore"],
    ],
    [
      "verify-booking-request-lifecycle-upgrade.mjs",
      ["--defer-successful-restore"],
    ],
  ])(
    "defers only the successful current-schema restore for %s",
    (script, args) => {
      const { commands, result } = runUpgradeVerifier(script, args);

      expect(result.status, result.stderr).toBe(0);
      expect(commands).toContain("npx supabase db reset --local --version");
      expect(commands).not.toMatch(/npx supabase db reset --local\n/);
    },
  );

  it.each([
    [
      "verify-cottage-profile-draft-concurrency.mjs",
      ["--verify-migration-preflight", "--defer-successful-restore"],
    ],
    [
      "verify-booking-request-lifecycle-upgrade.mjs",
      ["--defer-successful-restore"],
    ],
  ])(
    "restores the current schema after %s fails with deferral requested",
    (script, args) => {
      for (const failure of [
        { failPriorReset: true, message: "forced prior reset failure" },
        { failProof: true, message: "forced proof failure" },
      ]) {
        const { commands, result } = runUpgradeVerifier(script, args, failure);

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(failure.message);
        expect(commands.match(/npx supabase db reset --local\n/g)).toHaveLength(
          1,
        );
      }
    },
  );

  it("rejects arguments before starting Docker or Supabase", async () => {
    const run = vi.fn();
    const stderr = vi.fn();

    expect(await main(["unexpected"], { run, stderr })).toBe(2);
    expect(run).not.toHaveBeenCalled();

    expect(await main(["--database", "--browser"], { run, stderr })).toBe(2);
    expect(await main(["--database", "--database"], { run, stderr })).toBe(2);
    expect(run).not.toHaveBeenCalled();
  });

  it("reports a public command spawn failure without tracking an invalid process group", async () => {
    const emptyPath = mkdtempSync(join(tmpdir(), "rentcottage-empty-path-"));
    const stderr = [];
    try {
      const wrapper = spawn(
        process.execPath,
        [resolve(process.cwd(), "scripts/verify-access.mjs"), "--database"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PATH: emptyPath,
            SUPABASE_LOCAL_PROJECT: "rentcottage",
            TMPDIR: emptyPath,
          },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      wrapper.stderr.on("data", (chunk) => stderr.push(String(chunk)));

      expect(await waitForChildExit(wrapper, "spawn-failure wrapper")).toEqual({
        code: 1,
        signal: null,
      });
      expect(stderr.join("")).toContain("Unable to run npx: spawn npx ENOENT");
    } finally {
      rmSync(emptyPath, { recursive: true, force: true });
    }
  });

  it("preserves split UTF-8 command diagnostics", async () => {
    const stateRoot = mkdtempSync(join(tmpdir(), "rentcottage-utf8-output-"));
    const npx = join(stateRoot, "npx");
    writeFileSync(
      npx,
      `#!${process.execPath}
process.stdout.write(Buffer.from([0xe2]));
process.stderr.write(Buffer.from([0xd8]));
setTimeout(() => {
  process.stdout.write(Buffer.from([0x82, 0xac, 0x0a]));
  process.stderr.write(Buffer.from([0xb9, 0x0a]));
  process.exit(7);
}, 20);
`,
    );
    chmodSync(npx, 0o755);
    const stderr = [];
    try {
      const wrapper = spawn(
        process.execPath,
        [resolve(process.cwd(), "scripts/verify-access.mjs"), "--database"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            PATH: stateRoot,
            SUPABASE_LOCAL_PROJECT: "rentcottage",
            TMPDIR: stateRoot,
          },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      wrapper.stderr.on("data", (chunk) => stderr.push(String(chunk)));

      expect(await waitForChildExit(wrapper, "UTF-8 wrapper")).toEqual({
        code: 7,
        signal: null,
      });
      expect(stderr.join("")).toContain("€");
      expect(stderr.join("")).toContain("ع");
      expect(stderr.join("")).not.toContain("�");
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it("bounds captured public command output and cleans that exact process", async () => {
    assertProcessObserverReady();
    const stateRoot = mkdtempSync(join(tmpdir(), "rentcottage-output-bound-"));
    const token = basename(stateRoot);
    const npx = join(stateRoot, `npx-${token}`);
    const ready = join(stateRoot, "output.ready");
    writeFileSync(
      npx,
      `#!${process.execPath}
import { writeFileSync } from "node:fs";
writeFileSync(process.env.OUTPUT_READY, JSON.stringify({ pid: process.pid, token: process.env.OUTPUT_TOKEN }));
process.stdout.write(Buffer.alloc(1024 * 1024 + 1, 97));
setInterval(() => {}, 1000);
`,
    );
    chmodSync(npx, 0o755);
    symlinkSync(npx, join(stateRoot, "npx"));
    const stderr = [];
    try {
      const wrapper = spawn(
        process.execPath,
        [resolve(process.cwd(), "scripts/verify-access.mjs"), "--database"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            OUTPUT_READY: ready,
            OUTPUT_TOKEN: token,
            PATH: stateRoot,
            SUPABASE_LOCAL_PROJECT: "rentcottage",
            TMPDIR: stateRoot,
          },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      wrapper.stderr.on("data", (chunk) => stderr.push(String(chunk)));

      await waitForCondition(
        () => existsSync(ready),
        "output fixture readiness",
      );
      expect(await waitForChildExit(wrapper, "output-bound wrapper")).toEqual({
        code: 1,
        signal: null,
      });
      const identity = JSON.parse(readFileSync(ready, "utf8"));
      expect(processIsAlive(identity.pid)).toBe(false);
      expect(stderr.join("")).toContain("spawn output exceeded maxBuffer");
    } finally {
      if (existsSync(ready)) {
        await stopExactFixtureProcess(JSON.parse(readFileSync(ready, "utf8")));
      }
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it("runs complete database evidence without browser work", async () => {
    const run = successfulRun();

    expect(await main(["--database"], { environment: {}, run })).toBe(0);

    expect(commands(run)).toEqual([
      startCommand,
      ownershipCommand,
      resetCommand,
      ...databasePreflightCommands,
      statusCommand,
      ...databaseCheckCommands,
      ownershipCommand,
      stopCommand,
    ]);
  });

  it.each([
    {
      name: "a non-empty declared schema diff",
      stdout: JSON.stringify({
        diff: "ALTER TABLE public.booking_requests DROP COLUMN party_size;",
        dropStatements: [],
      }),
      diagnostic: "ALTER TABLE public.booking_requests DROP COLUMN party_size;",
    },
    {
      name: "an unreadable declared schema diff",
      stdout: "not json",
      diagnostic: "unreadable declared schema diff",
    },
  ])(
    "fails database evidence on $name before running SQL tests and cleans up",
    async ({ stdout, diagnostic }) => {
      const errors = vi.fn();
      const run = ownedRun((command, args) => ({
        status: 0,
        stdout:
          command === "npx" &&
          args.slice(0, 6).join(" ") ===
            "supabase db diff --local --output-format json"
            ? stdout
            : command === "npx" && args.join(" ") === "supabase status -o json"
              ? localCredentials
              : "",
      }));

      expect(
        await main(["--database"], { environment: {}, run, stderr: errors }),
      ).toBe(1);

      expect(commands(run)).toEqual([
        startCommand,
        ownershipCommand,
        resetCommand,
        declaredSchemaDiffCommand,
        ownershipCommand,
        stopCommand,
      ]);
      expect(errors.mock.calls.flat().join("\n")).toContain(diagnostic);
    },
  );

  it.each([{ mode: [] }, { mode: ["--database"] }])(
    "propagates Capture concurrency failure in mode $mode and cleans up",
    async ({ mode }) => {
      const run = ownedRun((command, args) => ({
        status:
          command === "node" &&
          args[0] === "scripts/verify-booking-request-capture-concurrency.mjs"
            ? 7
            : 0,
        stdout:
          command === "npx" && args.join(" ") === "supabase status -o json"
            ? localCredentials
            : "",
      }));
      expect(await main(mode, { environment: {}, run, stderr: vi.fn() })).toBe(
        7,
      );
      expect(run.mock.calls.at(-1).slice(0, 2)).toEqual(stopCommand);
      expect(run.mock.calls.some(([, args]) => args[0] === "playwright")).toBe(
        false,
      );
    },
  );

  it("runs complete browser evidence from fresh fixtures without database checks", async () => {
    const run = successfulRun();

    expect(await main(["--browser"], { environment: {}, run })).toBe(0);

    expect(commands(run)).toEqual([
      startCommand,
      ownershipCommand,
      resetCommand,
      statusCommand,
      ...browserCommands,
      ownershipCommand,
      stopCommand,
    ]);
  });

  it("refuses to reset, modify, browse, or stop a foreign local project", async () => {
    const run = vi.fn((command, args) => ({
      status: 0,
      stdout:
        command === "docker" && args[0] === "inspect"
          ? "rentcottage|/tmp/another-checkout\n"
          : "",
    }));
    const removeTemp = vi.fn();
    const stderr = vi.fn();

    expect(
      await main(["--browser"], {
        environment: {},
        makeTemp: () => "/tmp/access-docker",
        removeTemp,
        run,
        stderr,
        workingDirectory: "/tmp/this-checkout",
      }),
    ).toBe(1);
    expect(commands(run)).toEqual([
      [
        "npx",
        [
          "supabase",
          "start",
          "-x",
          "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
        ],
      ],
      [
        "docker",
        [
          "inspect",
          "supabase_db_rentcottage",
          "--format",
          '{{ index .Config.Labels "com.supabase.cli.project" }}|{{ index .Config.Labels "com.supabase.cli.workdir" }}',
        ],
      ],
    ]);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining(
        "does not belong to this disposable local checkout",
      ),
    );
    expect(removeTemp).not.toHaveBeenCalled();
  });

  it("runs only the public Worker fixture contract in focused disposable mode", async () => {
    const run = ownedRun((command, args) => ({
      status: 0,
      stdout:
        command === "npx" && args.join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }));
    const removeTemp = vi.fn();

    expect(
      await main(["--fixture-contract"], {
        environment: {},
        makeTemp: () => "/tmp/access-docker",
        removeTemp,
        run,
      }),
    ).toBe(0);

    expect(commands(run)).toEqual([
      startCommand,
      ownershipCommand,
      resetCommand,
      statusCommand,
      databaseCheckCommands[0],
      ownershipCommand,
      stopCommand,
    ]);
    expect(run.mock.calls[4][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
  });

  it("rejects a malformed local project before creating temp state or starting a subprocess", async () => {
    const makeTemp = vi.fn();
    const prepareProject = vi.fn();
    const run = vi.fn();
    const stderr = vi.fn();

    expect(
      await main([], {
        environment: {
          SUPABASE_LOCAL_PROJECT: "rentcottage;docker-rm",
        },
        makeTemp,
        prepareProject,
        run,
        stderr,
      }),
    ).toBe(2);
    expect(stderr).toHaveBeenCalledWith(
      "SUPABASE_LOCAL_PROJECT must name a disposable RentCottage local project.",
    );
    expect(makeTemp).not.toHaveBeenCalled();
    expect(prepareProject).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("runs database and browser evidence with local credentials then stops", async () => {
    const run = ownedRun((command, args) => ({
      status: 0,
      stdout:
        command === "npx" && args.join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }));
    const removeTemp = vi.fn();

    expect(
      await main([], {
        environment: {
          EXISTING: "kept",
          SUPABASE_URL: "http://127.0.0.1:59999",
          SUPABASE_PUBLISHABLE_KEY: "stale-publishable",
          SUPABASE_SECRET_KEY: "inherited-secret",
        },
        makeTemp: () => "/tmp/access-docker",
        removeTemp,
        run,
      }),
    ).toBe(0);

    expect(commands(run)).toEqual([
      startCommand,
      ownershipCommand,
      resetCommand,
      ...databasePreflightCommands,
      statusCommand,
      ...databaseCheckCommands,
      ...browserCommands,
      ownershipCommand,
      stopCommand,
    ]);
    expect(run.mock.calls[0][2].env).toMatchObject({
      DOCKER_CONFIG: "/tmp/access-docker",
      DO_NOT_TRACK: "1",
      EXISTING: "kept",
      SUPABASE_TELEMETRY_DISABLED: "1",
    });
    expect(run.mock.calls[1][2]).toMatchObject({
      encoding: "utf8",
      env: {
        DOCKER_CONFIG: "/tmp/access-docker",
        DO_NOT_TRACK: "1",
        EXISTING: "kept",
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
        SUPABASE_TELEMETRY_DISABLED: "1",
      },
      maxBuffer: 1024 * 1024,
    });
    expect(run.mock.calls[1][2]).toHaveProperty("input", undefined);
    expect(run.mock.calls[1][2].env.DOCKER_CONFIG).toBe(
      run.mock.calls[0][2].env.DOCKER_CONFIG,
    );
    expect(run.mock.calls[1][2].env).not.toHaveProperty("SUPABASE_URL");
    expect(run.mock.calls[1][2].env).not.toHaveProperty(
      "SUPABASE_PUBLISHABLE_KEY",
    );
    expect(run.mock.calls[1][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[12][2].env).toMatchObject({
      EXISTING: "kept",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      SUPABASE_SECRET_KEY: "local-secret",
      PRIVILEGED_AUDIT_HMAC_KEY: "local-test-audit-hmac-key-32-characters",
      SUPABASE_TELEMETRY_DISABLED: "1",
      DO_NOT_TRACK: "1",
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[13][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      SUPABASE_SECRET_KEY: "local-secret",
    });
    expect(run.mock.calls[14][2].env).toMatchObject({
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[14][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[5][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[5][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[6][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[6][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[16][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[16][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[17][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[17][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[18][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[18][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[19][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
      SUPABASE_SECRET_KEY: "local-secret",
    });
    expect(run.mock.calls[20][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[20][2].env.SUPABASE_SECRET_KEY).toBe("local-secret");
    expect(run.mock.calls[23][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[23][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[25][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: "http://127.0.0.1:54331",
    });
    expect(run.mock.calls[26][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: "http://127.0.0.1:54331",
    });
    expect(run.mock.calls[27][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      NEXTJS_ENV: "test",
      SUPABASE_PROJECT_REF: "local-test",
    });
    expect(run.mock.calls[28][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: "http://127.0.0.1:54331",
    });
    expect(run.mock.calls[29][2].env).toMatchObject({
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: "http://127.0.0.1:54331",
    });
    expect(run.mock.calls[31][2].env).toMatchObject({
      PLAYWRIGHT_SERVER: "worker",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      SUPABASE_SECRET_KEY: "local-secret",
      PRIVILEGED_AUDIT_HMAC_KEY: "local-test-audit-hmac-key-32-characters",
    });
    expect(run.mock.calls[32][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[32][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(run.mock.calls[33][2].env).toMatchObject({
      PLAYWRIGHT_SERVER: "worker",
      SUPABASE_SECRET_KEY: "local-secret",
    });
    expect(run.mock.calls[34][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
      SUPABASE_LOCAL_PROJECT: "rentcottage",
    });
    expect(run.mock.calls[34][2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
  });

  it.each([
    { status: 7 },
    { status: null, signal: "SIGTERM" },
    { status: null, error: new Error("build unavailable") },
  ])(
    "blocks prebuilt Worker journeys on a failed build and still cleans up: %j",
    async (failure) => {
      const removeTemp = vi.fn();
      const run = ownedRun((command, args) => {
        if (command === "npm" && args.join(" ") === "run build:worker")
          return failure;
        return {
          status: 0,
          stdout:
            args.join(" ") === "supabase status -o json"
              ? localCredentials
              : "",
        };
      });
      expect(
        await main(["--browser"], {
          environment: {},
          makeTemp: () => "/tmp/access-docker",
          removeTemp,
          run,
          stderr: vi.fn(),
        }),
      ).toBe(failure.status ?? 1);
      expect(
        run.mock.calls.some(([, args]) =>
          args.includes("--config=playwright.worker-prebuilt.config.ts"),
        ),
      ).toBe(false);
      expect(run.mock.calls.at(-1).slice(0, 2)).toEqual(stopCommand);
      expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
    },
  );

  it("builds Worker access and scheduled expiry once with the same real local bindings", async () => {
    const run = successfulRun();
    expect(await main(["--browser"], { environment: {}, run })).toBe(0);
    const builds = run.mock.calls.filter(([command]) => command === "npm");
    const workers = run.mock.calls.filter(([, args]) =>
      args.includes("--project=worker"),
    );
    expect(builds).toHaveLength(1);
    expect(builds[0].slice(0, 2)).toEqual(["npm", ["run", "build:worker"]]);
    expect(workers).toHaveLength(2);
    for (const worker of workers) {
      expect(worker[1]).toContain(
        "--config=playwright.worker-prebuilt.config.ts",
      );
      expect(worker[2].env).toEqual(builds[0][2].env);
      expect(run.mock.calls.indexOf(builds[0])).toBeLessThan(
        run.mock.calls.indexOf(worker),
      );
    }
    expect(builds[0][2].env).toMatchObject({
      SUPABASE_SECRET_KEY: "local-secret",
      NEXTJS_ENV: "test",
      PLAYWRIGHT_SERVER: "worker",
    });
  });

  it("creates the mobile Cottage Owner identity before its concurrency proof", async () => {
    let mobileIdentityCreated = false;
    const run = ownedRun((command, args) => {
      const invocation = [command, ...args].join(" ");
      if (invocation === "node scripts/prepare-access-test.mjs create mobile") {
        mobileIdentityCreated = true;
      }
      return {
        status:
          invocation ===
            "node scripts/verify-cottage-profile-draft-concurrency.mjs" &&
          !mobileIdentityCreated
            ? 9
            : 0,
        stdout:
          invocation === "npx supabase status -o json" ? localCredentials : "",
      };
    });

    expect(await main([], { environment: {}, run })).toBe(0);
    expect(mobileIdentityCreated).toBe(true);
  });

  it("blocks Worker journeys when browser fixture validation fails and still cleans up", async () => {
    const removeTemp = vi.fn();
    const run = ownedRun((command, args) => ({
      status:
        command === "node" &&
        args.join(" ") === "scripts/prepare-access-test.mjs validate worker"
          ? 7
          : 0,
      stdout:
        command === "npx" && args.join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }));

    expect(
      await main(["--browser"], {
        environment: {},
        makeTemp: () => "/tmp/access-docker",
        removeTemp,
        run,
      }),
    ).toBe(7);
    expect(
      run.mock.calls.some(
        ([command, args]) =>
          command === "npx" &&
          args.includes("playwright") &&
          args.includes("--project=worker"),
      ),
    ).toBe(false);
    expect(run.mock.calls.at(-1).slice(0, 2)).toEqual([
      "npx",
      ["supabase", "stop", "--no-backup"],
    ]);
    expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
  });

  it("derives the guarded database container from an isolated local project override", async () => {
    const isolatedWorkdir = "/tmp/access-state/project";
    const prepareProject = vi.fn(() => isolatedWorkdir);
    const removeTemp = vi.fn();
    const run = ownedRun(
      (command, args) => ({
        status: 0,
        stdout:
          command === "npx" && args[0] === "supabase" && args.includes("status")
            ? localCredentials
            : "",
      }),
      {
        project: "rentcottage-issue-32-v3",
        workdir: isolatedWorkdir,
      },
    );

    expect(
      await main([], {
        environment: {
          SUPABASE_LOCAL_PROJECT: "rentcottage-issue-32-v3",
        },
        makeTemp: () => "/tmp/access-state",
        prepareProject,
        removeTemp,
        run,
      }),
    ).toBe(0);

    const supabaseCalls = run.mock.calls.filter(
      ([command, args]) => command === "npx" && args[0] === "supabase",
    );
    expect(supabaseCalls.length).toBeGreaterThan(0);
    expect(supabaseCalls.every(([, args]) => args.includes("--workdir"))).toBe(
      true,
    );
    expect(
      supabaseCalls.every(([, args]) => args.includes(isolatedWorkdir)),
    ).toBe(true);
    expect(commands(run)).toContainEqual([
      "docker",
      [
        "inspect",
        "supabase_db_rentcottage-issue-32-v3",
        "--format",
        '{{ index .Config.Labels "com.supabase.cli.project" }}|{{ index .Config.Labels "com.supabase.cli.workdir" }}',
      ],
    ]);
    expect(run.mock.calls[5][2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-issue-32-v3",
      SUPABASE_LOCAL_PROJECT: "rentcottage-issue-32-v3",
      SUPABASE_LOCAL_WORKDIR: isolatedWorkdir,
    });
    const nextBrowser = run.mock.calls.find(
      ([command, args]) =>
        command === "npx" &&
        args.includes("playwright") &&
        args.includes("--project=mobile"),
    );
    expect(nextBrowser[2].env).toMatchObject({
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-issue-32-v3",
      SUPABASE_LOCAL_PROJECT: "rentcottage-issue-32-v3",
      SUPABASE_LOCAL_WORKDIR: isolatedWorkdir,
    });
    expect(removeTemp).toHaveBeenCalledWith("/tmp/access-state");
  });

  it("preserves a database failure when cleanup also fails", async () => {
    const run = ownedRun((command, args) => {
      const invocation = [command, ...args].join(" ");
      return {
        status:
          invocation === "node scripts/verify-booking-request-concurrency.mjs"
            ? 9
            : invocation === "npx supabase stop --no-backup"
              ? 6
              : 0,
        stdout:
          invocation === "npx supabase status -o json" ? localCredentials : "",
      };
    });
    const removeTemp = vi.fn();

    expect(
      await main(["--database"], {
        environment: {},
        makeTemp: () => "/tmp/access-docker",
        removeTemp,
        run,
      }),
    ).toBe(9);
    expect(run.mock.calls.at(-1).slice(0, 2)).toEqual([
      "npx",
      ["supabase", "stop", "--no-backup"],
    ]);
    expect(
      run.mock.calls.filter(
        ([command, args]) =>
          command === "npx" && args.join(" ") === "supabase stop --no-backup",
      ),
    ).toHaveLength(1);
    expect(run.mock.calls.some(([, args]) => args[0] === "playwright")).toBe(
      false,
    );
    expect(removeTemp).not.toHaveBeenCalled();
  });

  it("fails and retains the project when ownership changes before cleanup", async () => {
    let inspections = 0;
    const run = vi.fn((command, args) => {
      if (command === "docker" && args[0] === "inspect") {
        inspections += 1;
        return {
          status: 0,
          stdout:
            inspections === 1
              ? `rentcottage|${process.cwd()}\n`
              : `foreign-project|${process.cwd()}\n`,
          stderr: "",
        };
      }
      return {
        status: 0,
        stdout:
          command === "npx" && args.join(" ") === "supabase status -o json"
            ? localCredentials
            : "",
      };
    });
    const removeTemp = vi.fn();
    const stderr = vi.fn();

    expect(
      await main(["--fixture-contract"], {
        environment: {},
        makeTemp: () => "/tmp/access-docker",
        removeTemp,
        run,
        stderr,
      }),
    ).toBe(1);
    expect(inspections).toBe(2);
    expect(
      run.mock.calls.some(
        ([command, args]) =>
          command === "npx" && args.join(" ") === "supabase stop --no-backup",
      ),
    ).toBe(false);
    expect(removeTemp).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining(
        "Unable to reverify disposable local Supabase ownership before cleanup",
      ),
    );
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("Retained local Supabase project rentcottage"),
    );
  });

  it.each([
    { stage: "cleanup inspection", signal: "SIGTERM", status: 143 },
    { stage: "cleanup stop", signal: "SIGINT", status: 130 },
  ])(
    "finishes exact cleanup when $signal arrives during $stage",
    async ({ signal, stage, status }) => {
      let inspections = 0;
      let stops = 0;
      const run = vi.fn((command, args) => {
        if (command === "docker" && args[0] === "inspect") {
          inspections += 1;
          if (stage === "cleanup inspection" && inspections === 2) {
            process.emit(signal);
          }
          return {
            status: 0,
            stdout: `rentcottage|${process.cwd()}\n`,
            stderr: "",
          };
        }
        if (
          command === "npx" &&
          args.join(" ") === "supabase stop --no-backup"
        ) {
          stops += 1;
          if (stage === "cleanup stop") process.emit(signal);
        }
        return {
          status: 0,
          stdout:
            command === "npx" && args.join(" ") === "supabase status -o json"
              ? localCredentials
              : "",
        };
      });
      const removeTemp = vi.fn();

      expect(
        await main(["--fixture-contract"], {
          environment: {},
          makeTemp: () => "/tmp/access-docker",
          removeTemp,
          run,
          stderr: vi.fn(),
        }),
      ).toBe(status);
      expect(inspections).toBe(2);
      expect(stops).toBe(1);
      expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
    },
  );

  it("prints captured command output when startup fails", async () => {
    const run = vi.fn().mockReturnValue({
      status: 7,
      stdout: "startup details\n",
      stderr: "docker details\n",
    });
    const stderr = vi.fn();

    expect(
      await main([], {
        environment: {},
        makeTemp: () => "/tmp/access-docker",
        removeTemp: vi.fn(),
        run,
        stderr,
      }),
    ).toBe(7);
    expect(stderr).toHaveBeenCalledWith("startup details");
    expect(stderr).toHaveBeenCalledWith("docker details");
  });

  it("rejects malformed Supabase credentials before spawning a browser", async () => {
    const run = ownedRun((command, args) => ({
      status: 0,
      stdout:
        command === "npx" && args.join(" ") === "supabase status -o json"
          ? JSON.stringify({
              API_URL: {},
              PUBLISHABLE_KEY: [],
              SECRET_KEY: true,
            })
          : "",
    }));
    const stderr = vi.fn();

    expect(await main([], { environment: {}, run, stderr })).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      "Supabase did not return valid local test credentials.",
    );
    expect(run.mock.calls.some(([, args]) => args[0] === "playwright")).toBe(
      false,
    );
    expect(
      run.mock.calls.some(
        ([command, args]) =>
          command === "node" && args[0] === "scripts/prepare-access-test.mjs",
      ),
    ).toBe(false);
  });

  it("rejects unreadable Supabase credential output", async () => {
    const run = ownedRun((command, args) => ({
      status: 0,
      stdout:
        command === "npx" && args.join(" ") === "supabase status -o json"
          ? "not-json"
          : "",
    }));
    const stderr = vi.fn();

    expect(await main([], { environment: {}, run, stderr })).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      "Supabase returned unreadable local test credentials.",
    );
    expect(run.mock.calls.some(([, args]) => args[0] === "playwright")).toBe(
      false,
    );
  });

  it("rejects a non-loopback Supabase API URL", async () => {
    const run = ownedRun((command, args) => ({
      status: 0,
      stdout:
        command === "npx" && args.join(" ") === "supabase status -o json"
          ? JSON.stringify({
              API_URL: "https://supabase.example.com",
              PUBLISHABLE_KEY: "local-publishable",
              SECRET_KEY: "local-secret",
            })
          : "",
    }));
    const stderr = vi.fn();

    expect(await main([], { environment: {}, run, stderr })).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      "Supabase did not return valid local test credentials.",
    );
    expect(run.mock.calls.some(([, args]) => args[0] === "playwright")).toBe(
      false,
    );
    expect(
      run.mock.calls.some(
        ([command, args]) =>
          command === "node" && args[0] === "scripts/prepare-access-test.mjs",
      ),
    ).toBe(false);
  });

  it("fails when the local services cannot be stopped cleanly", async () => {
    const run = ownedRun((command, args) => ({
      status:
        command === "npx" && args.join(" ") === "supabase stop --no-backup"
          ? 6
          : 0,
      stdout:
        command === "npx" && args.join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }));
    const stderr = vi.fn();
    const removeTemp = vi.fn();

    expect(
      await main([], {
        environment: {},
        makeTemp: () => "/tmp/access-docker",
        removeTemp,
        run,
        stderr,
      }),
    ).toBe(6);
    expect(stderr).toHaveBeenCalledWith("Local Supabase cleanup failed.");
    expect(removeTemp).not.toHaveBeenCalled();
  });
});
