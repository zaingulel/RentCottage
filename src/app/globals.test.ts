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

const globalsFile = join("app", "globals.css");
const rootBlockPattern = /:root\s*\{[^}]*\}/;
const rootBlock =
  stylesheets
    .find(({ file }) => file === globalsFile)
    ?.source.match(rootBlockPattern)?.[0] ?? "";

const tolerated = new Set([
  "transparent",
  "currentcolor",
  "inherit",
  "initial",
  "unset",
  "revert",
]);
const probe = document.createElement("span");

function blank(text: string) {
  return text.replace(/[^\n]/g, " ");
}

function isNamedColour(word: string) {
  const lower = word.toLowerCase();
  const property = lower.replace(/-([a-z])/g, (_, letter) =>
    letter.toUpperCase(),
  );
  if (tolerated.has(lower) || property in probe.style) return false;
  probe.style.color = "";
  probe.style.color = word;
  return probe.style.color !== "";
}

function lineOf(source: string, index: number) {
  return source.slice(0, index).split("\n").length;
}

describe("stylesheet colour tokens", () => {
  it("keeps every stylesheet colour in the :root token block", () => {
    const hits = stylesheets.flatMap(({ file, source }) => {
      const rest = (
        file === globalsFile ? source.replace(rootBlockPattern, blank) : source
      ).replace(/box-shadow:(?!\s*0 0 0 )[^;]+;/g, blank);
      const literals = [
        ...rest.matchAll(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/gi),
      ].map((match) => `${file}:${lineOf(rest, match.index)} ${match[0]}`);
      const named = [...rest.matchAll(/[\w-]+\s*:([^;{}]*)(?=[;}])/g)].flatMap(
        (declaration) => {
          const value = declaration[1].replace(
            /var\([^()]*\)|url\([^)]*\)|"[^"]*"|'[^']*'/g,
            blank,
          );
          const start =
            declaration.index + declaration[0].length - value.length;
          return [...value.matchAll(/(?<![\w#.-])[a-z][\w-]*/gi)]
            .filter(([word]) => isNamedColour(word))
            .map(
              (match) =>
                `${file}:${lineOf(rest, start + match.index)} ${match[0]}`,
            );
        },
      );
      return [...literals, ...named];
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
