import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.githooks/pre-push",
);

function executable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function withFixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "rentcottage-prepush-"));
  try {
    const bin = join(root, "bin");
    mkdirSync(bin);
    executable(
      join(bin, "git"),
      `#!/bin/sh
case "$*" in
  "rev-parse --local-env-vars") echo GIT_DIR ;;
  "rev-parse --show-toplevel") echo ${root} ;;
  *) exit 1 ;;
esac
`,
    );
    fn({ bin, root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function run(root, bin, extra = {}) {
  return spawnSync("/bin/sh", [HOOK], {
    cwd: root,
    encoding: "utf8",
    env: {
      PATH: bin,
      GIT_DIR: "/wrong/repository",
      GIT_NAMESPACE: "wrong",
      NODE_TEST_CONTEXT: "wrong",
      GIT_TRACE_PACKET: "1",
      ...extra,
    },
  });
}

test("pre-push fails closed when Node is unavailable", () => {
  withFixture(({ root, bin }) => {
    const result = run(root, bin);
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}${result.stderr}`,
      /node: (?:command )?not found/,
    );
  });
});

test("pre-push scrubs Git and nested-test environment before the script suite", () => {
  withFixture(({ root, bin }) => {
    executable(
      join(bin, "node"),
      `#!/bin/sh
[ -z "$GIT_DIR$GIT_NAMESPACE$NODE_TEST_CONTEXT$GIT_TRACE_PACKET" ] || exit 91
exit 0
`,
    );
    const result = run(root, bin);
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  });
});

test("pre-push RUN_TESTS=1 keeps the optional full-test invocation", () => {
  withFixture(({ root, bin }) => {
    const calls = join(root, "npm-calls");
    executable(join(bin, "node"), "#!/bin/sh\nexit 0\n");
    executable(
      join(bin, "npm"),
      `#!/bin/sh
echo "$*" >> ${calls}
exit 0
`,
    );
    symlinkSync("/usr/bin/dirname", join(bin, "dirname"));
    const result = run(root, bin, { RUN_TESTS: "1" });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    assert.match(readFileSync(calls, "utf8"), /^test$/m);
  });
});
