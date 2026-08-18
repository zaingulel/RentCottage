export type CottagePublicationMediaFailurePhase =
  | "resolve"
  | "sign"
  | "origin"
  | "fetch"
  | "status"
  | "type"
  | "size"
  | "stream"
  | "timeout";

export class CottagePublicationMediaUnavailableError extends Error {
  constructor(readonly phase: CottagePublicationMediaFailurePhase) {
    super("Publication media is unavailable");
    this.name = "CottagePublicationMediaUnavailableError";
  }
}

export interface CottagePublicationMediaAdapter {
  resolveMedia(opaqueId: string): Promise<string>;
  signMedia(objectPath: string): Promise<string>;
}

export interface CottagePublicationMedia {
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
}

const maximumMediaBytes = 5 * 1024 * 1024;
const safeMediaTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function unavailable(phase: CottagePublicationMediaFailurePhase): never {
  throw new CottagePublicationMediaUnavailableError(phase);
}

function validatedProviderUrl(value: string, configuredUrl: string) {
  let provider: URL;
  let configured: URL;
  try {
    provider = new URL(value);
    configured = new URL(configuredUrl);
  } catch {
    unavailable("origin");
  }
  const loopback =
    configured.hostname === "localhost" ||
    configured.hostname === "127.0.0.1" ||
    configured.hostname === "[::1]";
  if (
    provider.username ||
    provider.password ||
    provider.hash ||
    provider.origin !== configured.origin ||
    (provider.protocol !== "https:" &&
      !(loopback && provider.protocol === "http:"))
  ) {
    unavailable("origin");
  }
  return provider.toString();
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) unavailable("timeout");
  return new Promise<T>((resolve, reject) => {
    const aborted = () =>
      reject(new CottagePublicationMediaUnavailableError("timeout"));
    signal.addEventListener("abort", aborted, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      },
    );
  });
}

async function readBounded(response: Response, signal: AbortSignal) {
  if (!response.body) unavailable("stream");
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) break;
      length += value.byteLength;
      if (length > maximumMediaBytes) {
        await reader.cancel().catch(() => undefined);
        unavailable("size");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof CottagePublicationMediaUnavailableError) throw error;
    unavailable(signal.aborted ? "timeout" : "stream");
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createCottagePublicationMediaService({
  adapter,
  configuredSupabaseUrl,
  fetchMedia = fetch,
  timeoutMilliseconds = 10_000,
}: {
  adapter: CottagePublicationMediaAdapter;
  configuredSupabaseUrl: string;
  fetchMedia?: typeof fetch;
  timeoutMilliseconds?: number;
}) {
  return {
    async load(opaqueId: string): Promise<CottagePublicationMedia> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
      try {
        let objectPath: string;
        try {
          objectPath = await withAbort(
            adapter.resolveMedia(opaqueId),
            controller.signal,
          );
        } catch (error) {
          if (error instanceof CottagePublicationMediaUnavailableError)
            throw error;
          unavailable("resolve");
        }
        let signedUrl: string;
        try {
          signedUrl = validatedProviderUrl(
            await withAbort(adapter.signMedia(objectPath), controller.signal),
            configuredSupabaseUrl,
          );
        } catch (error) {
          if (error instanceof CottagePublicationMediaUnavailableError)
            throw error;
          unavailable("sign");
        }
        let providerResponse: Response | undefined;
        for (let redirects = 0; redirects <= 2; redirects += 1) {
          try {
            providerResponse = await withAbort(
              fetchMedia(signedUrl, {
                redirect: "manual",
                signal: controller.signal,
              }),
              controller.signal,
            );
          } catch (error) {
            if (error instanceof CottagePublicationMediaUnavailableError)
              throw error;
            unavailable("fetch");
          }
          if (providerResponse.status < 300 || providerResponse.status >= 400)
            break;
          const location = providerResponse.headers.get("location");
          if (!location || redirects === 2) unavailable("status");
          try {
            signedUrl = validatedProviderUrl(
              new URL(location, signedUrl).toString(),
              configuredSupabaseUrl,
            );
          } catch (error) {
            if (error instanceof CottagePublicationMediaUnavailableError)
              throw error;
            unavailable("origin");
          }
        }
        if (!providerResponse?.ok) unavailable("status");
        const contentType = providerResponse.headers
          .get("content-type")
          ?.split(";", 1)[0]
          .trim()
          .toLowerCase();
        if (!contentType || !safeMediaTypes.has(contentType))
          unavailable("type");
        const declaredLength = Number(
          providerResponse.headers.get("content-length") ?? "0",
        );
        if (
          !Number.isFinite(declaredLength) ||
          declaredLength < 0 ||
          declaredLength > maximumMediaBytes
        )
          unavailable("size");
        return {
          bytes: await readBounded(providerResponse, controller.signal),
          contentType,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
