import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { main } from "./verify-access.mjs";
import {
  browserCommands,
  commands,
  databaseCheckCommands,
  databasePreflightCommands,
  localCredentials,
  mainWithPreparedProject,
  ownedRun,
  ownershipCommand,
  resetCommand,
  startCommand,
  statusCommand,
  stopCommand,
  successfulRun,
} from "./verify-access-command-doubles.mjs";

describe("access verification command", () => {
  it("partitions hosted checks without losing setup, coverage or cleanup", async () => {
    const cases = [
      ["--database", "database-core"],
      ["--database", "booking-request"],
      ["--database", "booking-capture"],
      ["--database", "payment-required-expiry"],
      ["--browser", "next", "1/2"],
      ["--browser", "next", "2/2"],
      ["--browser", "worker", "1/2"],
      ["--browser", "worker", "2/2"],
      ["--browser", "scheduled"],
    ];
    const observed = new Map();
    for (const [mode, partition, shard] of cases) {
      const run = successfulRun();
      const removeTemp = vi.fn();
      const output = vi.fn();
      const prepareProject = vi.fn(({ stateRoot }) =>
        join(stateRoot, "project"),
      );
      expect(
        await mainWithPreparedProject([mode], {
          environment: {
            GITHUB_ACTIONS: "true",
            VERIFY_CI_PARTITION: partition,
            ...(shard ? { VERIFY_CI_SHARD: shard } : {}),
          },
          makeTemp: () => "/tmp/access-partition",
          prepareProject,
          removeTemp,
          run,
          stdout: output,
        }),
      ).toBe(0);
      const actual = commands(run);
      expect(actual.slice(0, 3)).toEqual([
        startCommand,
        ownershipCommand,
        resetCommand,
      ]);
      expect(actual.at(-2)).toEqual(ownershipCommand);
      expect(actual.at(-1)).toEqual(stopCommand);
      expect(prepareProject).toHaveBeenCalledWith({
        localProject: "rentcottage-verification",
        stateRoot: "/tmp/access-partition",
        workingDirectory: process.cwd(),
      });
      expect(removeTemp).toHaveBeenCalledWith("/tmp/access-partition");
      expect(
        output.mock.calls.some(([line]) => {
          const record = JSON.parse(line);
          return (
            record.type === "access-partition" &&
            record.evidence === "partial" &&
            record.partition === partition &&
            record.shard === (shard ?? null)
          );
        }),
      ).toBe(true);
      const playwright = run.mock.calls.find(
        ([, args]) =>
          args[0] === "playwright" &&
          args.includes("tests/booking-request-access.spec.ts"),
      );
      if (playwright) {
        expect(playwright[2].env.PLAYWRIGHT_SERVER).toBe(
          partition === "worker" ? "worker" : "next",
        );
        expect(playwright[2].env.NEXTJS_ENV).toBe("test");
      }
      const selectedProgram = run.mock.calls.find(
        ([, args]) =>
          args[0] === "scripts/verify-booking-request-capture-concurrency.mjs",
      );
      if (selectedProgram) {
        expect(selectedProgram[2].env.SUPABASE_SECRET_KEY).toBe("local-secret");
      }
      if (partition === "booking-request") {
        const preparation = run.mock.calls.find(
          ([command, args]) =>
            command === "node" &&
            args.join(" ") ===
              "scripts/prepare-access-test.mjs create mobile worker",
        );
        expect(preparation?.[2].env).toMatchObject({
          APP_ENVIRONMENT: "test",
          SUPABASE_URL: "http://127.0.0.1:54331",
          SUPABASE_PUBLISHABLE_KEY: "local-publishable",
          SUPABASE_SECRET_KEY: "local-secret",
        });
        expect(preparation?.[2].stdio).toBe("inherit");
        const concurrency = run.mock.calls.find(
          ([command, args]) =>
            command === "node" &&
            args[0] === "scripts/verify-booking-request-concurrency.mjs",
        );
        expect(concurrency?.[2].env).not.toHaveProperty("SUPABASE_SECRET_KEY");
      }
      for (const [, args, options] of run.mock.calls) {
        if (args[0] === "supabase") {
          expect(args.slice(-2)).toEqual([
            "--workdir",
            "/tmp/access-partition/project",
          ]);
        }
        if (
          args[0] === "playwright" ||
          args[0] === "scripts/prepare-access-test.mjs"
        ) {
          expect(options.stdio).toBe("inherit");
        }
      }
      observed.set(`${partition}:${shard ?? ""}`, actual.slice(3, -2));
    }

    const mobileFixture = [
      "node",
      ["scripts/prepare-access-test.mjs", "create", "mobile"],
    ];
    const bookingRequestFixture = [
      "node",
      ["scripts/prepare-access-test.mjs", "create", "mobile", "worker"],
    ];
    const longPrograms = new Map([
      ["booking-request", "scripts/verify-booking-request-concurrency.mjs"],
      [
        "booking-capture",
        "scripts/verify-booking-request-capture-concurrency.mjs",
      ],
      [
        "payment-required-expiry",
        "scripts/verify-booking-request-payment-required-expiry-concurrency.mjs",
      ],
    ]);
    expect(observed.get("database-core:")).toEqual([
      ...databasePreflightCommands,
      statusCommand,
      ...databaseCheckCommands.filter(
        ([, args]) => ![...longPrograms.values()].includes(args[0]),
      ),
    ]);
    for (const [partition, script] of longPrograms) {
      expect(observed.get(`${partition}:`)).toEqual([
        statusCommand,
        partition === "booking-request" ? bookingRequestFixture : mobileFixture,
        ["node", [script]],
      ]);
    }
    const failedBookingRequestPreparation = ownedRun((command, args) => ({
      status:
        command === "node" &&
        args.join(" ") ===
          "scripts/prepare-access-test.mjs create mobile worker"
          ? 7
          : 0,
      stdout:
        command === "npx" &&
        args.slice(0, 4).join(" ") === "supabase status -o json"
          ? localCredentials
          : "",
    }));
    const removeFailedBookingRequestTemp = vi.fn();
    expect(
      await mainWithPreparedProject(["--database"], {
        environment: {
          GITHUB_ACTIONS: "true",
          VERIFY_CI_PARTITION: "booking-request",
        },
        makeTemp: () => "/tmp/access-booking-request-prerequisite",
        removeTemp: removeFailedBookingRequestTemp,
        run: failedBookingRequestPreparation,
        stderr: vi.fn(),
      }),
    ).toBe(7);
    expect(commands(failedBookingRequestPreparation).at(-3)).toEqual(
      bookingRequestFixture,
    );
    expect(commands(failedBookingRequestPreparation).at(-2)).toEqual(
      ownershipCommand,
    );
    expect(commands(failedBookingRequestPreparation).at(-1)).toEqual(
      stopCommand,
    );
    expect(removeFailedBookingRequestTemp).toHaveBeenCalledWith(
      "/tmp/access-booking-request-prerequisite",
    );
    expect(
      commands(failedBookingRequestPreparation).some(
        ([, args]) =>
          args[0] === "scripts/verify-booking-request-concurrency.mjs",
      ),
    ).toBe(false);
    const databaseUnion = [
      ...observed
        .get("database-core:")
        .slice(databasePreflightCommands.length + 1),
      ...[...longPrograms.keys()].map((partition) =>
        observed.get(`${partition}:`).at(-1),
      ),
    ];
    expect(databaseUnion).toHaveLength(databaseCheckCommands.length);
    expect(
      new Set(databaseUnion.map((entry) => JSON.stringify(entry))),
    ).toEqual(
      new Set(databaseCheckCommands.map((entry) => JSON.stringify(entry))),
    );

    for (const shard of ["1/2", "2/2"]) {
      expect(observed.get(`next:${shard}`)).toEqual([
        statusCommand,
        ...browserCommands.slice(0, 2),
        ["npx", [...browserCommands[2][1], "--list"]],
        ["npx", [...browserCommands[2][1], `--shard=${shard}`]],
      ]);
      expect(observed.get(`worker:${shard}`)).toEqual([
        statusCommand,
        ...browserCommands.slice(3, 6),
        ["npx", [...browserCommands[6][1], "--list"]],
        ["npx", [...browserCommands[6][1], `--shard=${shard}`]],
      ]);
    }
    expect(observed.get("scheduled:")).toEqual([
      statusCommand,
      ...browserCommands.slice(3, 6),
      ...browserCommands.slice(7),
    ]);
    for (const [mode, partition, failedScript] of [
      [
        "--database",
        "booking-capture",
        "scripts/verify-booking-request-capture-concurrency.mjs",
      ],
      [
        "--browser",
        "scheduled",
        "scripts/verify-booking-request-scheduled-expiry.mjs",
      ],
    ]) {
      const run = ownedRun((command, args) => ({
        status: args[0] === failedScript ? 7 : 0,
        stdout:
          command === "npx" &&
          args.slice(0, 4).join(" ") === "supabase status -o json"
            ? localCredentials
            : "",
      }));
      expect(
        await mainWithPreparedProject([mode], {
          environment: {
            GITHUB_ACTIONS: "true",
            VERIFY_CI_PARTITION: partition,
          },
          run,
          stderr: vi.fn(),
        }),
      ).toBe(7);
      expect(commands(run).at(-1)).toEqual(stopCommand);
      expect(commands(run).some(([, args]) => args[0] === failedScript)).toBe(
        true,
      );
    }
  });

  it("rejects empty hosted journey selections before sharding and cleans up", async () => {
    for (const partition of ["next", "worker"]) {
      for (const shard of ["1/2", "2/2"]) {
        const run = ownedRun((command, args) => ({
          status:
            command === "npx" &&
            args[0] === "playwright" &&
            args.includes("--list")
              ? 1
              : 0,
          stdout:
            command === "npx" &&
            args.slice(0, 4).join(" ") === "supabase status -o json"
              ? localCredentials
              : "",
        }));
        const removeTemp = vi.fn();
        const stdout = vi.fn();
        expect(
          await mainWithPreparedProject(["--browser"], {
            environment: {
              GITHUB_ACTIONS: "true",
              VERIFY_CI_PARTITION: partition,
              VERIFY_CI_SHARD: shard,
            },
            makeTemp: () => "/tmp/empty-hosted-journeys",
            removeTemp,
            run,
            stdout,
          }),
        ).toBe(1);
        const listed = commands(run).filter(
          ([command, args]) => command === "npx" && args.includes("--list"),
        );
        const journey =
          partition === "next" ? browserCommands[2] : browserCommands[6];
        expect(listed).toEqual([["npx", [...journey[1], "--list"]]]);
        expect(
          commands(run).some(([, args]) => args.includes(`--shard=${shard}`)),
        ).toBe(false);
        expect(commands(run).at(-2)).toEqual(ownershipCommand);
        expect(commands(run).at(-1)).toEqual(stopCommand);
        expect(removeTemp).toHaveBeenCalledWith("/tmp/empty-hosted-journeys");
        expect(stdout).toHaveBeenCalledWith(
          expect.stringContaining('"type":"verification-failure"'),
        );
        expect(stdout).toHaveBeenCalledWith(
          expect.stringContaining('"--list"'),
        );
      }
    }
  });

  it("rejects invalid hosted partition controls before side effects", async () => {
    const cases = [
      {
        args: ["--browser"],
        env: { VERIFY_CI_PARTITION: "next", VERIFY_CI_SHARD: "1/2" },
        reason: "GITHUB_ACTIONS",
      },
      {
        args: [],
        env: {
          GITHUB_ACTIONS: "true",
          VERIFY_CI_PARTITION: "next",
          VERIFY_CI_SHARD: "1/2",
        },
        reason: "VERIFY_CI_PARTITION",
      },
      {
        args: ["--browser"],
        env: {
          GITHUB_ACTIONS: "true",
          VERIFY_CI_PARTITION: "next",
          VERIFY_CI_SHARD: "0/2",
        },
        reason: "VERIFY_CI_SHARD",
      },
      {
        args: ["--browser"],
        env: { GITHUB_ACTIONS: "true", VERIFY_CI_PARTITION: "next" },
        reason: "VERIFY_CI_SHARD",
      },
      {
        args: ["--browser"],
        env: {
          GITHUB_ACTIONS: "true",
          VERIFY_CI_PARTITION: "scheduled",
          VERIFY_CI_SHARD: "1/2",
        },
        reason: "VERIFY_CI_SHARD",
      },
      {
        args: ["--database"],
        env: {
          GITHUB_ACTIONS: "true",
          VERIFY_CI_PARTITION: "next",
          VERIFY_CI_SHARD: "1/2",
        },
        reason: "VERIFY_CI_PARTITION",
      },
      {
        args: ["--browser"],
        env: { GITHUB_ACTIONS: "true", VERIFY_CI_PARTITION: "unknown" },
        reason: "VERIFY_CI_PARTITION",
      },
      {
        args: ["--browser"],
        env: { GITHUB_ACTIONS: "true", VERIFY_CI_SHARD: "1/2" },
        reason: "VERIFY_CI_PARTITION",
      },
    ];
    for (const { args, env, reason } of cases) {
      const makeTemp = vi.fn();
      const prepareProject = vi.fn();
      const run = vi.fn();
      const stderr = vi.fn();
      expect(
        await main(args, {
          environment: env,
          makeTemp,
          prepareProject,
          run,
          stderr,
        }),
      ).toBe(2);
      expect(stderr.mock.calls.flat().join("\n")).toContain(reason);
      expect(makeTemp).not.toHaveBeenCalled();
      expect(prepareProject).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
    }
  });
});
