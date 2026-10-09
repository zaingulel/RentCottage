import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, vi } from "vitest";
import { main } from "./verify.mjs";

export const requiredBaselineSteps = [
  ["npm", ["run", "audit:production"]],
  ["npm", ["run", "audit:shipped-dev"]],
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
  [
    "npm",
    [
      "run",
      "test:browser",
      "--",
      "--config=playwright.next-prebuilt.config.ts",
    ],
  ],
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

export const requiredShellSmokeSteps = [
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
  [
    "npm",
    [
      "run",
      "test:browser",
      "--",
      "--config=playwright.next-prebuilt.config.ts",
    ],
  ],
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

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const lockedDependencyVersions = {
  wrangler: "4.130.0",
  workerd: "1.20260908.1",
};

export function requiredCiSteps(mode) {
  const chromium = ["npx", ["playwright", "install", "chromium"]];
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
  write(repository, "tsconfig.json", "{}\n");
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

export async function runVerification(repository, options = {}) {
  const calls = [];
  const stdout = vi.fn();
  const stderr = vi.fn();
  const run = vi.fn((command, args, environment) => {
    calls.push([command, args, environment]);
    return { status: 0 };
  });
  const status = await main(options.args ?? [], {
    claimRunSlot: options.claimRunSlot,
    cwd: repository,
    environment: options.environment ?? {},
    run: options.run ?? run,
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
