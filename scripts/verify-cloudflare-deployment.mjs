import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const USAGE =
  "Usage: npm run verify:cloudflare-deployment -- preview <40-character-commit>";

function requiredArray(value, description) {
  if (!Array.isArray(value)) {
    throw new Error(`Cloudflare ${description} response was malformed`);
  }
  return value;
}

export function verifyCloudflareDeployment(
  versionsValue,
  deploymentValue,
  expectedCommit,
) {
  const versions = requiredArray(versionsValue, "versions");
  const activeVersions = requiredArray(deploymentValue?.versions, "deployment");
  if (activeVersions.length !== 1 || activeVersions[0]?.percentage !== 100) {
    throw new Error("Expected one Cloudflare version serving 100% of traffic");
  }

  const versionId = activeVersions[0]?.version_id;
  const activeVersion = versions.find((version) => version?.id === versionId);
  if (!activeVersion) {
    throw new Error(
      "Active Cloudflare version was not present in versions list",
    );
  }
  if (activeVersion.annotations?.["workers/tag"] !== expectedCommit) {
    throw new Error(
      "Active Cloudflare version tag does not match expected commit",
    );
  }
  return { versionId };
}

function runWrangler(args) {
  return execFileSync("npx", ["wrangler", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function queryCloudflare(run, description, args) {
  let output;
  try {
    output = run(args);
  } catch {
    throw new Error(`Unable to query Cloudflare ${description}`);
  }
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`Cloudflare ${description} response was malformed`);
  }
}

export function main(
  args,
  { run = runWrangler, stderr = console.error, stdout = console.log } = {},
) {
  if (
    args.length !== 2 ||
    args[0] !== "preview" ||
    !/^[0-9a-f]{40}$/.test(args[1])
  ) {
    stderr(USAGE);
    return 2;
  }

  const [environment, expectedCommit] = args;
  try {
    const versions = queryCloudflare(run, "versions", [
      "versions",
      "list",
      "--env",
      environment,
      "--json",
    ]);
    const deployment = queryCloudflare(run, "deployment", [
      "deployments",
      "status",
      "--env",
      environment,
      "--json",
    ]);
    const { versionId } = verifyCloudflareDeployment(
      versions,
      deployment,
      expectedCommit,
    );
    stdout(
      `Verified Cloudflare preview version ${versionId} at commit ${expectedCommit}`,
    );
    return 0;
  } catch (error) {
    stderr(`Cloudflare deployment verification failed: ${error.message}`);
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
