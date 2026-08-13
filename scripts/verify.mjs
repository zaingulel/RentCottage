import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const USAGE = "Usage: npm run verify";

export const verificationSteps = [
  ["npm", ["run", "audit:production"]],
  ["npm", ["run", "format:check"]],
  ["npm", ["run", "lint"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["test"]],
  ["npm", ["run", "verify:access"]],
  ["npm", ["run", "build:worker"]],
  ["npm", ["run", "scan:client-secrets"]],
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
  ["npm", ["run", "test:browser"]],
  ["npm", ["run", "smoke:preview"]],
];

const testEnvironment = {
  APP_ENVIRONMENT: "test",
  NEXTJS_ENV: "test",
  SUPABASE_PROJECT_REF: "local-test",
  SUPABASE_URL: "http://127.0.0.1:54331",
  SUPABASE_PUBLISHABLE_KEY: "local-test-publishable",
  SUPABASE_SECRET_KEY: "local-test-secret",
};

function runStep(command, args, environment) {
  return spawnSync(command, args, {
    env: environment,
    stdio: "inherit",
  });
}

export function main(
  args,
  { environment = process.env, run = runStep, stderr = console.error } = {},
) {
  if (args.length !== 0) {
    stderr(USAGE);
    return 2;
  }

  const verificationEnvironment = { ...environment, ...testEnvironment };
  for (const [command, commandArgs] of verificationSteps) {
    const result = run(command, commandArgs, verificationEnvironment);
    if (result.error) {
      stderr(`Unable to run ${command}: ${result.error.message}`);
      return 1;
    }
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
