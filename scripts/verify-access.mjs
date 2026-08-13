import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const USAGE = "Usage: npm run verify:access";
const EXCLUDED_SERVICES =
  "realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor";

function runStep(command, args, options) {
  return spawnSync(command, args, options);
}

function defaultRemoveTemp(path) {
  rmSync(path, { recursive: true, force: true });
}

function localCredentials(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const credentials = value;
  if (
    typeof credentials.API_URL !== "string" ||
    typeof credentials.PUBLISHABLE_KEY !== "string" ||
    typeof credentials.SECRET_KEY !== "string" ||
    !credentials.PUBLISHABLE_KEY ||
    !credentials.SECRET_KEY
  ) {
    return undefined;
  }
  try {
    const url = new URL(credentials.API_URL);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.hostname !== "127.0.0.1"
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return credentials;
}

export function main(
  args,
  {
    environment = process.env,
    makeTemp = () => mkdtempSync(join(tmpdir(), "rentcottage-docker-config-")),
    removeTemp = defaultRemoveTemp,
    run = runStep,
    stderr = console.error,
  } = {},
) {
  if (args.length !== 0) {
    stderr(USAGE);
    return 2;
  }

  const dockerConfig = makeTemp();
  const supabaseEnvironment = {
    ...environment,
    DOCKER_CONFIG: dockerConfig,
    SUPABASE_TELEMETRY_DISABLED: "1",
    DO_NOT_TRACK: "1",
  };
  let started = false;
  let exitCode = 0;

  const execute = (command, commandArgs, options = {}) => {
    const result = run(command, commandArgs, {
      env: supabaseEnvironment,
      stdio: "inherit",
      ...options,
    });
    if (result.error) {
      stderr(`Unable to run ${command}: ${result.error.message}`);
      return { ...result, status: 1 };
    }
    if (result.status !== 0) {
      if (result.stdout) stderr(String(result.stdout).trimEnd());
      if (result.stderr) stderr(String(result.stderr).trimEnd());
      stderr(
        `Failed: ${command} ${commandArgs.join(" ")} (status ${result.status ?? 1}).`,
      );
    }
    return { ...result, status: result.status ?? 1 };
  };

  const verify = () => {
    let result = execute(
      "npx",
      ["supabase", "start", "-x", EXCLUDED_SERVICES],
      { encoding: "utf8", stdio: "pipe" },
    );
    if (result.status !== 0) return result.status;
    started = true;

    result = execute("npx", ["supabase", "db", "reset", "--local"]);
    if (result.status !== 0) return result.status;

    result = execute("npx", ["supabase", "test", "db"]);
    if (result.status !== 0) return result.status;

    const status = execute("npx", ["supabase", "status", "-o", "json"], {
      encoding: "utf8",
      stdio: "pipe",
    });
    if (status.status !== 0) return status.status;

    let parsedCredentials;
    try {
      parsedCredentials = JSON.parse(status.stdout);
    } catch {
      stderr("Supabase returned unreadable local test credentials.");
      return 1;
    }
    const credentials = localCredentials(parsedCredentials);
    if (!credentials) {
      stderr("Supabase did not return valid local test credentials.");
      return 1;
    }
    const supabaseUrl = credentials.API_URL;
    const publishableKey = credentials.PUBLISHABLE_KEY;
    const secretKey = credentials.SECRET_KEY;
    const accessEnvironment = {
      ...supabaseEnvironment,
      SUPABASE_URL: supabaseUrl,
      SUPABASE_PUBLISHABLE_KEY: publishableKey,
      SUPABASE_SECRET_KEY: secretKey,
      PRIVILEGED_AUDIT_HMAC_KEY: "local-test-audit-hmac-key-32-characters",
    };
    const prepared = execute("node", ["scripts/prepare-access-test.mjs"], {
      env: accessEnvironment,
      stdio: "inherit",
    });
    if (prepared.status !== 0) return prepared.status;

    const browserEnvironment = {
      ...accessEnvironment,
      APP_ENVIRONMENT: "test",
      NEXTJS_ENV: "test",
      SUPABASE_PROJECT_REF: "local-test",
      PLAYWRIGHT_SERVER: "next",
    };
    const browser = execute(
      "npx",
      [
        "playwright",
        "test",
        "tests/access.spec.ts",
        "--project=mobile",
        "--project=desktop",
        "--workers=1",
      ],
      { env: browserEnvironment, stdio: "inherit" },
    );
    if (browser.status !== 0) return browser.status;

    const workerBrowser = execute(
      "npx",
      [
        "playwright",
        "test",
        "tests/access.spec.ts",
        "--project=worker",
        "--workers=1",
      ],
      {
        env: { ...browserEnvironment, PLAYWRIGHT_SERVER: "worker" },
        stdio: "inherit",
      },
    );
    return workerBrowser.status;
  };

  try {
    exitCode = verify();
  } finally {
    if (started) {
      const stopped = execute("npx", ["supabase", "stop", "--no-backup"], {
        encoding: "utf8",
        stdio: "pipe",
      });
      if (exitCode === 0 && stopped.status !== 0) {
        stderr("Local Supabase cleanup failed.");
        exitCode = stopped.status;
      }
    }
    removeTemp(dockerConfig);
  }
  return exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
