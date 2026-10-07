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
const rootBlock = rootBlockOf(stylesheets);

const tolerated = new Set([
  "transparent",
  "currentcolor",
  "inherit",
  "initial",
  "unset",
  "revert",
]);
const probe = document.createElement("span");

const designSystem = readFileSync(
  join(process.cwd(), "docs", "DESIGN-SYSTEM.md"),
  "utf8",
);
const toleratedSection = (
  designSystem.match(/^## Tolerated literals\n([\s\S]*?)(?=^## )/m)?.[1] ?? ""
).replace(/\s+/g, " ");
const listedRules = new Set(
  [...toleratedSection.matchAll(/`([^`]+ \{ [^`]+ \})`/g)].map(
    ([, rule]) => rule,
  ),
);
const listedTokens = new Set(
  [...toleratedSection.matchAll(/`--([\w-]+)`/g)].map(([, name]) => name),
);
const scaledProperty =
  /^(?:(?:margin|padding|inset)(?:-[a-z-]+)?|(?:row-|column-)?gap|top|right|bottom|left|font|font-size|line-height|letter-spacing)$/;
const scaleToken =
  /^(?:(?:space|font-size)-\d+|radius-(?:control|card|mark)|shadow-(?:focus|invalid|pressed))$/;

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

function ruleSelector(source: string, index: number) {
  let open = index - 1;
  for (let depth = 0; open >= 0; open--) {
    if (source[open] === "}") depth++;
    else if (source[open] === "{" && depth-- === 0) break;
  }
  const start = Math.max(
    ...["{", "}", ";"].map((mark) => source.lastIndexOf(mark, open - 1)),
  );
  return source
    .slice(start + 1, open)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/ ?, ?/g, ", ");
}

function lengthLiterals(property: string, value: string) {
  return [
    ...value
      .replace(/var\(\s*--[\w-]+\s*\)|"[^"]*"|'[^']*'/g, blank)
      .replace(
        /(clamp\((?:[^(),]|\([^()]*\))*,\s*)([\d.]+v[a-z]+)(?=\s*,(?:[^(),]|\([^()]*\))*\))/g,
        (_, first, middle) => first + blank(middle),
      )
      .matchAll(/(?<![\w.#-])-?\d*\.?\d+([a-z]+)/gi),
  ].filter(([, unit]) => !(property === "letter-spacing" && unit === "em"));
}

function rootBlockOf(sheets: typeof stylesheets) {
  return (
    sheets
      .find(({ file }) => file === globalsFile)
      ?.source.match(rootBlockPattern)?.[0] ?? ""
  );
}

function lengthHits(sheets: typeof stylesheets) {
  const declarations = sheets.flatMap(({ file, source }) => {
    const rest =
      file === globalsFile ? source.replace(rootBlockPattern, blank) : source;
    return [...rest.matchAll(/([\w-]+)\s*:([^;{}]*)(?=[;}])/g)]
      .map((declaration) => ({
        property: declaration[1],
        value: declaration[2].replace(/\s+/g, " ").trim(),
        index: declaration.index,
      }))
      .filter(
        ({ property, value, index }) =>
          (property.startsWith("--") ||
            (scaledProperty.test(property) &&
              !listedRules.has(
                `${ruleSelector(rest, index)} { ${property}: ${value} }`,
              ))) &&
          lengthLiterals(property, value).length > 0,
      )
      .map(
        ({ property, value, index }) =>
          `${file}:${lineOf(rest, index)} ${property}: ${value}`,
      );
  });
  const tokens = [
    ...rootBlockOf(sheets).matchAll(/--([\w-]+)\s*:([^;{}]*)(?=[;}])/g),
  ]
    .filter(
      ([, name, value]) =>
        !scaleToken.test(name) &&
        !listedTokens.has(name) &&
        lengthLiterals(`--${name}`, value).length > 0,
    )
    .map(([, name]) => `--${name}`);
  return [...declarations, ...tokens];
}

function offScaleHits(property: RegExp, allowedTerm: RegExp): string[] {
  return stylesheets.flatMap(({ file, source }) =>
    [...source.matchAll(/([\w-]+)\s*:([^;{}]*)(?=[;}])/g)]
      .map((declaration) => ({
        name: declaration[1],
        value: declaration[2].replace(/\s+/g, " ").trim(),
        index: declaration.index,
      }))
      .filter(
        ({ name, value }) =>
          property.test(name) &&
          value.split(" ").some((term) => !allowedTerm.test(term)),
      )
      .map(
        ({ name, value, index }) =>
          `${file}:${lineOf(source, index)} ${name}: ${value}`,
      ),
  );
}

describe("stylesheet colour tokens", () => {
  it("keeps every stylesheet colour in the :root token block", () => {
    const hits = stylesheets.flatMap(({ file, source }) => {
      const rest =
        file === globalsFile ? source.replace(rootBlockPattern, blank) : source;
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
    expect(lengthHits(stylesheets)).toEqual([]);
  });

  const scaleRoot =
    ":root { --space-3: 0.75rem; --space-1: 0.25rem; --space-4: 1rem; }";

  it("refuses a viewport length outside the middle term of clamp()", () => {
    const source = `${scaleRoot}\n.x { padding: max(var(--space-1), 10vw, var(--space-4)); }`;

    expect(lengthHits([{ file: globalsFile, source }])).toEqual([
      `${globalsFile}:2 padding: max(var(--space-1), 10vw, var(--space-4))`,
    ]);
  });

  it("refuses a length in a var() fallback", () => {
    const source = `${scaleRoot}\n.x { padding: var(--space-3, 0.7rem); }`;

    expect(lengthHits([{ file: globalsFile, source }])).toEqual([
      `${globalsFile}:2 padding: var(--space-3, 0.7rem)`,
    ]);
  });

  it("refuses a length-bearing custom property outside :root", () => {
    const source = `${scaleRoot}\n.x { --space-3: 0.7rem; padding: var(--space-3); }`;

    expect(lengthHits([{ file: globalsFile, source }])).toEqual([
      `${globalsFile}:2 --space-3: 0.7rem`,
    ]);
  });

  it("refuses a listed exception on a rule the document does not name", () => {
    const source = `${scaleRoot}\n.x { padding-block: 11rem 8.5rem; }`;

    expect(lengthHits([{ file: globalsFile, source }])).toEqual([
      `${globalsFile}:2 padding-block: 11rem 8.5rem`,
    ]);
  });

  it("lists no tolerated length the stylesheets do not write", () => {
    const written = new Set(
      stylesheets.flatMap(({ source }) =>
        [...source.matchAll(/([\w-]+)\s*:([^;{}]*)(?=[;}])/g)].map(
          (declaration) =>
            `${ruleSelector(source, declaration.index)} { ${declaration[1]}: ${declaration[2].replace(/\s+/g, " ").trim()} }`,
        ),
      ),
    );
    const declared = new Set(
      [...rootBlock.matchAll(/--([\w-]+)\s*:/g)].map(([, name]) => name),
    );
    const stale = [
      ...[...listedRules].filter((rule) => !written.has(rule)),
      ...[...listedTokens]
        .filter((name) => !declared.has(name))
        .map((name) => `--${name}`),
    ];

    expect(stale).toEqual([]);
  });
});

describe("stylesheet shape and layer tokens", () => {
  it("keeps every corner radius on the radius scale or a tolerated shape", () => {
    expect(
      offScaleHits(
        /^border-(?:[a-z-]+-)?radius$/,
        /^(?:var\(--radius-[a-z]+\)|999px|50%|0|inherit)$/,
      ),
    ).toEqual([]);
  });

  it("keeps the pill off selectable options", () => {
    const pills = stylesheets.flatMap(({ source }) =>
      [...source.matchAll(/border-radius:\s*999px/g)].map((match) =>
        ruleSelector(source, match.index),
      ),
    );

    expect(pills.length).toBeGreaterThan(0);
    expect(
      pills.filter((selector) =>
        /\.action-toggle|\.amenity-options/.test(selector),
      ),
    ).toEqual([]);
  });

  it("keeps every box shadow a state ring token", () => {
    expect(
      offScaleHits(/^box-shadow$/, /^(?:var\(--shadow-[a-z]+\)|none|inherit)$/),
    ).toEqual([]);
  });

  it("keeps every z-index a stacking order token", () => {
    expect(
      offScaleHits(/^z-index$/, /^(?:var\(--layer-[a-z]+\)|0|auto|inherit)$/),
    ).toEqual([]);
  });

  it("declares the agreed radius sizes and offset-free state rings", () => {
    const declared = [
      ...rootBlock.matchAll(/--([\w-]+)\s*:([^;{}]*)(?=[;}])/g),
    ].map(
      ([, name, value]) => `--${name}: ${value.replace(/\s+/g, " ").trim()}`,
    );
    const rings = declared.filter((token) => token.startsWith("--shadow-"));

    expect(declared.filter((token) => token.startsWith("--radius-"))).toEqual(
      expect.arrayContaining([
        "--radius-control: 0.5rem",
        "--radius-mark: 0.25rem",
        "--radius-card: 0.625rem",
      ]),
    );
    expect(rings.map((token) => token.split(":")[0])).toEqual(
      expect.arrayContaining([
        "--shadow-focus",
        "--shadow-invalid",
        "--shadow-pressed",
      ]),
    );
    expect(
      rings.filter(
        (token) =>
          !/^--[\w-]+: (?:inset )?0 0 0 \d+px var\(--[a-z-]+\)$/.test(token),
      ),
    ).toEqual([]);
  });
});

describe("stylesheet breakpoints", () => {
  it("uses exactly the breakpoints the design system lists", () => {
    const section =
      designSystem.match(
        /^## Breakpoints\n([\s\S]*?)(?=^## |(?![\s\S]))/m,
      )?.[1] ?? "";
    const listed = [...section.matchAll(/`(\d*\.?\d+rem)`/g)].map(
      ([, value]) => value,
    );
    const allowed = new Set(listed.map((value) => `(max-width: ${value})`));
    const conditions = stylesheets.flatMap(({ file, source }) =>
      [...source.matchAll(/@media\s*([^{]+)\{/gi)].map((query) => ({
        condition: query[1].replace(/\s+/g, " ").trim().toLowerCase(),
        where: `${file}:${lineOf(source, query.index)}`,
      })),
    );
    const unlisted = conditions
      .filter(
        ({ condition }) =>
          condition.includes("width") && !allowed.has(condition),
      )
      .map(({ condition, where }) => `${where} ${condition}`);
    const used = new Set(conditions.map(({ condition }) => condition));
    const unused = listed.filter((value) => !used.has(`(max-width: ${value})`));

    expect(unlisted).toEqual([]);
    expect(unused).toEqual([]);
  });
});
