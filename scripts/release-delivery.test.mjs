import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it, onTestFinished, vi } from "vitest";

import { releaseDelivery } from "./release-delivery.mjs";

const run = (cwd, args) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

function gitExecutor(repo, inspect) {
  return (args, options) => {
    const execute = () => {
      const effectiveArgs =
        args[0] === "fetch" && args[2] === "origin"
          ? [...args.slice(0, 2), repo.remote, ...args.slice(3)]
          : args;
      return execFileSync("git", effectiveArgs, options);
    };
    return inspect ? inspect(args, options, execute) : execute();
  };
}

function repository({ mergeMode = "merge" } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "release-delivery-")));
  onTestFinished(() => rmSync(root, { force: true, recursive: true }));
  const remote = join(root, "remote.git");
  const primary = join(root, "primary");
  const secondary = join(root, "secondary");
  run(root, ["init", "--bare", remote]);
  run(root, ["clone", remote, primary]);
  run(primary, ["config", "user.email", "test@example.com"]);
  run(primary, ["config", "user.name", "Delivery Test"]);
  writeFileSync(join(primary, "tracked.txt"), "base\n");
  writeFileSync(
    join(primary, ".gitignore"),
    "node_modules/\n.next/\n.open-next/\n.wrangler/\ntest-results/\nplaywright-report/\ncoverage/\nnext-env.d.ts\n*.tsbuildinfo\n",
  );
  mkdirSync(join(primary, "supabase"));
  writeFileSync(join(primary, "supabase", ".gitignore"), ".branches\n.temp\n");
  run(primary, ["add", "tracked.txt", ".gitignore", "supabase/.gitignore"]);
  run(primary, ["commit", "-m", "base"]);
  run(primary, ["branch", "-M", "main"]);
  run(primary, [
    "remote",
    "set-url",
    "origin",
    "https://github.com/zaingulel/RentCottage.git",
  ]);
  run(primary, ["push", remote, "main"]);
  run(primary, ["remote", "set-url", "origin", remote]);
  run(primary, ["worktree", "add", "-b", "topic", secondary]);
  writeFileSync(join(secondary, "tracked.txt"), "topic\n");
  run(secondary, ["commit", "-am", "topic"]);
  const head = run(secondary, ["rev-parse", "HEAD"]);
  run(primary, ["push", remote, "topic:topic"]);
  run(primary, ["checkout", "main"]);
  if (mergeMode === "squash") {
    run(primary, ["merge", "--squash", "topic"]);
    run(primary, ["commit", "-m", "squash"]);
  } else if (mergeMode === "rebase") {
    writeFileSync(join(primary, "main-only.txt"), "advance\n");
    run(primary, ["add", "main-only.txt"]);
    run(primary, ["commit", "-m", "advance main"]);
    run(primary, ["cherry-pick", head]);
  } else {
    run(primary, ["merge", "--no-ff", "topic", "-m", "merge"]);
  }
  run(primary, ["push", remote, "main"]);
  const mergeCommit = run(primary, ["rev-parse", "HEAD"]);
  run(primary, [
    "remote",
    "set-url",
    "origin",
    "https://github.com/zaingulel/RentCottage.git",
  ]);
  return { root, remote, primary, secondary, head, mergeCommit };
}

function github({ head, mergeCommit }, transform = (value) => value) {
  return vi.fn(() =>
    JSON.stringify(
      transform({
        data: {
          repository: {
            nameWithOwner: "zaingulel/RentCottage",
            defaultBranchRef: { name: "main" },
            pullRequest: {
              number: 74,
              state: "MERGED",
              headRefName: "topic",
              headRefOid: head,
              headRepository: { nameWithOwner: "zaingulel/RentCottage" },
              baseRefName: "main",
              baseRepository: { nameWithOwner: "zaingulel/RentCottage" },
              mergedAt: "2026-08-16T10:00:00Z",
              mergeCommit: { oid: mergeCommit },
            },
          },
        },
      }),
    ),
  );
}

function input(repo, overrides = {}) {
  return {
    worktree: repo.secondary,
    branch: "topic",
    head: repo.head,
    pullRequest: 74,
    writerState: "stopped",
    cwd: repo.primary,
    runGh: github(repo),
    executeGit: gitExecutor(repo),
    ...overrides,
  };
}

describe("releaseDelivery", () => {
  it("rejects invalid CLI input with structured exit 2 before external work", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/release-delivery.mjs", "--worktree", "relative"],
      {
        cwd: resolve(import.meta.dirname, ".."),
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      exitCode: 2,
      status: "invalid",
    });
    expect(result.stderr).toBe("");

    const bounded = releaseDelivery({
      worktree: `/${"x".repeat(10_000)}`,
      branch: "topic",
      head: "a".repeat(40),
      pullRequest: 74,
      writerState: "stopped",
    });
    expect(bounded).toMatchObject({ exitCode: 2, status: "invalid" });
    expect(JSON.stringify(bounded).length).toBeLessThan(2_000);

    for (const branch of ["foo/", "foo.", ".foo", "foo//bar"]) {
      const runGh = vi.fn();
      const executeGit = vi.fn(() => {
        throw new Error("Git must not run for invalid input");
      });
      const invalidBranch = releaseDelivery({
        worktree: "/private/tmp/absent-release-target",
        branch,
        head: "a".repeat(40),
        pullRequest: 74,
        writerState: "stopped",
        runGh,
        executeGit,
      });
      expect(invalidBranch).toMatchObject({ exitCode: 2, status: "invalid" });
      expect(executeGit).not.toHaveBeenCalled();
      expect(runGh).not.toHaveBeenCalled();
    }
  });

  it("pins default GitHub evidence to github.com at the CLI boundary", () => {
    const repo = repository();
    const fakeBin = join(repo.root, "bin");
    const ghArguments = join(repo.root, "gh-arguments.json");
    mkdirSync(fakeBin);
    const gitWrapper = join(fakeBin, "git");
    const ghWrapper = join(fakeBin, "gh");
    writeFileSync(
      gitWrapper,
      `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
if (args[0] === "fetch" && args[2] === "origin") args[2] = process.env.TEST_REMOTE;
const result = spawnSync(process.env.REAL_GIT, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
`,
    );
    writeFileSync(
      ghWrapper,
      `#!/usr/bin/env node
require("node:fs").writeFileSync(process.env.GH_ARGUMENTS, JSON.stringify(process.argv.slice(2)));
process.stdout.write(process.env.GH_EVIDENCE);
`,
    );
    chmodSync(gitWrapper, 0o755);
    chmodSync(ghWrapper, 0o755);
    const realGit = execFileSync("sh", ["-c", "command -v git"], {
      encoding: "utf8",
    }).trim();
    const result = spawnSync(
      process.execPath,
      [
        resolve(import.meta.dirname, "release-delivery.mjs"),
        "--worktree",
        repo.secondary,
        "--branch",
        "topic",
        "--head",
        repo.head,
        "--pull-request",
        "74",
        "--writer-state",
        "stopped",
      ],
      {
        cwd: repo.primary,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          REAL_GIT: realGit,
          TEST_REMOTE: repo.remote,
          GH_ARGUMENTS: ghArguments,
          GH_EVIDENCE: github(repo)(),
        },
      },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "released" });
    expect(JSON.parse(readFileSync(ghArguments, "utf8")).slice(0, 4)).toEqual([
      "api",
      "--hostname",
      "github.com",
      "graphql",
    ]);
  }, 15_000);

  it("refuses an active writer before reading GitHub or mutating the target", () => {
    for (const writerState of ["active", "unknown"]) {
      const repo = repository();
      const runGh = github(repo);
      const result = releaseDelivery(input(repo, { writerState, runGh }));
      expect(result).toMatchObject({
        exitCode: 3,
        status: "refused",
        target: repo.secondary,
      });
      expect(result.reason).toContain(`writer-state=${writerState}`);
      expect(runGh).not.toHaveBeenCalled();
      expect(run(repo.secondary, ["rev-parse", "HEAD"])).toBe(repo.head);
    }
  });

  it("retains the primary worktree", () => {
    const primary = repository();
    expect(
      releaseDelivery(input(primary, { worktree: primary.primary })).reason,
    ).toContain("primary");
  });

  it("retains the current worktree", () => {
    const current = repository();
    expect(
      releaseDelivery(input(current, { cwd: current.secondary })).reason,
    ).toContain("current");
  });

  it("retains an unregistered or foreign target", () => {
    const foreign = repository();
    const foreignPath = join(foreign.root, "foreign");
    mkdirSync(foreignPath);
    expect(
      releaseDelivery(input(foreign, { worktree: foreignPath })).reason,
    ).toContain("foreign");
  });

  it("retains a detached target", () => {
    const detached = repository();
    run(detached.secondary, ["checkout", "--detach"]);
    expect(releaseDelivery(input(detached)).reason).toContain("detached");
  });

  it("releases the exact clean secondary worktree and compare-deletes its branch", () => {
    const repo = repository();
    const result = releaseDelivery(input(repo));
    expect(result).toMatchObject({
      exitCode: 0,
      status: "released",
      target: repo.secondary,
    });
    expect(() =>
      run(repo.primary, ["show-ref", "--verify", "refs/heads/topic"]),
    ).toThrow();
    expect(readFileSync(join(repo.primary, "tracked.txt"), "utf8")).toBe(
      "topic\n",
    );
    expect(
      run(repo.primary, ["worktree", "list", "--porcelain"]),
    ).not.toContain(repo.secondary);
  });

  it("releases squash-merged work without requiring the approved head to be an ancestor", () => {
    const repo = repository({ mergeMode: "squash" });
    expect(releaseDelivery(input(repo))).toMatchObject({
      exitCode: 0,
      status: "released",
    });
  });

  it("accepts a both-absent squash-merged rerun after the approved head object is pruned", () => {
    const repo = repository({ mergeMode: "squash" });
    run(repo.primary, ["worktree", "remove", repo.secondary]);
    run(repo.primary, ["update-ref", "-d", "refs/heads/topic", repo.head]);
    run(repo.primary, ["update-ref", "-d", "refs/remotes/origin/topic"]);
    run(repo.primary, ["reflog", "expire", "--expire=now", "--all"]);
    run(repo.primary, ["gc", "--prune=now"]);
    expect(() => run(repo.primary, ["cat-file", "-e", repo.head])).toThrow();
    expect(releaseDelivery(input(repo))).toMatchObject({
      exitCode: 0,
      status: "already-released",
    });
  });

  it("releases rebase-style merged work and reruns after pruning the original head", () => {
    const repo = repository({ mergeMode: "rebase" });
    expect(releaseDelivery(input(repo))).toMatchObject({
      exitCode: 0,
      status: "released",
    });
    run(repo.primary, ["update-ref", "-d", "refs/remotes/origin/topic"]);
    run(repo.primary, ["reflog", "expire", "--expire=now", "--all"]);
    run(repo.primary, ["gc", "--prune=now"]);
    expect(() => run(repo.primary, ["cat-file", "-e", repo.head])).toThrow();
    expect(releaseDelivery(input(repo))).toMatchObject({
      exitCode: 0,
      status: "already-released",
    });
  });

  it("refuses when any worktree inventory record is malformed", () => {
    const repo = repository();
    const executeGit = vi.fn((args, options) => {
      if (args.includes("worktree") && args.includes("list"))
        return "worktree /bad\0HEAD nope\0\0";
      return execFileSync("git", args, options);
    });
    const result = releaseDelivery(input(repo, { executeGit }));
    expect(result).toMatchObject({ exitCode: 4, status: "incomplete" });
    expect(result.reason).toContain("worktree inventory");

    const trailing = repository();
    const trailingGit = (args, options) => {
      const value = execFileSync("git", args, options);
      if (args[0] === "worktree" && args[1] === "list")
        return `${String(value)}worktree /bad\0HEAD nope\0\0`;
      return value;
    };
    expect(
      releaseDelivery(input(trailing, { executeGit: trailingGit })).reason,
    ).toContain("worktree inventory");
  });

  it("refuses locked, prunable, duplicate, and branch-reused inventory", () => {
    for (const marker of ["locked release", "prunable stale"]) {
      const repo = repository();
      const executeGit = vi.fn((args, options) => {
        const value = execFileSync("git", args, options);
        if (args[0] === "worktree" && args[1] === "list") {
          return String(value).replace(
            `branch refs/heads/topic\0\0`,
            `branch refs/heads/topic\0${marker}\0\0`,
          );
        }
        return value;
      });
      expect(releaseDelivery(input(repo, { executeGit })).reason).toContain(
        marker.split(" ")[0],
      );
    }

    const duplicate = repository();
    const duplicateGit = (args, options) => {
      const value = execFileSync("git", args, options);
      if (args[0] === "worktree" && args[1] === "list") {
        return `${String(value)}worktree ${duplicate.secondary}\0HEAD ${duplicate.head}\0branch refs/heads/other\0\0`;
      }
      return value;
    };
    expect(
      releaseDelivery(input(duplicate, { executeGit: duplicateGit })).reason,
    ).toContain("worktree inventory");

    const reused = repository();
    const reusedGit = (args, options) => {
      const value = execFileSync("git", args, options);
      if (args[0] === "worktree" && args[1] === "list") {
        return `${String(value)}worktree ${join(reused.root, "other")}\0HEAD ${reused.head}\0branch refs/heads/topic\0\0`;
      }
      return value;
    };
    expect(
      releaseDelivery(input(reused, { executeGit: reusedGit })).reason,
    ).toContain("another worktree");
  });

  it("retains staged, tracked, and untracked changes before GitHub evidence", () => {
    for (const change of ["staged", "tracked", "untracked"]) {
      const repo = repository();
      if (change === "untracked")
        writeFileSync(join(repo.secondary, "new.txt"), "new\n");
      else {
        writeFileSync(join(repo.secondary, "tracked.txt"), `${change}\n`);
        if (change === "staged") run(repo.secondary, ["add", "tracked.txt"]);
      }
      const runGh = github(repo);
      const result = releaseDelivery(input(repo, { runGh }));
      expect(result).toMatchObject({ exitCode: 3, status: "refused" });
      expect(runGh).not.toHaveBeenCalled();
    }
  });

  it("fails closed when local branch evidence is unavailable", () => {
    const repo = repository();
    run(repo.primary, ["worktree", "remove", repo.secondary]);
    run(repo.primary, ["update-ref", "-d", "refs/heads/topic", repo.head]);
    const executeGit = gitExecutor(repo, (args, _options, execute) => {
      if (args[0] === "show-ref") {
        const error = new Error("simulated repository read failure");
        error.status = 128;
        throw error;
      }
      return execute();
    });
    const result = releaseDelivery(input(repo, { executeGit }));
    expect(result).toMatchObject({ exitCode: 4, status: "incomplete" });
    expect(result.reason).toContain("branch evidence");
  });

  it("classifies unavailable worktree inventory as incomplete evidence", () => {
    const repo = repository();
    const executeGit = gitExecutor(repo, (args, _options, execute) => {
      if (args[0] === "worktree" && args[1] === "list")
        throw new Error("repository read token=secret");
      return execute();
    });
    const result = releaseDelivery(input(repo, { executeGit }));
    expect(result).toMatchObject({ exitCode: 4, status: "incomplete" });
    expect(JSON.stringify(result)).not.toContain("token=secret");
  });

  it("classifies a timed-out fetch as bounded incomplete evidence", () => {
    const repo = repository();
    const executeGit = gitExecutor(repo, (args, options, execute) => {
      if (args[0] === "fetch") {
        const error = new Error(`timed out token=${"s".repeat(5_000)}`);
        error.code = "ETIMEDOUT";
        throw error;
      }
      return execute();
    });
    const result = releaseDelivery(input(repo, { executeGit }));
    expect(result).toMatchObject({ exitCode: 4, status: "incomplete" });
    expect(JSON.stringify(result).length).toBeLessThan(2_000);
    expect(JSON.stringify(result)).not.toContain("token=");
  });

  it("classifies unavailable status and path reads as incomplete evidence", () => {
    const statusRepo = repository();
    const statusGit = gitExecutor(statusRepo, (args, _options, execute) => {
      if (args[0] === "status") throw new Error("status unavailable");
      return execute();
    });
    expect(
      releaseDelivery(input(statusRepo, { executeGit: statusGit })),
    ).toMatchObject({ exitCode: 4, status: "incomplete" });

    const pathRepo = repository();
    expect(
      releaseDelivery(
        input(pathRepo, {
          lstat: () => {
            throw new Error("path unavailable");
          },
        }),
      ),
    ).toMatchObject({ exitCode: 4, status: "incomplete" });
  });

  it("refuses self-release when the process cwd is nested inside the target", () => {
    const repo = repository();
    const nested = join(repo.secondary, "nested");
    mkdirSync(nested);
    const result = spawnSync(
      process.execPath,
      [
        resolve(import.meta.dirname, "release-delivery.mjs"),
        "--worktree",
        repo.secondary,
        "--branch",
        "topic",
        "--head",
        repo.head,
        "--pull-request",
        "74",
        "--writer-state",
        "stopped",
      ],
      { cwd: nested, encoding: "utf8" },
    );
    expect(result.status).toBe(3);
    expect(JSON.parse(result.stdout)).toMatchObject({
      exitCode: 3,
      status: "refused",
    });
    expect(existsSync(repo.secondary)).toBe(true);
  });

  it("refuses an origin whose effective fetch URL is rewritten", () => {
    const repo = repository();
    run(repo.primary, [
      "config",
      `url.${repo.remote}.insteadOf`,
      "https://github.com/zaingulel/RentCottage.git",
    ]);
    const runGh = github(repo);
    const result = releaseDelivery(input(repo, { runGh }));
    expect(result).toMatchObject({ exitCode: 3, status: "refused" });
    expect(result.reason).toContain("origin");
    expect(runGh).not.toHaveBeenCalled();
  });

  it("allows only reviewed generated ignored content and refuses an unlisted ignored path", () => {
    const allowed = repository();
    mkdirSync(join(allowed.secondary, "node_modules"));
    writeFileSync(
      join(allowed.secondary, "node_modules", "cache"),
      "generated",
    );
    expect(releaseDelivery(input(allowed))).toMatchObject({
      status: "released",
    });

    const unknown = repository();
    writeFileSync(
      join(unknown.secondary, ".gitignore"),
      "node_modules/\nprivate-output\n",
    );
    run(unknown.secondary, ["add", ".gitignore"]);
    run(unknown.secondary, ["commit", "-m", "ignore"]);
    const changedHead = run(unknown.secondary, ["rev-parse", "HEAD"]);
    run(unknown.primary, [
      "push",
      unknown.root + "/remote.git",
      "topic:topic",
      "--force",
    ]);
    run(unknown.primary, ["checkout", "main"]);
    run(unknown.primary, ["merge", "--no-ff", "topic", "-m", "merge ignore"]);
    run(unknown.primary, ["push", unknown.root + "/remote.git", "main"]);
    const mergeCommit = run(unknown.primary, ["rev-parse", "HEAD"]);
    writeFileSync(join(unknown.secondary, "private-output"), "secret");
    const result = releaseDelivery(
      input(unknown, {
        head: changedHead,
        runGh: github({ head: changedHead, mergeCommit }),
      }),
    );
    expect(result).toMatchObject({ exitCode: 3, status: "refused" });
    expect(result.reason).toContain("private-output");
  }, 15_000);

  it("allows the exact reviewed generated roots and files", () => {
    const repo = repository();
    for (const path of [
      "node_modules",
      ".next",
      ".open-next",
      ".wrangler",
      "test-results",
      "playwright-report",
      "coverage",
      "supabase/.branches",
      "supabase/.temp",
    ]) {
      mkdirSync(join(repo.secondary, path), { recursive: true });
      writeFileSync(join(repo.secondary, path, "generated"), "generated");
    }
    writeFileSync(join(repo.secondary, "next-env.d.ts"), "generated");
    writeFileSync(join(repo.secondary, "tsconfig.tsbuildinfo"), "generated");
    expect(releaseDelivery(input(repo))).toMatchObject({
      exitCode: 0,
      status: "released",
    });
  });

  it("treats an allowed generated path that vanishes after validation as removed", () => {
    const repo = repository();
    const generated = join(repo.secondary, ".next");
    mkdirSync(generated);
    writeFileSync(join(generated, "generated"), "generated");
    let generatedReads = 0;

    const result = releaseDelivery(
      input(repo, {
        lstat: (path) => {
          const stat = lstatSync(path);
          if (resolve(path) === generated && ++generatedReads === 2) {
            rmSync(generated, { force: true, recursive: true });
          }
          return stat;
        },
      }),
    );

    expect(result).toMatchObject({ exitCode: 0, status: "released" });
  });

  it("refuses an arbitrary ignored tsbuildinfo file", () => {
    const repo = repository();
    writeFileSync(join(repo.secondary, "secret.tsbuildinfo"), "secret");
    const result = releaseDelivery(input(repo));
    expect(result).toMatchObject({ exitCode: 3, status: "refused" });
    expect(result.reason).toContain("secret.tsbuildinfo");
  });

  it("unlinks an allowed nested Supabase root symlink without traversal", () => {
    const repo = repository();
    const external = join(repo.root, "supabase-external");
    mkdirSync(external);
    writeFileSync(join(external, "keep"), "keep");
    symlinkSync(external, join(repo.secondary, "supabase", ".branches"));
    expect(releaseDelivery(input(repo))).toMatchObject({ status: "released" });
    expect(readFileSync(join(external, "keep"), "utf8")).toBe("keep");
  });

  it("does not traverse a Supabase parent replaced by a symlink after validation", () => {
    const repo = repository();
    const generated = join(repo.secondary, "supabase", ".temp");
    const supabase = join(repo.secondary, "supabase");
    const external = join(repo.root, "supabase-parent-external");
    const externalGenerated = join(external, ".temp");
    mkdirSync(generated);
    writeFileSync(join(generated, "generated"), "generated");
    mkdirSync(externalGenerated, { recursive: true });
    writeFileSync(join(externalGenerated, "keep"), "keep");
    let generatedReads = 0;

    const result = releaseDelivery(
      input(repo, {
        lstat: (path) => {
          const stat = lstatSync(path);
          if (resolve(path) === generated && ++generatedReads === 2) {
            rmSync(supabase, { force: true, recursive: true });
            symlinkSync(external, supabase);
          }
          return stat;
        },
      }),
    );

    expect(result).not.toMatchObject({ status: "released" });
    expect(readFileSync(join(externalGenerated, "keep"), "utf8")).toBe("keep");
  });

  it("unlinks an allowed generated-root symlink without traversing its target", () => {
    const repo = repository();
    const external = join(repo.root, "external");
    mkdirSync(external);
    writeFileSync(join(external, "keep"), "keep");
    symlinkSync(external, join(repo.secondary, "node_modules"));
    expect(releaseDelivery(input(repo))).toMatchObject({ status: "released" });
    expect(readFileSync(join(external, "keep"), "utf8")).toBe("keep");
  });

  it("refuses an unknown symlink without traversing its target", () => {
    const repo = repository();
    const external = join(repo.root, "unknown-external");
    mkdirSync(external);
    writeFileSync(join(external, "keep"), "keep");
    symlinkSync(external, join(repo.secondary, "unknown-link"));
    const result = releaseDelivery(input(repo));
    expect(result).toMatchObject({ exitCode: 3, status: "refused" });
    expect(result.reason).toContain("unknown-link");
    expect(readFileSync(join(external, "keep"), "utf8")).toBe("keep");
  });

  it("recovers a branch-only partial state and supports an exact absent-state rerun", () => {
    const repo = repository();
    run(repo.primary, ["worktree", "remove", repo.secondary]);
    expect(releaseDelivery(input(repo))).toMatchObject({ status: "recovered" });
    expect(releaseDelivery(input(repo)).status).toBe("already-released");
    const staleEvidence = github({
      head: "a".repeat(40),
      mergeCommit: repo.mergeCommit,
    });
    expect(
      releaseDelivery(input(repo, { runGh: staleEvidence })),
    ).toMatchObject({ exitCode: 4, status: "incomplete" });
  });

  it("requires exact pull-request head and branch evidence", () => {
    const wrongHead = repository();
    const mismatched = releaseDelivery(
      input(wrongHead, {
        runGh: github({
          head: "a".repeat(40),
          mergeCommit: wrongHead.mergeCommit,
        }),
      }),
    );
    expect(mismatched).toMatchObject({ exitCode: 4, status: "incomplete" });
    expect(mismatched.reason).toContain("head OID");

    const wrongBranch = repository();
    const branchEvidence = github(wrongBranch, (value) => {
      value.data.repository.pullRequest.headRefName = "other";
      return value;
    });
    expect(
      releaseDelivery(input(wrongBranch, { runGh: branchEvidence })).reason,
    ).toContain("branch");
  });

  it("requires refreshed merge ancestry and merged state", () => {
    const wrongMerge = repository();
    const tree = run(wrongMerge.primary, ["rev-parse", "main^{tree}"]);
    const unrelated = run(wrongMerge.primary, [
      "commit-tree",
      tree,
      "-m",
      "unrelated",
    ]);
    const notAncestor = releaseDelivery(
      input(wrongMerge, {
        runGh: github({ head: wrongMerge.head, mergeCommit: unrelated }),
      }),
    );
    expect(notAncestor).toMatchObject({ exitCode: 4, status: "incomplete" });
    expect(notAncestor.reason).toContain("ancestor");

    const unmerged = repository();
    const openEvidence = github(unmerged, (value) => {
      value.data.repository.pullRequest.state = "OPEN";
      value.data.repository.pullRequest.mergedAt = null;
      return value;
    });
    expect(
      releaseDelivery(input(unmerged, { runGh: openEvidence })),
    ).toMatchObject({ exitCode: 4, status: "incomplete" });
  });

  it("requires same-repository schema-validated GitHub evidence", () => {
    const fork = repository();
    const forkEvidence = github(fork, (value) => {
      value.data.repository.pullRequest.headRepository.nameWithOwner =
        "outside/RentCottage";
      return value;
    });
    expect(
      releaseDelivery(input(fork, { runGh: forkEvidence })).reason,
    ).toContain("same repository");

    const malformed = repository();
    expect(
      releaseDelivery(
        input(malformed, { runGh: () => "token=secret malformed" }),
      ),
    ).toMatchObject({ exitCode: 4, status: "incomplete" });

    const unavailable = repository();
    const unavailableResult = releaseDelivery(
      input(unavailable, {
        runGh: () => {
          throw new Error("provider unavailable token=secret");
        },
      }),
    );
    expect(unavailableResult).toMatchObject({
      exitCode: 4,
      status: "incomplete",
    });
    expect(JSON.stringify(unavailableResult)).not.toContain("token=secret");

    const timedOut = repository();
    const timedOutResult = releaseDelivery(
      input(timedOut, {
        runGh: () => {
          const error = new Error(
            `provider timed out token=${"s".repeat(5_000)}`,
          );
          error.code = "ETIMEDOUT";
          throw error;
        },
      }),
    );
    expect(timedOutResult).toMatchObject({
      exitCode: 4,
      status: "incomplete",
    });
    expect(JSON.stringify(timedOutResult).length).toBeLessThan(2_000);
    expect(JSON.stringify(timedOutResult)).not.toContain("token=");
  });

  it("fails closed when the target changes during the immediate pre-mutation recheck", () => {
    const repo = repository();
    let statusReads = 0;
    const executeGit = gitExecutor(repo, (args, _options, execute) => {
      if (args[0] === "status" && ++statusReads === 2)
        writeFileSync(join(repo.secondary, "late.txt"), "late\n");
      return execute();
    });
    const result = releaseDelivery(input(repo, { executeGit }));
    expect(result).toMatchObject({ exitCode: 3, status: "refused" });
    expect(result.reason).toContain("late.txt");
    expect(run(repo.secondary, ["rev-parse", "HEAD"])).toBe(repo.head);
  });

  it.each([
    ["worktree+branch to branch-only", "worktree", "branch-only"],
    ["worktree+branch to both-absent", "worktree", "both-absent"],
    ["branch-only to both-absent", "branch-only", "both-absent"],
    ["both-absent to branch-only", "both-absent", "branch-only"],
    ["both-absent to worktree+branch", "both-absent", "worktree"],
    ["branch-only to worktree+branch", "branch-only", "worktree"],
  ])(
    "refuses a pre-mutation state transition: %s",
    (_name, before, after) => {
      const repo = repository();
      if (before !== "worktree")
        run(repo.primary, ["worktree", "remove", repo.secondary]);
      if (before === "both-absent")
        run(repo.primary, ["update-ref", "-d", "refs/heads/topic", repo.head]);
      let changed = false;
      const executeGit = gitExecutor(repo, (args, _options, execute) => {
        if (!changed && args[0] === "fetch") {
          changed = true;
          if (before === "worktree")
            run(repo.primary, ["worktree", "remove", repo.secondary]);
          if (after === "both-absent")
            run(repo.primary, [
              "update-ref",
              "-d",
              "refs/heads/topic",
              repo.head,
            ]);
          if (before === "both-absent")
            run(repo.primary, ["update-ref", "refs/heads/topic", repo.head]);
          if (after === "worktree")
            run(repo.primary, ["worktree", "add", repo.secondary, "topic"]);
        }
        return execute();
      });
      const result = releaseDelivery(input(repo, { executeGit }));
      expect(result).toMatchObject({ exitCode: 3, status: "refused" });
      expect(result.reason).toContain("changed before release");
      if (after === "worktree") expect(existsSync(repo.secondary)).toBe(true);
    },
    15_000,
  );

  it("retains a foreign directory that replaces the target during evidence collection", () => {
    const repo = repository();
    let replaced = false;
    const executeGit = gitExecutor(repo, (args, _options, execute) => {
      if (!replaced && args[0] === "fetch") {
        replaced = true;
        run(repo.primary, ["worktree", "remove", repo.secondary]);
        mkdirSync(repo.secondary);
        writeFileSync(join(repo.secondary, "keep"), "foreign");
      }
      return execute();
    });
    const result = releaseDelivery(input(repo, { executeGit }));
    expect(result).toMatchObject({ exitCode: 3, status: "refused" });
    expect(readFileSync(join(repo.secondary, "keep"), "utf8")).toBe("foreign");
  });

  it("applies finite timeouts at the default Git and GitHub subprocess boundaries", () => {
    const repo = repository();
    const fetchTimeouts = [];
    const githubTimeouts = [];
    const executeFile = (command, args, options) => {
      const effectiveArgs =
        args[0] === "fetch" && args[2] === "origin"
          ? [...args.slice(0, 2), repo.remote, ...args.slice(3)]
          : args;
      if (args[0] === "fetch") fetchTimeouts.push(options.timeout);
      return execFileSync(command, effectiveArgs, options);
    };
    const executeGh = (_command, _args, options) => {
      githubTimeouts.push(options.timeout);
      return github(repo)();
    };
    const result = releaseDelivery(
      input(repo, {
        executeGit: undefined,
        runGh: undefined,
        executeFile,
        executeGh,
      }),
    );
    expect(result).toMatchObject({ exitCode: 0, status: "released" });
    expect(fetchTimeouts).toEqual([30_000]);
    expect(githubTimeouts).toEqual([30_000]);
  });

  it("fails the mutation when target-path residue appears after worktree removal", () => {
    const repo = repository();
    const executeGit = gitExecutor(repo, (args, _options, execute) => {
      const result = execute();
      if (args[0] === "worktree" && args[1] === "remove") {
        mkdirSync(repo.secondary);
        writeFileSync(join(repo.secondary, "keep"), "residue");
      }
      return result;
    });
    const result = releaseDelivery(input(repo, { executeGit }));
    expect(result).toMatchObject({ exitCode: 5, status: "failed" });
    expect(result.reason).toContain("path remains");
    expect(readFileSync(join(repo.secondary, "keep"), "utf8")).toBe("residue");
  });

  it("retains the branch when atomic compare-delete detects a race", () => {
    const repo = repository();
    let raced = false;
    const executeGit = gitExecutor(repo, (args, _options, execute) => {
      if (!raced && args[0] === "update-ref" && args[1] === "-d") {
        raced = true;
        run(repo.primary, ["update-ref", "refs/heads/topic", repo.mergeCommit]);
      }
      return execute();
    });
    const result = releaseDelivery(input(repo, { executeGit }));
    expect(result).toMatchObject({ exitCode: 5, status: "failed" });
    expect(result.reason).toContain("retained branch");
    expect(run(repo.primary, ["rev-parse", "refs/heads/topic"])).toBe(
      repo.mergeCommit,
    );
  });

  it("retains a branch attached to another worktree after target removal", () => {
    const repo = repository();
    const replacement = join(repo.root, "replacement");
    let inventoryReads = 0;
    const executeGit = gitExecutor(repo, (args, _options, execute) => {
      if (
        args[0] === "worktree" &&
        args[1] === "list" &&
        ++inventoryReads === 3
      ) {
        run(repo.primary, ["worktree", "add", replacement, "topic"]);
      }
      return execute();
    });
    const result = releaseDelivery(input(repo, { executeGit }));
    expect(result).toMatchObject({ exitCode: 5, status: "failed" });
    expect(result.reason).toContain("another worktree");
    expect(run(repo.primary, ["rev-parse", "refs/heads/topic"])).toBe(
      repo.head,
    );
  });

  it("restores a branch attached after the last pre-delete inventory", () => {
    const repo = repository();
    const replacement = join(repo.root, "late-replacement");
    let branchReads = 0;
    const executeGit = gitExecutor(repo, (args, _options, execute) => {
      if (args[0] === "show-ref" && ++branchReads === 3) {
        run(repo.primary, ["worktree", "add", replacement, "topic"]);
      }
      return execute();
    });
    const result = releaseDelivery(input(repo, { executeGit }));
    expect(result).toMatchObject({ exitCode: 5, status: "failed" });
    expect(result.reason).toContain("restored branch");
    expect(run(repo.primary, ["rev-parse", "refs/heads/topic"])).toBe(
      repo.head,
    );
  });

  it("does not report success until final inventory and ref absence are observed", () => {
    const repo = repository();
    const executeGit = gitExecutor(repo, (args, _options, execute) => {
      if (args[0] === "update-ref" && args[1] === "-d") return "";
      return execute();
    });
    const result = releaseDelivery(input(repo, { executeGit }));
    expect(result).toMatchObject({ exitCode: 5, status: "failed" });
    expect(result.reason).toContain("incomplete");
    expect(run(repo.primary, ["rev-parse", "refs/heads/topic"])).toBe(
      repo.head,
    );
  });
});
