import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const sourceDirectory = join(process.cwd(), "src");

const stylesheets = readdirSync(sourceDirectory, { recursive: true })
  .map(String)
  .filter((file) => file.endsWith(".css"))
  .map((file) => ({
    file,
    source: readFileSync(join(sourceDirectory, file), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      (comment) => comment.replace(/[^\n]/g, " "),
    ),
  }));

const rootBlockPattern = /:root\s*\{[^}]*\}/;
const rootBlock =
  stylesheets
    .find(({ file }) => file === join("app", "globals.css"))
    ?.source.match(rootBlockPattern)?.[0] ?? "";

function lineOf(source: string, index: number) {
  return source.slice(0, index).split("\n").length;
}

describe("stylesheet colour tokens", () => {
  it("keeps every stylesheet colour in the :root token block", () => {
    const hits = stylesheets.flatMap(({ file, source }) => {
      const rest = source
        .replace(rootBlockPattern, (block) => block.replace(/[^\n]/g, " "))
        .replace(/box-shadow:(?!\s*0 0 0 )[^;]+;/g, (shadow) =>
          shadow.replace(/[^\n]/g, " "),
        );
      return [
        ...rest.matchAll(
          /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(|:\s*(?:white|black)\s*;/gi,
        ),
      ].map((match) => `${file}:${lineOf(rest, match.index)} ${match[0]}`);
    });

    expect(rootBlock).not.toBe("");
    expect(hits).toEqual([]);
  });

  it("declares every custom property a stylesheet uses", () => {
    const declared = new Set(
      [...rootBlock.matchAll(/--([\w-]+)\s*:/g)].map(([, name]) => name),
    );
    const undeclared = stylesheets.flatMap(({ file, source }) =>
      [...source.matchAll(/var\(--([\w-]+)/g)]
        .filter(([, name]) => !declared.has(name))
        .map((match) => `${file}:${lineOf(source, match.index)} --${match[1]}`),
    );

    expect(undeclared).toEqual([]);
  });
});
