import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import { afterEach, expect, it, vi } from "vitest";

import {
  accessJourneyCases,
  accessJourneyIdentity,
} from "./lib/access-journey-fixtures.mjs";
import {
  ownedAccessJourneyAllocation,
  prepareOwnedAccessJourney,
} from "./access-journey-playwright";

const doubles = {
  createClient: vi.fn(),
  prepare: vi.fn(),
  validate: vi.fn(),
  writeFile: vi.fn(),
};
const prepareAttempt = (journey, info) =>
  prepareOwnedAccessJourney(journey, info, {
    createClient: doubles.createClient,
    prepareAccessJourney: doubles.prepare,
    validateAccessJourneyInitialState: doubles.validate,
    writeFile: doubles.writeFile,
  });
afterEach(() => vi.unstubAllEnvs());

it("owned Playwright collection preserves forward and reverse order for both Next projects", () => {
  const forward = [
    "shared sign-in from the homepage returns a prospective owner to their private application",
    "a Cottage Owner saves, resumes and submits a complete private application",
    "Owner Application keeps evidence controls aligned and accessible in every locale",
    "one account returns to customer bookings, enrolls explicitly and signs out only this device",
  ];
  const reverse = [
    "one account returns to customer bookings, enrolls explicitly and signs out only this device",
    "Owner Application keeps evidence controls aligned and accessible in every locale",
    "a Cottage Owner saves, resumes and submits a complete private application",
    "shared sign-in from the homepage returns a prospective owner to their private application",
  ];
  const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
  const environment = {
    ...process.env,
    PLAYWRIGHT_SERVER: "next",
    PLAYWRIGHT_WORKER_PORT: "8788",
    SUPABASE_URL: "http://127.0.0.1:55331",
    SUPABASE_SECRET_KEY: "synthetic-collection-secret",
  };
  delete environment.PLAYWRIGHT_JSON_OUTPUT_FILE;
  delete environment.PLAYWRIGHT_JSON_OUTPUT_DIR;
  delete environment.PLAYWRIGHT_JSON_OUTPUT_NAME;

  for (const [phase, expected] of [
    ["forward", forward],
    ["reverse", reverse],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        cli,
        "test",
        "tests/access.spec.ts",
        "--config=playwright.config.ts",
        "--project=mobile",
        "--project=desktop",
        "--workers=1",
        "--retries=0",
        "--repeat-each=1",
        "--list",
        "--reporter=json",
        "--grep",
        `(?:${forward.join("|")})$`,
      ],
      {
        env: { ...environment, ACCESS_JOURNEY_PHASE: phase },
        encoding: "utf8",
        timeout: 30_000,
        killSignal: "SIGKILL",
        maxBuffer: 1024 * 1024,
      },
    );
    expect(result.error, phase).toBeUndefined();
    expect(result.signal, phase).toBeNull();
    expect(result.status, phase).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.errors, phase).toEqual([]);
    expect(report.suites, phase).toHaveLength(1);
    const [suite] = report.suites;
    expect(suite.title, phase).toBe("access.spec.ts");
    expect(suite.suites, phase).toBeUndefined();
    expect(Array.isArray(suite.specs), phase).toBe(true);
    const records = [];
    for (const spec of suite.specs) {
      expect(Array.isArray(spec.tests), phase).toBe(true);
      for (const test of spec.tests) {
        expect(["mobile", "desktop"], phase).toContain(test.projectName);
        records.push({ project: test.projectName, title: spec.title });
      }
    }
    expect(records, phase).toHaveLength(8);
    for (const project of ["mobile", "desktop"]) {
      expect(
        records
          .filter((record) => record.project === project)
          .map((record) => record.title),
        `${phase} ${project}`,
      ).toEqual(expected);
    }
  }
}, 70_000);

function nativeAttempt(journey, overrides = {}) {
  return {
    project: { name: "mobile" },
    retry: 0,
    repeatEachIndex: 0,
    title: accessJourneyCases.find((row) => row.journey === journey).title,
    outputPath: vi.fn((filename) => `/synthetic-attempt/${filename}`),
    attach: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

it("owned Playwright adapter maps native attempt coordinates and rejects duplicate invalid or mismatched attempts", async () => {
  for (const { journey } of accessJourneyCases) {
    for (const project of ["mobile", "desktop", "worker"]) {
      for (const phase of [
        "ordinary",
        "forward",
        "reverse",
        "retry-proof",
        "boundary",
      ]) {
        for (const retry of [0, 1, 2]) {
          for (const repeatEachIndex of [0, 1]) {
            expect(
              ownedAccessJourneyAllocation(
                journey,
                nativeAttempt(journey, {
                  project: { name: project },
                  retry,
                  repeatEachIndex,
                }),
                phase,
              ),
            ).toEqual({ journey, project, retry, repeatEachIndex, phase });
          }
        }
      }
    }
  }
  for (const overrides of [
    { project: { name: "unknown" } },
    { retry: -1 },
    { retry: 3 },
    { retry: 0.5 },
    { retry: undefined },
    { repeatEachIndex: -1 },
    { repeatEachIndex: 2 },
    { repeatEachIndex: undefined },
    { title: "another journey" },
    { title: undefined },
  ]) {
    expect(() =>
      ownedAccessJourneyAllocation(
        "signin",
        nativeAttempt("signin", overrides),
        "forward",
      ),
    ).toThrow();
  }
  for (const phase of [undefined, "", "unknown"]) {
    expect(() =>
      ownedAccessJourneyAllocation("signin", nativeAttempt("signin"), phase),
    ).toThrow("phase");
  }
  expect(() =>
    ownedAccessJourneyAllocation("unknown", nativeAttempt("signin"), "forward"),
  ).toThrow("Unknown access journey");

  vi.stubEnv("ACCESS_JOURNEY_PHASE", "forward");
  vi.stubEnv("SUPABASE_URL", "http://127.0.0.1:55331");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "synthetic-publishable");
  vi.stubEnv("SUPABASE_SECRET_KEY", "synthetic-secret");
  const privilegedClient = { synthetic: "privileged client" };
  doubles.createClient.mockReturnValue(privilegedClient);
  let resolvePreparation;
  let resolveReadiness;
  let resolveWrite;
  doubles.writeFile.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveWrite = resolve;
      }),
  );
  doubles.prepare.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePreparation = resolve;
      }),
  );
  doubles.validate.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveReadiness = resolve;
      }),
  );
  const info = nativeAttempt("signin", {
    project: { name: "desktop" },
    retry: 1,
    repeatEachIndex: 1,
  });
  const allocation = {
    journey: "signin",
    project: "desktop",
    retry: 1,
    repeatEachIndex: 1,
    phase: "forward",
  };
  const fixture = {
    ...accessJourneyIdentity(allocation),
    applicationId: "synthetic-application-id",
    profileId: "synthetic-profile-id",
    userId: "synthetic-user-id",
    ownerClient: { session: "must never attach" },
  };
  let consumed = false;
  const pending = prepareAttempt("signin", info).then((ready) => {
    consumed = true;
    return ready;
  });
  expect(doubles.prepare).toHaveBeenCalledWith({
    allocation,
    environment: process.env,
    privilegedClient,
    publishableKey: "synthetic-publishable",
    selectedTitle: info.title,
    url: "http://127.0.0.1:55331",
  });
  expect(doubles.validate).not.toHaveBeenCalled();
  expect(consumed).toBe(false);
  await expect(prepareAttempt("signin", info)).rejects.toThrow(
    "Duplicate access journey attempt",
  );
  expect(doubles.prepare).toHaveBeenCalledTimes(1);
  resolvePreparation(fixture);
  await vi.waitFor(() => expect(doubles.validate).toHaveBeenCalledTimes(1));
  expect(doubles.validate).toHaveBeenCalledWith({
    fixture,
    privilegedClient,
    publishableKey: "synthetic-publishable",
    url: "http://127.0.0.1:55331",
  });
  expect(info.outputPath).not.toHaveBeenCalled();
  expect(doubles.writeFile).not.toHaveBeenCalled();
  expect(info.attach).not.toHaveBeenCalled();
  expect(consumed).toBe(false);
  resolveReadiness();
  await vi.waitFor(() => expect(doubles.writeFile).toHaveBeenCalledTimes(1));
  const readinessPath =
    "/synthetic-attempt/owned-access-journey-readiness.json";
  expect(info.outputPath).toHaveBeenCalledWith(
    "owned-access-journey-readiness.json",
  );
  const [writtenPath, writtenMetadata, encoding] =
    doubles.writeFile.mock.calls[0];
  expect(writtenPath).toBe(readinessPath);
  expect(encoding).toBe("utf8");
  expect(info.attach).not.toHaveBeenCalled();
  expect(consumed).toBe(false);
  resolveWrite();
  expect(await pending).toBe(fixture);
  expect(consumed).toBe(true);
  expect(info.attach).toHaveBeenCalledTimes(1);
  const [name, attachment] = info.attach.mock.calls[0];
  expect(name).toBe("owned-access-journey-readiness");
  expect(attachment).toEqual({
    path: readinessPath,
    contentType: "application/json",
  });
  expect(JSON.parse(writtenMetadata)).toEqual({
    allocation,
    phone: fixture.phone,
    applicationId: fixture.applicationId,
    profileId: fixture.profileId,
    userId: fixture.userId,
    readiness: "validated",
  });

  const rejected = nativeAttempt("owner-submit", { retry: 2 });
  doubles.prepare.mockResolvedValue(
    accessJourneyIdentity({
      journey: "owner-submit",
      project: "mobile",
      retry: 2,
      repeatEachIndex: 0,
      phase: "forward",
    }),
  );
  doubles.validate.mockRejectedValue(
    new Error("production readiness rejected"),
  );
  await expect(prepareAttempt("owner-submit", rejected)).rejects.toThrow(
    "production readiness rejected",
  );
  expect(rejected.outputPath).not.toHaveBeenCalled();
  expect(rejected.attach).not.toHaveBeenCalled();
  expect(doubles.writeFile).toHaveBeenCalledTimes(1);
  const validationCount = doubles.validate.mock.calls.length;
  doubles.prepare.mockRejectedValue(new Error("preparation rejected"));
  await expect(
    prepareAttempt("owner-layout", nativeAttempt("owner-layout")),
  ).rejects.toThrow("preparation rejected");
  expect(doubles.validate).toHaveBeenCalledTimes(validationCount);
  const preparationCount = doubles.prepare.mock.calls.length;
  await expect(
    prepareAttempt(
      "shared-account",
      nativeAttempt("shared-account", { title: "another title" }),
    ),
  ).rejects.toThrow("title");
  vi.stubEnv("ACCESS_JOURNEY_PHASE", "unknown");
  await expect(
    prepareAttempt("shared-account", nativeAttempt("shared-account")),
  ).rejects.toThrow("phase");
  expect(doubles.prepare).toHaveBeenCalledTimes(preparationCount);

  vi.stubEnv("ACCESS_JOURNEY_PHASE", "forward");
  const failedWrite = nativeAttempt("shared-account");
  doubles.prepare.mockResolvedValue(
    accessJourneyIdentity({
      journey: "shared-account",
      project: "mobile",
      retry: 0,
      repeatEachIndex: 0,
      phase: "forward",
    }),
  );
  doubles.validate.mockResolvedValue(undefined);
  doubles.writeFile.mockRejectedValue(
    new Error("readiness output unavailable"),
  );
  await expect(prepareAttempt("shared-account", failedWrite)).rejects.toThrow(
    "readiness output unavailable",
  );
  expect(failedWrite.attach).not.toHaveBeenCalled();
});
