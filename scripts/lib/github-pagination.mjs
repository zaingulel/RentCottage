const minimumGhVersion = [2, 48, 0];

export function assertSupportedGhVersion(versionOutput) {
  const match = versionOutput.match(/^gh version (\d+)\.(\d+)\.(\d+)/m);
  if (!match)
    throw new Error(
      "Unable to determine the GitHub CLI version; require 2.48.0 or newer",
    );
  const version = match.slice(1).map(Number);
  const firstDifference = version.findIndex(
    (part, index) => part !== minimumGhVersion[index],
  );
  const supported =
    firstDifference === -1 ||
    version[firstDifference] > minimumGhVersion[firstDifference];
  if (!supported)
    throw new Error(
      `GitHub CLI ${version.join(".")} is unsupported; require 2.48.0 or newer`,
    );
}

export function paginatedRestArgs(endpoint) {
  return [
    "api",
    "--paginate",
    "--slurp",
    "-H",
    "X-GitHub-Api-Version: 2022-11-28",
    endpoint,
  ];
}

export function parsePaginatedPages(serializedPages, context) {
  const pages = JSON.parse(serializedPages);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page)))
    throw new Error(`${context} pagination returned an unknown shape`);
  return pages.flat();
}
