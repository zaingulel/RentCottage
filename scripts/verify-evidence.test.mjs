import fs from "node:fs";
import {
  chmodSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { describe, expect, it, vi } from "vitest";
import {
  requiredBaselineSteps,
  requiredExpensiveSteps,
  requiredDatabaseSteps,
  requiredLightDatabaseSteps,
  requiredBrowserSteps,
  write,
  createRepository,
  commit,
  localVerification,
  evidenceFile,
  commands,
} from "./verify-test-fixtures.mjs";

describe("repository verification command", () => {
  it("retains only authoritatively completed service groups", () => {
    for (const failure of ["verify:access", "build:worker", "test:browser"]) {
      const repository = createRepository();
      commit(repository, "tsconfig.json", "seed\n");
      const run = vi.fn((_command, args) => ({
        status: args[1] === failure ? 7 : 0,
      }));
      expect(localVerification(repository, { run }).status).toBe(7);
      commit(repository, "AGENTS.md", "baseline-only repair\n");
      const repaired = localVerification(repository);
      if (failure !== "verify:access")
        expect(repaired.stdout.mock.calls.flat().join("\n")).toContain(
          "database: reused local evidence",
        );
      expect(commands(repaired)).toEqual([
        ...requiredBaselineSteps,
        ...(failure === "verify:access"
          ? requiredExpensiveSteps
          : requiredBrowserSteps),
      ]);
    }
    const independentRepository = createRepository();
    commit(independentRepository, "tsconfig.json", "seed\n");
    expect(
      localVerification(independentRepository, { args: ["--database"] }).status,
    ).toBe(0);
    expect(
      localVerification(independentRepository, {
        args: ["--browser"],
        run: vi.fn(() => ({ status: 7 })),
      }).status,
    ).toBe(7);
    commit(
      independentRepository,
      "src/app/globals.css",
      "presentation repair\n",
    );
    expect(commands(localVerification(independentRepository))).toEqual([
      ...requiredBaselineSteps,
      ...requiredBrowserSteps,
    ]);
    for (const outcome of [
      { status: 5 },
      { status: null, signal: "SIGTERM" },
      {
        status: null,
        error: Object.assign(new Error("missing"), { code: "ENOENT" }),
      },
    ]) {
      const repository = createRepository();
      commit(repository, "tsconfig.json", "seed\n");
      const failed = localVerification(repository, {
        args: ["--database"],
        run: vi.fn(() => outcome),
      });
      expect(failed.status).not.toBe(0);
      expect(
        commands(localVerification(repository, { args: ["--database"] })),
      ).toEqual(requiredDatabaseSteps);
    }
    const repository = createRepository();
    commit(repository, "tsconfig.json", "seed\n");
    localVerification(repository, {
      args: ["--database"],
      run: vi.fn(() => {
        write(repository, "tsconfig.json", "changed during execution\n");
        return { status: 0 };
      }),
    });
    expect(
      commands(localVerification(repository, { args: ["--database"] })),
    ).toEqual(requiredDatabaseSteps);
  }, 60000);

  it("does not reuse light database evidence for a booking concurrency change", () => {
    const repository = createRepository();
    commit(
      repository,
      "supabase/tests/database/booking_quotes.test.sql",
      "select 1;\n",
    );
    const light = localVerification(repository);
    expect(light.status).toBe(0);
    expect(commands(light)).toEqual([
      ...requiredBaselineSteps,
      ...requiredLightDatabaseSteps,
    ]);
    commit(
      repository,
      "supabase/schemas/20_functions_booking.sql",
      "-- booking\n",
    );

    const heavy = localVerification(repository);

    expect(heavy.status).toBe(0);
    expect(commands(heavy)).toEqual([
      ...requiredBaselineSteps,
      ...requiredDatabaseSteps,
    ]);
    const output = heavy.stdout.mock.calls.flat().join("\n");
    expect(output).not.toContain("database: reused local evidence");
    expect(output).toContain("database: executed fresh verification");
  });

  it("retains completed forced-run evidence without reusing forced execution", () => {
    const repository = createRepository();
    commit(repository, "tsconfig.json", "seed\n");
    expect(localVerification(repository).status).toBe(0);
    const previousTokens = Object.fromEntries(
      ["database", "browser"].map((group) => [
        group,
        JSON.parse(readFileSync(evidenceFile(repository, "attempt", group)))
          .token,
      ]),
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const run = vi.fn((_command, args) => {
        if (args[1] === "verify:access") {
          for (const group of ["database", "browser"]) {
            const marker = JSON.parse(
              readFileSync(evidenceFile(repository, "attempt", group)),
            );
            expect(marker.token).not.toBe(previousTokens[group]);
          }
        }
        return { status: 0 };
      });
      const forced = localVerification(repository, { args: ["--full"], run });
      expect(forced.status).toBe(0);
      expect(commands(forced)).toEqual([
        ...requiredBaselineSteps,
        ...requiredExpensiveSteps,
      ]);
      for (const group of ["database", "browser"]) {
        const marker = JSON.parse(
          readFileSync(evidenceFile(repository, "attempt", group)),
        );
        const success = JSON.parse(
          readFileSync(evidenceFile(repository, "success", group)),
        );
        expect(marker.token).not.toBe(previousTokens[group]);
        expect(success.token).toBe(marker.token);
        previousTokens[group] = marker.token;
      }
    }
    commit(repository, "AGENTS.md", "baseline-only repair\n");
    const reused = localVerification(repository);
    expect(reused.status).toBe(0);
    expect(commands(reused)).toEqual(requiredBaselineSteps);

    for (const [group, expected] of [
      ["database", requiredDatabaseSteps],
      ["browser", requiredBrowserSteps],
    ]) {
      const independentRepository = createRepository();
      commit(independentRepository, "tsconfig.json", "seed\n");
      const forced = localVerification(independentRepository, {
        args: [`--${group}`, "--full"],
      });
      expect(forced.status).toBe(0);
      expect(commands(forced)).toEqual(expected);
      const marker = JSON.parse(
        readFileSync(evidenceFile(independentRepository, "attempt", group)),
      );
      const success = JSON.parse(
        readFileSync(evidenceFile(independentRepository, "success", group)),
      );
      expect(success.token).toBe(marker.token);
      const reused = localVerification(independentRepository, {
        args: [`--${group}`],
      });
      expect(reused.status).toBe(0);
      expect(commands(reused)).toEqual([]);
    }

    for (const failure of ["verify:access", "build:worker", "test:browser"]) {
      const failedRepository = createRepository();
      commit(failedRepository, "tsconfig.json", "seed\n");
      expect(localVerification(failedRepository).status).toBe(0);
      const forced = localVerification(failedRepository, {
        args: ["--full"],
        run: vi.fn((_command, args) => ({
          status: args[1] === failure ? 7 : 0,
        })),
      });
      expect(forced.status).toBe(7);
      for (const group of ["database", "browser"]) {
        const marker = JSON.parse(
          readFileSync(evidenceFile(failedRepository, "attempt", group)),
        );
        const success = JSON.parse(
          readFileSync(evidenceFile(failedRepository, "success", group)),
        );
        if (group === "database" && failure !== "verify:access")
          expect(success.token).toBe(marker.token);
        else expect(success.token).not.toBe(marker.token);
      }
      commit(failedRepository, "AGENTS.md", "baseline-only repair\n");
      expect(commands(localVerification(failedRepository))).toEqual([
        ...requiredBaselineSteps,
        ...(failure === "verify:access"
          ? requiredExpensiveSteps
          : requiredBrowserSteps),
      ]);
    }
  }, 60000);

  it("rejects corrupt interrupted and superseded local evidence", () => {
    const changes = [
      (path) => {
        const record = JSON.parse(readFileSync(path));
        record.head = [record.head];
        writeFileSync(path, JSON.stringify(record));
      },
      (path, marker) => {
        for (const target of [path, marker]) {
          const record = JSON.parse(readFileSync(target));
          record.token = "-".repeat(36);
          writeFileSync(target, JSON.stringify(record));
        }
      },
      (path) => {
        const record = JSON.parse(readFileSync(path));
        record.completedAt = "2026";
        writeFileSync(path, JSON.stringify(record));
      },
      (path) => writeFileSync(path, "{broken"),
      (path) => writeFileSync(path, "x".repeat(1024 * 1024 + 1)),
      (path) => {
        const record = JSON.parse(readFileSync(path));
        record.version = 2;
        writeFileSync(path, JSON.stringify(record));
      },
      (path) => {
        const record = JSON.parse(readFileSync(path));
        record.group = "browser";
        writeFileSync(path, JSON.stringify(record));
      },
      (path) => {
        const record = JSON.parse(readFileSync(path));
        record.commandDigest = "0".repeat(64);
        writeFileSync(path, JSON.stringify(record));
      },
      (path) => {
        const record = JSON.parse(readFileSync(path));
        record.identity.dockerReferences = [
          ["b".repeat(64), "c".repeat(64)],
          ["b".repeat(64), "c".repeat(64)],
        ];
        writeFileSync(path, JSON.stringify(record));
      },
      (path) => {
        renameSync(path, `${path}.original`);
        symlinkSync(`${path}.original`, path);
      },
      (_path, marker) => rmSync(marker),
      (_path, marker) => {
        const record = JSON.parse(readFileSync(marker));
        record.token = "00000000-0000-0000-0000-000000000000";
        writeFileSync(marker, JSON.stringify(record));
      },
    ];
    for (const change of changes) {
      const repository = createRepository();
      commit(repository, "tsconfig.json", "seed\n");
      localVerification(repository, { args: ["--database"] });
      change(
        evidenceFile(repository, "success"),
        evidenceFile(repository, "attempt"),
      );
      expect(
        commands(localVerification(repository, { args: ["--database"] })),
      ).toEqual(requiredDatabaseSteps);
    }
    const oversizedRepository = createRepository();
    commit(oversizedRepository, "tsconfig.json", "seed\n");
    const oversized = localVerification(oversizedRepository, {
      args: ["--database"],
      captureRuntimeContract: () => ({
        digest: "a".repeat(64),
        dockerReferences: Array.from({ length: 10000 }, (_, index) => [
          index.toString(16).padStart(64, "0"),
          "b".repeat(64),
        ]),
      }),
    });
    expect(oversized.status).toBe(0);
    expect(oversized.stdout.mock.calls.flat().join("\n")).toContain(
      "local evidence not retained",
    );
    expect(() =>
      readFileSync(evidenceFile(oversizedRepository, "success")),
    ).toThrow();
    const repository = createRepository();
    commit(repository, "tsconfig.json", "seed\n");
    localVerification(repository, {
      args: ["--database"],
      run: vi.fn(() => {
        const marker = evidenceFile(repository, "attempt");
        const record = JSON.parse(readFileSync(marker));
        record.token = "00000000-0000-0000-0000-000000000000";
        writeFileSync(marker, JSON.stringify(record));
        return { status: 0 };
      }),
    });
    expect(
      commands(localVerification(repository, { args: ["--database"] })),
    ).toEqual(requiredDatabaseSteps);
    const stateDirectory = dirname(evidenceFile(repository, "success"));
    renameSync(stateDirectory, `${stateDirectory}.elsewhere`);
    symlinkSync(`${stateDirectory}.elsewhere`, stateDirectory);
    const escaped = localVerification(repository, { args: ["--database"] });
    expect(commands(escaped)).toEqual([]);
    expect(escaped.status).toBe(1);
    expect(escaped.stderr.mock.calls.flat().join("\n")).toContain(
      "verification-admission-failure",
    );
  }, 60000);

  it("requires durable invalidation before fresh local execution", () => {
    const repository = createRepository();
    commit(repository, "tsconfig.json", "seed\n");
    localVerification(repository, { args: ["--database"] });
    const marker = evidenceFile(repository, "attempt");
    const directory = dirname(marker);
    const originalMarker = readFileSync(marker, "utf8");
    const provenance = JSON.parse(
      readFileSync(evidenceFile(repository, "success")),
    ).head;
    chmodSync(directory, 0o500);
    try {
      const blocked = localVerification(repository, {
        args: ["--database", "--full"],
      });
      expect(blocked.status).toBe(1);
      expect(commands(blocked)).toEqual([]);
      expect(blocked.stderr.mock.calls.flat().join("\n")).toContain(
        "verification-admission-failure",
      );
      expect(blocked.stderr.mock.calls.flat().join("\n")).not.toContain(
        '"type":"verification-failure"',
      );
      expect(blocked.stdout.mock.calls.flat().join("\n")).not.toContain(
        '"type":"verification-phase"',
      );
    } finally {
      chmodSync(directory, 0o700);
    }
    const recovered = localVerification(repository, { args: ["--database"] });
    expect(commands(recovered)).toEqual([]);
    expect(recovered.stdout.mock.calls.flat().join("\n")).toContain(
      `HEAD ${provenance}`,
    );
    const failedAttempt = localVerification(repository, {
      args: ["--database", "--full"],
      run: vi.fn(() => {
        expect(readFileSync(marker, "utf8")).not.toBe(originalMarker);
        return { status: 9 };
      }),
    });
    expect(failedAttempt.status).toBe(9);
    expect(
      commands(localVerification(repository, { args: ["--database"] })),
    ).toEqual(requiredDatabaseSteps);
    for (const fault of [
      "write",
      "file-flush",
      "rename",
      "directory-flush",
      "readback",
    ]) {
      const originalWrite = fs.writeFileSync;
      const originalFlush = fs.fsyncSync;
      const originalRename = fs.renameSync;
      const originalRead = fs.readFileSync;
      const spies = [
        vi.spyOn(fs, "writeFileSync").mockImplementation((...args) => {
          if (fault === "write")
            throw Object.assign(new Error("fixture denied marker write"), {
              code: "EACCES",
            });
          return originalWrite(...args);
        }),
        vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
          const directory = fs.fstatSync(fd).isDirectory();
          if (
            (fault === "directory-flush" && directory) ||
            (fault === "file-flush" && !directory)
          )
            throw Object.assign(new Error("fixture denied flush"), {
              code: "EIO",
            });
          return originalFlush(fd);
        }),
        vi.spyOn(fs, "renameSync").mockImplementation((...args) => {
          if (fault === "rename")
            throw Object.assign(new Error("fixture denied rename"), {
              code: "EACCES",
            });
          return originalRename(...args);
        }),
        vi.spyOn(fs, "readFileSync").mockImplementation((...args) => {
          if (fault === "readback")
            throw Object.assign(new Error("fixture denied readback"), {
              code: "EIO",
            });
          return originalRead(...args);
        }),
      ];
      try {
        const blocked = localVerification(repository, {
          args: ["--database", "--full"],
        });
        expect(blocked.status, fault).toBe(1);
        expect(commands(blocked), fault).toEqual([]);
        expect(blocked.stderr.mock.calls.flat().join("\n"), fault).toContain(
          "verification-admission-failure",
        );
      } finally {
        for (const spy of spies) spy.mockRestore();
      }
    }
    const originalRename = fs.renameSync;
    const browserDenied = vi
      .spyOn(fs, "renameSync")
      .mockImplementation((from, to) => {
        if (to.endsWith("browser.attempt.json"))
          throw Object.assign(new Error("fixture denied browser marker"), {
            code: "EACCES",
          });
        return originalRename(from, to);
      });
    try {
      const combined = localVerification(repository, { args: ["--full"] });
      expect(combined.status).toBe(1);
      expect(commands(combined)).toEqual(requiredBaselineSteps);
      expect(combined.stderr.mock.calls.flat().join("\n")).toContain(
        '"group":"browser"',
      );
      expect(combined.stdout.mock.calls.flat().join("\n")).not.toContain(
        "database: executed",
      );
    } finally {
      browserDenied.mockRestore();
    }
  }, 60000);

  it("keeps completion write failures separate from product outcomes", () => {
    const repository = createRepository();
    commit(repository, "tsconfig.json", "seed\n");
    localVerification(repository, { args: ["--database"] });
    const receipt = evidenceFile(repository, "success");
    const marker = evidenceFile(repository, "attempt");
    const directory = dirname(receipt);
    const originalReceipt = readFileSync(receipt, "utf8");
    const originalToken = JSON.parse(originalReceipt).token;
    chmodSync(receipt, 0o000);
    try {
      const completed = localVerification(repository, {
        args: ["--database"],
        run: vi.fn(() => {
          expect(JSON.parse(readFileSync(marker)).token).not.toBe(
            originalToken,
          );
          chmodSync(receipt, 0o600);
          chmodSync(directory, 0o500);
          return { status: 0 };
        }),
      });
      expect(completed.status).toBe(0);
      expect(commands(completed)).toEqual(requiredDatabaseSteps);
      expect(completed.stdout.mock.calls.flat().join("\n")).toContain(
        "local evidence not retained",
      );
      expect(completed.stdout.mock.calls.flat().join("\n")).toContain(
        '"outcome":{"type":"exit","status":0}',
      );
      expect(completed.stderr).not.toHaveBeenCalled();
    } finally {
      chmodSync(directory, 0o700);
      chmodSync(receipt, 0o600);
    }
    expect(readFileSync(receipt, "utf8")).toBe(originalReceipt);
    expect(
      commands(localVerification(repository, { args: ["--database"] })),
    ).toEqual(requiredDatabaseSteps);
    expect(
      commands(localVerification(repository, { args: ["--database"] })),
    ).toEqual([]);
    for (const operation of ["writeFileSync", "fsyncSync", "renameSync"]) {
      const before = readFileSync(receipt, "utf8");
      chmodSync(receipt, 0o000);
      let fault;
      try {
        const completed = localVerification(repository, {
          args: ["--database"],
          run: vi.fn(() => {
            chmodSync(receipt, 0o600);
            fault = vi.spyOn(fs, operation).mockImplementation(() => {
              throw Object.assign(new Error("fixture completion write fault"), {
                code: "EIO",
              });
            });
            return { status: 0 };
          }),
        });
        expect(completed.status, operation).toBe(0);
        expect(
          completed.stdout.mock.calls.flat().join("\n"),
          operation,
        ).toContain("local evidence not retained");
        expect(completed.stderr, operation).not.toHaveBeenCalled();
        expect(fault, operation).toHaveBeenCalled();
      } finally {
        fault?.mockRestore();
        chmodSync(receipt, 0o600);
      }
      expect(readFileSync(receipt, "utf8"), operation).toBe(before);
      expect(
        commands(localVerification(repository, { args: ["--database"] })),
        operation,
      ).toEqual(requiredDatabaseSteps);
    }
  }, 60000);
});
