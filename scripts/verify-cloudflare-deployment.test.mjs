import { describe, expect, it, vi } from "vitest";

import {
  main,
  verifyCloudflareDeployment,
} from "./verify-cloudflare-deployment.mjs";

const commit = "a".repeat(40);
const versionId = "11111111-2222-3333-4444-555555555555";

function versions(tag = commit) {
  return [
    {
      id: versionId,
      annotations: { "workers/tag": tag },
      metadata: { created_on: "2026-08-16T23:00:00.000Z" },
    },
  ];
}

function deployment({ percentage = 100, id = versionId } = {}) {
  return {
    id: "deployment-id",
    versions: [{ version_id: id, percentage }],
  };
}

describe("Cloudflare deployment verifier", () => {
  it("proves the exact tagged version is serving all preview traffic", () => {
    expect(
      verifyCloudflareDeployment(versions(), deployment(), commit),
    ).toEqual({ versionId });
  });

  it("rejects a stale tag, split traffic, or unknown active version", () => {
    expect(() =>
      verifyCloudflareDeployment(
        versions("previous-head"),
        deployment(),
        commit,
      ),
    ).toThrow("tag does not match");
    expect(() =>
      verifyCloudflareDeployment(
        versions(),
        deployment({ percentage: 50 }),
        commit,
      ),
    ).toThrow("100% of traffic");
    expect(() =>
      verifyCloudflareDeployment(
        versions(),
        deployment({ id: "different-version" }),
        commit,
      ),
    ).toThrow("not present");
  });

  it("queries the preview control plane and reports the verified version", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce(JSON.stringify(versions()))
      .mockReturnValueOnce(JSON.stringify(deployment()));
    const stdout = vi.fn();

    expect(main(["preview", commit], { run, stdout, stderr: vi.fn() })).toBe(0);
    expect(run.mock.calls).toEqual([
      [["versions", "list", "--env", "preview", "--json"]],
      [["deployments", "status", "--env", "preview", "--json"]],
    ]);
    expect(stdout).toHaveBeenCalledWith(
      `Verified Cloudflare preview version ${versionId} at commit ${commit}`,
    );
  });

  it("fails closed on malformed input or provider output", () => {
    const stderr = vi.fn();
    expect(main(["production", commit], { run: vi.fn(), stderr })).toBe(2);
    expect(main(["preview", "short"], { run: vi.fn(), stderr })).toBe(2);
    expect(
      main(["preview", commit], {
        run: vi.fn().mockReturnValue("not-json"),
        stderr,
        stdout: vi.fn(),
      }),
    ).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      "Cloudflare deployment verification failed: Cloudflare versions response was malformed",
    );
    expect(stderr).not.toHaveBeenCalledWith(
      expect.stringContaining("not-json"),
    );
  });

  it("reports safe actionable reasons without provider output", () => {
    const stderr = vi.fn();
    expect(
      main(["preview", commit], {
        run: vi.fn().mockImplementation(() => {
          throw new Error("provider token=secret");
        }),
        stderr,
        stdout: vi.fn(),
      }),
    ).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      "Cloudflare deployment verification failed: Unable to query Cloudflare versions",
    );
    expect(JSON.stringify(stderr.mock.calls)).not.toContain("token=secret");
  });
});
