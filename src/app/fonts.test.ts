import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const appDirectory = join(process.cwd(), "src", "app");
const fontDirectory = join(process.cwd(), "public", "fonts");

function stylesheet(name: string) {
  return readFileSync(join(appDirectory, name), "utf8");
}

// The three subsets Google's css2 API defines for these families: a provider
// contract under the testing strategy's rule 4, not a copy of anything this
// repository computes. Arabic and Sorani Kurdish depend on the Arabic one, and
// a regeneration that narrows it is the change hardest to notice by eye.
const arabicRange =
  "U+0600-06FF, U+0750-077F, U+0870-088E, U+0890-0891, U+0897-08E1, U+08E3-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC, U+102E0-102FB, U+10E60-10E7E, U+10EC2-10EC4, U+10EFC-10EFF, U+1EE00-1EE03, U+1EE05-1EE1F, U+1EE21-1EE22, U+1EE24, U+1EE27, U+1EE29-1EE32, U+1EE34-1EE37, U+1EE39, U+1EE3B, U+1EE42, U+1EE47, U+1EE49, U+1EE4B, U+1EE4D-1EE4F, U+1EE51-1EE52, U+1EE54, U+1EE57, U+1EE59, U+1EE5B, U+1EE5D, U+1EE5F, U+1EE61-1EE62, U+1EE64, U+1EE67-1EE6A, U+1EE6C-1EE72, U+1EE74-1EE77, U+1EE79-1EE7C, U+1EE7E, U+1EE80-1EE89, U+1EE8B-1EE9B, U+1EEA1-1EEA3, U+1EEA5-1EEA9, U+1EEAB-1EEBB, U+1EEF0-1EEF1";
const latinRange =
  "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD";
const latinExtendedRange =
  "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF";

function declaredFaces() {
  const source = stylesheet("fonts.css");
  return [...source.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
    family: body.match(/font-family:\s*"([^"]+)"/)?.[1],
    weight: body.match(/font-weight:\s*(\d+)/)?.[1],
    display: body.match(/font-display:\s*(\w+)/)?.[1],
    file: body.match(/url\("\/fonts\/([^"]+)"\)/)?.[1],
    range: body.match(/unicode-range:\s*([^;]+);/)?.[1].replace(/\s+/g, " "),
  }));
}

describe("self-hosted web fonts", () => {
  it("serves every face from this origin", () => {
    const sources = ["globals.css", "fonts.css"].map(stylesheet).join("\n");

    expect(sources).not.toMatch(/@import\s+(?:url\()?["']?https?:/);
    expect(sources).not.toMatch(/url\(["']?https?:/);
  });

  it("imports the faces into the application stylesheet", () => {
    expect(stylesheet("globals.css")).toMatch(/@import\s+"\.\/fonts\.css";/);
  });

  it("points every face at a font file that exists", () => {
    const faces = declaredFaces();

    expect(
      faces.map((face) => `${face.family} ${face.weight} ${face.file}`),
    ).toEqual([
      "Almarai 400 almarai-400-arabic.woff2",
      "Almarai 400 almarai-400-latin.woff2",
      "Almarai 700 almarai-700-arabic.woff2",
      "Almarai 700 almarai-700-latin.woff2",
      "Almarai 800 almarai-800-arabic.woff2",
      "Almarai 800 almarai-800-latin.woff2",
      "Changa 500 changa-arabic.woff2",
      "Changa 500 changa-latin-ext.woff2",
      "Changa 500 changa-latin.woff2",
      "Changa 600 changa-arabic.woff2",
      "Changa 600 changa-latin-ext.woff2",
      "Changa 600 changa-latin.woff2",
      "Changa 700 changa-arabic.woff2",
      "Changa 700 changa-latin-ext.woff2",
      "Changa 700 changa-latin.woff2",
      "Karla 400 karla-latin-ext.woff2",
      "Karla 400 karla-latin.woff2",
      "Karla 500 karla-latin-ext.woff2",
      "Karla 500 karla-latin.woff2",
      "Karla 600 karla-latin-ext.woff2",
      "Karla 600 karla-latin.woff2",
      "Karla 700 karla-latin-ext.woff2",
      "Karla 700 karla-latin.woff2",
    ]);
    for (const face of faces) {
      expect(existsSync(join(fontDirectory, face.file!))).toBe(true);
      expect(face.display).toBe("swap");
    }
  });

  it("keeps every subset on the character range its script needs", () => {
    const ranges = new Map<string, Set<string>>();
    for (const face of declaredFaces()) {
      const subset = face.file!.match(/-(arabic|latin-ext|latin)\.woff2$/)?.[1];
      expect(face.range).toBeDefined();
      ranges.set(subset!, (ranges.get(subset!) ?? new Set()).add(face.range!));
    }

    // Pinning the ranges themselves, not just their consistency, is what makes
    // this "preserved": regenerating fonts.css rewrites every face of a subset
    // at once, so a narrowed subset stays self-consistent and would otherwise
    // pass. Compare block by block, or the red is two 600-character strings
    // side by side and the reader has to find the difference by eye.
    expect(
      Object.fromEntries(
        [...ranges].map(([subset, seen]) => [
          subset,
          [...seen].map((range) => range.split(", ")),
        ]),
      ),
    ).toEqual({
      arabic: [arabicRange.split(", ")],
      latin: [latinRange.split(", ")],
      "latin-ext": [latinExtendedRange.split(", ")],
    });
  });

  it("declares the weights the design tokens depend on", () => {
    const weights = new Map<string, string[]>();
    for (const face of declaredFaces()) {
      const seen = weights.get(face.family!) ?? [];
      if (!seen.includes(face.weight!)) seen.push(face.weight!);
      weights.set(face.family!, seen);
    }

    const declared = Object.fromEntries(
      [...weights].map(([family, values]) => [family, [...values].sort()]),
    );

    expect(declared).toEqual({
      Almarai: ["400", "700", "800"],
      Changa: ["500", "600", "700"],
      Karla: ["400", "500", "600", "700"],
    });
  });

  it("ships the licence for every redistributed family", () => {
    for (const family of ["almarai", "changa", "karla"]) {
      const licence = readFileSync(
        join(fontDirectory, `OFL-${family}.txt`),
        "utf8",
      );
      expect(licence).toContain("SIL Open Font License, Version 1.1");
    }
  });
});
