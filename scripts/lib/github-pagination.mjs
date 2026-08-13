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
