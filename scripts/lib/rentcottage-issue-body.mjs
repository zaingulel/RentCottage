function normalizeBody(body) {
  return String(body ?? "").replaceAll("\r\n", "\n");
}

const canonicalBlockedBySectionPattern =
  /^## Blocked by\n\n([\s\S]*?)(?=\n\n(?:## |<!--)|(?![\s\S]))/m;

export function canonicalBlockedBySectionCount(body) {
  return [...normalizeBody(body).matchAll(/^## Blocked by\n\n/gm)].length;
}

export function canonicalBlockedByNumbers(body) {
  const section =
    canonicalBlockedBySectionPattern.exec(normalizeBody(body))?.[1] ?? "";
  return [...section.matchAll(/#(\d+)/g)].map((match) => Number(match[1]));
}

export function replaceCanonicalBlockedBySection(body, replacement) {
  const normalized = normalizeBody(body);
  const replaced = normalized.replace(
    canonicalBlockedBySectionPattern,
    String(replacement).trimEnd(),
  );
  return normalized.endsWith("\n") && !replaced.endsWith("\n")
    ? `${replaced}\n`
    : replaced;
}
