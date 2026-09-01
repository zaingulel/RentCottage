import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createSourceMutationPreload } from "./test-support/source-mutation-preload.mjs";
import {
  runFixtureContractCommand,
  runPricingProofWithRestoration,
} from "./verify-access-fixture-contract.mjs";

function pricingSnapshot() {
  return [
    {
      unitId: "shift-1",
      unitKind: "shift",
      standardPriceIqd: 180000,
      weekdayOverrides: [{ priceIqd: 181000, weekday: 1 }],
      dateOverrides: [{ priceIqd: 182000, serviceDay: "2099-01-11" }],
    },
    {
      unitId: "shift-2",
      unitKind: "shift",
      standardPriceIqd: 190000,
      weekdayOverrides: [{ priceIqd: 192000, weekday: 2 }],
      dateOverrides: [{ priceIqd: 194000, serviceDay: "2099-01-12" }],
    },
    {
      unitId: "bundle-1",
      unitKind: "full_day_bundle",
      standardPriceIqd: 250000,
      weekdayOverrides: [{ priceIqd: 253000, weekday: 3 }],
      dateOverrides: [{ priceIqd: 256000, serviceDay: "2099-01-13" }],
    },
  ];
}

const falsyThrownValues = [undefined, null, 0, false];
const dualFalsyFailures = [
  [undefined, null],
  [null, 0],
  [0, false],
  [false, undefined],
];

async function captureRejection(operation) {
  let rejected = false;
  let value;
  try {
    await operation();
  } catch (error) {
    rejected = true;
    value = error;
  }
  return { rejected, value };
}

function expectPristineIndependentSnapshot(
  snapshot,
  expected,
  originalPricing,
) {
  expect(snapshot).toEqual(expected);
  expect(snapshot).not.toBe(originalPricing);
  expect(snapshot[0].weekdayOverrides).not.toBe(
    originalPricing[0].weekdayOverrides,
  );
  expect(snapshot[0].dateOverrides).not.toBe(originalPricing[0].dateOverrides);
}

function hostileMainMutation(targetUrl) {
  return {
    anchor: "async function main() {\n",
    label: "fixture-contract hostile main",
    replacement: `async function main() {
  const hostileFailure = new Proxy(Object.create(null), {
    get() {
      throw new Error("hostile property trap must not escape");
    },
    getPrototypeOf() {
      throw new Error("hostile prototype trap must not escape");
    },
  });
  throw hostileFailure;
`,
    targetUrl,
  };
}

function runFixtureContractExecutableGuard(guardMutation) {
  const root = mkdtempSync(
    join(tmpdir(), "rentcottage-issue-147-fixture-guard-"),
  );
  const executablePath = resolve(
    process.cwd(),
    "scripts/verify-access-fixture-contract.mjs",
  );
  const targetUrl = pathToFileURL(executablePath).href;
  const preloadPath = createSourceMutationPreload({
    filename: "source-mutation-preload.mjs",
    mutations: [
      hostileMainMutation(targetUrl),
      ...(guardMutation ? [{ ...guardMutation, targetUrl }] : []),
    ],
    root,
  });
  let result;
  try {
    result = spawnSync(
      process.execPath,
      ["--import", preloadPath, executablePath],
      { encoding: "utf8", env: process.env },
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
  return { ...result, rootRemoved: !existsSync(root) };
}

function hasSafeExecutableFailureSignature(result) {
  return (
    result.error === undefined &&
    result.status === 1 &&
    result.signal === null &&
    result.stdout === "" &&
    result.stderr.trimEnd() === "<unprintable thrown value>"
  );
}

describe("Worker pricing proof restoration", () => {
  it("restores a pristine independent snapshot after a successful proof", async () => {
    const expected = pricingSnapshot();
    const originalPricing = pricingSnapshot();
    let liveState = structuredClone(originalPricing);
    const prove = vi.fn(async () => {
      liveState[0].standardPriceIqd = 1;
      originalPricing[0].weekdayOverrides[0].priceIqd = 2;
    });
    const restore = vi.fn(async (snapshot) => {
      expectPristineIndependentSnapshot(snapshot, expected, originalPricing);
      liveState = structuredClone(snapshot);
    });

    await runPricingProofWithRestoration({
      originalPricing,
      prove,
      restore,
    });

    expect(prove).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(liveState).toEqual(expected);
  });

  it.each(falsyThrownValues)(
    "preserves a proof-only falsy failure %#",
    async (thrownValue) => {
      const expected = pricingSnapshot();
      const originalPricing = pricingSnapshot();
      let liveState = structuredClone(originalPricing);
      const prove = vi.fn(async () => {
        liveState[0].standardPriceIqd = 1;
        originalPricing[0].weekdayOverrides[0].priceIqd = 2;
        throw thrownValue;
      });
      const restore = vi.fn(async (snapshot) => {
        expectPristineIndependentSnapshot(snapshot, expected, originalPricing);
        liveState = structuredClone(snapshot);
      });

      const rejection = await captureRejection(() =>
        runPricingProofWithRestoration({
          originalPricing,
          prove,
          restore,
        }),
      );

      expect(rejection.rejected).toBe(true);
      expect(Object.is(rejection.value, thrownValue)).toBe(true);
      expect(prove).toHaveBeenCalledTimes(1);
      expect(restore).toHaveBeenCalledTimes(1);
      expect(liveState).toEqual(expected);
    },
  );

  it.each(falsyThrownValues)(
    "preserves a restoration-only falsy failure %#",
    async (thrownValue) => {
      const expected = pricingSnapshot();
      const originalPricing = pricingSnapshot();
      let liveState = structuredClone(originalPricing);
      const prove = vi.fn(async () => {
        liveState[0].standardPriceIqd = 1;
        originalPricing[0].weekdayOverrides[0].priceIqd = 2;
      });
      const restore = vi.fn(async (snapshot) => {
        expectPristineIndependentSnapshot(snapshot, expected, originalPricing);
        liveState = structuredClone(snapshot);
        throw thrownValue;
      });

      const rejection = await captureRejection(() =>
        runPricingProofWithRestoration({
          originalPricing,
          prove,
          restore,
        }),
      );

      expect(rejection.rejected).toBe(true);
      expect(Object.is(rejection.value, thrownValue)).toBe(true);
      expect(prove).toHaveBeenCalledTimes(1);
      expect(restore).toHaveBeenCalledTimes(1);
      expect(liveState).toEqual(expected);
    },
  );

  it.each(dualFalsyFailures)(
    "preserves ordered dual falsy failures %#",
    async (proofValue, restorationValue) => {
      const expected = pricingSnapshot();
      const originalPricing = pricingSnapshot();
      let liveState = structuredClone(originalPricing);
      const prove = vi.fn(async () => {
        liveState[0].standardPriceIqd = 1;
        originalPricing[0].weekdayOverrides[0].priceIqd = 2;
        throw proofValue;
      });
      const restore = vi.fn(async (snapshot) => {
        expectPristineIndependentSnapshot(snapshot, expected, originalPricing);
        liveState = structuredClone(snapshot);
        throw restorationValue;
      });

      const rejection = await captureRejection(() =>
        runPricingProofWithRestoration({
          originalPricing,
          prove,
          restore,
        }),
      );

      expect(rejection.rejected).toBe(true);
      expect(rejection.value).toBeInstanceOf(AggregateError);
      expect(rejection.value.errors).toHaveLength(2);
      expect(Object.is(rejection.value.errors[0], proofValue)).toBe(true);
      expect(Object.is(rejection.value.errors[1], restorationValue)).toBe(true);
      expect(rejection.value.message).toBe(
        `Worker pricing proof and restoration failed: ${String(proofValue)}; ${String(restorationValue)}`,
      );
      expect(prove).toHaveBeenCalledTimes(1);
      expect(restore).toHaveBeenCalledTimes(1);
      expect(liveState).toEqual(expected);
    },
  );

  it("keeps hostile proof and restoration failures intact through the command runner", async () => {
    const hostileFailure = (label) =>
      new Proxy(Object.create(null), {
        get() {
          throw new Error(`${label} property trap must not escape`);
        },
        getPrototypeOf() {
          throw new Error(`${label} prototype trap must not escape`);
        },
      });
    const proofFailure = hostileFailure("proof");
    const restorationFailure = hostileFailure("restoration");
    const expected = pricingSnapshot();
    const originalPricing = pricingSnapshot();
    let capturedAggregate;
    let liveState = structuredClone(originalPricing);
    const stderr = vi.fn();
    const restore = vi.fn(async (snapshot) => {
      expectPristineIndependentSnapshot(snapshot, expected, originalPricing);
      liveState = structuredClone(snapshot);
      throw restorationFailure;
    });

    const exitCode = await runFixtureContractCommand({
      command: async () => {
        const rejection = await captureRejection(() =>
          runPricingProofWithRestoration({
            originalPricing,
            prove: async () => {
              liveState[0].standardPriceIqd = 1;
              originalPricing[0].weekdayOverrides[0].priceIqd = 2;
              throw proofFailure;
            },
            restore,
          }),
        );
        capturedAggregate = rejection.value;
        throw capturedAggregate;
      },
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledExactlyOnceWith(
      "Worker pricing proof and restoration failed: <unprintable thrown value>; <unprintable thrown value>",
    );
    expect(capturedAggregate).toBeInstanceOf(AggregateError);
    expect(capturedAggregate.errors).toHaveLength(2);
    expect(Object.is(capturedAggregate.errors[0], proofFailure)).toBe(true);
    expect(Object.is(capturedAggregate.errors[1], restorationFailure)).toBe(
      true,
    );
    expect(restore).toHaveBeenCalledTimes(1);
    expect(liveState).toEqual(expected);
  });
});

describe("fixture-contract executable guard", () => {
  it("contains the hostile rejection at the real direct-entry boundary", () => {
    const result = runFixtureContractExecutableGuard();

    expect(hasSafeExecutableFailureSignature(result)).toBe(true);
    expect(result.rootRemoved).toBe(true);
    expect(result.stderr).not.toContain("hostile property trap");
    expect(result.stderr).not.toContain("hostile prototype trap");
    expect(result.stderr).not.toContain("at main");
  });

  it.each([
    [
      "direct main",
      {
        anchor: "  process.exitCode = await runFixtureContractCommand();",
        label: "fixture-contract direct-main guard",
        replacement: "  process.exitCode = await main();",
      },
    ],
    [
      "unsafe catch",
      {
        anchor: "  process.exitCode = await runFixtureContractCommand();",
        label: "fixture-contract unsafe-catch guard",
        replacement: `  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }`,
      },
    ],
  ])("rejects the %s guard mutant's executable signature", (_, mutation) => {
    const result = runFixtureContractExecutableGuard(mutation);

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).not.toBe(0);
    expect(hasSafeExecutableFailureSignature(result)).toBe(false);
    expect(result.rootRemoved).toBe(true);
  });
});
