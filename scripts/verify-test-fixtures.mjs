import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, vi } from "vitest";
import { main } from "./verify.mjs";

export const requiredBaselineSteps = [
  ["npm", ["run", "audit:production"]],
  ["npm", ["run", "format:check"]],
  ["npm", ["run", "lint"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["test"]],
  ["npm", ["run", "cf-typegen"]],
  [
    "git",
    [
      "diff",
      "--exit-code",
      "--ignore-space-at-eol",
      "--",
      "cloudflare-env.d.ts",
    ],
  ],
];

export const requiredExpensiveSteps = [
  ["npm", ["run", "verify:access"]],
  ["npm", ["run", "build:worker"]],
  ["npm", ["run", "scan:client-secrets"]],
  ["npm", ["run", "test:browser"]],
  [
    "npm",
    [
      "run",
      "smoke:preview",
      "--",
      "--config=playwright.worker-prebuilt.config.ts",
    ],
  ],
];

export const requiredDatabaseSteps = [
  ["npm", ["run", "verify:access:database"]],
];

export const requiredLightDatabaseSteps = [
  ["npm", ["run", "verify:access:database-tests"]],
];

export const requiredBrowserSteps = [
  ["npm", ["run", "verify:access:browser"]],
  ...requiredExpensiveSteps.slice(1),
];

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const lockedDependencyVersions = {
  wrangler: "4.130.0",
  workerd: "1.20260908.1",
};

export function requiredCiSteps(mode) {
  const chromium = [
    "npx",
    ["playwright", "install", "--with-deps", "chromium"],
  ];
  if (mode === "--database")
    return [["npm", ["run", "verify:access:database"]]];
  if (mode === "--browser")
    return [
      chromium,
      ["npm", ["run", "verify:access:browser"]],
      ...requiredExpensiveSteps.slice(1),
    ];
  return [...requiredBaselineSteps, chromium, ...requiredExpensiveSteps];
}

export const repositories = [];

export function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

export function write(repository, path, contents) {
  const target = join(repository, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

export function writeDependencyMetadata(
  repository,
  {
    lockVersions = lockedDependencyVersions,
    installedVersions = lockedDependencyVersions,
  } = {},
) {
  write(
    repository,
    "package-lock.json",
    `${JSON.stringify(
      {
        lockfileVersion: 3,
        packages: Object.fromEntries(
          Object.entries(lockVersions).map(([name, version]) => [
            `node_modules/${name}`,
            { version },
          ]),
        ),
      },
      null,
      2,
    )}\n`,
  );
  for (const [name, version] of Object.entries(installedVersions)) {
    write(
      repository,
      `node_modules/${name}/package.json`,
      `${JSON.stringify({ name, version }, null, 2)}\n`,
    );
  }
}

export function createRepository() {
  const repository = mkdtempSync(join(tmpdir(), "rentcottage-verify-"));
  repositories.push(repository);
  git(repository, ["init", "--initial-branch=main"]);
  git(repository, ["config", "user.name", "Verification Test"]);
  git(repository, ["config", "user.email", "verify@example.test"]);
  write(repository, "AGENTS.md", "initial instructions\n");
  write(repository, ".gitignore", "node_modules/\n");
  write(repository, "custom-worker.ts", "export const value = 'initial';\n");
  writeDependencyMetadata(repository);
  git(repository, ["add", "."]);
  git(repository, ["commit", "-m", "initial"]);
  git(repository, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  git(repository, ["switch", "-c", "job/test"]);
  return repository;
}
export function commit(repository, path, contents, message = "change") {
  write(repository, path, contents);
  git(repository, ["add", "--", path]);
  git(repository, ["commit", "-m", message]);
  return git(repository, ["rev-parse", "HEAD"]);
}

export function runVerification(repository, options = {}) {
  const calls = [];
  const stdout = vi.fn();
  const stderr = vi.fn();
  const run = vi.fn((command, args, environment) => {
    calls.push([command, args, environment]);
    return { status: 0 };
  });
  const status = main(options.args ?? [], {
    cwd: repository,
    environment: options.environment ?? {},
    run: options.run ?? run,
    captureRuntimeContract: options.captureRuntimeContract,
    stderr,
    stdout,
  });
  return { calls, run: options.run ?? run, status, stderr, stdout };
}

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

export function runtimeFixture() {
  return { digest: "a".repeat(64), dockerReferences: [] };
}

export function localVerification(repository, options = {}) {
  return runVerification(repository, {
    captureRuntimeContract: runtimeFixture,
    ...options,
  });
}

export function productionFixture({ browsers = false } = {}) {
  const repository = createRepository();
  const tools = mkdtempSync(join(tmpdir(), "rentcottage-native-"));
  repositories.push(tools);
  const bin = join(tools, "bin");
  mkdirSync(bin);
  for (const name of ["node", "git"]) {
    const actual =
      name === "node"
        ? process.execPath
        : spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
    symlinkSync(actual, join(bin, name));
  }
  const images = join(tools, "images.json");
  const daemon = join(tools, "daemon.json");
  const commandLog = join(tools, "commands.jsonl");
  writeFileSync(images, "");
  writeFileSync(daemon, JSON.stringify("fixture-daemon"));
  const npmConfig = {
    userconfig: join(tools, "user.npmrc"),
    globalconfig: join(tools, "global.npmrc"),
  };
  const launcher = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const name = require('node:path').basename(process.argv[1]);
if (name === 'docker') {
  if (args[0] === 'version') console.log(JSON.stringify({ Client: { Version: 'fixture-client' }, Server: { Version: 'fixture-server' } }));
  else if (args[0] === 'info') console.log(fs.readFileSync(${JSON.stringify(daemon)}, 'utf8'));
  else if (args[0] === 'context') console.log('fixture-context');
  else if (args[0] === 'image') process.stdout.write(fs.readFileSync(${JSON.stringify(images)}, 'utf8'));
  else process.exitCode = 2;
} else if (args[0] === 'config') console.log(${JSON.stringify(JSON.stringify(npmConfig))});
else fs.appendFileSync(${JSON.stringify(commandLog)}, JSON.stringify([name, ...args]) + '\\n');
`;
  for (const name of ["npm", "npx", "docker"]) {
    writeFileSync(join(bin, name), launcher, { mode: 0o755 });
  }
  const environment = { PATH: bin, HOME: tools };
  let distributions;
  if (browsers) {
    cpSync(
      join(ROOT, "node_modules/playwright-core"),
      join(repository, "node_modules/playwright-core"),
      { recursive: true },
    );
    const browserRoot = join(tools, "browsers");
    environment.PLAYWRIGHT_BROWSERS_PATH = browserRoot;
    const resolveDistributions = spawnSync(
      process.execPath,
      [
        "-e",
        `const {createRequire}=require('node:module');const requireHere=createRequire(process.cwd()+'/package.json');const {registry}=requireHere('playwright-core/lib/coreBundle');console.log(JSON.stringify(['chromium','chromium-headless-shell'].map(name=>{const entry=registry.registry.findExecutable(name);return {name,directory:entry.directory,executable:entry.executablePath()}})));`,
      ],
      { cwd: repository, env: environment, encoding: "utf8" },
    );
    if (resolveDistributions.status !== 0)
      throw new Error(resolveDistributions.stderr);
    distributions = JSON.parse(resolveDistributions.stdout);
    for (const entry of distributions) {
      mkdirSync(dirname(entry.executable), { recursive: true });
      writeFileSync(entry.executable, "fixture-launcher", { mode: 0o755 });
      write(entry.directory, "Resources/locale.pak", "fixture-resource");
    }
  }
  commit(repository, "custom-worker.ts", "seed\n");
  return {
    repository,
    tools,
    images,
    daemon,
    commandLog,
    environment,
    distributions,
  };
}

export function evidenceFile(repository, suffix, group = "database") {
  return join(
    git(repository, ["rev-parse", "--absolute-git-dir"]),
    "rentcottage-verification",
    `${group}.${suffix}.json`,
  );
}

export function commands(result) {
  return result.run.mock.calls.map(([command, args]) => [command, args]);
}
