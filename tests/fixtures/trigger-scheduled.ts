import { request } from "node:http";

export async function triggerScheduled(
  baseURL: string | undefined,
  path: string,
): Promise<Response> {
  if (!baseURL) throw new Error("Scheduled trigger requires a local base URL.");
  const target = new URL(path, baseURL);
  if (
    target.protocol !== "http:" ||
    target.hostname !== "127.0.0.1" ||
    target.origin !== new URL(baseURL).origin ||
    target.pathname !== "/__scheduled" ||
    target.username ||
    target.password ||
    target.hash
  ) {
    throw new Error(
      "Scheduled trigger requires the local HTTP scheduled route.",
    );
  }

  return await new Promise<Response>((resolve, reject) => {
    // A close header alone can still reuse a stale socket from the shared agent.
    const invocation = request(
      target,
      { method: "GET", agent: false },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.once("error", fail);
        response.once("end", () => {
          clearTimeout(deadline);
          const headers = new Headers();
          for (let index = 0; index < response.rawHeaders.length; index += 2) {
            headers.append(
              response.rawHeaders[index],
              response.rawHeaders[index + 1],
            );
          }
          const body = Buffer.concat(chunks);
          resolve(
            new Response(body.length ? new Uint8Array(body) : null, {
              status: response.statusCode,
              statusText: response.statusMessage,
              headers,
            }),
          );
        });
      },
    );
    const deadline = setTimeout(() => {
      invocation.destroy(
        new Error("Scheduled trigger exceeded its 30000ms deadline."),
      );
    }, 30_000);
    function fail(error: Error) {
      clearTimeout(deadline);
      reject(error);
    }
    invocation.once("error", fail);
    invocation.end();
  });
}
