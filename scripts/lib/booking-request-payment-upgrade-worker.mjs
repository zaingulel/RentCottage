import { spawnSync } from "node:child_process";

export function createBookingRequestPaymentUpgradeWorker({
  guardDisposableLocalDatabase,
  workerBundle,
}) {
  return function runPaymentWorker(mode, bookingRequestId, extra = {}) {
    guardDisposableLocalDatabase();
    const workdir = process.env.SUPABASE_LOCAL_WORKDIR;
    const status = spawnSync(
      "npx",
      [
        "supabase",
        "status",
        "--output",
        "json",
        ...(workdir ? ["--workdir", workdir] : []),
      ],
      {
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
      },
    );
    let connection;
    try {
      connection = JSON.parse(status.stdout);
      const origin = new URL(connection.API_URL);
      if (
        status.status !== 0 ||
        origin.protocol !== "http:" ||
        origin.hostname !== "127.0.0.1" ||
        connection.API_URL !== origin.origin ||
        typeof connection.SECRET_KEY !== "string" ||
        !connection.SECRET_KEY
      )
        throw new Error();
    } catch {
      throw new Error(
        "Unable to resolve the disposable Supabase connection for payment upgrade",
      );
    }
    const result = spawnSync(process.execPath, [workerBundle], {
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        CAPTURE_WORKER_MODE: mode,
        CAPTURE_BOOKING_REQUEST_ID: bookingRequestId,
        PAYMENT_WORKER_OUTPUT: "json",
        ...extra,
        SUPABASE_URL: connection.API_URL,
        SUPABASE_SECRET_KEY: connection.SECRET_KEY,
      },
    });
    const messages = result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    if (result.status !== 0)
      throw new Error(
        `Payment upgrade worker failed: ${result.stderr}; ${JSON.stringify(messages)}`,
      );
    const complete = messages.find((message) => message.stage === "complete");
    if (!complete) throw new Error("Payment upgrade worker returned no result");
    return complete.result;
  };
}
