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

const toleratedSection = (
  readFileSync(join(process.cwd(), "docs", "DESIGN-SYSTEM.md"), "utf8").match(
    /^## Tolerated literals\n([\s\S]*?)(?=^## )/m,
  )?.[1] ?? ""
).replace(/\s+/g, " ");
const listedDeclarations = new Set(
  [...toleratedSection.matchAll(/`([a-z-]+: [^`]+)`/g)].map(
    ([, declaration]) => declaration,
  ),
);
const listedTokens = new Set(
  [...toleratedSection.matchAll(/`--([\w-]+)`/g)].map(([, name]) => name),
);
const scaledProperty =
  /^(?:(?:margin|padding|inset)(?:-[a-z-]+)?|(?:row-|column-)?gap|top|right|bottom|left|font|font-size|line-height|letter-spacing)$/;
const scaleToken = /^(?:space|font-size)-\d+$/;

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

function lengthLiterals(property: string, value: string) {
  return [
    ...value
      .replace(/var\([^()]*\)|"[^"]*"|'[^']*'/g, blank)
      .replace(/,\s*[\d.]+v[a-z]+\s*,/g, blank)
      .matchAll(/(?<![\w.#-])-?\d*\.?\d+([a-z]+)/gi),
  ].filter(([, unit]) => !(property === "letter-spacing" && unit === "em"));
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

describe("stylesheet length tokens", () => {
  it("keeps every spacing and text size length on the scale or in the tolerated list", () => {
    const declarations = stylesheets.flatMap(({ file, source }) => {
      const rest =
        file === globalsFile ? source.replace(rootBlockPattern, blank) : source;
      return [...rest.matchAll(/([\w-]+)\s*:([^;{}]*)(?=[;}])/g)]
        .map((declaration) => ({
          property: declaration[1],
          value: declaration[2].replace(/\s+/g, " ").trim(),
          line: lineOf(rest, declaration.index),
        }))
        .filter(
          ({ property, value }) =>
            scaledProperty.test(property) &&
            !listedDeclarations.has(`${property}: ${value}`) &&
            lengthLiterals(property, value).length > 0,
        )
        .map(
          ({ property, value, line }) =>
            `${file}:${line} ${property}: ${value}`,
        );
    });
    const tokens = [...rootBlock.matchAll(/--([\w-]+)\s*:([^;{}]*)(?=[;}])/g)]
      .filter(
        ([, name, value]) =>
          !scaleToken.test(name) &&
          !listedTokens.has(name) &&
          lengthLiterals(`--${name}`, value).length > 0,
      )
      .map(([, name]) => `--${name}`);
    const hits = [...declarations, ...tokens];

    expect(hits).toEqual([]);
  });

  it("lists no tolerated length the stylesheets do not write", () => {
    const written = new Set(
      stylesheets.flatMap(({ source }) =>
        [...source.matchAll(/([\w-]+)\s*:([^;{}]*)(?=[;}])/g)].map(
          ([, property, value]) =>
            `${property}: ${value.replace(/\s+/g, " ").trim()}`,
        ),
      ),
    );
    const declared = new Set(
      [...rootBlock.matchAll(/--([\w-]+)\s*:/g)].map(([, name]) => name),
    );
    const stale = [
      ...[...listedDeclarations].filter(
        (declaration) => !written.has(declaration),
      ),
      ...[...listedTokens]
        .filter((name) => !declared.has(name))
        .map((name) => `--${name}`),
    ];

    expect(stale).toEqual([]);
  });
});
