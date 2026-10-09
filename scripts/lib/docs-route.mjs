// docs-route.mjs: which changed paths may reach main without a pull request. A fail-closed
// allowlist: a path qualifies only at a listed documentation location, of a documentation or media
// type, and outside the shared factory files.

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
