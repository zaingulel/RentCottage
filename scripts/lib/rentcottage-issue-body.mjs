function normalizeBody(body) {
  return String(body ?? "").replaceAll("\r\n", "\n");
}

export function canonicalBlockedBySectionCount(body) {
  return [...normalizeBody(body).matchAll(/(?:^|\n)## Blocked by\n\n/g)].length;
}

export function canonicalBlockedByNumbers(body) {
  const section =
    normalizeBody(body)
      .split("## Blocked by\n\n")[1]
      ?.split(/\n\n(?:## |<!--)/)[0] ?? "";
  return [...section.matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
}
