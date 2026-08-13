import { existsSync, readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

function filesWithin(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = `${path}/${entry.name}`;
    return entry.isDirectory() ? filesWithin(child) : [child];
  });
}

export function assertNoClientSecret(secret: string, roots: string[]) {
  if (!secret) throw new Error("Server credential is required");

  for (const root of roots) {
    if (!existsSync(root))
      throw new Error(`Client asset directory missing: ${root}`);

    for (const file of filesWithin(root)) {
      if (readFileSync(file).includes(Buffer.from(secret))) {
        throw new Error(`Server credential found in client asset: ${file}`);
      }
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const roots = process.argv.slice(2);
  assertNoClientSecret(process.env.SUPABASE_SECRET_KEY ?? "", roots);
  assertNoClientSecret(process.env.PRIVILEGED_AUDIT_HMAC_KEY ?? "", roots);
}
