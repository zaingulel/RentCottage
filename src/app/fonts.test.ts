import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const appDirectory = join(process.cwd(), "src", "app");
const fontDirectory = join(process.cwd(), "public", "fonts");

function stylesheet(name: string) {
  return readFileSync(join(appDirectory, name), "utf8");
}

function declaredFaces() {
  const source = stylesheet("fonts.css");
  return [...source.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(([, body]) => ({
    family: body.match(/font-family:\s*"([^"]+)"/)?.[1],
    weight: body.match(/font-weight:\s*(\d+)/)?.[1],
    display: body.match(/font-display:\s*(\w+)/)?.[1],
    file: body.match(/url\("\/fonts\/([^"]+)"\)/)?.[1],
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
      expect(face.file).toBeDefined();
      expect(existsSync(join(fontDirectory, face.file!))).toBe(true);
      expect(face.display).toBe("swap");
    }
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
