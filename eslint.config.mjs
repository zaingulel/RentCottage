import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  // The workflow scripts are shared with the canonical repository and are linted under the rule
  // set they were written for.
  {
    files: [
      "scripts/**/*.mjs",
      ".claude/hooks/**/*.mjs",
      ".codex/hooks/**/*.mjs",
    ],
    rules: {
      ...js.configs.recommended.rules,

      // `catch {}` is used deliberately throughout to swallow expected errors.
      "no-empty": ["error", { allowEmptyCatch: true }],

      // These are standalone programs, so an unused first-party variable is a real defect and blocks.
      "no-unused-vars": [
        "error",
        {
          caughtErrors: "none",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          // `({ linkProblem, ...correction }) => correction` strips a property on purpose.
          ignoreRestSiblings: true,
        },
      ],

      // Matchers for aligned CLI output legitimately contain literal runs of spaces.
      "no-regex-spaces": "off",
    },
  },
  globalIgnores([
    ".next/**",
    ".open-next/**",
    ".wrangler/**",
    "test-results/**",
    "playwright-report/**",
    "cloudflare-env.d.ts",
  ]),
]);
