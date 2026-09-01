import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";

import { describeThrown } from "./lib/trap-safe-diagnostics.mjs";

const BROWSER_ENVIRONMENT_KEYS = [
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PATH",
  "TMPDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_RUNTIME_DIR",
];

export function browserEnvironment(environment = process.env) {
  return Object.fromEntries(
    BROWSER_ENVIRONMENT_KEYS.flatMap((key) =>
      typeof environment[key] === "string" ? [[key, environment[key]]] : [],
    ),
  );
}

export function classifyChromiumLaunchFailure(error) {
  const detail = describeThrown(error);
  const permissionDenied =
    /\b(?:EPERM|EACCES)\b|operation not permitted|permission denied/i.test(
      detail,
    );
  const category = permissionDenied
    ? "permission failure"
    : "infrastructure failure";
  return `Chromium preflight ${category}: ${detail}`;
}

export async function main({
  chromiumImpl = chromium,
  environment = process.env,
  stderr = console.error,
} = {}) {
  try {
    const browser = await chromiumImpl.launch({
      env: browserEnvironment(environment),
      headless: true,
    });
    await browser.close();
    return 0;
  } catch (error) {
    stderr(classifyChromiumLaunchFailure(error));
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main();
}
