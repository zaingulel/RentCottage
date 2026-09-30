import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const USAGE = "Usage: npm run audit:shipped-dev";

// Read from the built Worker bundle (`npm run build:worker`, then the `node_modules/...` names inside
// `.open-next`); re-derive both when the adapter version changes.
const SHIPPED_DEV_PACKAGE_PATHS = [
  "node_modules/@opennextjs/aws",
  "node_modules/@opennextjs/cloudflare",
  "node_modules/path-to-regexp",
];
const SHIPPED_LIST_ADAPTER_VERSION = "1.20.2";

const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

function runAudit(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function main(
  args,
  {
    cwd = process.cwd(),
    run = runAudit,
    stdout = console.log,
    stderr = console.error,
  } = {},
) {
  if (args.length > 0) {
    stderr(USAGE);
    return 2;
  }

  let lockText;
  try {
    lockText = readFileSync(join(cwd, "package-lock.json"), "utf8");
  } catch (error) {
    stderr(`Unable to read package-lock.json: ${error.message}`);
    return 2;
  }
  const packages = parseJson(lockText)?.packages;
  if (!isPlainObject(packages)) {
    stderr("package-lock.json is not JSON with a packages object.");
    return 2;
  }
  const missing = SHIPPED_DEV_PACKAGE_PATHS.filter((path) => !packages[path]);
  if (missing.length > 0) {
    stderr(`package-lock.json has no ${missing.join(", ")}.`);
    return 2;
  }
  const adapterVersion =
    packages["node_modules/@opennextjs/cloudflare"].version;
  if (adapterVersion !== SHIPPED_LIST_ADAPTER_VERSION) {
    stderr(
      `@opennextjs/cloudflare is ${adapterVersion} but the shipped development packages were derived for ${SHIPPED_LIST_ADAPTER_VERSION}: rebuild the Worker, re-derive them from .open-next, and update both constants in scripts/audit-shipped-dev-packages.mjs.`,
    );
    return 2;
  }

  const result = run(
    "npm",
    ["audit", "--json", "--package-lock-only", "--audit-level=none"],
    cwd,
  );
  if (result.error) {
    stderr(`Unable to run npm audit: ${result.error.message}`);
    return 2;
  }
  if (result.signal) {
    stderr(`Unable to run npm audit: terminated by ${result.signal}`);
    return 2;
  }
  if (result.status !== 0) {
    stderr(`npm audit exited with status ${result.status}.`);
    return 2;
  }
  const report = parseJson(result.stdout);
  if (!isPlainObject(report)) {
    stderr("npm audit did not print a JSON report.");
    return 2;
  }
  if ("error" in report) {
    stderr("npm audit reported an error instead of an audit.");
    return 2;
  }
  if (!isPlainObject(report.vulnerabilities)) {
    stderr("npm audit report has no vulnerabilities object.");
    return 2;
  }

  const findings = [];
  for (const { nodes, via } of Object.values(report.vulnerabilities)) {
    const shippedPaths = SHIPPED_DEV_PACKAGE_PATHS.filter((path) =>
      nodes?.includes(path),
    );
    if (shippedPaths.length === 0) continue;
    // String `via` entries name vulnerable dependencies; only objects are advisories on this package.
    for (const advisory of via.filter(isPlainObject)) {
      if (!Object.hasOwn(SEVERITY_RANK, advisory.severity)) {
        stderr(
          `npm audit reported unknown severity "${advisory.severity}" for ${advisory.url}.`,
        );
        return 2;
      }
      if (SEVERITY_RANK[advisory.severity] >= SEVERITY_RANK.moderate) {
        findings.push(
          ...shippedPaths.map(
            (path) =>
              `${path}: ${advisory.severity} ${advisory.title} (${advisory.url}), affects ${advisory.range}`,
          ),
        );
      }
    }
  }

  if (findings.length > 0) {
    findings.forEach((finding) => stderr(finding));
    return 1;
  }
  stdout(
    `No moderate-or-higher advisories on the ${SHIPPED_DEV_PACKAGE_PATHS.length} shipped development install paths.`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
