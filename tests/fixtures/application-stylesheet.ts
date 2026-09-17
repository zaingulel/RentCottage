import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const stylesheet = join(process.cwd(), "src", "app", "globals.css");

/* The application relies on its bundler to resolve the relative @import rules in
   globals.css. A browser test injects the file as raw text, where nothing resolves
   them: the relative specifier is fetched against the page URL, 404s, and the whole
   injected sheet fails to load. Inline the imported files instead. */
export async function readApplicationStylesheet() {
  const source = await readFile(stylesheet, "utf8");
  let resolved = source;
  for (const [rule, specifier] of source.matchAll(/@import\s+"(\.[^"]+)";/g)) {
    resolved = resolved.replace(
      rule,
      await readFile(join(dirname(stylesheet), specifier), "utf8"),
    );
  }
  return resolved;
}
