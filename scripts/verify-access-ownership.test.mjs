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
  successfulRun,
} from "./verify-access-command-doubles.mjs";

// Every slotted run goes through here, so none can bind a real lock or touch the real temporary directory.
async function runWithPlaceDoubles({
  answering = [],
  claimed,
  cleanupCommandLimitMs,
  environment = {},
  removeStaleFolders = vi.fn(() => []),
  run = vi.fn(() => ({ status: 0, stdout: "" })),
}) {
  const doubles = {
    claimDatabaseSlot: vi.fn(async () => claimed),
    makeTemp: vi.fn(() => "/tmp/place-state"),
    portAnswers: vi.fn(async (port) => answering.includes(port)),
    prepareProject: vi.fn(({ stateRoot }) => join(stateRoot, "project")),
    removeStaleFolders,
    removeTemp: vi.fn(),
    run,
    stderr: vi.fn(),
    stdout: vi.fn(),
  };
  const status = await main(["--fixture-contract"], {
    ...doubles,
    cleanupCommandLimitMs,
    environment,
  });
  return { ...doubles, status };
}

const placeListingCommand = [
  "docker",
  [
    "ps",
    "--all",
    "--filter",
    "name=supabase_db_rentcottage-verification-1",
    "--format",
    '[{{json .Names}},{{json (.Label "com.supabase.cli.project")}},{{json (.Label "com.supabase.cli.workdir")}}]',
  ],
];
const placeStopCommand = [
  "npx",
  [
    "supabase",
    "stop",
    "--no-backup",
    "--project-id",
    "rentcottage-verification-1",
    "--workdir",
    "/tmp/place-state/project",
  ],
];
const placeStartCommand = [
  "npx",
  [
    "supabase",
    "start",
    "-x",
    "realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
    "--workdir",
    "/tmp/place-state/project",
  ],
];
const placeInventoryCommands = [
  [
    "docker",
    [
      "container",
      "ls",
      "--all",
      "--quiet",
      "--filter",
      "name=supabase_db_rentcottage-verification-1",
    ],
  ],
  [
    "docker",
    [
      "volume",
      "ls",
      "--quiet",
      "--filter",
      "name=supabase_db_rentcottage-verification-1",
    ],
  ],
];
const leftoverDatabaseListing =
  '["supabase_db_rentcottage-verification-1","rentcottage-verification-1","/tmp/rentcottage-docker-config-1-Ab3dE9/project"]\n';

// Place 1 with what an earlier check left in it; commands and the folder double share one ordered event list.
async function runInLeftoverPlace({
  cleanupCommandLimitMs,
  listed = { status: 0, stdout: "" },
  removeStale = () => [],
  stopped,
}) {
  const events = [];
  const rest = successfulRun({ project: "rentcottage-verification-1" });
  const run = vi.fn((command, args, options) => {
    events.push([command, args]);
    if (command === "docker" && args[0] === "ps") return listed;
    if (stopped && command === "npx" && args[1] === "stop") return stopped;
    return rest(command, args, options);
  });
  const removeStaleFolders = vi.fn((...given) => {
    events.push(["removeStaleFolders", given]);
    return removeStale();
  });
  const place = await runWithPlaceDoubles({
    claimed: 1,
    cleanupCommandLimitMs,
    removeStaleFolders,
    run,
  });
  return { ...place, events };
}

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
        "port = 15331",
        "port = 15332",
        "port = 15339",
        "port = 15333",
        "port = 15334",
        "inspector_port = 8183",
        "port = 15337",
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
        "15331",
        "15332",
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

  it("stops before any temporary state or command when it cannot take a place", async () => {
    for (const { answering, claimed, environment, message, probed } of [
      {
        answering: [],
        claimed: undefined,
        environment: {},
        message:
          "The full local check runs at most 2 at a time on this machine, and all 2 places are in use. Nothing ran. Run it again when one of them has finished.",
        probed: [],
      },
      {
        answering: [],
        claimed: undefined,
        environment: { VERIFY_LOCAL_SLOT: "2" },
        message:
          "Port 15356, the database lock of place 2 of the full local check, is taken. An earlier check's database step may still be running or shutting down. Nothing ran. Run it again in a moment; if the port stays taken, find what is using it.",
        probed: [],
      },
      {
        answering: [3010],
        claimed: 1,
        environment: {},
        message:
          "Something still answers on port 3010, which place 1 of the full local check uses for its test server. A server from an earlier check may still be running. Nothing was removed and nothing ran. Run it again when the port is free; if it stays in use, stop what is using it.",
        probed: [[3010]],
      },
      {
        answering: [8798],
        claimed: 1,
        environment: {},
        message:
          "Something still answers on port 8798, which place 1 of the full local check uses for its test server. A server from an earlier check may still be running. Nothing was removed and nothing ran. Run it again when the port is free; if it stays in use, stop what is using it.",
        probed: [[3010], [8798]],
      },
    ]) {
      const place = await runWithPlaceDoubles({
        answering,
        claimed,
        environment,
      });

      expect(place.status).toBe(4);
      expect(place.stderr.mock.calls).toEqual([[message]]);
      expect(place.portAnswers.mock.calls).toEqual(probed);
      expect(place.makeTemp).not.toHaveBeenCalled();
      expect(place.prepareProject).not.toHaveBeenCalled();
      expect(place.removeTemp).not.toHaveBeenCalled();
      expect(place.run).not.toHaveBeenCalled();
    }
  });

  it("rejects an invalid inherited place or an explicit project naming a place before claiming", async () => {
    for (const { environment, message } of [
      {
        environment: { VERIFY_LOCAL_SLOT: "0" },
        message: 'VERIFY_LOCAL_SLOT must be an integer from 1 to 2, got "0"',
      },
      {
        environment: { VERIFY_LOCAL_SLOT: "3" },
        message: 'VERIFY_LOCAL_SLOT must be an integer from 1 to 2, got "3"',
      },
      {
        environment: { SUPABASE_LOCAL_PROJECT: "rentcottage-verification-1" },
        message:
          "SUPABASE_LOCAL_PROJECT must not name a place of the full local check; the check assigns rentcottage-verification-1 itself.",
      },
      {
        environment: {
          SUPABASE_LOCAL_PROJECT: "rentcottage-verification-2",
          VERIFY_LOCAL_SLOT: "2",
        },
        message:
          "SUPABASE_LOCAL_PROJECT must not name a place of the full local check; the check assigns rentcottage-verification-2 itself.",
      },
    ]) {
      const place = await runWithPlaceDoubles({ claimed: 1, environment });

      expect(place.status).toBe(2);
      expect(place.stderr.mock.calls).toEqual([[message]]);
      expect(place.claimDatabaseSlot).not.toHaveBeenCalled();
      expect(place.portAnswers).not.toHaveBeenCalled();
      expect(place.makeTemp).not.toHaveBeenCalled();
      expect(place.run).not.toHaveBeenCalled();
    }
  });

  it("runs in its claimed place with that place's project, folder prefix, ports and addresses", async () => {
    for (const expected of [
      {
        api: 15341,
        claimedWith: undefined,
        container: "supabase_db_rentcottage-verification-1",
        environment: {},
        next: 3010,
        prefix: "rentcottage-docker-config-1-",
        project: "rentcottage-verification-1",
        slot: 1,
        worker: 8798,
      },
      {
        api: 15351,
        claimedWith: 2,
        container: "supabase_db_rentcottage-verification-2",
        environment: { VERIFY_LOCAL_SLOT: "2" },
        next: 3020,
        prefix: "rentcottage-docker-config-2-",
        project: "rentcottage-verification-2",
        slot: 2,
        worker: 8808,
      },
    ]) {
      const place = await runWithPlaceDoubles({
        claimed: expected.slot,
        environment: expected.environment,
        run: successfulRun({ project: expected.project }),
      });

      expect(place.status).toBe(0);
      expect(place.claimDatabaseSlot.mock.calls).toEqual([
        [expected.claimedWith],
      ]);
      expect(place.portAnswers.mock.calls).toEqual([
        [expected.next],
        [expected.worker],
      ]);
      expect(place.makeTemp.mock.calls).toEqual([[expected.prefix]]);
      expect(place.prepareProject).toHaveBeenCalledWith(
        expect.objectContaining({
          localProject: expected.project,
          ports: expect.objectContaining({
            api: expected.api,
            next: expected.next,
            worker: expected.worker,
          }),
          stateRoot: "/tmp/place-state",
        }),
      );
      const addresses = {
        PLAYWRIGHT_NEXT_PORT: String(expected.next),
        PLAYWRIGHT_WORKER_PORT: String(expected.worker),
      };
      const [listing, containers, volumes, start] = place.run.mock.calls;
      expect(listing[1].slice(0, 2)).toEqual(["ps", "--all"]);
      expect(containers[1]).toEqual([
        "container",
        "ls",
        "--all",
        "--quiet",
        "--filter",
        `name=${expected.container}`,
      ]);
      expect(volumes[1]).toEqual([
        "volume",
        "ls",
        "--quiet",
        "--filter",
        `name=${expected.container}`,
      ]);
      expect(start[1].slice(0, 2)).toEqual(["supabase", "start"]);
      expect(start[2].env).toMatchObject(addresses);
      expect(commands(place.run)).toContainEqual([
        "docker",
        [
          "inspect",
          expected.container,
          "--format",
          '{{ index .Config.Labels "com.supabase.cli.project" }}|{{ index .Config.Labels "com.supabase.cli.workdir" }}',
        ],
      ]);
      const browser = place.run.mock.calls.find(
        ([command, args]) => command === "npx" && args[0] === "playwright",
      );
      expect(browser).toBeDefined();
      expect(browser[2].env).toMatchObject({
        ...addresses,
        SUPABASE_DB_CONTAINER: expected.container,
        SUPABASE_LOCAL_PROJECT: expected.project,
        SUPABASE_LOCAL_WORKDIR: "/tmp/place-state/project",
      });
      expect(place.run.mock.calls.at(-1)[1]).toEqual([
        "supabase",
        "stop",
        "--no-backup",
        "--project-id",
        expected.project,
        "--workdir",
        "/tmp/place-state/project",
      ]);
      expect(place.removeTemp.mock.calls).toEqual([["/tmp/place-state"]]);
    }
  });

  it("takes no place on the hosted check or for an explicitly named project", async () => {
    for (const { environment, project } of [
      {
        environment: {
          GITHUB_ACTIONS: "true",
          RUNNER_ENVIRONMENT: "github-hosted",
        },
        project: "rentcottage-verification",
      },
      {
        environment: { SUPABASE_LOCAL_PROJECT: "rentcottage-issue-32-v3" },
        project: "rentcottage-issue-32-v3",
      },
    ]) {
      const place = await runWithPlaceDoubles({
        claimed: 1,
        environment,
        run: successfulRun({ project }),
      });

      expect(place.status).toBe(0);
      expect(place.claimDatabaseSlot).not.toHaveBeenCalled();
      expect(place.portAnswers).not.toHaveBeenCalled();
      expect(place.makeTemp.mock.calls).toEqual([
        ["rentcottage-docker-config-"],
      ]);
      expect(place.prepareProject).toHaveBeenCalledWith(
        expect.objectContaining({
          localProject: project,
          ports: expect.objectContaining({ api: 15331, next: 3000 }),
        }),
      );
      const start = place.run.mock.calls.find(
        ([command, args]) => command === "npx" && args[1] === "start",
      );
      expect(start).toBeDefined();
      expect(start[2].env).not.toHaveProperty("PLAYWRIGHT_NEXT_PORT");
      expect(start[2].env).not.toHaveProperty("PLAYWRIGHT_WORKER_PORT");
    }
  });

  it("clears a database its own tool left in its place: looks, stops, removes the folders, then starts", async () => {
    const place = await runInLeftoverPlace({
      cleanupCommandLimitMs: 4321,
      listed: { status: 0, stdout: leftoverDatabaseListing },
      removeStale: () => ["/tmp/rentcottage-docker-config-1-Zz9yX8"],
    });

    expect(place.status).toBe(0);
    expect(place.events.slice(0, 6)).toEqual([
      placeListingCommand,
      placeStopCommand,
      ["removeStaleFolders", [1, "/tmp/place-state"]],
      ...placeInventoryCommands,
      placeStartCommand,
    ]);
    for (const [, , options] of place.run.mock.calls.slice(0, 2)) {
      expect(options).toMatchObject({
        encoding: "utf8",
        lifecycleLimit: 4321,
        stdio: "pipe",
      });
    }
    const printed = place.stdout.mock.calls.map(([line]) => line);
    expect(printed).toContain(
      "Place 1: removed what an earlier check left behind: database rentcottage-verification-1, /tmp/rentcottage-docker-config-1-Zz9yX8.",
    );
    const clearing = printed
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line))
      .filter(({ name }) => name === "place-clearing");
    expect(clearing).toEqual([
      expect.objectContaining({
        type: "access-phase",
        scope: "shared-setup",
        inclusive: true,
        outcome: { type: "exit", status: 0 },
      }),
    ]);
  });

  it("removes only stale folders when its place holds no database", async () => {
    const place = await runInLeftoverPlace({
      removeStale: () => [
        "/tmp/rentcottage-docker-config-1-Zz9yX8",
        "/tmp/rentcottage-docker-config-1-Qq7wE6",
      ],
    });

    expect(place.status).toBe(0);
    expect(place.events.slice(0, 5)).toEqual([
      placeListingCommand,
      ["removeStaleFolders", [1, "/tmp/place-state"]],
      ...placeInventoryCommands,
      placeStartCommand,
    ]);
    expect(place.stdout).toHaveBeenCalledWith(
      "Place 1: removed what an earlier check left behind: /tmp/rentcottage-docker-config-1-Zz9yX8, /tmp/rentcottage-docker-config-1-Qq7wE6.",
    );
  });

  it("skips the reset in a claimed place only when Docker shows no database container or volume of that place", async () => {
    const isInventory = ([command, args]) =>
      command === "docker" && args[1] === "ls";
    const resetsOf = (run) =>
      run.mock.calls.filter(
        ([command, args]) =>
          command === "npx" && args[1] === "db" && args[2] === "reset",
      );
    const runWithInventory = (answer, options = {}) => {
      const rest = successfulRun({ project: "rentcottage-verification-1" });
      return runWithPlaceDoubles({
        claimed: 1,
        ...options,
        run: vi.fn((command, args, runOptions) =>
          isInventory([command, args])
            ? answer(args[0])
            : rest(command, args, runOptions),
        ),
      });
    };

    for (const { name, containers, volumes, resets } of [
      { name: "both empty", containers: "", volumes: "", resets: 0 },
      { name: "whitespace only", containers: " \n", volumes: "\n", resets: 0 },
      {
        name: "container listed",
        containers: "stopped-container-id\n",
        volumes: "",
        resets: 1,
      },
      {
        name: "volume listed",
        containers: "",
        volumes: "supabase_db_rentcottage-verification-1\n",
        resets: 1,
      },
    ]) {
      const place = await runWithInventory((resource) => ({
        status: 0,
        stdout: resource === "container" ? containers : volumes,
      }));

      expect(place.status, name).toBe(0);
      const issued = commands(place.run);
      const first = issued.findIndex(isInventory);
      expect(issued.slice(0, first), name).toContainEqual(placeListingCommand);
      expect(issued.slice(first, first + 3), name).toEqual([
        ...placeInventoryCommands,
        placeStartCommand,
      ]);
      for (const [, , options] of place.run.mock.calls.filter(isInventory))
        expect(options).toMatchObject({ encoding: "utf8", stdio: "pipe" });
      expect(resetsOf(place.run), name).toHaveLength(resets);
      expect(place.stderr).not.toHaveBeenCalled();
    }

    for (const failed of ["container", "volume"]) {
      for (const failure of [{ status: 7, stdout: "" }, { status: 0 }]) {
        const place = await runWithInventory((resource) =>
          resource === failed ? failure : { status: 0, stdout: "" },
        );

        expect(place.status).toBe(failure.status || 1);
        expect(place.stderr).toHaveBeenCalledWith(
          `Unable to verify Docker ${failed} inventory. Check Docker daemon access before retrying local verification.`,
        );
        expect(commands(place.run)).not.toContainEqual(placeStartCommand);
      }
    }

    const named = await runWithPlaceDoubles({
      claimed: 1,
      environment: { SUPABASE_LOCAL_PROJECT: "rentcottage-issue-32-v3" },
      run: successfulRun({ project: "rentcottage-issue-32-v3" }),
    });

    expect(named.status).toBe(0);
    expect(commands(named.run).filter(isInventory)).toEqual([]);
    expect(resetsOf(named.run)).toHaveLength(1);
  });

  it("deletes nothing when the database in its place cannot be shown to be this check's own", async () => {
    for (const { found, listing } of [
      {
        found:
          'its project label is "rentcottage-verification-1" and its folder label is "/home/someone/rentcottage-docker-config-1-Ab3dE9/project"',
        listing:
          '["supabase_db_rentcottage-verification-1","rentcottage-verification-1","/home/someone/rentcottage-docker-config-1-Ab3dE9/project"]\n',
      },
      {
        found:
          'its project label is "rentcottage-verification-1" and its folder label is "/tmp/rentcottage-docker-config-2-Ab3dE9/project"',
        listing:
          '["supabase_db_rentcottage-verification-1","rentcottage-verification-1","/tmp/rentcottage-docker-config-2-Ab3dE9/project"]\n',
      },
      {
        found: 'its project label is "" and its folder label is ""',
        listing: '["supabase_db_rentcottage-verification-1","",""]\n',
      },
      {
        found:
          'its project label is "rentcottage-verification-1" and its folder label is "/tmp/rentcottage-docker-config-1-Ab3dE9/project\\n/owner/protected"',
        listing:
          '["supabase_db_rentcottage-verification-1","rentcottage-verification-1","/tmp/rentcottage-docker-config-1-Ab3dE9/project\\n/owner/protected"]\n',
      },
    ]) {
      const place = await runInLeftoverPlace({
        listed: { status: 0, stdout: listing },
      });

      expect(place.status).toBe(4);
      expect(place.events).toEqual([placeListingCommand]);
      expect(place.removeStaleFolders).not.toHaveBeenCalled();
      expect(place.stderr.mock.calls).toEqual([
        [
          `Place 1 of the full local check holds a database container, supabase_db_rentcottage-verification-1, that this check cannot show it made: ${found}. Nothing was removed and nothing ran. Look at that container and remove it yourself if nothing is using it.`,
        ],
      ]);
      expect(place.stderr.mock.calls[0][0]).not.toContain("\n");
      expect(place.removeTemp.mock.calls).toEqual([["/tmp/place-state"]]);
    }
  });

  it("refuses a database in its own place that this run did not start", async () => {
    const place = await runWithPlaceDoubles({
      claimed: 1,
      run: successfulRun({
        project: "rentcottage-verification-1",
        workdir: "/tmp/rentcottage-docker-config-1-Other1/project",
      }),
    });

    expect(place.status).toBe(1);
    expect(commands(place.run)).toEqual([
      placeListingCommand,
      ...placeInventoryCommands,
      placeStartCommand,
      [
        "docker",
        [
          "inspect",
          "supabase_db_rentcottage-verification-1",
          "--format",
          '{{ index .Config.Labels "com.supabase.cli.project" }}|{{ index .Config.Labels "com.supabase.cli.workdir" }}',
        ],
      ],
    ]);
    expect(place.stderr).toHaveBeenCalledWith(
      expect.stringContaining(
        "does not belong to this disposable local checkout",
      ),
    );
    expect(place.removeTemp).not.toHaveBeenCalled();
    // The one folder sweep is the look before start; it keeps this run's own folder and found nothing to remove.
    expect(place.removeStaleFolders.mock.calls).toEqual([
      [1, "/tmp/place-state"],
    ]);
    expect(place.removeStaleFolders.mock.results).toEqual([
      { type: "return", value: [] },
    ]);
  });

  it("removes nothing when Docker cannot list its place", async () => {
    for (const listed of [
      { status: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" },
      { status: 0 },
    ]) {
      const place = await runInLeftoverPlace({ listed });

      expect(place.status).toBe(4);
      expect(place.events).toEqual([placeListingCommand]);
      expect(place.removeStaleFolders).not.toHaveBeenCalled();
      expect(place.stderr).toHaveBeenCalledWith(
        "Unable to see what an earlier check left in place 1 of the full local check: Docker did not list the place's database container. Nothing was removed and nothing ran.",
      );
      expect(place.removeTemp.mock.calls).toEqual([["/tmp/place-state"]]);
    }
  });

  it("keeps the folders when the leftover database cannot be stopped", async () => {
    for (const stopped of [
      { status: 1, stdout: "", stderr: "" },
      {
        error: Object.assign(new Error("Command did not exit within 4321ms."), {
          code: "ETIMEDOUT",
        }),
        signal: null,
        status: null,
        stderr: "",
        stdout: "",
      },
    ]) {
      const place = await runInLeftoverPlace({
        listed: { status: 0, stdout: leftoverDatabaseListing },
        stopped,
      });

      expect(place.status).toBe(4);
      expect(place.events).toEqual([placeListingCommand, placeStopCommand]);
      expect(place.removeStaleFolders).not.toHaveBeenCalled();
      expect(place.stderr).toHaveBeenCalledWith(
        "Unable to stop the database an earlier check left in place 1 of the full local check. Its folders were kept and nothing ran.",
      );
      expect(place.removeTemp.mock.calls).toEqual([["/tmp/place-state"]]);
    }
  });

  it("fails loudly when a leftover folder cannot be removed", async () => {
    const place = await runInLeftoverPlace({
      removeStale: () => {
        throw new Error(
          "EACCES: permission denied, rmdir '/tmp/rentcottage-docker-config-1-Zz9yX8'",
        );
      },
    });

    expect(place.status).toBe(4);
    expect(place.events).toEqual([
      placeListingCommand,
      ["removeStaleFolders", [1, "/tmp/place-state"]],
    ]);
    expect(place.stderr.mock.calls).toEqual([
      [
        "Unable to remove a folder an earlier check left in place 1 of the full local check: EACCES: permission denied, rmdir '/tmp/rentcottage-docker-config-1-Zz9yX8'. Nothing ran. Remove that folder, then run it again.",
      ],
    ]);
    expect(place.removeTemp.mock.calls).toEqual([["/tmp/place-state"]]);
  });
});
