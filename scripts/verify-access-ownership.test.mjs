import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { localCheckSettings } from "./lib/local-check-slot.mjs";
import { main, prepareIsolatedSupabaseWorkdir } from "./verify-access.mjs";
import {
  commands,
  emptyDeclaredSchemaDiff,
  localCredentials,
  mainWithPreparedProject,
  ownedRun,
} from "./verify-access-command-doubles.mjs";

describe("access verification command", () => {
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
        "port = 55339",
        "port = 55333",
        "port = 55334",
        "inspector_port = 8183",
        "port = 55337",
      ]) {
        expect(generatedConfig).toContain(value);
      }
      const shadowPortLines = [
        ...generatedConfig.matchAll(/^shadow_port = (\d+)$/gm),
      ];
      expect(shadowPortLines).toHaveLength(1);
      const shadowPort = Number(shadowPortLines[0][1]);
      expect(shadowPort).toBeGreaterThanOrEqual(1024);
      expect(shadowPort).toBeLessThan(32768);
      const generatedOtpSection = generatedConfig.match(
        /\[auth\.sms\.test_otp\]\n([\s\S]*?)(?=\n\[|$)/,
      );
      expect(generatedOtpSection).not.toBeNull();
      const generatedJourneyPhones = [
        ...generatedOtpSection[1].matchAll(/^(96477\d+) = "123456"$/gm),
      ].map((match) => match[1]);
      expect(generatedJourneyPhones).toHaveLength(360);
      expect(new Set(generatedJourneyPhones)).toHaveLength(360);
      expect(generatedJourneyPhones).toContain("9647700000000");
      expect(generatedJourneyPhones).toContain("9647700207104");
      expect(readlinkSync(join(workdir, "supabase", "migrations"))).toBe(
        join(workingDirectory, "supabase", "migrations"),
      );
      expect(readlinkSync(join(workdir, "supabase", "schemas"))).toBe(
        join(workingDirectory, "supabase", "schemas"),
      );
      expect(readlinkSync(join(workdir, "supabase", "tests"))).toBe(
        join(workingDirectory, "supabase", "tests"),
      );
      const corruptSource = join(directState, "corrupt-source");
      const corruptState = join(directState, "corrupt-state");
      mkdirSync(join(corruptSource, "supabase"), { recursive: true });
      writeFileSync(
        join(corruptSource, "supabase", "config.toml"),
        sourceConfig.replace("shadow_port = 54330", "shadow_port = invalid"),
      );
      expect(() =>
        prepareIsolatedSupabaseWorkdir({
          localProject: "rentcottage-issue-32-constructor",
          stateRoot: corruptState,
          workingDirectory: corruptSource,
        }),
      ).toThrow("Local Supabase config is missing shadow_port = 54330.");
      expect(
        existsSync(join(corruptState, "project", "supabase", "config.toml")),
      ).toBe(false);
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

  it("refuses to reset, modify, browse, or stop a foreign local project", async () => {
    for (const environment of [
      {},
      { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted" },
    ]) {
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
          environment,
          makeTemp: () => "/tmp/access-docker",
          removeTemp,
          run,
          stderr,
          workingDirectory: "/tmp/this-checkout",
        }),
      ).toBe(1);
      expect(commands(run)).toEqual([
        ...(environment.RUNNER_ENVIRONMENT === "github-hosted"
          ? [
              ["docker", ["container", "ls", "--all", "--quiet"]],
              ["docker", ["volume", "ls", "--quiet"]],
            ]
          : []),
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
    }
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

  it("prepares a place's project with its own ports and site address", () => {
    const stateRoot = mkdtempSync(
      join(tmpdir(), "rentcottage-access-workdir-place-"),
    );
    try {
      const workdir = prepareIsolatedSupabaseWorkdir({
        localProject: "rentcottage-verification-1",
        ports: localCheckSettings(1).ports,
        stateRoot,
        workingDirectory: process.cwd(),
      });
      const activeLines = readFileSync(
        join(workdir, "supabase", "config.toml"),
        "utf8",
      )
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("#"));

      for (const line of [
        'project_id = "rentcottage-verification-1"',
        "port = 15341",
        "port = 15342",
        "shadow_port = 15340",
        "port = 15349",
        "port = 15343",
        "port = 15344",
        "port = 15347",
        "inspector_port = 8193",
        'site_url = "http://127.0.0.1:3010"',
        'additional_redirect_urls = ["http://127.0.0.1:3010"]',
      ]) {
        expect(activeLines).toContain(line);
      }
      for (const defaultValue of [
        "55331",
        "55332",
        "15330",
        "127.0.0.1:3000",
      ]) {
        expect(
          activeLines.filter((line) => line.includes(defaultValue)),
        ).toEqual([]);
      }
    } finally {
      rmSync(stateRoot, { recursive: true, force: true });
    }
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
});
