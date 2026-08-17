import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const USAGE =
  "Usage: node scripts/write-preview-deployment-secrets.mjs <target-json-path>";

export function writePreviewDeploymentSecrets(target, source) {
  const secrets = {
    SUPABASE_SECRET_KEY: source.SUPABASE_SECRET_KEY,
    PRIVILEGED_AUDIT_HMAC_KEY: source.PRIVILEGED_AUDIT_HMAC_KEY,
  };
  if (
    Object.values(secrets).some(
      (value) => typeof value !== "string" || value.length === 0,
    )
  ) {
    throw new Error("A required preview deployment secret is absent");
  }
  writeFileSync(target, JSON.stringify(secrets), {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

export function main(
  args,
  { source = process.env, stderr = console.error } = {},
) {
  if (args.length !== 1 || !args[0]) {
    stderr(USAGE);
    return 2;
  }
  try {
    writePreviewDeploymentSecrets(args[0], source);
    return 0;
  } catch {
    stderr("Unable to prepare preview deployment secrets");
    return 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
