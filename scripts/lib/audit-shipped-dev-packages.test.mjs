// audit-shipped-dev-packages.test.mjs — the shipped development-package audit's whole contract.
//
// Each test writes its own lockfile to a temporary directory and injects a hand-written
// `npm audit --json` report, so no network or real audit runs. The report shape (vulnerabilities
// keyed by name, `nodes` install paths, `via` mixing transitive strings and advisory objects) is
// the one measured on this repository.
//
// Run: node --test scripts/lib/audit-shipped-dev-packages.test.mjs

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../audit-shipped-dev-packages.mjs";

const ADAPTER_ADVISORY = {
  source: 1112935,
  name: "@opennextjs/cloudflare",
  title: "@opennextjs/cloudflare has a server-side request forgery issue",
  url: "https://github.com/advisories/GHSA-c7mq-gh6q-6q7c",
  severity: "high",
  range: "<1.17.1",
};

function lockfile({ adapterVersion = "1.20.2", omit = undefined } = {}) {
  const packages = {
    "": { name: "rentcottage" },
    "node_modules/@opennextjs/aws": { version: "4.1.0", dev: true },
    "node_modules/@opennextjs/cloudflare": {
      version: adapterVersion,
      dev: true,
    },
    "node_modules/path-to-regexp": { version: "6.3.0", dev: true },
    "node_modules/router/node_modules/path-to-regexp": {
      version: "8.4.2",
      dev: true,
    },
    "node_modules/wrangler": { version: "4.0.0", dev: true },
  };
  if (omit) delete packages[omit];
  return { lockfileVersion: 3, packages };
}

function audit(vulnerabilities) {
  return JSON.stringify({ auditReportVersion: 2, vulnerabilities });
}

function entry(name, nodes, via) {
  return { name, nodes, via, severity: "high", isDirect: false };
}

function check({ lock = lockfile(), report = audit({}), status = 0 } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "audit-shipped-dev-"));
  try {
    writeFileSync(join(cwd, "package-lock.json"), JSON.stringify(lock));
    const calls = [];
    const stdout = [];
    const stderr = [];
    const code = main([], {
      cwd,
      run: (command, commandArgs, runCwd) => {
        calls.push([command, commandArgs, runCwd]);
        return { status, signal: null, stdout: report, stderr: "" };
      },
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });
    return { code, calls, stdout, stderr, cwd };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe("shipped development-package audit", () => {
  test("a high advisory on the shipped Cloudflare adapter fails and names its url", () => {
    const result = check({
      report: audit({
        "@opennextjs/cloudflare": entry(
          "@opennextjs/cloudflare",
          ["node_modules/@opennextjs/cloudflare"],
          [ADAPTER_ADVISORY],
        ),
      }),
    });

    assert.equal(result.code, 1);
    assert.deepEqual(result.calls, [
      [
        "npm",
        ["audit", "--json", "--package-lock-only", "--audit-level=none"],
        result.cwd,
      ],
    ]);
    assert.equal(result.stderr.length, 1);
    assert.match(result.stderr[0], /node_modules\/@opennextjs\/cloudflare/);
    assert.match(result.stderr[0], /high/);
    assert.match(result.stderr[0], /<1\.17\.1/);
    assert.ok(
      result.stderr[0].includes(
        "https://github.com/advisories/GHSA-c7mq-gh6q-6q7c",
      ),
    );
  });

  test("a high advisory on an unshipped path-to-regexp copy passes", () => {
    const result = check({
      report: audit({
        "path-to-regexp": entry(
          "path-to-regexp",
          ["node_modules/router/node_modules/path-to-regexp"],
          [
            {
              source: 1,
              name: "path-to-regexp",
              title: "path-to-regexp backtracking",
              url: "https://github.com/advisories/GHSA-example",
              severity: "high",
              range: ">=8.0.0 <8.5.0",
            },
          ],
        ),
      }),
    });

    assert.equal(result.code, 0);
    assert.deepEqual(result.stderr, []);
    assert.deepEqual(result.stdout, [
      "No moderate-or-higher advisories on the 3 shipped development install paths.",
    ]);
  });

  test("a shipped package flagged only through a transitive dependency passes", () => {
    const result = check({
      report: audit({
        "@opennextjs/aws": entry(
          "@opennextjs/aws",
          ["node_modules/@opennextjs/aws"],
          ["brace-expansion"],
        ),
      }),
    });

    assert.equal(result.code, 0);
    assert.deepEqual(result.stderr, []);
  });

  test("a moderate advisory on an unshipped development package passes", () => {
    const result = check({
      report: audit({
        wrangler: entry(
          "wrangler",
          ["node_modules/wrangler"],
          [
            {
              source: 2,
              name: "wrangler",
              title: "wrangler issue",
              url: "https://github.com/advisories/GHSA-wrangler",
              severity: "moderate",
              range: "<5.0.0",
            },
          ],
        ),
      }),
    });

    assert.equal(result.code, 0);
    assert.deepEqual(result.stderr, []);
  });

  test("a low advisory on a shipped development package passes", () => {
    const result = check({
      report: audit({
        "@opennextjs/aws": entry(
          "@opennextjs/aws",
          ["node_modules/@opennextjs/aws"],
          [
            {
              source: 3,
              name: "@opennextjs/aws",
              title: "@opennextjs/aws minor issue",
              url: "https://github.com/advisories/GHSA-low",
              severity: "low",
              range: "<5.0.0",
            },
          ],
        ),
      }),
    });

    assert.equal(result.code, 0);
    assert.deepEqual(result.stderr, []);
  });

  test("an adapter version the shipped list was not derived for is incomplete evidence and never audits", () => {
    const result = check({ lock: lockfile({ adapterVersion: "1.21.0" }) });

    assert.equal(result.code, 2);
    assert.deepEqual(result.calls, []);
    assert.equal(result.stderr.length, 1);
    assert.match(result.stderr[0], /1\.21\.0/);
    assert.match(result.stderr[0], /1\.20\.2/);
  });

  test("incomplete evidence exits 2", async (t) => {
    const cases = [
      {
        name: "a missing listed install path",
        input: { lock: lockfile({ omit: "node_modules/path-to-regexp" }) },
        audited: false,
        message: /node_modules\/path-to-regexp/,
      },
      {
        name: "non-JSON audit output",
        input: { report: "npm ERR! something" },
        audited: true,
        message: /JSON/,
      },
      {
        name: "a non-zero audit status",
        input: { status: 1 },
        audited: true,
        message: /status 1/,
      },
      {
        name: "an unknown severity",
        input: {
          report: audit({
            "path-to-regexp": entry(
              "path-to-regexp",
              ["node_modules/path-to-regexp"],
              [{ ...ADAPTER_ADVISORY, severity: "severe" }],
            ),
          }),
        },
        audited: true,
        message: /severe/,
      },
      {
        name: "an entry whose nodes is not an array",
        input: {
          report: audit({
            "@opennextjs/cloudflare": entry("@opennextjs/cloudflare", null, [
              ADAPTER_ADVISORY,
            ]),
            wrangler: entry("wrangler", ["node_modules/wrangler"], []),
          }),
        },
        audited: true,
        message: /@opennextjs\/cloudflare/,
      },
    ];
    for (const { name, input, audited, message } of cases) {
      await t.test(name, () => {
        const result = check(input);

        assert.equal(result.code, 2);
        assert.equal(result.calls.length, audited ? 1 : 0);
        assert.equal(result.stderr.length, 1);
        assert.match(result.stderr[0], message);
        assert.deepEqual(result.stdout, []);
      });
    }
  });
});
