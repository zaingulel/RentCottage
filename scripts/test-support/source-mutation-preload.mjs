import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function createSourceMutationPreload({ root, filename, mutations }) {
  const preloadPath = join(root, filename);
  writeFileSync(
    preloadPath,
    `import { registerHooks } from "node:module";

const mutations = ${JSON.stringify(mutations)};

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    const selected = mutations.filter((mutation) => mutation.targetUrl === url);
    if (selected.length === 0) return loaded;
    let source =
      typeof loaded.source === "string"
        ? loaded.source
        : Buffer.from(loaded.source).toString("utf8");
    for (const mutation of selected) {
      const occurrences = source.split(mutation.anchor).length - 1;
      if (occurrences !== 1) {
        throw new Error(\`Mutation anchor mismatch: \${mutation.label}\`);
      }
      source = source.replace(mutation.anchor, mutation.replacement);
    }
    return { ...loaded, source };
  },
});
`,
    { flag: "wx" },
  );
  return preloadPath;
}
