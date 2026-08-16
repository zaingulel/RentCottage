#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { lstatSync, rmSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { boundedDiagnostic, runGh as runGithubCli } from "./lib/github-cli.mjs";

const EXIT = Object.freeze({
  invalid: 2,
  refused: 3,
  incomplete: 4,
  failed: 5,
});
const OID = /^[0-9a-f]{40}$/;
const SAFE_BRANCH_CHARACTERS = /^[^\x00-\x20\x7f~^:?*[\\]+$/;
const ALLOWED_IGNORED_ROOTS = new Set([
  "node_modules",
  ".next",
  ".open-next",
  ".wrangler",
  "test-results",
  "playwright-report",
  "coverage",
]);
const ALLOWED_NESTED_IGNORED_ROOTS = new Set([
  "supabase/.branches",
  "supabase/.temp",
]);
const ALLOWED_IGNORED_FILES = new Set([
  "next-env.d.ts",
  "tsconfig.tsbuildinfo",
]);
const MAX_TARGET_LENGTH = 1_024;
const GIT_TIMEOUT_MS = 30_000;

class EvidenceError extends Error {}

function validBranch(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1_024 ||
    value === "@" ||
    value.startsWith("-") ||
    value.endsWith("/") ||
    value.endsWith(".") ||
    value.includes("..") ||
    value.includes("//") ||
    value.includes("@{") ||
    !SAFE_BRANCH_CHARACTERS.test(value)
  )
    return false;
  return value
    .split("/")
    .every(
      (component) =>
        component.length > 0 &&
        !component.startsWith(".") &&
        !component.endsWith(".lock"),
    );
}

const diagnostic = (exitCode, status, target, reason) => ({
  exitCode,
  status,
  target: String(target ?? "<invalid target>")
    .replace(/[\r\n\0]+/g, " ")
    .slice(0, MAX_TARGET_LENGTH),
  reason: boundedDiagnostic(reason, 500),
});

function validateInput(input) {
  if (!input || typeof input !== "object") return "input is required";
  if (typeof input.worktree !== "string" || !isAbsolute(input.worktree))
    return "--worktree must be an absolute path";
  if (input.worktree.length > MAX_TARGET_LENGTH)
    return "--worktree exceeds the supported path length";
  if (resolve(input.worktree) !== input.worktree)
    return "--worktree must be normalized";
  if (!validBranch(input.branch))
    return "--branch is not an exact local branch name";
  if (typeof input.head !== "string" || !OID.test(input.head))
    return "--head must be a full lowercase commit OID";
  if (!Number.isSafeInteger(input.pullRequest) || input.pullRequest < 1)
    return "--pull-request must be a positive integer";
  if (!new Set(["stopped", "active", "unknown"]).has(input.writerState))
    return "--writer-state must be stopped, active, or unknown";
  return null;
}

function git(executeGit, cwd, args, encoding = "utf8") {
  return executeGit(args, { cwd, encoding, stdio: ["ignore", "pipe", "pipe"] });
}

function parseWorktrees(value) {
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
  if (!text.endsWith("\0\0"))
    throw new Error("worktree inventory is incomplete");
  const records = text
    .split("\0\0")
    .filter(Boolean)
    .map((record) => {
      const result = {};
      for (const line of record.split("\0")) {
        if (!line) continue;
        const space = line.indexOf(" ");
        const key = space === -1 ? line : line.slice(0, space);
        const value = space === -1 ? true : line.slice(space + 1);
        if (Object.hasOwn(result, key))
          throw new Error("worktree inventory has duplicate fields");
        result[key] = value;
      }
      if (
        typeof result.worktree !== "string" ||
        typeof result.HEAD !== "string" ||
        !OID.test(result.HEAD)
      ) {
        throw new Error("worktree inventory contains a malformed record");
      }
      if (
        result.branch !== undefined &&
        (typeof result.branch !== "string" ||
          !result.branch.startsWith("refs/heads/"))
      ) {
        throw new Error("worktree inventory contains a malformed branch");
      }
      const known = new Set([
        "worktree",
        "HEAD",
        "branch",
        "detached",
        "locked",
        "prunable",
        "bare",
      ]);
      if (Object.keys(result).some((key) => !known.has(key)))
        throw new Error("worktree inventory contains an unknown field");
      return result;
    });
  if (records.length === 0) throw new Error("worktree inventory is empty");
  if (new Set(records.map((record) => record.worktree)).size !== records.length)
    throw new Error("worktree inventory contains duplicate paths");
  return records;
}

function inventory(executeGit, cwd) {
  try {
    return parseWorktrees(
      git(executeGit, cwd, ["worktree", "list", "--porcelain", "-z"]),
    );
  } catch (error) {
    throw new EvidenceError(
      error instanceof EvidenceError
        ? error.message
        : "worktree inventory evidence is unavailable or malformed",
    );
  }
}

function localHead(executeGit, cwd, branch) {
  try {
    git(executeGit, cwd, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ]);
  } catch (error) {
    if (error?.status === 1) return null;
    throw new EvidenceError("local branch evidence is unavailable");
  }
  try {
    return String(
      git(executeGit, cwd, [
        "rev-parse",
        "--verify",
        `refs/heads/${branch}^{commit}`,
      ]),
    ).trim();
  } catch {
    throw new EvidenceError("local branch evidence is unavailable");
  }
}

function targetRecord(records, target) {
  return records.find((record) => record.worktree === target) ?? null;
}

function assertTargetInventory(records, target, branch, primary) {
  if (target === primary) throw new Error("the primary worktree is retained");
  const record = targetRecord(records, target);
  if (!record) return null;
  if (record.detached || !record.branch)
    throw new Error("detached target worktree is retained");
  if (record.locked) throw new Error("locked target worktree is retained");
  if (record.prunable) throw new Error("prunable target worktree is retained");
  if (record.bare) throw new Error("bare target worktree is retained");
  if (record.branch !== `refs/heads/${branch}`)
    throw new Error("target worktree branch does not match --branch");
  if (
    records.some(
      (candidate) => candidate !== record && candidate.branch === record.branch,
    )
  ) {
    throw new Error("the branch is used by another worktree");
  }
  return record;
}

function repositoryTopLevel(executeGit, cwd) {
  try {
    return String(
      git(executeGit, cwd, ["rev-parse", "--show-toplevel"]),
    ).trim();
  } catch {
    throw new EvidenceError("current checkout identity is unavailable");
  }
}

function observePath(target, readStat = lstatSync) {
  try {
    const stat = readStat(target);
    return { device: stat.dev, inode: stat.ino, directory: stat.isDirectory() };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new EvidenceError("target path evidence is unavailable");
  }
}

function samePathIdentity(left, right) {
  if (left === null || right === null) return left === right;
  return (
    left.device === right.device &&
    left.inode === right.inode &&
    left.directory === right.directory
  );
}

function normalizedStatusPath(path) {
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function generatedEntry(path) {
  const normalized = normalizedStatusPath(path);
  if (ALLOWED_IGNORED_FILES.has(normalized)) return normalized;
  for (const root of [
    ...ALLOWED_IGNORED_ROOTS,
    ...ALLOWED_NESTED_IGNORED_ROOTS,
  ]) {
    if (normalized === root || normalized.startsWith(`${root}/`)) return root;
  }
  return null;
}

function allowedIgnoredPath(target, path, readStat) {
  const absolute = resolve(target, path);
  const within = relative(target, absolute);
  if (within.startsWith(`..${sep}`) || within === ".." || isAbsolute(within))
    return false;
  const root = generatedEntry(within);
  if (root && !ALLOWED_IGNORED_FILES.has(root)) {
    const rootStat = readStat(resolve(target, root));
    return rootStat.isDirectory() || rootStat.isSymbolicLink();
  }
  if (root && ALLOWED_IGNORED_FILES.has(root))
    return readStat(absolute).isFile();
  return false;
}

function allowedGeneratedSymlink(target, path, readStat) {
  const root = generatedEntry(path);
  return Boolean(
    root &&
    !ALLOWED_IGNORED_FILES.has(root) &&
    normalizedStatusPath(path) === root &&
    readStat(resolve(target, path)).isSymbolicLink(),
  );
}

function cleanGeneratedPaths(executeGit, target, readStat) {
  let raw;
  try {
    raw = git(executeGit, target, [
      "status",
      "--porcelain=v1",
      "-z",
      "--ignored=matching",
      "--untracked-files=all",
    ]);
  } catch {
    throw new EvidenceError("target status evidence is unavailable");
  }
  const entries = String(raw).split("\0").filter(Boolean);
  const paths = [];
  for (const entry of entries) {
    const code = entry.slice(0, 2);
    const path = entry.slice(3);
    try {
      if (code === "!!" && allowedIgnoredPath(target, path, readStat)) {
        paths.push(path);
        continue;
      }
      if (code === "??" && allowedGeneratedSymlink(target, path, readStat)) {
        paths.push(path);
        continue;
      }
    } catch {
      throw new EvidenceError("target path evidence is unavailable");
    }
    throw new Error(
      `target worktree is retained because of ${path.slice(0, 200) || "unknown status"}`,
    );
  }
  return paths;
}

function removeAllowedGeneratedContent(target, paths) {
  for (const path of paths) {
    rmSync(resolve(target, path), { recursive: true });
  }
}

function parseGithubEvidence(raw, expected) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    throw new Error("GitHub returned malformed evidence");
  }
  if (parsed?.errors !== undefined)
    throw new Error("GitHub evidence contains provider errors");
  const repository = parsed?.data?.repository;
  const pullRequest = repository?.pullRequest;
  const fields = [
    repository?.nameWithOwner,
    repository?.defaultBranchRef?.name,
    pullRequest?.headRefName,
    pullRequest?.headRefOid,
    pullRequest?.headRepository?.nameWithOwner,
    pullRequest?.baseRefName,
    pullRequest?.baseRepository?.nameWithOwner,
    pullRequest?.mergeCommit?.oid,
  ];
  if (
    !pullRequest ||
    fields.some((field) => typeof field !== "string") ||
    pullRequest.number !== expected.pullRequest ||
    pullRequest.state !== "MERGED" ||
    typeof pullRequest.mergedAt !== "string" ||
    Number.isNaN(Date.parse(pullRequest.mergedAt)) ||
    !validBranch(repository.defaultBranchRef.name) ||
    !OID.test(pullRequest.mergeCommit.oid)
  ) {
    throw new Error("GitHub evidence is incomplete or malformed");
  }
  if (
    repository.nameWithOwner !== "zaingulel/RentCottage" ||
    pullRequest.headRepository.nameWithOwner !== repository.nameWithOwner ||
    pullRequest.baseRepository.nameWithOwner !== repository.nameWithOwner
  )
    throw new Error("pull request is not from the same repository");
  if (pullRequest.baseRefName !== repository.defaultBranchRef.name)
    throw new Error("pull request did not target the default branch");
  if (pullRequest.headRefName !== expected.branch)
    throw new Error("pull request branch does not match --branch");
  if (pullRequest.headRefOid !== expected.head)
    throw new Error("pull request head OID does not match --head");
  return {
    defaultBranch: repository.defaultBranchRef.name,
    mergeCommit: pullRequest.mergeCommit.oid,
  };
}

function defaultGithub(args) {
  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){nameWithOwner defaultBranchRef{name} pullRequest(number:$number){number state headRefName headRefOid headRepository{nameWithOwner} baseRefName baseRepository{nameWithOwner} mergedAt mergeCommit{oid}}}}`;
  return runGithubCli(
    [
      "api",
      "--hostname",
      "github.com",
      "graphql",
      "-f",
      `query=${query}`,
      "-F",
      "owner=zaingulel",
      "-F",
      "name=RentCottage",
      "-F",
      `number=${args.pullRequest}`,
    ],
    { execute: args.executeGh, timeoutMs: GIT_TIMEOUT_MS },
  );
}

function verifyOrigin(executeGit, cwd) {
  let configured;
  let effective;
  try {
    configured = String(
      git(executeGit, cwd, ["config", "--get", "remote.origin.url"]),
    )
      .trim()
      .replace(/\.git$/, "");
    effective = String(git(executeGit, cwd, ["remote", "get-url", "origin"]))
      .trim()
      .replace(/\.git$/, "");
  } catch {
    throw new EvidenceError("origin identity evidence is unavailable");
  }
  const expected =
    /^(?:https:\/\/github\.com\/|git@github\.com:)zaingulel\/RentCottage$/;
  if (!expected.test(configured) || !expected.test(effective)) {
    throw new Error("origin is not the verified RentCottage repository");
  }
}

function observedState(record, branchHead) {
  if (record) return "worktree+branch";
  if (branchHead) return "branch-only";
  return "both-absent";
}

function localFailure(error, target) {
  if (error instanceof EvidenceError)
    return diagnostic(EXIT.incomplete, "incomplete", target, error.message);
  return diagnostic(EXIT.refused, "refused", target, error.message);
}

export function releaseDelivery(input) {
  const invalid = validateInput(input);
  if (invalid)
    return diagnostic(EXIT.invalid, "invalid", input?.worktree, invalid);
  const target = input.worktree;
  if (input.writerState !== "stopped")
    return diagnostic(
      EXIT.refused,
      "refused",
      target,
      `writer-state=${input.writerState}; coordinator must establish stopped ownership`,
    );
  const executeGit =
    input.executeGit ??
    ((args, options) =>
      (input.executeFile ?? execFileSync)("git", args, {
        ...options,
        maxBuffer: 4 * 1024 * 1024,
        timeout: GIT_TIMEOUT_MS,
      }));
  const cwd = input.cwd ?? process.cwd();
  const readStat = input.lstat ?? lstatSync;
  let records;
  let primary;
  let record;
  let branchHead;
  let initialStatus;
  let initialState;
  let initialPath;
  let coordinationTop;
  let processTop;
  try {
    records = inventory(executeGit, cwd);
    primary = records[0].worktree;
    coordinationTop = repositoryTopLevel(executeGit, cwd);
    processTop = repositoryTopLevel(executeGit, process.cwd());
    if (target === primary) throw new Error("the primary worktree is retained");
    if (coordinationTop === target || processTop === target)
      throw new Error("the current worktree is retained");
    record = assertTargetInventory(records, target, input.branch, primary);
    initialPath = observePath(target, readStat);
    if (!record && initialPath)
      throw new Error("unregistered or foreign target path is retained");
    if (record && (!initialPath || !initialPath.directory))
      throw new Error("registered target path identity is invalid");
    branchHead = localHead(executeGit, cwd, input.branch);
    if (record && !branchHead)
      throw new Error("worktree exists but its local branch is absent");
    if (record && (record.HEAD !== input.head || branchHead !== input.head))
      throw new Error("local target or branch head does not match --head");
    if (!record && branchHead && branchHead !== input.head)
      throw new Error("retained branch head does not match --head");
    if (record) cleanGeneratedPaths(executeGit, target, readStat);
    initialState = observedState(record, branchHead);
    initialStatus = record
      ? "released"
      : branchHead
        ? "recovered"
        : "already-released";
    verifyOrigin(executeGit, cwd);
  } catch (error) {
    return localFailure(error, target);
  }

  let evidence;
  let rawEvidence;
  try {
    rawEvidence = (input.runGh ?? defaultGithub)(input);
  } catch {
    return diagnostic(
      EXIT.incomplete,
      "incomplete",
      target,
      "GitHub evidence is unavailable",
    );
  }
  try {
    evidence = parseGithubEvidence(rawEvidence, input);
  } catch (error) {
    return diagnostic(EXIT.incomplete, "incomplete", target, error.message);
  }

  try {
    git(executeGit, cwd, [
      "fetch",
      "--no-tags",
      "origin",
      `+refs/heads/${evidence.defaultBranch}:refs/remotes/origin/${evidence.defaultBranch}`,
    ]);
    git(executeGit, cwd, [
      "merge-base",
      "--is-ancestor",
      evidence.mergeCommit,
      `refs/remotes/origin/${evidence.defaultBranch}`,
    ]);
  } catch {
    return diagnostic(
      EXIT.incomplete,
      "incomplete",
      target,
      "verified pull request merge is not an ancestor of refreshed origin default branch",
    );
  }

  let generatedPaths = [];
  try {
    records = inventory(executeGit, cwd);
    if (records[0].worktree !== primary)
      throw new Error("primary worktree identity changed before release");
    if (
      repositoryTopLevel(executeGit, cwd) !== coordinationTop ||
      repositoryTopLevel(executeGit, process.cwd()) !== processTop ||
      coordinationTop === target ||
      processTop === target
    )
      throw new Error("current worktree identity changed before release");
    record = assertTargetInventory(records, target, input.branch, primary);
    branchHead = localHead(executeGit, cwd, input.branch);
    const currentPath = observePath(target, readStat);
    const currentState = observedState(record, branchHead);
    if (currentState !== initialState)
      throw new Error("target state changed before release");
    if (!samePathIdentity(currentPath, initialPath))
      throw new Error("target path identity changed before release");
    if (record && branchHead === input.head && record.HEAD === input.head)
      generatedPaths = cleanGeneratedPaths(executeGit, target, readStat);
    else if (record || (branchHead && branchHead !== input.head))
      throw new Error("target state changed before release");
  } catch (error) {
    return localFailure(error, target);
  }

  try {
    if (record) {
      removeAllowedGeneratedContent(target, generatedPaths);
      git(executeGit, cwd, ["worktree", "remove", "--", target]);
    }
    records = inventory(executeGit, cwd);
    if (targetRecord(records, target))
      throw new Error("target worktree remains after removal");
    if (observePath(target, readStat))
      throw new Error("target path remains after worktree removal");
    if (
      records.some(
        (candidate) => candidate.branch === `refs/heads/${input.branch}`,
      )
    )
      throw new Error("retained branch is used by another worktree");

    branchHead = localHead(executeGit, cwd, input.branch);
    if (branchHead) {
      try {
        git(executeGit, cwd, [
          "update-ref",
          "-d",
          `refs/heads/${input.branch}`,
          input.head,
        ]);
      } catch {
        throw new Error(
          "worktree removed but retained branch after compare-delete race",
        );
      }
    }
    records = inventory(executeGit, cwd);
    const attachedAfterDelete = records.find(
      (candidate) => candidate.branch === `refs/heads/${input.branch}`,
    );
    if (attachedAfterDelete) {
      try {
        git(executeGit, cwd, [
          "update-ref",
          `refs/heads/${input.branch}`,
          input.head,
          "0".repeat(40),
        ]);
      } catch {
        if (localHead(executeGit, cwd, input.branch) !== input.head)
          throw new Error(
            "branch attached to another worktree and exact restoration failed",
          );
      }
      throw new Error(
        "restored branch attached to another worktree after compare-delete race",
      );
    }
    if (
      targetRecord(records, target) ||
      localHead(executeGit, cwd, input.branch) ||
      observePath(target, readStat)
    )
      throw new Error(
        "release mutation is incomplete; target or branch retained",
      );
    return diagnostic(0, initialStatus, target, "verified release complete");
  } catch (error) {
    return diagnostic(EXIT.failed, "failed", target, error.message);
  }
}

function parseCli(argv) {
  const allowed = new Set([
    "worktree",
    "branch",
    "head",
    "pull-request",
    "writer-state",
  ]);
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    if (
      !token?.startsWith("--") ||
      index + 1 >= argv.length ||
      !allowed.has(token.slice(2)) ||
      Object.hasOwn(values, token.slice(2))
    )
      return null;
    values[token.slice(2)] = argv[index + 1];
  }
  return {
    worktree: values.worktree,
    branch: values.branch,
    head: values.head,
    pullRequest: /^\d+$/.test(values["pull-request"] ?? "")
      ? Number(values["pull-request"])
      : NaN,
    writerState: values["writer-state"],
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const parsed = parseCli(process.argv.slice(2));
  const result = parsed
    ? releaseDelivery(parsed)
    : diagnostic(
        EXIT.invalid,
        "invalid",
        undefined,
        "expected exact named arguments",
      );
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.exitCode;
}
