import {
  chmodSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it, vi } from "vitest";
import {
  requiredBaselineSteps,
  requiredExpensiveSteps,
  requiredDatabaseSteps,
  requiredBrowserSteps,
  write,
  runVerification,
  productionFixture,
  evidenceFile,
  commands,
} from "./verify-test-fixtures.mjs";

describe("repository verification command", () => {
  it("refuses external executable overrides through production capture", () => {
    const fixture = productionFixture();
    const external = join(fixture.tools, "external-binary");
    writeFileSync(external, "first executable", { mode: 0o755 });
    const execute = (environment, args = ["--database"]) =>
      runVerification(fixture.repository, {
        environment: { ...fixture.environment, ...environment },
        args,
      });
    expect(execute({}).status).toBe(0);
    expect(commands(execute({}))).toEqual([]);
    for (const name of [
      "SUPABASE_CLI_BINARY_OVERRIDE",
      "ESBUILD_BINARY_PATH",
      "MINIFLARE_WORKERD_PATH",
    ]) {
      for (const value of [external, ""]) {
        const earlierReceipt = readFileSync(
          evidenceFile(fixture.repository, "success"),
          "utf8",
        );
        const result = execute({ [name]: value });
        expect(commands(result)).toEqual(requiredDatabaseSteps);
        expect(result.stdout.mock.calls.flat().join("\n")).toContain(
          `${name}: external executable override prevents reuse`,
        );
        expect(result.stdout.mock.calls.flat().join("\n")).not.toContain(
          external,
        );
        writeFileSync(external, "same path replacement", { mode: 0o755 });
        expect(commands(execute({ [name]: value }))).toEqual(
          requiredDatabaseSteps,
        );
        expect(
          readFileSync(evidenceFile(fixture.repository, "success"), "utf8"),
        ).toBe(earlierReceipt);
        const refusedBrowser = execute({ [name]: value }, ["--browser"]);
        expect(commands(refusedBrowser)).toEqual(requiredBrowserSteps);
        expect(refusedBrowser.stdout.mock.calls.flat().join("\n")).toContain(
          `${name}: external executable override prevents reuse`,
        );
        expect(() =>
          readFileSync(evidenceFile(fixture.repository, "success", "browser")),
        ).toThrow();
      }
      expect(commands(execute({}))).toEqual(requiredDatabaseSteps);
      expect(commands(execute({}))).toEqual([]);
    }
    for (const name of [
      "NODE_OPTIONS",
      "NODE_PATH",
      "PW_INSTRUMENT_MODULES",
      "LD_PRELOAD",
      "LD_LIBRARY_PATH",
      "DYLD_INSERT_LIBRARIES",
      "DYLD_LIBRARY_PATH",
    ]) {
      const refused = execute({ [name]: "external" });
      expect(commands(refused)).toEqual(requiredDatabaseSteps);
      expect(refused.stdout.mock.calls.flat().join("\n")).toContain(
        `${name}: external executable override prevents reuse`,
      );
    }
    for (const name of ["SELENIUM_REMOTE_URL", "PW_TEST_CONNECT_WS_ENDPOINT"]) {
      const remote = execute({ [name]: "remote-secret" }, ["--browser"]);
      expect(commands(remote)).toEqual(requiredBrowserSteps);
      expect(remote.stdout.mock.calls.flat().join("\n")).toContain(
        `${name}: remote browser prevents reuse`,
      );
      expect(remote.stdout.mock.calls.flat().join("\n")).not.toContain(
        "remote-secret",
      );
    }
  }, 60000);

  it("distinguishes installed inputs from generated results after baseline", () => {
    const fixture = productionFixture({ browsers: true });
    const execute = (mutate) =>
      runVerification(fixture.repository, {
        environment: fixture.environment,
        run: vi.fn((_command, args) => {
          if (args[0] === "test" && mutate) mutate();
          return { status: 0 };
        }),
      });
    expect(execute().status).toBe(0);
    const resultPath = `node_modules/.vite/vitest/${"a".repeat(40)}/results.json`;
    for (const mutate of [
      () =>
        write(
          fixture.repository,
          resultPath,
          JSON.stringify({
            version: "4.1.10",
            results: [["case", { duration: 12, failed: false }]],
          }),
        ),
      () =>
        write(
          fixture.repository,
          resultPath,
          JSON.stringify({
            version: "4.1.10",
            results: [["case", { duration: 99, failed: true }]],
          }),
        ),
      () => rmSync(join(fixture.repository, resultPath)),
    ]) {
      const result = execute(mutate);
      expect(commands(result)).toEqual(requiredBaselineSteps);
      expect(result.stdout.mock.calls.flat().join("\n")).toContain(
        "database: reused local evidence",
      );
      expect(result.stdout.mock.calls.flat().join("\n")).toContain(
        "browser: reused local evidence",
      );
    }
    for (const [path, contents, mode] of [
      ["node_modules/workerd/installed.js", "first installed input", 0o644],
      [
        "node_modules/workerd/installed.js",
        "same-path installed replacement",
        0o644,
      ],
      ["node_modules/.vite/executable-output", "executable result", 0o755],
      [resultPath, "executable results", 0o755],
    ]) {
      const result = execute(() => {
        write(fixture.repository, path, contents);
        chmodSync(join(fixture.repository, path), mode);
      });
      expect(commands(result)).toEqual([
        ...requiredBaselineSteps,
        ...requiredExpensiveSteps,
      ]);
    }
    const symlinkReplacement = execute(() => {
      rmSync(join(fixture.repository, resultPath));
      symlinkSync(
        "../../../workerd/installed.js",
        join(fixture.repository, resultPath),
      );
    });
    expect(commands(symlinkReplacement)).toEqual([
      ...requiredBaselineSteps,
      ...requiredExpensiveSteps,
    ]);
    const symlinkResult = execute();
    expect(commands(symlinkResult)).toEqual(requiredBaselineSteps);
    const ancestor = join(fixture.repository, "node_modules/.vite/vitest");
    renameSync(ancestor, `${ancestor}.original`);
    symlinkSync("vitest.original", ancestor);
    const invalidAncestor = execute();
    expect(commands(invalidAncestor)).toEqual([
      ...requiredBaselineSteps,
      ...requiredExpensiveSteps,
    ]);
    expect(invalidAncestor.stdout.mock.calls.flat().join("\n")).toContain(
      "local evidence not retained",
    );
    rmSync(ancestor);
    renameSync(`${ancestor}.original`, ancestor);
    expect(execute().status).toBe(0);
    const external = join(fixture.tools, "external-installed-input");
    writeFileSync(external, "unbounded external input");
    const dependencyRoot = join(fixture.repository, "node_modules");
    symlinkSync(
      relative(dependencyRoot, external),
      join(dependencyRoot, "external-input"),
    );
    const unbounded = execute();
    expect(commands(unbounded)).toEqual([
      ...requiredBaselineSteps,
      ...requiredExpensiveSteps,
    ]);
    expect(unbounded.stdout.mock.calls.flat().join("\n")).toContain(
      "local evidence not retained",
    );
  }, 60000);
});
