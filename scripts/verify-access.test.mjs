import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
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
import { pathToFileURL } from "node:url";

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
    "--workdir",
    expect.any(String),
  ],
];
const ownershipCommand = [
  "docker",
  [
    "inspect",
    "supabase_db_rentcottage-verification",
    "--format",
    '{{ index .Config.Labels "com.supabase.cli.project" }}|{{ index .Config.Labels "com.supabase.cli.workdir" }}',
  ],
];
const resetCommand = [
  "npx",
  ["supabase", "db", "reset", "--local", "--workdir", expect.any(String)],
];
const statusCommand = [
  "npx",
  ["supabase", "status", "-o", "json", "--workdir", expect.any(String)],
];
const stopCommand = [
  "npx",
  [
    "supabase",
    "stop",
    "--no-backup",
    "--project-id",
    "rentcottage-verification",
    "--workdir",
    expect.any(String),
  ],
];
const declaredSchemaDiffCommand = [
  "npx",
  [
    "supabase",
    "db",
    "diff",
    "--local",
    "--output-format",
    "json",
    "--workdir",
    expect.any(String),
  ],
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
  ["node", ["scripts/verify-customer-review-upgrade.mjs"]],
  ["npx", ["supabase", "test", "db", "--workdir", expect.any(String)]],
];
const databaseCheckCommands = [
  ["node", ["scripts/verify-access-fixture-contract.mjs"]],
  ["node", ["scripts/verify-account-access-concurrency.mjs"]],
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
  ["node", ["scripts/verify-booking-event-notification-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-request-notification-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-preparation-reminder-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-cancellation-concurrency.mjs"]],
  ["node", ["scripts/verify-messaging-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-completion-concurrency.mjs"]],
  ["node", ["scripts/verify-customer-review-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-refund-concurrency.mjs"]],
  ["node", ["scripts/verify-booking-payout-concurrency.mjs"]],
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
      "tests/booking-history.spec.ts",
      "tests/request-notification-details.spec.ts",
      "tests/messaging.spec.ts",
      "tests/customer-reviews.spec.ts",
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
      "tests/booking-cancellation-refund.spec.ts",
      "tests/messaging.spec.ts",
      "tests/customer-reviews.spec.ts",
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
      "tests/worker-scheduled-refund.spec.ts",
      "tests/worker-scheduled-completion.spec.ts",
      "tests/worker-scheduled-reminder.spec.ts",
      "tests/worker-scheduled-request-notification.spec.ts",
      "--project=worker",
      "--config=playwright.worker-prebuilt.config.ts",
      "--workers=1",
      "--output=playwright-report/scheduled-expiry-worker",
    ],
  ],
  ["node", ["scripts/verify-booking-request-scheduled-expiry.mjs", "--verify"]],
];

function ownedRun(
  implementation,
  { project = "rentcottage-verification", workdir } = {},
) {
  return vi.fn((command, args, options) => {
    if (command === "docker" && args[0] === "inspect") {
      const ownedWorkdir =
        typeof workdir === "function"
          ? workdir()
          : (workdir ?? options.env.SUPABASE_LOCAL_WORKDIR);
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

function successfulRun({ project = "rentcottage-verification", workdir } = {}) {
  return ownedRun(
    (command, args) => ({
      status: 0,
      stdout:
        command === "npx" &&
        args.slice(0, 4).join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }),
    { project, workdir },
  );
}

function mainWithPreparedProject(args, options = {}) {
  return main(args, {
    prepareProject: ({ stateRoot }) => join(stateRoot, "project"),
    ...options,
  });
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
    exitedGroupState,
    groupPermissionFailure = false,
    hangCleanup = false,
    inspectionFailure,
    interruptStartup = false,
    cleanupStage,
    observeTiming,
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
  const cleanupBoundary = join(stateRoot, "cleanup-boundary.mjs");
  const inspectionBoundary = join(stateRoot, "inspection-boundary.mjs");
  const readinessPublisher = `const publishReady = (path, contents) => {
  writeFileSync(path + ".pending", contents);
  renameSync(path + ".pending", path);
};`;
  writeFileSync(
    inspectionBoundary,
    `
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const originalSpawn = childProcess.spawn;
const root = process.env.ACCESS_INTERRUPTION_ROOT;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => setImmediate(() => writeFileSync(root + "/signal.handled", signal)));
}
const originalKill = process.kill;
let exitedGroup;
process.kill = (pid, signal) => {
  if (pid < 0 && signal !== 0) {
    writeFileSync(root + "/termination-attempt", String(pid));
    if (process.env.ACCESS_GROUP_PERMISSION_FAILURE === "1") {
      const error = new Error("kill EPERM");
      error.code = "EPERM";
      throw error;
    }
  }
  if (pid < 0 && signal === 0 && process.env.ACCESS_EXITED_GROUP_STATE && existsSync(root + "/termination-attempt") && Number(readFileSync(root + "/termination-attempt", "utf8")) === pid) {
    try {
      originalKill.call(process, pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH" && error.code !== "EPERM") throw error;
      exitedGroup = -pid;
      writeFileSync(root + "/exited-group-observed", String(exitedGroup));
      const denied = new Error("kill EPERM");
      denied.code = "EPERM";
      throw denied;
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
  if (command === "/bin/ps" && exitedGroup) {
    return originalSpawn(process.execPath, ["-e",
      "const { spawnSync } = require('node:child_process'); const result = spawnSync('/bin/ps', " + JSON.stringify(args) + ", { encoding: 'utf8' }); process.stdout.write(result.stdout); process.stderr.write(result.stderr); if (result.status !== 0) process.exit(result.status); " +
      (process.env.ACCESS_EXITED_GROUP_STATE === "zombie" ? "process.stdout.write(" + JSON.stringify(exitedGroup + " " + exitedGroup + " Z Thu Sep 10 11:17:15 2026 <defunct>\\n") + ");" : "")
    ], options);
  }
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
    `import { renameSync, writeFileSync } from "node:fs";
${readinessPublisher}
const [readyFile, token, behavior = "graceful"] = process.argv.slice(2);
publishReady(readyFile, JSON.stringify({ pid: process.pid, ppid: process.ppid, token }));
const finish = () => process.exit(0);
const ignore = () => { process.title = "retitled-" + token; };
process.on("SIGTERM", behavior === "ignore" ? ignore : finish);
process.on("SIGINT", behavior === "ignore" ? ignore : finish);
setInterval(() => {}, 1000);
`,
  );
  if (hangCleanup) {
    writeFileSync(
      cleanupBoundary,
      `import { main } from ${JSON.stringify(pathToFileURL(resolve(process.cwd(), "scripts/verify-access.mjs")).href)};
process.exitCode = await main(process.argv.slice(2), {
  cleanupCommandLimitMs: 2_000,
});
`,
    );
  }
  writeFileSync(
    commandBoundary,
    `#!${process.execPath}
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
${readinessPublisher}

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
    publishReady(root + "/cleanup.ready", JSON.stringify({ pid: process.pid, token: "cleanup-stop-" + token }));
    await waitFor(() => existsSync(root + "/cleanup.release"));
  }
  writeFileSync(root + "/inspected", "inspected");
  process.stdout.write(process.env.SUPABASE_LOCAL_PROJECT + "|" + process.env.SUPABASE_LOCAL_WORKDIR + "\\n");
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
    publishReady(root + "/cleanup.ready", JSON.stringify({ pid: process.pid, token: "cleanup-stop-" + token }));
    await waitFor(() => existsSync(root + "/cleanup.release"));
  }
  if (hangCleanup) {
    publishReady(root + "/cleanup.ready", JSON.stringify({
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
  publishReady(root + "/command.ready", JSON.stringify({
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
        ...(exitedGroupState ||
        inspectionFailure ||
        groupPermissionFailure ||
        cleanupStage ||
        completedCommandStatus !== undefined
          ? ["--import", inspectionBoundary]
          : []),
        hangCleanup
          ? cleanupBoundary
          : resolve(process.cwd(), "scripts/verify-access.mjs"),
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
          ACCESS_EXITED_GROUP_STATE: exitedGroupState ?? "",
          PATH: `${fakeBin}:${process.env.PATH}`,
          SUPABASE_LOCAL_PROJECT: "rentcottage-verification",
          TMPDIR: stateRoot,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const stdout = [];
    wrapper.stdout.on("data", (chunk) => stdout.push(String(chunk)));
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
        12_000,
      );
      const cleanup = JSON.parse(
        readFileSync(join(stateRoot, "cleanup.ready"), "utf8"),
      );
      const service = JSON.parse(
        readFileSync(join(stateRoot, "service.ready"), "utf8"),
      );
      const unrelatedIdentity = JSON.parse(
        readFileSync(unrelatedReady, "utf8"),
      );
      expect(wrapperExit).toEqual({ code: 1, signal: null });
      expect(processIsAlive(cleanup.pid)).toBe(false);
      expect(processIsAlive(service.pid)).toBe(true);
      expect(processIsAlive(unrelatedIdentity.pid)).toBe(true);
      expect(stderr.join("")).toContain("Command did not exit within 2000ms");
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
        `npx supabase db reset --local --workdir ${realpathSync(join(retainedState, "project"))}`,
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
    if (exitedGroupState) {
      expect(
        readFileSync(join(stateRoot, "exited-group-observed"), "utf8"),
      ).toBe(String(command.pid));
    }
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
    if (observeTiming) {
      await waitForCondition(
        () =>
          stdout
            .join("")
            .split("\n")
            .slice(0, -1)
            .some((line) => line.includes('"type":"access-lifecycle"')),
        "access lifecycle completion record",
      );
      observeTiming(
        stdout
          .join("")
          .split("\n")
          .slice(0, -1)
          .filter((line) => line.startsWith("{"))
          .map((line) => JSON.parse(line)),
      );
    }
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
  it("accumulates repeated concurrency phases without inventing absent cleanup", () => {
    let tick = 100;
    const stdout = vi.fn();
    const utcNow = () => new Date(Date.UTC(2026, 8, 26) + tick).toISOString();
    const harness = createLocalSupabaseConcurrencyHarness({
      timing: { check: "controlled-check", isolation: "serial" },
      monotonicNow: () => tick,
      utcNow,
      stdout,
    });
    harness.markTimingPhase("setup");
    tick = 137;
    harness.markTimingPhase("execution");
    tick = 150;
    harness.markTimingPhase("setup");
    tick = 159;
    harness.markTimingPhase("execution");
    tick = 180;
    harness.markTimingPhase("cleanup");
    tick = 190;
    harness.finishTiming({ outcome: "passed", cleanupDisposition: "local" });
    const records = stdout.mock.calls.map(([line]) => JSON.parse(line));
    expect(
      records.slice(0, -1).map(({ phase, elapsedMs }) => [phase, elapsedMs]),
    ).toEqual([
      ["setup", 37],
      ["execution", 13],
      ["setup", 9],
      ["execution", 21],
      ["cleanup", 10],
    ]);
    expect(records[0]).toEqual({
      type: "concurrency-phase",
      check: "controlled-check",
      isolation: "serial",
      phase: "setup",
      startedAt: "2026-09-26T00:00:00.100Z",
      completedAt: "2026-09-26T00:00:00.137Z",
      elapsedMs: 37,
    });
    expect(records.at(-1)).toEqual({
      type: "concurrency-summary",
      check: "controlled-check",
      isolation: "serial",
      startedAt: "2026-09-26T00:00:00.100Z",
      completedAt: "2026-09-26T00:00:00.190Z",
      setupMs: 46,
      executionMs: 34,
      cleanupMs: 10,
      outcome: "passed",
      cleanupDisposition: "local",
      phaseReasons: {},
    });
    tick = 1000;
    harness.finishTiming({
      outcome: "failed",
      cleanupDisposition: "project-teardown",
    });
    harness.markTimingPhase("setup");
    expect(stdout).toHaveBeenCalledTimes(6);

    const deferred = createLocalSupabaseConcurrencyHarness({
      timing: { check: "deferred-check", isolation: "serial" },
      monotonicNow: () => tick,
      utcNow,
      stdout,
    });
    deferred.markTimingPhase("setup");
    deferred.markTimingPhase("execution");
    deferred.finishTiming({
      outcome: "passed",
      cleanupDisposition: "project-teardown",
    });
    expect(JSON.parse(stdout.mock.lastCall[0])).toMatchObject({
      setupMs: 0,
      executionMs: 0,
      cleanupMs: null,
      phaseReasons: {
        cleanup: "Cleanup is deferred to disposable project teardown.",
      },
    });

    for (const failedPhase of ["setup", "cleanup"]) {
      const failed = createLocalSupabaseConcurrencyHarness({
        timing: { check: "failed-check", isolation: "serial" },
        monotonicNow: () => tick,
        utcNow,
        stdout,
      });
      expect(() => {
        try {
          failed.markTimingPhase(failedPhase);
          tick += 7;
          throw new Error(`${failedPhase} failed`);
        } finally {
          failed.finishTiming({
            outcome: "failed",
            cleanupDisposition: "local",
          });
        }
      }).toThrow(`${failedPhase} failed`);
      const summary = JSON.parse(stdout.mock.lastCall[0]);
      expect(summary).toMatchObject({
        outcome: "failed",
        [`${failedPhase}Ms`]: 7,
      });
      for (const phase of ["setup", "execution", "cleanup"].filter(
        (phase) => phase !== failedPhase,
      )) {
        expect(summary[`${phase}Ms`]).toBeNull();
        expect(summary.phaseReasons[phase]).toBe("Phase was not reached.");
      }
    }

    stdout.mockClear();
    const monotonicNow = vi.fn();
    const silent = createLocalSupabaseConcurrencyHarness({
      stdout,
      monotonicNow,
    });
    silent.markTimingPhase("setup");
    silent.finishTiming({ outcome: "passed", cleanupDisposition: "local" });
    expect(stdout).not.toHaveBeenCalled();
    expect(monotonicNow).not.toHaveBeenCalled();
    for (const timing of [
      null,
      { check: " ", isolation: "serial" },
      { check: 42, isolation: "serial" },
      { check: "check", isolation: "independent" },
    ]) {
      expect(() => createLocalSupabaseConcurrencyHarness({ timing })).toThrow(
        "Concurrency timing requires a nonblank check and serial isolation.",
      );
    }
  });

  it("acknowledges SQL setup before sending the body on the same owned session", async () => {
    vi.useFakeTimers();
    function childProcess() {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdout.setEncoding = vi.fn();
      child.stderr.setEncoding = vi.fn();
      child.stdin = {
        write: vi.fn(),
        end: vi.fn(),
        destroyed: false,
        writableEnded: false,
      };
      child.kill = vi.fn();
      return child;
    }
    try {
      let tick = 100;
      const stdout = vi.fn();
      const child = childProcess();
      const spawnProcess = vi.fn(() => child);
      const harness = createLocalSupabaseConcurrencyHarness({
        timing: { check: "protocol-check", isolation: "serial" },
        monotonicNow: () => tick,
        stdout,
        spawnProcess,
      });
      harness.markTimingPhase("execution");
      let openingSettled = false;
      const opening = harness
        .startSessionAfterSetup("begin;\nselect 'fixture';", "select 'body';")
        .then((session) => {
          openingSettled = true;
          return session;
        });
      expect(child.stdin.write.mock.calls).toEqual([
        [
          "\\set VERBOSITY verbose\nbegin;\nselect 'fixture';\nselect 'RC330_SQL_SETUP_READY';\n",
        ],
      ]);
      child.stdout.emit("data", "fixture-output\nRC330_SQL_SETUP_");
      await vi.advanceTimersByTimeAsync(15_020);
      expect(openingSettled).toBe(false);
      expect(child.stdin.write).toHaveBeenCalledTimes(1);
      expect(child.kill).not.toHaveBeenCalled();
      tick = 137;
      child.stdout.emit("data", "READY\n");
      await vi.advanceTimersByTimeAsync(20);
      const session = await opening;
      expect(child.stdout.listenerCount("data")).toBe(1);
      expect(child.listenerCount("error")).toBe(1);
      expect(child.listenerCount("close")).toBe(1);
      expect(session.child).toBe(child);
      expect(spawnProcess).toHaveBeenCalledTimes(1);
      expect(session.setupStdout).toBe("fixture-output\n");
      expect(session.stdout).toBe("");
      expect(child.stdin.write.mock.calls).toEqual([
        [
          "\\set VERBOSITY verbose\nbegin;\nselect 'fixture';\nselect 'RC330_SQL_SETUP_READY';\n",
        ],
        ["select 'body';\n"],
      ]);
      expect(child.stdin.end).not.toHaveBeenCalled();
      child.stdout.emit("data", "body-output\n");
      tick = 150;
      const closing = harness.finishSession(session, { action: "rollback" });
      expect(child.stdin.end).toHaveBeenCalledExactlyOnceWith("rollback;\n");
      child.emit("close", 0, null);
      await closing;
      expect(session.stdout).toBe("body-output\n");
      harness.finishTiming({
        outcome: "passed",
        cleanupDisposition: "project-teardown",
      });
      expect(JSON.parse(stdout.mock.lastCall[0])).toMatchObject({
        setupMs: 37,
        executionMs: 13,
        cleanupMs: null,
      });

      for (const phase of ["setup", "execution", "cleanup", undefined]) {
        const oneShotChild = childProcess();
        const lines = [];
        const oneShot = createLocalSupabaseConcurrencyHarness({
          ...(phase
            ? { timing: { check: "one-shot", isolation: "serial" } }
            : {}),
          monotonicNow: () => tick,
          stdout: (line) => lines.push(JSON.parse(line)),
          spawnProcess: () => oneShotChild,
        });
        if (phase) oneShot.markTimingPhase(phase);
        const running = oneShot.runSqlAfterSetup(
          "select 'setup';",
          "select 'result';\ncommit;",
        );
        tick += 10;
        oneShotChild.stdout.emit(
          "data",
          "setup-output\nRC330_SQL_SETUP_READY\n",
        );
        await vi.advanceTimersByTimeAsync(20);
        expect(oneShotChild.stdin.end).toHaveBeenCalledExactlyOnceWith(
          "select 'result';\ncommit;\n",
        );
        tick += 20;
        oneShotChild.stdout.emit("data", "  body-result\n");
        oneShotChild.emit("close", 0, null);
        expect(await running).toBe("body-result");
        oneShot.finishTiming({
          outcome: "passed",
          cleanupDisposition: "local",
        });
        if (phase) {
          expect(lines.at(-1).setupMs).toBe(phase === "setup" ? 30 : 10);
          expect(lines.at(-1)[`${phase}Ms`]).toBe(phase === "setup" ? 30 : 20);
        } else {
          expect(lines).toEqual([]);
        }
      }

      const contenderChild = childProcess();
      const contender = createLocalSupabaseConcurrencyHarness({
        spawnProcess: () => contenderChild,
        waitLimitMilliseconds: 30,
      });
      const contenderSession = contender.startSession("select 'contender';");
      const markerWait = contender
        .waitForMarker(contenderSession, "CONTENTION_READY")
        .catch((error) => error);
      await vi.advanceTimersByTimeAsync(40);
      expect((await markerWait).message).toBe(
        "PostgreSQL session did not reach CONTENTION_READY.",
      );
      contenderChild.emit("close", 0, null);

      for (const failure of ["eof", "error", "body", "body-write", "cleanup"]) {
        const failedChild = childProcess();
        const primary = new Error("setup spawn failed");
        const cleanupError = new Error("termination failed");
        const writeError = new Error("body write failed");
        const lines = [];
        const failed = createLocalSupabaseConcurrencyHarness({
          timing: { check: "failed-protocol", isolation: "serial" },
          monotonicNow: () => tick,
          stdout: (line) => lines.push(JSON.parse(line)),
          spawnProcess: () => failedChild,
          waitLimitMilliseconds: 30,
        });
        failed.markTimingPhase("execution");
        if (failure === "cleanup")
          failedChild.kill.mockImplementation(() => {
            throw cleanupError;
          });
        let settled = false;
        const failedRun = failed
          .runSqlAfterSetup("select 'setup';", "select 'body';")
          .catch((error) => {
            settled = true;
            return error;
          });
        tick += 5;
        if (failure === "eof") {
          failedChild.stderr.emit("data", "setup SQL failed");
          failedChild.emit("close", 1, null);
          await vi.advanceTimersByTimeAsync(20);
        } else if (failure === "body" || failure === "body-write") {
          if (failure === "body-write")
            failedChild.stdin.end.mockImplementation(() => {
              throw writeError;
            });
          failedChild.stdout.emit("data", "RC330_SQL_SETUP_READY\n");
          await vi.advanceTimersByTimeAsync(20);
          if (failure === "body") {
            failedChild.stderr.emit("data", "body SQL failed");
            failedChild.emit("close", 9, null);
          } else {
            expect(failedChild.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
            expect(settled).toBe(false);
            failedChild.emit("close", null, "SIGTERM");
          }
        } else {
          failedChild.emit("error", primary);
          await vi.advanceTimersByTimeAsync(0);
          expect(failedChild.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
          expect(settled).toBe(false);
          failedChild.emit("close", null, "SIGTERM");
          await vi.advanceTimersByTimeAsync(20);
        }
        const error = await failedRun;
        if (failure === "error" || failure === "cleanup")
          expect(error).toBe(primary);
        else if (failure === "body-write") expect(error).toBe(writeError);
        else
          expect(error.message).toContain(
            failure === "eof" ? "session exited before" : "body SQL failed",
          );
        if (failure === "cleanup")
          expect(error.cleanupErrors).toEqual([cleanupError]);
        if (failure !== "body" && failure !== "body-write")
          expect(failedChild.stdin.end).not.toHaveBeenCalled();
        expect(failedChild.stdin.write).toHaveBeenCalledTimes(1);
        if (failure === "eof" || failure === "body")
          expect(failedChild.kill).not.toHaveBeenCalled();
        expect(settled).toBe(true);
        expect(failedChild.stdout.listenerCount("data")).toBe(1);
        expect(failedChild.listenerCount("error")).toBe(1);
        expect(failedChild.listenerCount("close")).toBe(1);
        failed.finishTiming({ outcome: "failed", cleanupDisposition: "local" });
        expect(lines.at(-1)).toMatchObject({ outcome: "failed", cleanupMs: 0 });
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("attributes actual terminal notification setup and delivery costs separately", async () => {
    vi.useFakeTimers();
    try {
      const { verifyTerminalReleaseNotifications } =
        await import("./verify-booking-request-notification-concurrency.mjs");
      let tick = 0;
      const children = [];
      const order = [];
      const lines = [];
      const actions = ["decline", "withdraw", "expire"];
      const statuses = ["declined", "withdrawn", "expired"];
      const harness = createLocalSupabaseConcurrencyHarness({
        timing: { check: "actual-notification", isolation: "serial" },
        monotonicNow: () => tick,
        stdout: (line) => lines.push(JSON.parse(line)),
        spawnSyncProcess: (_command, _args, { input }) => {
          let stdout = "";
          if (input.includes("select jsonb_agg(jsonb_build_object('role'")) {
            order.push("events");
            stdout = JSON.stringify([
              {
                role: "cottage_owner",
                recipient: "10000000-0000-4000-8000-000000001001",
                receipt: null,
              },
              {
                role: "customer",
                recipient: "10000000-0000-4000-8000-000000001002",
                receipt: null,
              },
            ]);
          } else if (
            input.includes("select count(*) from public.booking_receipts")
          ) {
            order.push("receipts");
            stdout = "0";
          } else {
            expect(input).toContain("delete from public.booking_requests");
            order.push("cleanup");
          }
          return { status: 0, stdout, stderr: "" };
        },
        spawnProcess: () => {
          const position = children.length;
          const index = Math.floor(position / 2);
          const release = position % 2 === 0;
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.stdout.setEncoding = vi.fn();
          child.stderr.setEncoding = vi.fn();
          const chargeSetup = (sql) => {
            if (release && sql.includes("insert into auth.users"))
              tick += [10, 20, 30][index];
            if (!release && sql.includes("create function pg_temp.notice_call"))
              tick += [1, 2, 3][index];
          };
          child.stdin = {
            destroyed: false,
            writableEnded: false,
            write: vi.fn((sql) => {
              chargeSetup(sql);
              order.push(release ? "release-setup" : "delivery-setup");
            }),
            end: vi.fn((sql) => {
              chargeSetup(sql);
              if (release) {
                expect(sql).toBe(
                  ` select pg_temp.finish_terminal_release('${actions[index]}'); commit;\n`,
                );
                tick += [100, 200, 300][index];
                order.push(actions[index]);
                child.stdout.emit(
                  "data",
                  JSON.stringify({ status: statuses[index] }) + "\n",
                );
              } else {
                expect(sql).toContain(
                  `pg_temp.prepare_request_notice('request_${statuses[index]}',role)`,
                );
                expect(sql).toContain(
                  "(values ('customer'),('cottage_owner')) recipients(role)",
                );
                expect(sql).not.toMatch(/\b(?:begin|commit|rollback);/);
                tick += [10, 20, 30][index];
                order.push("delivery");
                child.stdout.emit(
                  "data",
                  '[{"status":"delivered"},{"status":"delivered"}]\n',
                );
              }
              child.emit("close", 0, null);
            }),
          };
          child.kill = vi.fn();
          children.push(child);
          return child;
        },
      });
      harness.markTimingPhase("execution");
      const running = verifyTerminalReleaseNotifications(harness);
      for (let position = 0; position < 6; position++) {
        expect(children).toHaveLength(position + 1);
        const child = children[position];
        expect(child.stdin.write).toHaveBeenCalledTimes(1);
        expect(child.stdin.end).not.toHaveBeenCalled();
        const setup = child.stdin.write.mock.calls[0][0];
        expect(setup).toMatch(/select 'RC330_SQL_SETUP_READY';\n$/);
        if (position % 2 === 0) {
          expect(setup).toContain("insert into auth.users");
          expect(setup).toContain(
            "create function pg_temp.finish_terminal_release",
          );
          expect(setup).not.toContain(
            `select pg_temp.finish_terminal_release('${actions[Math.floor(position / 2)]}');`,
          );
          expect(setup).toContain("begin;");
          expect(setup).not.toContain("commit;");
          if (position === 4)
            expect(setup).toContain(
              "statement_timestamp()-interval '4 hours 1 second'",
            );
        } else {
          expect(setup).toContain("create function pg_temp.notice_call");
          expect(setup).not.toContain("insert into auth.users");
          expect(setup).not.toMatch(/\b(?:begin|commit|rollback);/);
        }
        child.stdout.emit("data", "setup-output\nRC330_SQL_SETUP_");
        await vi.advanceTimersByTimeAsync(20);
        expect(child.stdin.end).not.toHaveBeenCalled();
        child.stdout.emit("data", "READY\n");
        await vi.advanceTimersByTimeAsync(20);
        expect(child.stdin.end).toHaveBeenCalledTimes(1);
        expect(child.kill).not.toHaveBeenCalled();
      }
      await running;
      harness.finishTiming({ outcome: "passed", cleanupDisposition: "local" });
      expect(lines.at(-1)).toMatchObject({
        setupMs: 66,
        executionMs: 660,
        outcome: "passed",
      });
      expect(order).toEqual([
        "cleanup",
        "release-setup",
        "decline",
        "events",
        "delivery-setup",
        "delivery",
        "receipts",
        "cleanup",
        "release-setup",
        "withdraw",
        "events",
        "delivery-setup",
        "delivery",
        "receipts",
        "cleanup",
        "release-setup",
        "expire",
        "events",
        "delivery-setup",
        "delivery",
        "receipts",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("acknowledges actual history setup before readers and preserves owned rollback", async () => {
    vi.useFakeTimers();
    try {
      const { verifyProviderResolution, prepareHistorySession } =
        await import("./verify-booking-request-payment-history-concurrency.mjs");
      const physicalAttemptId = "authorization-attempt";
      const transition = {
        source: "provider-operation",
        kind: "state-transition",
        fromState: "indeterminate",
        toState: "succeeded",
        outcome: "succeeded",
        physicalAttemptId,
        providerRequestId: "internal-request:operation-1",
        providerReference: "internal-reference:operation-1",
        movementReference: "internal-movement:operation-1",
      };
      const before = {
        historyCoverage: "complete",
        events: [
          { kind: "physical-attempt", outcome: "indeterminate" },
          transition,
        ],
      };
      const timeEvidence = {
        ...before,
        events: [
          ...before.events,
          {
            kind: "state-transition",
            fromState: "succeeded",
            toState: "succeeded",
            physicalAttemptId,
            providerOccurredAt: "2099-01-01T00:00:00+00:00",
          },
        ],
      };
      const movementEvidence = {
        ...timeEvidence,
        events: [
          ...timeEvidence.events,
          {
            kind: "state-transition",
            fromState: "succeeded",
            toState: "succeeded",
            physicalAttemptId,
            movementReference: "sim-movement-1234567890abcdef1234567890abcdef",
          },
        ],
      };
      const output =
        [
          `RESOLVED:${JSON.stringify(before)}`,
          `SOURCE:${JSON.stringify({ id: "operation-1", physicalAttemptId, originalOutcome: "indeterminate", outcome: "succeeded", executions: 1 })}`,
          "RECEIPTS:0",
          "REPEAT:succeeded",
          `RESOLVED:${JSON.stringify(before)}`,
          `EVIDENCE_TIME:${JSON.stringify(timeEvidence)}`,
          `EVIDENCE_MOVEMENT:${JSON.stringify(movementEvidence)}`,
          `EVIDENCE_MOVEMENT:${JSON.stringify(movementEvidence)}`,
          "RC330_HISTORY_EXECUTION_READY",
        ].join("\n") + "\n";
      function childProcess() {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.stdout.setEncoding = vi.fn();
        child.stderr.setEncoding = vi.fn();
        child.stdin = {
          write: vi.fn(),
          end: vi.fn(() => child.emit("close", 0, null)),
          destroyed: false,
          writableEnded: false,
        };
        child.kill = vi.fn(() => child.emit("close", null, "SIGTERM"));
        return child;
      }
      let tick = 0;
      const lines = [];
      const child = childProcess();
      child.stdin.end.mockImplementation(() => {
        tick += 7;
        child.emit("close", 0, null);
      });
      const harness = createLocalSupabaseConcurrencyHarness({
        timing: { check: "actual-history", isolation: "serial" },
        monotonicNow: () => tick,
        stdout: (line) => lines.push(JSON.parse(line)),
        spawnProcess: () => child,
      });
      const running = verifyProviderResolution(harness);
      const setup = child.stdin.write.mock.calls[0][0];
      expect(setup).toContain(
        "'successful authorization finalizes one Pending Booking Request'",
      );
      expect(setup).toContain("create temp table history_reference");
      expect(setup).toContain(
        "grant select on history_reference to authenticated",
      );
      expect(setup).not.toContain("select 'RESOLVED:'");
      expect(child.stdin.write).toHaveBeenCalledTimes(1);
      tick = 20;
      child.stdout.emit(
        "data",
        "ok 1 - established submission\nRC330_SQL_SETUP_READY\n",
      );
      await vi.advanceTimersByTimeAsync(20);
      expect(child.stdin.write).toHaveBeenCalledTimes(2);
      const body = child.stdin.write.mock.calls[1][0];
      expect(body).toMatch(/^\s*select 'RESOLVED:'/);
      for (const statement of [
        "select 'SOURCE:'",
        "select 'RECEIPTS:'",
        "select 'REPEAT:'",
        "select 'EVIDENCE_TIME:'",
        "select 'EVIDENCE_MOVEMENT:'",
        "select 'RC330_HISTORY_EXECUTION_READY';",
      ])
        expect(body).toContain(statement);
      expect(body).not.toContain("rollback;");
      expect(child.stdin.end).not.toHaveBeenCalled();
      tick = 50;
      child.stdout.emit("data", output);
      await vi.advanceTimersByTimeAsync(20);
      await running;
      expect(child.stdin.end).toHaveBeenCalledExactlyOnceWith("rollback;\n");
      expect(child.kill).not.toHaveBeenCalled();
      harness.finishTiming({ outcome: "passed", cleanupDisposition: "local" });
      expect(lines.at(-1)).toMatchObject({
        setupMs: 20,
        executionMs: 30,
        cleanupMs: 7,
      });

      const children = [childProcess(), childProcess()];
      let position = 0;
      const paired = createLocalSupabaseConcurrencyHarness({
        spawnProcess: () => children[position++],
      });
      const sessions = [];
      for (const [offset, index] of [141, 142].entries()) {
        const opening = prepareHistorySession(paired, index);
        const actor = children[offset];
        const preparation = actor.stdin.write.mock.calls[0][0];
        expect(preparation).toContain("-- BEGIN PAYMENT EVIDENCE FIXTURE");
        expect(preparation).toContain("begin;");
        expect(preparation).toContain(`00000000${index}3`);
        expect(preparation).toContain('"aal":"aal2"');
        expect(preparation).not.toContain("create temp table history_lease");
        expect(actor.stdin.write).toHaveBeenCalledTimes(1);
        actor.stdout.emit("data", "fixture-output\nRC330_SQL_SETUP_READY\n");
        await vi.advanceTimersByTimeAsync(20);
        const session = await opening;
        sessions.push(session);
        const operation = actor.stdin.write.mock.calls[1][0];
        expect(operation).toMatch(/^\s*create temp table history_lease/);
        expect(operation).toContain(
          `lease_booking_request_capture_work('60000000-0000-4000-8000-00000000${index}1'`,
        );
        expect(operation.indexOf("history_lease")).toBeLessThan(
          operation.indexOf("history_execution"),
        );
        expect(operation.indexOf("history_execution")).toBeLessThan(
          operation.indexOf("select 'HISTORY:'"),
        );
        expect(operation).toContain("select 'SEQUENCES:'");
        expect(operation).toContain("select 'HISTORY_READY';");
        expect(operation).not.toMatch(/\b(?:commit|rollback);/);
        actor.stdout.emit("data", "HISTORY_READY\n");
      }
      await Promise.all(
        sessions.map((session) =>
          paired.waitForMarker(session, "HISTORY_READY"),
        ),
      );
      for (const session of sessions) {
        expect(session.exit).toBeUndefined();
        expect(session.child.stdin.end).not.toHaveBeenCalled();
        expect(session.child.stdin.write).toHaveBeenCalledTimes(2);
      }
      for (const session of sessions)
        await paired.finishSession(session, { action: "rollback" });
      for (const actor of children)
        expect(actor.stdin.end).toHaveBeenCalledExactlyOnceWith("rollback;\n");
      const source = readFileSync(
        "scripts/verify-booking-request-payment-history-concurrency.mjs",
        "utf8",
      );
      const readyBarrier = source.indexOf(
        'harness.waitForMarker(session, "HISTORY_READY")',
      );
      expect(
        source.indexOf("sessions.push({ index, request, session })"),
      ).toBeLessThan(readyBarrier);
      expect(readyBarrier).toBeLessThan(
        source.indexOf("select public.record_booking_request_capture_failure"),
      );
      expect(source).toContain(
        "assert.equal(new Set(allSequences).size, allSequences.length)",
      );
      expect(source).toContain('"payment_required"');

      for (const failure of [
        "setup",
        "body",
        "body-timeout",
        "setup-assertion",
      ]) {
        const failedChild = childProcess();
        const primary = new Error("actual history setup failure");
        const failed = createLocalSupabaseConcurrencyHarness({
          spawnProcess: () => failedChild,
          waitLimitMilliseconds: 30,
        });
        const failureRun = verifyProviderResolution(failed).catch(
          (error) => error,
        );
        if (failure === "setup") {
          failedChild.emit("error", primary);
          await vi.advanceTimersByTimeAsync(20);
          expect(await failureRun).toBe(primary);
          expect(failedChild.stdin.write).toHaveBeenCalledTimes(1);
          expect(failedChild.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
        } else {
          failedChild.stdout.emit(
            "data",
            (failure === "setup-assertion"
              ? "not ok 1 - submission setup\n"
              : "ok 1 - setup\n") + "RC330_SQL_SETUP_READY\n",
          );
          await vi.advanceTimersByTimeAsync(20);
          if (failure === "body") {
            failedChild.stderr.emit("data", "actual history body SQL failure");
            failedChild.emit("close", 9, null);
          } else if (failure === "setup-assertion") {
            failedChild.stdout.emit("data", output);
          }
          await vi.advanceTimersByTimeAsync(40);
          const error = await failureRun;
          expect(error.message).toContain(
            failure === "body"
              ? "actual history body SQL failure"
              : failure === "body-timeout"
                ? "PostgreSQL session did not reach RC330_HISTORY_EXECUTION_READY"
                : "The established submission setup must pass",
          );
          if (failure === "body-timeout")
            expect(failedChild.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
          if (failure === "setup-assertion")
            expect(failedChild.stdin.end).toHaveBeenCalledExactlyOnceWith(
              "rollback;\n",
            );
        }
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("declares mixed concurrency checks serial with acknowledged setup", () => {
    for (const name of [
      "verify-booking-request-payment-history-concurrency",
      "verify-booking-event-notification-concurrency",
      "verify-booking-request-notification-concurrency",
      "verify-booking-payout-concurrency",
    ]) {
      const source = readFileSync(`scripts/${name}.mjs`, "utf8");
      expect(source).toMatch(
        new RegExp(`check: "${name}",\\s*isolation: "serial"`),
      );
      expect(source).toMatch(/(?:runSqlAfterSetup|startSessionAfterSetup)\(/);
      expect(source).toContain('harness.markTimingPhase("setup")');
      expect(source).toContain('harness.markTimingPhase("execution")');
      expect(source).toContain('harness.markTimingPhase("cleanup")');
      expect(source).toContain('outcome: passed ? "passed" : "failed"');
      expect(source).toContain('cleanupDisposition: "local"');
    }
  });

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
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-verification",
        SUPABASE_LOCAL_PROJECT: "rentcottage-verification",
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
      stdout: "rentcottage-verification|/tmp/rentcottage-worktree\n",
      stderr: "",
    });
    await guarded;
    expect(settled).toBe(true);
  });

  it("declares payment prefix concurrency checks serial with acknowledged setup", () => {
    const checks = [
      "verify-booking-request-concurrency",
      "verify-booking-request-capture-concurrency",
      "verify-booking-request-payment-recovery-concurrency",
      "verify-booking-request-payment-required-expiry-concurrency",
    ];
    expect(
      databaseCheckCommands
        .map(([, args]) => basename(args[0], ".mjs"))
        .filter((check) => checks.includes(check)),
    ).toEqual(checks);
    for (const check of checks) {
      const source = readFileSync(`scripts/${check}.mjs`, "utf8");
      expect(source).toMatch(
        new RegExp(
          `timing:\\s*\\{\\s*check:\\s*"${check}",\\s*isolation:\\s*"serial"`,
        ),
      );
      expect(source).toContain("runSqlAfterSetup");
      expect(source).toContain("startSessionAfterSetup");
      expect(source).not.toMatch(/paymentEvidenceSql\s*\+/);
    }
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

  it.each(["zombie", "absent"])(
    "finishes cancellation cleanup when a complete inspection proves an EPERM group is %s",
    async (exitedGroupState) => {
      await observeInterruptedAccessVerification("SIGTERM", {
        exitedGroupState,
      });
    },
    15_000,
  );

  it("bounds a hung cleanup command and reports the retained owned service", async () => {
    await observeInterruptedAccessVerification(undefined, {
      hangCleanup: true,
    });
  }, 20_000);

  it.each([
    { cleanupCommandLimitMs: undefined, expectedLimitMs: 30_000 },
    { cleanupCommandLimitMs: 2_000, expectedLimitMs: 2_000 },
  ])(
    "uses a $expectedLimitMs ms limit only for cleanup inspection and stop",
    async ({ cleanupCommandLimitMs, expectedLimitMs }) => {
      const run = successfulRun({ workdir: "/tmp/access-state/project" });

      expect(
        await mainWithPreparedProject(["--fixture-contract"], {
          cleanupCommandLimitMs,
          environment: {},
          makeTemp: () => "/tmp/access-state",
          removeTemp: vi.fn(),
          run,
        }),
      ).toBe(0);

      const cleanupInspection = run.mock.calls.filter(
        ([command]) => command === "docker",
      )[1];
      const cleanupStop = run.mock.calls.find(
        ([command, args]) =>
          command === "npx" &&
          args.slice(0, 3).join(" ") === "supabase stop --no-backup",
      );
      expect(cleanupInspection[2]).toMatchObject({
        lifecycleLimit: expectedLimitMs,
      });
      expect(cleanupStop[2]).toMatchObject({
        lifecycleLimit: expectedLimitMs,
      });
      expect(run.mock.calls[1][0]).toBe("docker");
      expect(run.mock.calls[1][2].lifecycleLimit).toBeUndefined();
      expect(
        run.mock.calls
          .filter((call) => call !== cleanupInspection && call !== cleanupStop)
          .every(([, , options]) => options.lifecycleLimit === undefined),
      ).toBe(true);
    },
  );

  it("declares homogeneous concurrency checks serial without changing their command order", () => {
    const checks = [
      "verify-account-access-concurrency",
      "verify-cottage-profile-draft-concurrency",
      "verify-cottage-shift-schedule-concurrency",
      "verify-cottage-inventory-concurrency",
      "verify-booking-period-hold-concurrency",
      "verify-booking-request-lifecycle-concurrency",
      "verify-booking-confirmation-notification-concurrency",
      "verify-booking-preparation-reminder-concurrency",
      "verify-booking-cancellation-concurrency",
      "verify-messaging-concurrency",
      "verify-booking-completion-concurrency",
      "verify-customer-review-concurrency",
      "verify-booking-refund-concurrency",
    ];
    for (const check of checks) {
      const source = readFileSync(`scripts/${check}.mjs`, "utf8");
      expect(source, check).toMatch(
        new RegExp(
          `timing: \\s*\\{\\s*check: \\s*"${check}",\\s*isolation: \\s*"serial",?\\s*\\}`,
        ),
      );
    }
  });

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

  it("uses real isolated preparation by default without changing the source config", async () => {
    const stateRoot = mkdtempSync(
      join(tmpdir(), "rentcottage-default-verifier-"),
    );
    const sourcePath = join(process.cwd(), "supabase/config.toml");
    const sourceConfig = readFileSync(sourcePath, "utf8");
    const workdir = realpathSync(stateRoot) + "/project";
    const run = vi.fn((command, args) => {
      if (command === "docker")
        return {
          status: 0,
          stdout: `rentcottage-verification|${workdir}\n`,
          stderr: "",
        };
      if (command === "npx" && args[1] === "start") {
        expect(existsSync(join(workdir, "supabase/config.toml"))).toBe(true);
        expect(
          readFileSync(join(workdir, "supabase/config.toml"), "utf8"),
        ).toContain('project_id = "rentcottage-verification"');
      }
      return {
        status: 0,
        stdout:
          command === "npx" && args[1] === "status"
            ? localCredentials
            : command === "npx" && args[2] === "diff"
              ? emptyDeclaredSchemaDiff
              : "",
      };
    });
    try {
      expect(
        await main([], {
          environment: {},
          makeTemp: () => stateRoot,
          run,
        }),
      ).toBe(0);
      for (const [command, args] of run.mock.calls) {
        if (command === "npx" && args[0] === "supabase")
          expect(args.slice(-2)).toEqual(["--workdir", workdir]);
      }
      const concurrency = run.mock.calls.find(
        ([command, args]) =>
          command === "node" &&
          args[0] === "scripts/verify-account-access-concurrency.mjs",
      );
      expect(concurrency).toBeDefined();
      expect(concurrency[2].env).toMatchObject({
        SUPABASE_LOCAL_PROJECT: "rentcottage-verification",
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-verification",
        SUPABASE_LOCAL_WORKDIR: workdir,
      });
      const browser = run.mock.calls.find(
        ([command, args]) => command === "npx" && args[0] === "playwright",
      );
      expect(browser).toBeDefined();
      expect(browser[2].env).toMatchObject({
        SUPABASE_LOCAL_PROJECT: "rentcottage-verification",
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-verification",
        SUPABASE_LOCAL_WORKDIR: workdir,
      });
      expect(run.mock.calls.at(-1)[1]).toEqual([
        "supabase",
        "stop",
        "--no-backup",
        "--project-id",
        "rentcottage-verification",
        "--workdir",
        workdir,
      ]);
      expect(existsSync(stateRoot)).toBe(false);
      expect(readFileSync(sourcePath, "utf8")).toBe(sourceConfig);
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
    }
  });

  it("rejects the root project before any preparation or subprocess", async () => {
    const makeTemp = vi.fn(() => "/tmp/forbidden-root-state");
    const prepareProject = vi.fn(() => "/tmp/forbidden-root-state/project");
    const removeTemp = vi.fn();
    const run = vi.fn(() => ({ status: 1 }));
    expect(
      await main([], {
        environment: { SUPABASE_LOCAL_PROJECT: "rentcottage" },
        makeTemp,
        prepareProject,
        removeTemp,
        run,
        stderr: vi.fn(),
      }),
    ).toBe(2);
    expect(makeTemp).not.toHaveBeenCalled();
    expect(prepareProject).not.toHaveBeenCalled();
    expect(removeTemp).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
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
          await mainWithPreparedProject([], {
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

  it("rejects arguments before starting Docker or Supabase", async () => {
    const run = vi.fn();
    const stderr = vi.fn();

    expect(await mainWithPreparedProject(["unexpected"], { run, stderr })).toBe(
      2,
    );
    expect(run).not.toHaveBeenCalled();

    expect(
      await mainWithPreparedProject(["--database", "--browser"], {
        run,
        stderr,
      }),
    ).toBe(2);
    expect(
      await mainWithPreparedProject(["--database", "--database"], {
        run,
        stderr,
      }),
    ).toBe(2);
    expect(run).not.toHaveBeenCalled();
  });

  it("loads reused messaging cancellation templates before rejecting invalid database identity", () => {
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "scripts/verify-messaging-concurrency.mjs")],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SUPABASE_LOCAL_PROJECT: "invalid",
          SUPABASE_DB_CONTAINER: "invalid",
          PATH: "",
        },
        encoding: "utf8",
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "The guarded local Supabase database identity is invalid.",
    );
    expect(result.stderr).not.toMatch(
      /Missing .*template|Duplicate .*template|unresolved interpolation/,
    );
    const summaries = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((record) => record.type === "concurrency-summary");
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      check: "verify-messaging-concurrency",
      isolation: "serial",
      outcome: "failed",
      executionMs: null,
      cleanupMs: null,
      phaseReasons: {
        execution: "Phase was not reached.",
        cleanup: "Phase was not reached.",
      },
    });
    expect(Number.isFinite(summaries[0].setupMs)).toBe(true);
    expect(summaries[0].setupMs).toBeGreaterThanOrEqual(0);
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
            SUPABASE_LOCAL_PROJECT: "rentcottage-verification",
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
            SUPABASE_LOCAL_PROJECT: "rentcottage-verification",
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
            SUPABASE_LOCAL_PROJECT: "rentcottage-verification",
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

    expect(
      await mainWithPreparedProject(["--database"], { environment: {}, run }),
    ).toBe(0);

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
            : command === "npx" &&
                args.slice(0, 4).join(" ") === "supabase status -o json"
              ? localCredentials
              : "",
      }));

      expect(
        await mainWithPreparedProject(["--database"], {
          environment: {},
          run,
          stderr: errors,
        }),
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
          command === "npx" &&
          args.slice(0, 4).join(" ") === "supabase status -o json"
            ? localCredentials
            : "",
      }));
      expect(
        await mainWithPreparedProject(mode, {
          environment: {},
          run,
          stderr: vi.fn(),
        }),
      ).toBe(7);
      expect(run.mock.calls.at(-1).slice(0, 2)).toEqual(stopCommand);
      expect(run.mock.calls.some(([, args]) => args[0] === "playwright")).toBe(
        false,
      );
    },
  );

  it("runs complete browser evidence from fresh fixtures without database checks", async () => {
    const run = successfulRun();

    expect(
      await mainWithPreparedProject(["--browser"], { environment: {}, run }),
    ).toBe(0);

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
          ? "rentcottage-verification|/tmp/another-checkout\n"
          : "",
    }));
    const removeTemp = vi.fn();
    const stderr = vi.fn();

    expect(
      await mainWithPreparedProject(["--browser"], {
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
          "--workdir",
          "/tmp/access-docker/project",
        ],
      ],
      [
        "docker",
        [
          "inspect",
          "supabase_db_rentcottage-verification",
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
        command === "npx" &&
        args.slice(0, 4).join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }));
    const removeTemp = vi.fn();

    expect(
      await mainWithPreparedProject(["--fixture-contract"], {
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
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-verification",
      SUPABASE_LOCAL_PROJECT: "rentcottage-verification",
    });
    expect(removeTemp).toHaveBeenCalledWith("/tmp/access-docker");
  });

  it("rejects a malformed local project before creating temp state or starting a subprocess", async () => {
    const makeTemp = vi.fn();
    const prepareProject = vi.fn();
    const run = vi.fn();
    const stderr = vi.fn();

    expect(
      await mainWithPreparedProject([], {
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
        command === "npx" &&
        args.slice(0, 4).join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }));
    const removeTemp = vi.fn();

    expect(
      await mainWithPreparedProject([], {
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
    const optionsFor = (command, args) => {
      const calls = run.mock.calls.filter(
        ([actualCommand, actualArgs]) =>
          actualCommand === command &&
          actualArgs.length === args.length &&
          actualArgs.every((argument, index) => argument === args[index]),
      );
      expect(calls, `${command} ${args.join(" ")}`).toHaveLength(1);
      return calls[0][2];
    };
    const localEnvironment = {
      EXISTING: "kept",
      APP_ENVIRONMENT: "test",
      SUPABASE_URL: "http://127.0.0.1:54331",
      SUPABASE_PUBLISHABLE_KEY: "local-publishable",
      SUPABASE_SECRET_KEY: "local-secret",
      PRIVILEGED_AUDIT_HMAC_KEY: "local-test-audit-hmac-key-32-characters",
      SUPABASE_TELEMETRY_DISABLED: "1",
      DO_NOT_TRACK: "1",
    };
    const databaseIdentity = {
      SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-verification",
      SUPABASE_LOCAL_PROJECT: "rentcottage-verification",
    };
    // Startup remains the first public command, as asserted by the full sequence above.
    expect(run.mock.calls[0][2].env).toMatchObject({
      DOCKER_CONFIG: "/tmp/access-docker",
      DO_NOT_TRACK: "1",
      EXISTING: "kept",
      SUPABASE_TELEMETRY_DISABLED: "1",
    });
    const ownershipCalls = run.mock.calls.filter(
      ([command]) => command === "docker",
    );
    expect(ownershipCalls).toHaveLength(2);
    for (const [, , options] of ownershipCalls) {
      expect(options).toMatchObject({
        encoding: "utf8",
        env: {
          DOCKER_CONFIG: "/tmp/access-docker",
          DO_NOT_TRACK: "1",
          EXISTING: "kept",
          ...databaseIdentity,
          SUPABASE_TELEMETRY_DISABLED: "1",
        },
        maxBuffer: 1024 * 1024,
      });
      expect(options).toHaveProperty("input", undefined);
      expect(options.env).not.toHaveProperty("SUPABASE_URL");
      expect(options.env).not.toHaveProperty("SUPABASE_PUBLISHABLE_KEY");
      expect(options.env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    }
    expect(
      optionsFor("node", ["scripts/verify-access-fixture-contract.mjs"]).env,
    ).toMatchObject({ ...localEnvironment, ...databaseIdentity });

    for (const [command, args] of [
      ["node", ["scripts/verify-account-access-concurrency.mjs"]],
      [
        "node",
        ["scripts/verify-booking-request-scheduled-expiry.mjs", "--seed"],
      ],
      [
        "node",
        ["scripts/verify-booking-request-scheduled-expiry.mjs", "--verify"],
      ],
    ]) {
      const { env } = optionsFor(command, args);
      expect(env).toMatchObject(databaseIdentity);
      expect(env).not.toHaveProperty("SUPABASE_URL");
      expect(env).not.toHaveProperty("SUPABASE_PUBLISHABLE_KEY");
      expect(env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    }
    for (const script of [
      "verify-cottage-profile-draft-concurrency",
      "verify-cottage-inventory-concurrency",
      "verify-booking-period-hold-concurrency",
      "verify-booking-request-concurrency",
      "verify-booking-request-payment-recovery-concurrency",
      "verify-booking-request-payment-history-concurrency",
      "verify-booking-confirmation-notification-concurrency",
      "verify-booking-event-notification-concurrency",
      "verify-booking-request-notification-concurrency",
      "verify-booking-preparation-reminder-concurrency",
      "verify-booking-cancellation-concurrency",
      "verify-messaging-concurrency",
      "verify-booking-completion-concurrency",
      "verify-booking-refund-concurrency",
      "verify-booking-payout-concurrency",
      "verify-booking-request-payment-required-expiry-concurrency",
    ]) {
      const { env } = optionsFor("node", [`scripts/${script}.mjs`]);
      expect(env).toMatchObject({
        ...databaseIdentity,
        SUPABASE_URL: localEnvironment.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: localEnvironment.SUPABASE_PUBLISHABLE_KEY,
      });
      expect(env).not.toHaveProperty("SUPABASE_SECRET_KEY");
    }
    const scheduleEnvironment = optionsFor("node", [
      "scripts/verify-cottage-shift-schedule-concurrency.mjs",
    ]).env;
    expect(scheduleEnvironment).toMatchObject({
      SUPABASE_URL: localEnvironment.SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY: localEnvironment.SUPABASE_PUBLISHABLE_KEY,
    });
    expect(scheduleEnvironment).not.toHaveProperty("SUPABASE_SECRET_KEY");
    for (const script of [
      "verify-booking-request-lifecycle-concurrency",
      "verify-booking-request-capture-concurrency",
    ]) {
      expect(optionsFor("node", [`scripts/${script}.mjs`]).env).toMatchObject({
        ...localEnvironment,
        ...databaseIdentity,
      });
    }
    expect(
      optionsFor("node", [
        "scripts/prepare-access-test.mjs",
        "create",
        "mobile",
      ]).env,
    ).toMatchObject(localEnvironment);
    for (const [command, args] of browserCommands) {
      if (args[0] === "scripts/prepare-access-test.mjs") {
        expect(optionsFor(command, args).env).toMatchObject(localEnvironment);
      } else if (command === "npm" || args[0] === "playwright") {
        expect(optionsFor(command, args).env).toMatchObject({
          ...localEnvironment,
          ...databaseIdentity,
          NEXTJS_ENV: "test",
          SUPABASE_PROJECT_REF: "local-test",
          PLAYWRIGHT_SERVER: args.includes("--project=mobile")
            ? "next"
            : "worker",
        });
      }
    }
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
            args.slice(0, 4).join(" ") === "supabase status -o json"
              ? localCredentials
              : "",
        };
      });
      expect(
        await mainWithPreparedProject(["--browser"], {
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
    expect(
      await mainWithPreparedProject(["--browser"], { environment: {}, run }),
    ).toBe(0);
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
        stdout: invocation.startsWith("npx supabase status -o json ")
          ? localCredentials
          : "",
      };
    });

    expect(await mainWithPreparedProject([], { environment: {}, run })).toBe(0);
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
        command === "npx" &&
        args.slice(0, 4).join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }));

    expect(
      await mainWithPreparedProject(["--browser"], {
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
    expect(run.mock.calls.at(-1).slice(0, 2)).toEqual(stopCommand);
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
      await mainWithPreparedProject([], {
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
    const accountConcurrency = run.mock.calls.find(
      ([command, args]) =>
        command === "node" &&
        args[0] === "scripts/verify-account-access-concurrency.mjs",
    );
    expect(accountConcurrency).toBeDefined();
    expect(accountConcurrency[2].env).toMatchObject({
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
            : invocation.startsWith("npx supabase stop --no-backup ")
              ? 6
              : 0,
        stdout: invocation.startsWith("npx supabase status -o json ")
          ? localCredentials
          : "",
      };
    });
    const removeTemp = vi.fn();

    expect(
      await mainWithPreparedProject(["--database"], {
        environment: {},
        makeTemp: () => "/tmp/access-docker",
        removeTemp,
        run,
      }),
    ).toBe(9);
    expect(run.mock.calls.at(-1).slice(0, 2)).toEqual(stopCommand);
    expect(
      run.mock.calls.filter(
        ([command, args]) =>
          command === "npx" &&
          args.slice(0, 3).join(" ") === "supabase stop --no-backup",
      ),
    ).toHaveLength(1);
    expect(run.mock.calls.some(([, args]) => args[0] === "playwright")).toBe(
      false,
    );
    expect(removeTemp).not.toHaveBeenCalled();
  });

  it("fails and retains the project when ownership changes before cleanup", async () => {
    let inspections = 0;
    const run = vi.fn((command, args, options) => {
      if (command === "docker" && args[0] === "inspect") {
        inspections += 1;
        return {
          status: 0,
          stdout:
            inspections === 1
              ? `rentcottage-verification|${options.env.SUPABASE_LOCAL_WORKDIR}\n`
              : `foreign-project|${process.cwd()}\n`,
          stderr: "",
        };
      }
      return {
        status: 0,
        stdout:
          command === "npx" &&
          args.slice(0, 4).join(" ") === "supabase status -o json"
            ? localCredentials
            : "",
      };
    });
    const removeTemp = vi.fn();
    const stderr = vi.fn();

    expect(
      await mainWithPreparedProject(["--fixture-contract"], {
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
          command === "npx" &&
          args.slice(0, 3).join(" ") === "supabase stop --no-backup",
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
      const run = vi.fn((command, args, options) => {
        if (command === "docker" && args[0] === "inspect") {
          inspections += 1;
          if (stage === "cleanup inspection" && inspections === 2) {
            process.emit(signal);
          }
          return {
            status: 0,
            stdout: `rentcottage-verification|${options.env.SUPABASE_LOCAL_WORKDIR}\n`,
            stderr: "",
          };
        }
        if (
          command === "npx" &&
          args.slice(0, 3).join(" ") === "supabase stop --no-backup"
        ) {
          stops += 1;
          if (stage === "cleanup stop") process.emit(signal);
        }
        return {
          status: 0,
          stdout:
            command === "npx" &&
            args.slice(0, 4).join(" ") === "supabase status -o json"
              ? localCredentials
              : "",
        };
      });
      const removeTemp = vi.fn();

      expect(
        await mainWithPreparedProject(["--fixture-contract"], {
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
      await mainWithPreparedProject([], {
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
        command === "npx" &&
        args.slice(0, 4).join(" ") === "supabase status -o json"
          ? JSON.stringify({
              API_URL: {},
              PUBLISHABLE_KEY: [],
              SECRET_KEY: true,
            })
          : "",
    }));
    const stderr = vi.fn();

    expect(
      await mainWithPreparedProject([], { environment: {}, run, stderr }),
    ).toBe(1);
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
        command === "npx" &&
        args.slice(0, 4).join(" ") === "supabase status -o json"
          ? "not-json"
          : "",
    }));
    const stderr = vi.fn();

    expect(
      await mainWithPreparedProject([], { environment: {}, run, stderr }),
    ).toBe(1);
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
        command === "npx" &&
        args.slice(0, 4).join(" ") === "supabase status -o json"
          ? JSON.stringify({
              API_URL: "https://supabase.example.com",
              PUBLISHABLE_KEY: "local-publishable",
              SECRET_KEY: "local-secret",
            })
          : "",
    }));
    const stderr = vi.fn();

    expect(
      await mainWithPreparedProject([], { environment: {}, run, stderr }),
    ).toBe(1);
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
        command === "npx" &&
        args.slice(0, 3).join(" ") === "supabase stop --no-backup"
          ? 6
          : 0,
      stdout:
        command === "npx" &&
        args.slice(0, 4).join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }));
    const stderr = vi.fn();
    const removeTemp = vi.fn();

    expect(
      await mainWithPreparedProject([], {
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
  it("reports shared access phase costs and the authoritative failing child group", async () => {
    const captureCommand = [
      "node",
      "scripts/verify-booking-request-capture-concurrency.mjs",
    ];
    const nextCommand = [browserCommands[2][0], ...browserCommands[2][1]];
    const fixtureCommand = [
      "node",
      "scripts/verify-access-fixture-contract.mjs",
    ];
    const scenarios = [
      {
        args: [],
        failure: captureCommand,
        recipe: ["npm", "run", "verify:access:database"],
        before: [
          startCommand,
          ownershipCommand,
          resetCommand,
          ...databasePreflightCommands,
          statusCommand,
          ...databaseCheckCommands.slice(0, 10),
        ],
      },
      {
        args: [],
        failure: nextCommand,
        recipe: ["npm", "run", "verify:access:browser"],
        before: [
          startCommand,
          ownershipCommand,
          resetCommand,
          ...databasePreflightCommands,
          statusCommand,
          ...databaseCheckCommands,
          ...browserCommands.slice(0, 3),
        ],
      },
      {
        args: ["--fixture-contract"],
        failure: fixtureCommand,
        recipe: ["node", "scripts/verify-access.mjs", "--fixture-contract"],
        before: [
          startCommand,
          ownershipCommand,
          resetCommand,
          statusCommand,
          databaseCheckCommands[0],
        ],
      },
      {
        args: [],
        credentials: "secret-invalid-json",
        recipe: ["npm", "run", "verify:access"],
        before: [
          startCommand,
          ownershipCommand,
          resetCommand,
          ...databasePreflightCommands,
          statusCommand,
        ],
      },
      {
        args: [],
        credentials: JSON.stringify({
          API_URL: {},
          PUBLISHABLE_KEY: [],
          SECRET_KEY: true,
        }),
        recipe: ["npm", "run", "verify:access"],
        before: [
          startCommand,
          ownershipCommand,
          resetCommand,
          ...databasePreflightCommands,
          statusCommand,
        ],
      },
      {
        args: [],
        schema: "secret-schema-invalid-json",
        recipe: ["npm", "run", "verify:access:database"],
        before: [
          startCommand,
          ownershipCommand,
          resetCommand,
          declaredSchemaDiffCommand,
        ],
      },
      {
        args: ["--browser"],
        failure: ["npx", "supabase", "db", "reset", "--local"],
        prefix: true,
        recipe: ["npm", "run", "verify:access:browser"],
        before: [startCommand, ownershipCommand, resetCommand],
      },
    ];
    for (const scenario of scenarios) {
      let tick = 100;
      const timestamp = () =>
        new Date(Date.UTC(2026, 0, 1) + tick).toISOString();
      const lines = [];
      const baseRun = successfulRun();
      const run = vi.fn((command, args, options) => {
        // Advance time in actual work, including ownership inspections.
        tick += 7;
        const vector = [command, ...args];
        if (
          scenario.failure &&
          (scenario.prefix
            ? vector.slice(0, scenario.failure.length).join("|") ===
              scenario.failure.join("|")
            : vector.join("|") === scenario.failure.join("|"))
        )
          return { status: 9 };
        if (args[1] === "status" && scenario.credentials !== undefined)
          return { status: 0, stdout: scenario.credentials };
        if (
          args[1] === "db" &&
          args[2] === "diff" &&
          scenario.schema !== undefined
        )
          return { status: 0, stdout: scenario.schema };
        return baseRun(command, args, options);
      });
      expect(
        await mainWithPreparedProject(scenario.args, {
          environment: { HIDDEN_VALUE: "hidden-environment-value" },
          makeTemp: () => "/tmp/access-timing",
          prepareProject: ({ stateRoot }) => {
            tick += 11;
            return join(stateRoot, "project");
          },
          removeTemp: () => {
            tick += 3;
          },
          run,
          stderr: vi.fn(),
          stdout: (line) => lines.push(JSON.parse(line)),
          monotonicNow: () => tick,
          utcNow: timestamp,
        }),
      ).toBe(scenario.failure ? 9 : 1);
      expect(commands(run)).toEqual([
        ...scenario.before,
        ownershipCommand,
        stopCommand,
      ]);
      const records = lines.filter((line) => line.type === "access-phase");
      expect(records[0]).toMatchObject({
        name: "project-preparation",
        command: null,
        scope: "shared-setup",
        durationMs: 11,
        inclusive: false,
        startedAt: "2026-01-01T00:00:00.100Z",
        completedAt: "2026-01-01T00:00:00.111Z",
      });
      const commandRecords = records.filter((line) => line.command !== null);
      expect(
        commandRecords.map((line) => [line.command[0], line.command.slice(1)]),
      ).toEqual(commands(run));
      for (const record of commandRecords) {
        expect(record.durationMs).toBe(7);
        expect(
          Date.parse(record.completedAt) - Date.parse(record.startedAt),
        ).toBe(7);
      }
      expect(
        lines.filter((line) => line.type === "verification-failure"),
      ).toEqual([
        {
          type: "verification-failure",
          attemptedCommand: commandRecords.at(-3).command,
          reproduceGroup: scenario.recipe,
        },
      ]);
      const summary = lines.at(-1);
      expect(summary).toMatchObject({
        type: "access-lifecycle",
        inclusive: true,
        durationMs: 11 + commands(run).length * 7 + 3,
        cleanupMs: 17,
        cleanupReason: null,
        outcome: { type: "exit", status: scenario.failure ? 9 : 1 },
      });
      expect(summary.sharedSetupMs).toBe(
        records
          .filter((line) => line.scope === "shared-setup")
          .reduce((sum, line) => sum + line.durationMs, 0),
      );
      expect(summary.checksMs).toBe(
        records
          .filter((line) => line.scope === "check")
          .reduce((sum, line) => sum + line.durationMs, 0),
      );
      expect(summary.sharedSetupMs + summary.checksMs + summary.cleanupMs).toBe(
        summary.durationMs,
      );
      expect(JSON.stringify(lines)).not.toMatch(
        /hidden-environment-value|local-secret|local-publishable|secret-invalid-json|secret-schema-invalid-json/,
      );
      if (scenario.failure)
        expect(commandRecords.at(-3).outcome).toEqual({
          type: "exit",
          status: 9,
        });
    }
  });

  it("finishes access timing after cleanup and preserves failed or retained teardown", async () => {
    for (const scenario of [
      "passed",
      "cleanup-failure",
      "primary-and-cleanup-failure",
      "ownership-change",
      "ownership-spawn-failure",
      "startup-interrupted",
      "child-interrupted",
      "spawn-failure",
      "preparation-failure",
    ]) {
      let tick = 100;
      let inspections = 0;
      const lines = [];
      const removeTemp = vi.fn(() => {
        tick += 3;
      });
      const baseRun = successfulRun();
      const run = vi.fn((command, args, options) => {
        tick += args[1] === "stop" ? 41 : 7;
        if (command === "docker") {
          inspections += 1;
          if (scenario === "ownership-spawn-failure")
            return {
              error: Object.assign(new Error("inspection unavailable"), {
                code: "EACCES",
              }),
            };
          if (scenario === "ownership-change" && inspections === 2)
            return { status: 0, stdout: "foreign-project|foreign-workdir\n" };
        }
        if (args[1] === "stop" && scenario.includes("cleanup-failure"))
          return { status: 6 };
        if (args[0] === "scripts/verify-access-fixture-contract.mjs") {
          if (scenario === "primary-and-cleanup-failure") return { status: 9 };
          if (scenario === "child-interrupted") process.emit("SIGTERM");
          if (scenario === "ownership-spawn-failure")
            expect(
              lines.find((line) => line.name === "startup-ownership").outcome,
            ).toEqual({ type: "spawn-failure", code: "EACCES" });
          if (scenario === "spawn-failure")
            return {
              error: Object.assign(new Error("no child"), { code: "ENOENT" }),
            };
        }
        if (args[1] === "start" && scenario === "startup-interrupted")
          process.emit("SIGTERM");
        return baseRun(command, args, options);
      });
      const expected =
        scenario === "passed"
          ? 0
          : scenario === "cleanup-failure"
            ? 6
            : scenario === "primary-and-cleanup-failure"
              ? 9
              : scenario.includes("interrupted")
                ? 143
                : 1;
      expect(
        await mainWithPreparedProject(["--fixture-contract"], {
          environment: {},
          makeTemp: () => "/tmp/access-timing",
          removeTemp,
          run,
          prepareProject: ({ stateRoot }) => {
            tick += 11;
            if (scenario === "preparation-failure")
              throw new Error("preparation failed");
            return join(stateRoot, "project");
          },
          stderr: vi.fn(),
          stdout: (line) => lines.push(JSON.parse(line)),
          monotonicNow: () => tick,
          utcNow: () => new Date(Date.UTC(2026, 0, 1) + tick).toISOString(),
        }),
      ).toBe(expected);
      const retained = [
        "cleanup-failure",
        "primary-and-cleanup-failure",
        "ownership-change",
        "ownership-spawn-failure",
        "startup-interrupted",
      ].includes(scenario);
      const cleanup = lines.find((line) => line.name === "outer-cleanup");
      const summary = lines.at(-1);
      expect(cleanup).toMatchObject({
        type: "access-phase",
        name: "outer-cleanup",
        scope: "shared-cleanup",
        inclusive: true,
        outcome: { type: "exit", status: retained ? 1 : 0 },
      });
      expect(summary).toMatchObject({
        type: "access-lifecycle",
        inclusive: true,
        durationMs: tick - 100,
        completedAt: new Date(Date.UTC(2026, 0, 1) + tick).toISOString(),
        cleanupMs: retained ? null : cleanup.durationMs,
        cleanupReason: retained
          ? "Exact cleanup could not be completed; resources may be retained."
          : null,
        outcome: scenario.includes("interrupted")
          ? { type: "signal", signal: "SIGTERM" }
          : { type: "exit", status: expected },
      });
      expect(removeTemp).toHaveBeenCalledTimes(retained ? 0 : 1);
      const stop = lines.find((line) => line.name === "supabase-stop");
      if (
        [
          "ownership-change",
          "ownership-spawn-failure",
          "startup-interrupted",
          "preparation-failure",
        ].includes(scenario)
      ) {
        expect(stop).toBeUndefined();
      } else {
        expect(stop.durationMs).toBe(41);
        expect(Date.parse(summary.completedAt)).toBeGreaterThanOrEqual(
          Date.parse(stop.completedAt),
        );
        expect(stop.outcome).toEqual({
          type: "exit",
          status: scenario.includes("cleanup-failure") ? 6 : 0,
        });
      }
      const diagnostics = lines.filter(
        (line) => line.type === "verification-failure",
      );
      expect(
        diagnostics.every(
          (line) =>
            line.reproduceGroup.join(" ") ===
            "node scripts/verify-access.mjs --fixture-contract",
        ),
      ).toBe(true);
      if (scenario === "spawn-failure")
        expect(
          lines.find(
            (line) =>
              line.name === "scripts/verify-access-fixture-contract.mjs",
          ).outcome,
        ).toEqual({ type: "spawn-failure", code: "ENOENT" });
    }
    for (const failure of ["temporary-state", "preparation-cleanup"]) {
      let tick = 100;
      const lines = [];
      const run = vi.fn();
      const removeTemp = vi.fn(() => {
        tick += 13;
        throw new Error("cleanup failed");
      });
      await expect(
        mainWithPreparedProject([], {
          environment: {},
          run,
          removeTemp,
          makeTemp: () => {
            tick += 5;
            if (failure === "temporary-state")
              throw new Error("temporary state failed");
            return "/tmp/access-timing";
          },
          prepareProject: () => {
            tick += 11;
            throw new Error("preparation failed");
          },
          stdout: (line) => lines.push(JSON.parse(line)),
          stderr: vi.fn(),
          monotonicNow: () => tick,
          utcNow: () => new Date(Date.UTC(2026, 0, 1) + tick).toISOString(),
        }),
      ).rejects.toThrow(
        failure === "temporary-state"
          ? "temporary state failed"
          : "cleanup failed",
      );
      expect(run).not.toHaveBeenCalled();
      expect(removeTemp).toHaveBeenCalledTimes(
        failure === "temporary-state" ? 0 : 1,
      );
      expect(lines.at(-1)).toMatchObject({
        type: "access-lifecycle",
        durationMs: tick - 100,
        cleanupMs: null,
        cleanupReason:
          failure === "temporary-state"
            ? "Cleanup was not entered because temporary project state was not created."
            : "Exact cleanup could not be completed; resources may be retained.",
        outcome: { type: "exit", status: 1 },
      });
    }
    await observeInterruptedAccessVerification("SIGTERM", {
      observeTiming: (lines) => {
        const summary = lines.at(-1);
        expect(summary).toMatchObject({
          type: "access-lifecycle",
          cleanupReason: null,
          outcome: { type: "signal", signal: "SIGTERM" },
        });
        expect(summary.cleanupMs).toBeGreaterThanOrEqual(0);
        const stopped = lines.find((line) => line.name === "supabase-stop");
        expect(stopped.outcome).toEqual({ type: "exit", status: 0 });
        expect(Date.parse(summary.completedAt)).toBeGreaterThanOrEqual(
          Date.parse(stopped.completedAt),
        );
        expect(
          lines.find((line) => line.name === "supabase-db-reset").outcome,
        ).toEqual({ type: "signal", signal: "SIGTERM" });
      },
    });
  }, 15_000);
});
