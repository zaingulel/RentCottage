import { describe, expect, it, vi } from "vitest";

import {
  browserEnvironment,
  classifyChromiumLaunchFailure,
  main,
} from "./verify-chromium-preflight-worker.mjs";

describe("Chromium preflight worker", () => {
  it("classifies local permission denials separately from infrastructure failures", () => {
    expect(
      classifyChromiumLaunchFailure(
        new Error("EPERM: operation not permitted"),
      ),
    ).toContain("permission failure");
    expect(
      classifyChromiumLaunchFailure(new Error("browser executable is missing")),
    ).toContain("infrastructure failure");
  });

  it("passes Chromium only its allowlisted local runtime environment", async () => {
    const launch = vi.fn().mockResolvedValue({ close: vi.fn() });

    expect(
      await main({
        chromiumImpl: { launch },
        environment: {
          HOME: "/Users/test",
          PATH: "/usr/bin",
          SUPABASE_SECRET_KEY: "must-not-reach-chromium",
        },
      }),
    ).toBe(0);
    expect(launch).toHaveBeenCalledWith({
      env: { HOME: "/Users/test", PATH: "/usr/bin" },
      headless: true,
    });
    expect(
      browserEnvironment({ SUPABASE_URL: "http://127.0.0.1:54321" }),
    ).toEqual({});
  });

  it("does not report success until browser cleanup finishes", async () => {
    let closeStarted;
    let finishClose;
    const closeStartedPromise = new Promise((resolve) => {
      closeStarted = resolve;
    });
    const closePromise = new Promise((resolve) => {
      finishClose = resolve;
    });
    const close = vi.fn(() => {
      closeStarted();
      return closePromise;
    });
    let settled = false;

    const result = main({
      chromiumImpl: { launch: vi.fn().mockResolvedValue({ close }) },
    }).then((code) => {
      settled = true;
      return code;
    });
    await closeStartedPromise;
    await Promise.resolve();

    expect(close).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    finishClose();
    await expect(result).resolves.toBe(0);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, null, 0, false])(
    "treats a falsy Chromium launch rejection as infrastructure failure %#",
    async (failure) => {
      const stderr = vi.fn();

      await expect(
        main({
          chromiumImpl: { launch: vi.fn().mockRejectedValue(failure) },
          stderr,
        }),
      ).resolves.toBe(1);
      expect(stderr).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining("Chromium preflight infrastructure failure"),
      );
    },
  );

  it.each([undefined, null, 0, false])(
    "treats a falsy Chromium close rejection as infrastructure failure %#",
    async (failure) => {
      const stderr = vi.fn();

      await expect(
        main({
          chromiumImpl: {
            launch: vi.fn().mockResolvedValue({
              close: vi.fn().mockRejectedValue(failure),
            }),
          },
          stderr,
        }),
      ).resolves.toBe(1);
      expect(stderr).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining("Chromium preflight infrastructure failure"),
      );
    },
  );

  it.each(["launch", "close"])(
    "safely reports a hostile Chromium %s rejection",
    async (stage) => {
      const hostile = new Proxy(Object.create(null), {
        get() {
          throw new Error("property trap must not escape");
        },
        getPrototypeOf() {
          throw new Error("prototype trap must not escape");
        },
      });
      const stderr = vi.fn();
      const browser = {
        close: vi.fn().mockRejectedValue(hostile),
      };
      const launch =
        stage === "launch"
          ? vi.fn().mockRejectedValue(hostile)
          : vi.fn().mockResolvedValue(browser);

      await expect(main({ chromiumImpl: { launch }, stderr })).resolves.toBe(1);
      expect(stderr).toHaveBeenCalledExactlyOnceWith(
        "Chromium preflight infrastructure failure: <unprintable thrown value>",
      );
    },
  );
});
