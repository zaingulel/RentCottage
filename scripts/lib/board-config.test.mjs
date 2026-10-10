import { test } from "node:test";
import assert from "node:assert/strict";

test("the local board kind labels retain the type convention", async () => {
  const { KIND_LABELS } = await import("./board-config.mjs");
  assert.deepEqual(KIND_LABELS, {
    epic: "type:epic",
    feature: "type:feature",
    task: "type:task",
    bug: "type:bug",
    docs: "type:docs",
  });
});
