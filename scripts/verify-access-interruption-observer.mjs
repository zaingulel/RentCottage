import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { expect } from "vitest";

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

export function processIsAlive(pid) {
  return processIdentity(pid) !== undefined;
}

export function assertProcessObserverReady() {
  if (!processIdentity(process.pid)) {
    throw new Error("Unable to observe the lifecycle-test process identity.");
  }
}

export async function waitForCondition(predicate, label, limit = 4_000) {
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

export async function waitForChildExit(child, label, limit = 4_000) {
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

export async function stopExactFixtureProcess(identity) {
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

export async function observeInterruptedAccessVerification(
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
          GITHUB_ACTIONS: "false",
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
      // eslint-disable-next-line no-unsafe-finally -- a fixture process that could not be stopped must fail loudly
      throw new AggregateError(
        cleanupErrors,
        "Fixture process cleanup failed.",
      );
    }
    rmSync(stateRoot, { recursive: true, force: true });
  }
}
