// @vitest-environment node
import { once } from "node:events";
import { createServer, globalAgent, get } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { triggerScheduled } from "../tests/fixtures/trigger-scheduled.ts";

async function localServer(handler, observe) {
  const sockets = new Set();
  const server = createServer(handler);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await observe(`http://127.0.0.1:${server.address().port}`);
  } finally {
    const closed = once(server, "close");
    server.close();
    for (const socket of sockets) socket.destroy();
    await closed;
  }
}

async function warmSharedSocket(baseURL) {
  const free = once(globalAgent, "free");
  await new Promise((resolve, reject) => {
    get(`${baseURL}/warm`, (response) => {
      response.resume();
      response.once("error", reject);
      response.once("end", resolve);
    }).once("error", reject);
  });
  const [socket] = await free;
  expect(socket.destroyed).toBe(false);
  return socket;
}

describe("local scheduled trigger transport", () => {
  it("bypasses a warmed shared socket and preserves each scheduled response without replay", async () => {
    const seen = new Set();
    const scheduled = [];
    let warmSocket;
    await localServer(
      (request, response) => {
        if (seen.has(request.socket)) {
          request.socket.destroy();
          return;
        }
        seen.add(request.socket);
        if (request.url === "/warm") {
          warmSocket = request.socket;
          response.end("warm");
          return;
        }
        scheduled.push({
          method: request.method,
          path: request.url,
          socket: request.socket,
        });
        const status = scheduled.length === 1 ? 200 : 500;
        response.writeHead(status, {
          "Content-Type": "text/plain",
          "X-Observation": String(status),
        });
        response.write("scheduled ");
        response.end(String(status));
      },
      async (baseURL) => {
        const warmed = await warmSharedSocket(baseURL);
        const path =
          "/__scheduled?format=json&cron=%2A%20%2A%20%2A%20%2A%20%2A";
        for (const expected of [200, 500]) {
          const response = await triggerScheduled(baseURL, path);
          expect(response.status).toBe(expected);
          expect(response.ok).toBe(expected === 200);
          expect(response.headers.get("x-observation")).toBe(String(expected));
          expect(await response.text()).toBe(`scheduled ${expected}`);
        }
        expect(scheduled).toHaveLength(2);
        expect(
          scheduled.map(({ method, path: actual }) => [method, actual]),
        ).toEqual([
          ["GET", path],
          ["GET", path],
        ]);
        expect(new Set(scheduled.map(({ socket }) => socket)).size).toBe(2);
        expect(scheduled.every(({ socket }) => socket !== warmSocket)).toBe(
          true,
        );
        expect(warmed.destroyed).toBe(false);
      },
    );
  });

  it("dispatches concurrent scheduled requests before either response is released", async () => {
    const arrivals = [];
    await localServer(
      (request, response) => {
        arrivals.push({ request, response });
        if (arrivals.length === 2) {
          for (const arrival of arrivals)
            arrival.response.end(arrival.request.url);
        }
      },
      async (baseURL) => {
        const responses = await Promise.all([
          triggerScheduled(baseURL, "/__scheduled?call=1"),
          triggerScheduled(baseURL, "/__scheduled?call=2"),
        ]);
        expect(arrivals).toHaveLength(2);
        expect(arrivals[0].request.socket).not.toBe(arrivals[1].request.socket);
        expect(
          await Promise.all(responses.map((response) => response.text())),
        ).toEqual(["/__scheduled?call=1", "/__scheduled?call=2"]);
      },
    );
  });

  it.each(["request", "response"])(
    "rejects a real %s failure without retrying",
    async (stage) => {
      let attempts = 0;
      await localServer(
        (request, response) => {
          attempts++;
          if (stage === "request") request.socket.destroy();
          else {
            response.writeHead(200, { "Content-Length": "100" });
            response.end("incomplete");
            response.once("finish", () => request.socket.destroy());
          }
        },
        async (baseURL) => {
          await expect(
            triggerScheduled(baseURL, "/__scheduled"),
          ).rejects.toMatchObject({ code: "ECONNRESET" });
          expect(attempts).toBe(1);
        },
      );
    },
  );

  it("bounds the complete response by the existing total deadline even while data arrives", async () => {
    let accept;
    const arrived = new Promise((resolve) => {
      accept = resolve;
    });
    await localServer(
      (_request, response) => {
        response.write("first");
        accept(response);
      },
      async (baseURL) => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        try {
          const pending = triggerScheduled(baseURL, "/__scheduled");
          let settled = false;
          void pending.then(
            () => {
              settled = true;
            },
            () => {
              settled = true;
            },
          );
          const rejected = expect(pending).rejects.toThrow("30000ms deadline");
          const response = await arrived;
          await vi.advanceTimersByTimeAsync(29_999);
          expect(settled).toBe(false);
          response.write("still streaming");
          await vi.advanceTimersByTimeAsync(1);
          await rejected;
        } finally {
          vi.useRealTimers();
        }
      },
    );
  });

  it.each([
    [undefined, "/__scheduled"],
    ["https://127.0.0.1:8788", "/__scheduled"],
    ["http://example.com", "/__scheduled"],
    ["http://127.0.0.1:8788", "http://127.0.0.1:8789/__scheduled"],
    ["http://127.0.0.1:8788", "/api/health"],
  ])(
    "refuses an out-of-scope scheduled target %s %s",
    async (baseURL, path) => {
      await expect(triggerScheduled(baseURL, path)).rejects.toThrow(
        "Scheduled trigger requires",
      );
    },
  );
});
