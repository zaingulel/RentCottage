// docs-route.mjs: which changed paths may reach main without a pull request. A fail-closed
// allowlist: a path qualifies only at a listed documentation location, of a documentation or media
// type, and outside the shared factory files. scripts/gates/pre-push-main pipes the pushed paths to
// the CLI below.
//
// CLI: `docs-route.mjs`, newline-separated paths on stdin; prints each refusal to stderr; exits 1
// when any path is refused, none was given or the manifest cannot be read, else 0.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// The record directories docs/README.md indexes. docs/adr/ is left out: an accepted decision is an
// authority every plan follows. A new directory under docs/ qualifies only once it is listed here.
const LOCATIONS = [
  "docs/commercial/",
  "docs/design/",
  "docs/discovery/",
  "docs/engineering/",
  "docs/research/",
];
// The document index itself.
const DOCUMENTS = new Set(["docs/README.md"]);
// Each type is one scripts/verify.mjs runs on the baseline route alone when it sits under docs/.
const EXTENSIONS = new Set([
  "md",
  "docx",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
]);

function refusalReason(path, sharedFiles) {
  if (
    !DOCUMENTS.has(path) &&
    !LOCATIONS.some((location) => path.startsWith(location))
  ) {
    return "outside the documentation locations";
  }
  const extension = path.match(/\.([^./]+)$/)?.[1].toLowerCase();
  if (!EXTENSIONS.has(extension))
    return "not a documentation or media file type";
  if (sharedFiles.has(path)) return "a shared factory file";
  return null;
}

/** The refused paths, each with the first rule it fails; an empty list admits them all. */
export function docsRouteRefusals(paths, manifestPaths) {
  const sharedFiles = new Set(manifestPaths);
  return paths.flatMap((path) => {
    const reason = refusalReason(path, sharedFiles);
    return reason ? [{ path, reason }] : [];
  });
}

const MANIFEST_PATH = ".agents/factory-manifest.json";

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  let manifestPaths;
  // An unreadable or malformed manifest refuses: an empty list in its place would admit a shared document.
  try {
    const manifest = JSON.parse(
      readFileSync(
        fileURLToPath(new URL(`../../${MANIFEST_PATH}`, import.meta.url)),
        "utf8",
      ),
    );
    if (
      !Array.isArray(manifest.entries) ||
      manifest.entries.some(
        (entry) => typeof entry?.path !== "string" || entry.path === "",
      )
    ) {
      throw new Error("its entries are not a list of paths");
    }
    manifestPaths = manifest.entries.map((entry) => entry.path);
  } catch (error) {
    console.error(
      `docs-route: cannot read ${MANIFEST_PATH} (${error.message}); use the pull request route.`,
    );
    process.exit(1);
  }
  const paths = readFileSync(0, "utf8").split("\n").filter(Boolean);
  const refusals = docsRouteRefusals(paths, manifestPaths);
  if (paths.length === 0)
    console.error("docs-route: no changed paths to admit.");
  for (const { path, reason } of refusals)
    console.error(`docs-route: refused ${path}: ${reason}.`);
  if (paths.length === 0 || refusals.length > 0) {
    console.error(
      "docs-route: only qualifying documentation and media reach main directly; use the pull request route.",
    );
    process.exit(1);
  }
}
