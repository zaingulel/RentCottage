import { spawnSync } from "node:child_process";
import fs from "node:fs";
import {
  chmodSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

import { describe, expect, it, vi } from "vitest";
import {
  ROOT,
  requiredDatabaseSteps,
  requiredBrowserSteps,
  write,
  runVerification,
  productionFixture,
  evidenceFile,
  commands,
} from "./verify-test-fixtures.mjs";

describe("repository verification command", () => {
  it("wires local evidence reuse through a real child invocation", () => {
    const fixture = productionFixture();
    const gitExecutable = join(fixture.tools, "bin/git");
    const originalGit = fs.realpathSync(gitExecutable);
    const gitLog = join(fixture.tools, "git-commands.jsonl");
    rmSync(gitExecutable);
    writeFileSync(
      gitExecutable,
      `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(gitLog)}, JSON.stringify(args) + '\\n');
const result = require('node:child_process').spawnSync(${JSON.stringify(originalGit)}, args, { stdio: 'inherit' });
if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
else process.exit(result.status);
`,
      { mode: 0o755 },
    );
    const child = () =>
      spawnSync(
        process.execPath,
        [join(ROOT, "scripts/verify.mjs"), "--database"],
        { cwd: fixture.repository, env: fixture.environment, encoding: "utf8" },
      );
    const first = child();
    expect(first.status, first.stderr).toBe(0);
    expect(
      readFileSync(fixture.commandLog, "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse),
    ).toEqual([["npm", "run", "verify:access:database"]]);
    const second = child();
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toContain("reused local evidence");
    expect(
      readFileSync(fixture.commandLog, "utf8").trim().split("\n"),
    ).toHaveLength(1);
    write(fixture.repository, "custom-worker.ts", "stale source\n");
    const stale = child();
    expect(stale.status, stale.stderr).toBe(0);
    expect(stale.stdout).not.toContain("reused local evidence");
    expect(
      readFileSync(fixture.commandLog, "utf8")
        .trim()
        .split("\n")
        .map(JSON.parse),
    ).toEqual([
      ["npm", "run", "verify:access:database"],
      ["npm", "run", "verify:access:database"],
    ]);
    const gitArguments = readFileSync(gitLog, "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    expect(gitArguments.some(([command]) => command === "ls-tree")).toBe(true);
    expect(gitArguments.some(([command]) => command === "ls-files")).toBe(true);
    expect(
      gitArguments.filter(
        ([command, type]) => command === "cat-file" && type === "blob",
      ),
    ).toEqual([]);
  }, 30000);

  it("admits cold image preparation and ignores unrelated image additions", () => {
    const fixture = productionFixture();
    const image = (repository, tag, id) => ({
      Repository: repository,
      Tag: tag,
      Digest: "<none>",
      ID: `sha256:${id.repeat(64)}`,
    });
    const original = image("fixture/required", "latest", "a");
    const unrelated = image("other/fixture", "extra", "b");
    const writeImages = (rows) =>
      writeFileSync(
        fixture.images,
        rows.map((row) => JSON.stringify(row)).join("\n"),
      );
    const execute = (mutate) =>
      runVerification(fixture.repository, {
        args: ["--database"],
        environment: fixture.environment,
        run: vi.fn(() => {
          if (mutate) mutate();
          return { status: 0 };
        }),
      });
    expect(execute(() => writeImages([original])).status).toBe(0);
    const saved = readFileSync(
      evidenceFile(fixture.repository, "success"),
      "utf8",
    );
    expect(saved).not.toContain(original.Repository);
    expect(saved).not.toContain(original.ID);
    expect(commands(execute())).toEqual([]);
    writeImages([original, unrelated]);
    expect(commands(execute())).toEqual([]);
    expect(
      readFileSync(evidenceFile(fixture.repository, "success"), "utf8"),
    ).toBe(saved);
    writeImages([image(original.Repository, original.Tag, "c"), unrelated]);
    expect(commands(execute())).toEqual(requiredDatabaseSteps);
    writeImages([unrelated]);
    expect(commands(execute())).toEqual(requiredDatabaseSteps);
    writeFileSync(fixture.daemon, JSON.stringify("changed-daemon"));
    expect(commands(execute())).toEqual(requiredDatabaseSteps);
    expect(commands(execute())).toEqual([]);
    write(
      fixture.repository,
      "custom-worker.ts",
      "repair requiring execution\n",
    );
    const changedDuring = execute(() =>
      writeImages([image(unrelated.Repository, unrelated.Tag, "d")]),
    );
    expect(changedDuring.stdout.mock.calls.flat().join("\n")).toContain(
      "local evidence not retained",
    );
    expect(commands(execute())).toEqual(requiredDatabaseSteps);
    for (const metadata of [
      "{malformed",
      JSON.stringify({
        Repository: "private-image-name",
        Tag: "latest",
        ID: "bad",
        Digest: "<none>",
      }),
      [image("conflict", "tag", "a"), image("conflict", "tag", "b")]
        .map(JSON.stringify)
        .join("\n"),
    ]) {
      writeFileSync(fixture.images, metadata);
      const malformed = execute();
      expect(commands(malformed)).toEqual(requiredDatabaseSteps);
      expect(malformed.stdout.mock.calls.flat().join("\n")).toContain(
        "local evidence not retained",
      );
      expect(malformed.stdout.mock.calls.flat().join("\n")).not.toContain(
        "private-image-name",
      );
    }
  }, 60000);

  it("fingerprints browser distribution sidecars through production capture", () => {
    const fixture = productionFixture({ browsers: true });
    const [chromium, headless] = fixture.distributions;
    const framework = join(
      chromium.directory,
      "Fixture.app/Contents/Frameworks/Fixture.framework/Versions",
    );
    write(framework, "A/Fixture", "framework executable");
    chmodSync(join(framework, "A/Fixture"), 0o755);
    write(framework, "A/Resources/resource.pak", "framework resource");
    symlinkSync("A", join(framework, "Current"));
    const library = join(dirname(headless.executable), "libfixture.dylib");
    const icd = join(dirname(headless.executable), "vk_fixture_icd.json");
    writeFileSync(library, "headless sibling library");
    writeFileSync(icd, '{"fixture":"initial"}');
    const launchers = fixture.distributions.map((entry) =>
      readFileSync(entry.executable, "utf8"),
    );
    const execute = (environment = fixture.environment) =>
      runVerification(fixture.repository, { args: ["--browser"], environment });
    expect(execute().status).toBe(0);
    expect(commands(execute())).toEqual([]);
    for (const [path, contents] of [
      [join(framework, "Current/Fixture"), "changed framework executable"],
      [
        join(framework, "Current/Resources/resource.pak"),
        "changed framework resource",
      ],
      [library, "changed headless library"],
      [icd, '{"fixture":"changed"}'],
    ]) {
      writeFileSync(path, contents);
      const changed = execute();
      expect(commands(changed)).toEqual(requiredBrowserSteps);
      expect(changed.status).toBe(0);
      expect(commands(execute())).toEqual([]);
      expect(
        fixture.distributions.map((entry) =>
          readFileSync(entry.executable, "utf8"),
        ),
      ).toEqual(launchers);
    }
    const aliasEnvironment = { ...fixture.environment };
    aliasEnvironment.npm_config_playwright_browsers_path =
      aliasEnvironment.PLAYWRIGHT_BROWSERS_PATH;
    delete aliasEnvironment.PLAYWRIGHT_BROWSERS_PATH;
    expect(commands(execute(aliasEnvironment))).toEqual(requiredBrowserSteps);
    expect(commands(execute(aliasEnvironment))).toEqual([]);
    const external = join(fixture.tools, "outside-distribution");
    writeFileSync(external, "outside content");
    symlinkSync(
      relative(chromium.directory, external),
      join(chromium.directory, "escape"),
    );
    const escape = execute();
    expect(commands(escape)).toEqual(requiredBrowserSteps);
    expect(escape.stdout.mock.calls.flat().join("\n")).toContain(
      "local evidence not retained",
    );
    rmSync(join(chromium.directory, "escape"));
    rmSync(headless.directory, { recursive: true });
    const missing = execute();
    expect(commands(missing)).toEqual(requiredBrowserSteps);
    expect(missing.stdout.mock.calls.flat().join("\n")).toContain(
      "local evidence not retained",
    );
  }, 60000);
});
