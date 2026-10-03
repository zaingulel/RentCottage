import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { mainWithPreparedProject } from "./verify-access-command-doubles.mjs";
import {
  assertProcessObserverReady,
  processIsAlive,
  stopExactFixtureProcess,
  waitForChildExit,
  waitForCondition,
} from "./verify-access-interruption-observer.mjs";

describe("access verification command", () => {
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
            GITHUB_ACTIONS: "false",
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
            GITHUB_ACTIONS: "false",
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
            GITHUB_ACTIONS: "false",
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
});
