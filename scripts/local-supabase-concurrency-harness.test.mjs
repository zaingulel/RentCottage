import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createLocalSupabaseConcurrencyHarness } from "./local-supabase-concurrency-harness.mjs";
import {
  databaseCheckCommands,
  ownershipCommand,
} from "./verify-access-command-doubles.mjs";

describe("local Supabase concurrency harness", () => {
  function childProcess() {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = vi.fn();
    child.stderr.setEncoding = vi.fn();
    child.stdin = {
      write: vi.fn(),
      end: vi.fn(),
      destroyed: false,
      writableEnded: false,
    };
    child.kill = vi.fn();
    return child;
  }

  it("accumulates repeated concurrency phases without inventing absent cleanup", () => {
    let tick = 100;
    const stdout = vi.fn();
    const utcNow = () => new Date(Date.UTC(2026, 8, 26) + tick).toISOString();
    const harness = createLocalSupabaseConcurrencyHarness({
      timing: { check: "controlled-check", isolation: "serial" },
      monotonicNow: () => tick,
      utcNow,
      stdout,
    });
    harness.markTimingPhase("setup");
    tick = 137;
    harness.markTimingPhase("execution");
    tick = 150;
    harness.markTimingPhase("setup");
    tick = 159;
    harness.markTimingPhase("execution");
    tick = 180;
    harness.markTimingPhase("cleanup");
    tick = 190;
    harness.finishTiming({ outcome: "passed", cleanupDisposition: "local" });
    const records = stdout.mock.calls.map(([line]) => JSON.parse(line));
    expect(
      records.slice(0, -1).map(({ phase, elapsedMs }) => [phase, elapsedMs]),
    ).toEqual([
      ["setup", 37],
      ["execution", 13],
      ["setup", 9],
      ["execution", 21],
      ["cleanup", 10],
    ]);
    expect(records[0]).toEqual({
      type: "concurrency-phase",
      check: "controlled-check",
      isolation: "serial",
      phase: "setup",
      startedAt: "2026-09-26T00:00:00.100Z",
      completedAt: "2026-09-26T00:00:00.137Z",
      elapsedMs: 37,
    });
    expect(records.at(-1)).toEqual({
      type: "concurrency-summary",
      check: "controlled-check",
      isolation: "serial",
      startedAt: "2026-09-26T00:00:00.100Z",
      completedAt: "2026-09-26T00:00:00.190Z",
      setupMs: 46,
      executionMs: 34,
      cleanupMs: 10,
      outcome: "passed",
      cleanupDisposition: "local",
      phaseReasons: {},
    });
    tick = 1000;
    harness.finishTiming({
      outcome: "failed",
      cleanupDisposition: "project-teardown",
    });
    harness.markTimingPhase("setup");
    expect(stdout).toHaveBeenCalledTimes(6);

    const deferred = createLocalSupabaseConcurrencyHarness({
      timing: { check: "deferred-check", isolation: "serial" },
      monotonicNow: () => tick,
      utcNow,
      stdout,
    });
    deferred.markTimingPhase("setup");
    deferred.markTimingPhase("execution");
    deferred.finishTiming({
      outcome: "passed",
      cleanupDisposition: "project-teardown",
    });
    expect(JSON.parse(stdout.mock.lastCall[0])).toMatchObject({
      setupMs: 0,
      executionMs: 0,
      cleanupMs: null,
      phaseReasons: {
        cleanup: "Cleanup is deferred to disposable project teardown.",
      },
    });

    for (const failedPhase of ["setup", "cleanup"]) {
      const failed = createLocalSupabaseConcurrencyHarness({
        timing: { check: "failed-check", isolation: "serial" },
        monotonicNow: () => tick,
        utcNow,
        stdout,
      });
      expect(() => {
        try {
          failed.markTimingPhase(failedPhase);
          tick += 7;
          throw new Error(`${failedPhase} failed`);
        } finally {
          failed.finishTiming({
            outcome: "failed",
            cleanupDisposition: "local",
          });
        }
      }).toThrow(`${failedPhase} failed`);
      const summary = JSON.parse(stdout.mock.lastCall[0]);
      expect(summary).toMatchObject({
        outcome: "failed",
        [`${failedPhase}Ms`]: 7,
      });
      for (const phase of ["setup", "execution", "cleanup"].filter(
        (phase) => phase !== failedPhase,
      )) {
        expect(summary[`${phase}Ms`]).toBeNull();
        expect(summary.phaseReasons[phase]).toBe("Phase was not reached.");
      }
    }

    stdout.mockClear();
    const monotonicNow = vi.fn();
    const silent = createLocalSupabaseConcurrencyHarness({
      stdout,
      monotonicNow,
    });
    silent.markTimingPhase("setup");
    silent.finishTiming({ outcome: "passed", cleanupDisposition: "local" });
    expect(stdout).not.toHaveBeenCalled();
    expect(monotonicNow).not.toHaveBeenCalled();
    for (const timing of [
      null,
      { check: " ", isolation: "serial" },
      { check: 42, isolation: "serial" },
      { check: "check", isolation: "independent" },
    ]) {
      expect(() => createLocalSupabaseConcurrencyHarness({ timing })).toThrow(
        "Concurrency timing requires a nonblank check and serial isolation.",
      );
    }
  });

  it("acknowledges SQL setup before sending the body on the same owned session", async () => {
    vi.useFakeTimers();
    try {
      let tick = 100;
      const stdout = vi.fn();
      const child = childProcess();
      const spawnProcess = vi.fn(() => child);
      const harness = createLocalSupabaseConcurrencyHarness({
        timing: { check: "protocol-check", isolation: "serial" },
        monotonicNow: () => tick,
        stdout,
        spawnProcess,
      });
      harness.markTimingPhase("execution");
      let openingSettled = false;
      const opening = harness
        .startSessionAfterSetup("begin;\nselect 'fixture';", "select 'body';")
        .then((session) => {
          openingSettled = true;
          return session;
        });
      expect(child.stdin.write.mock.calls).toEqual([
        [
          "\\set VERBOSITY verbose\nbegin;\nselect 'fixture';\nselect 'RC330_SQL_SETUP_READY';\n",
        ],
      ]);
      child.stdout.emit("data", "fixture-output\nRC330_SQL_SETUP_");
      await vi.advanceTimersByTimeAsync(15_020);
      expect(openingSettled).toBe(false);
      expect(child.stdin.write).toHaveBeenCalledTimes(1);
      expect(child.kill).not.toHaveBeenCalled();
      tick = 137;
      child.stdout.emit("data", "READY\n");
      await vi.advanceTimersByTimeAsync(20);
      const session = await opening;
      expect(child.stdout.listenerCount("data")).toBe(1);
      expect(child.listenerCount("error")).toBe(1);
      expect(child.listenerCount("close")).toBe(1);
      expect(session.child).toBe(child);
      expect(spawnProcess).toHaveBeenCalledTimes(1);
      expect(session.setupStdout).toBe("fixture-output\n");
      expect(session.stdout).toBe("");
      expect(child.stdin.write.mock.calls).toEqual([
        [
          "\\set VERBOSITY verbose\nbegin;\nselect 'fixture';\nselect 'RC330_SQL_SETUP_READY';\n",
        ],
        ["select 'body';\n"],
      ]);
      expect(child.stdin.end).not.toHaveBeenCalled();
      child.stdout.emit("data", "body-output\n");
      tick = 150;
      const closing = harness.finishSession(session, { action: "rollback" });
      expect(child.stdin.end).toHaveBeenCalledExactlyOnceWith("rollback;\n");
      child.emit("close", 0, null);
      await closing;
      expect(session.stdout).toBe("body-output\n");
      harness.finishTiming({
        outcome: "passed",
        cleanupDisposition: "project-teardown",
      });
      expect(JSON.parse(stdout.mock.lastCall[0])).toMatchObject({
        setupMs: 37,
        executionMs: 13,
        cleanupMs: null,
      });

      for (const phase of ["setup", "execution", "cleanup", undefined]) {
        const oneShotChild = childProcess();
        const lines = [];
        const oneShot = createLocalSupabaseConcurrencyHarness({
          ...(phase
            ? { timing: { check: "one-shot", isolation: "serial" } }
            : {}),
          monotonicNow: () => tick,
          stdout: (line) => lines.push(JSON.parse(line)),
          spawnProcess: () => oneShotChild,
        });
        if (phase) oneShot.markTimingPhase(phase);
        const running = oneShot.runSqlAfterSetup(
          "select 'setup';",
          "select 'result';\ncommit;",
        );
        tick += 10;
        oneShotChild.stdout.emit(
          "data",
          "setup-output\nRC330_SQL_SETUP_READY\n",
        );
        await vi.advanceTimersByTimeAsync(20);
        expect(oneShotChild.stdin.end).toHaveBeenCalledExactlyOnceWith(
          "select 'result';\ncommit;\n",
        );
        tick += 20;
        oneShotChild.stdout.emit("data", "  body-result\n");
        oneShotChild.emit("close", 0, null);
        expect(await running).toBe("body-result");
        oneShot.finishTiming({
          outcome: "passed",
          cleanupDisposition: "local",
        });
        if (phase) {
          expect(lines.at(-1).setupMs).toBe(phase === "setup" ? 30 : 10);
          expect(lines.at(-1)[`${phase}Ms`]).toBe(phase === "setup" ? 30 : 20);
        } else {
          expect(lines).toEqual([]);
        }
      }

      const contenderChild = childProcess();
      const contender = createLocalSupabaseConcurrencyHarness({
        spawnProcess: () => contenderChild,
        waitLimitMilliseconds: 30,
      });
      const contenderSession = contender.startSession("select 'contender';");
      const markerWait = contender
        .waitForMarker(contenderSession, "CONTENTION_READY")
        .catch((error) => error);
      await vi.advanceTimersByTimeAsync(40);
      expect((await markerWait).message).toBe(
        "PostgreSQL session did not reach CONTENTION_READY.",
      );
      contenderChild.emit("close", 0, null);

      for (const failure of ["eof", "error", "body", "body-write", "cleanup"]) {
        const failedChild = childProcess();
        const primary = new Error("setup spawn failed");
        const cleanupError = new Error("termination failed");
        const writeError = new Error("body write failed");
        const lines = [];
        const failed = createLocalSupabaseConcurrencyHarness({
          timing: { check: "failed-protocol", isolation: "serial" },
          monotonicNow: () => tick,
          stdout: (line) => lines.push(JSON.parse(line)),
          spawnProcess: () => failedChild,
          waitLimitMilliseconds: 30,
        });
        failed.markTimingPhase("execution");
        if (failure === "cleanup")
          failedChild.kill.mockImplementation(() => {
            throw cleanupError;
          });
        let settled = false;
        const failedRun = failed
          .runSqlAfterSetup("select 'setup';", "select 'body';")
          .catch((error) => {
            settled = true;
            return error;
          });
        tick += 5;
        if (failure === "eof") {
          failedChild.stderr.emit("data", "setup SQL failed");
          failedChild.emit("close", 1, null);
          await vi.advanceTimersByTimeAsync(20);
        } else if (failure === "body" || failure === "body-write") {
          if (failure === "body-write")
            failedChild.stdin.end.mockImplementation(() => {
              throw writeError;
            });
          failedChild.stdout.emit("data", "RC330_SQL_SETUP_READY\n");
          await vi.advanceTimersByTimeAsync(20);
          if (failure === "body") {
            failedChild.stderr.emit("data", "body SQL failed");
            failedChild.emit("close", 9, null);
          } else {
            expect(failedChild.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
            expect(settled).toBe(false);
            failedChild.emit("close", null, "SIGTERM");
          }
        } else {
          failedChild.emit("error", primary);
          await vi.advanceTimersByTimeAsync(0);
          expect(failedChild.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
          expect(settled).toBe(false);
          failedChild.emit("close", null, "SIGTERM");
          await vi.advanceTimersByTimeAsync(20);
        }
        const error = await failedRun;
        if (failure === "error" || failure === "cleanup")
          expect(error).toBe(primary);
        else if (failure === "body-write") expect(error).toBe(writeError);
        else
          expect(error.message).toContain(
            failure === "eof" ? "session exited before" : "body SQL failed",
          );
        if (failure === "cleanup")
          expect(error.cleanupErrors).toEqual([cleanupError]);
        if (failure !== "body" && failure !== "body-write")
          expect(failedChild.stdin.end).not.toHaveBeenCalled();
        expect(failedChild.stdin.write).toHaveBeenCalledTimes(1);
        if (failure === "eof" || failure === "body")
          expect(failedChild.kill).not.toHaveBeenCalled();
        expect(settled).toBe(true);
        expect(failedChild.stdout.listenerCount("data")).toBe(1);
        expect(failedChild.listenerCount("error")).toBe(1);
        expect(failedChild.listenerCount("close")).toBe(1);
        failed.finishTiming({ outcome: "failed", cleanupDisposition: "local" });
        expect(lines.at(-1)).toMatchObject({ outcome: "failed", cleanupMs: 0 });
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs a statement list in one owned session after setup", async () => {
    vi.useFakeTimers();
    try {
      const child = childProcess();
      const spawnProcess = vi.fn(() => child);
      const harness = createLocalSupabaseConcurrencyHarness({ spawnProcess });
      const running = harness.runStatementsAfterSetup("select 'setup';", [
        "select 1",
        "select 2 -- note",
        "commit;",
      ]);
      child.stdout.emit("data", "RC330_SQL_SETUP_READY\n");
      await vi.advanceTimersByTimeAsync(20);
      expect(spawnProcess).toHaveBeenCalledTimes(1);
      expect(child.stdin.end).toHaveBeenCalledExactlyOnceWith(
        "select 1\n;\nselect 2 -- note\n;\ncommit;\n;\n",
      );
      child.emit("close", 0, null);
      await running;

      await harness.runStatementsAfterSetup("select 'setup';", []);
      expect(spawnProcess).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("attributes actual terminal notification setup and delivery costs separately", async () => {
    vi.useFakeTimers();
    try {
      const { verifyTerminalReleaseNotifications } =
        await import("./verify-booking-request-notification-concurrency.mjs");
      let tick = 0;
      const children = [];
      const order = [];
      const lines = [];
      const actions = ["decline", "withdraw", "expire"];
      const statuses = ["declined", "withdrawn", "expired"];
      const harness = createLocalSupabaseConcurrencyHarness({
        timing: { check: "actual-notification", isolation: "serial" },
        monotonicNow: () => tick,
        stdout: (line) => lines.push(JSON.parse(line)),
        spawnSyncProcess: (_command, _args, { input }) => {
          let stdout = "";
          if (input.includes("select jsonb_agg(jsonb_build_object('role'")) {
            order.push("events");
            stdout = JSON.stringify([
              {
                role: "cottage_owner",
                recipient: "10000000-0000-4000-8000-000000001001",
                receipt: null,
              },
              {
                role: "customer",
                recipient: "10000000-0000-4000-8000-000000001002",
                receipt: null,
              },
            ]);
          } else if (
            input.includes("select count(*) from public.booking_receipts")
          ) {
            order.push("receipts");
            stdout = "0";
          } else {
            expect(input).toContain("delete from public.booking_requests");
            order.push("cleanup");
          }
          return { status: 0, stdout, stderr: "" };
        },
        spawnProcess: () => {
          const position = children.length;
          const index = Math.floor(position / 2);
          const release = position % 2 === 0;
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.stdout.setEncoding = vi.fn();
          child.stderr.setEncoding = vi.fn();
          const chargeSetup = (sql) => {
            if (release && sql.includes("insert into auth.users"))
              tick += [10, 20, 30][index];
            if (!release && sql.includes("create function pg_temp.notice_call"))
              tick += [1, 2, 3][index];
          };
          child.stdin = {
            destroyed: false,
            writableEnded: false,
            write: vi.fn((sql) => {
              chargeSetup(sql);
              order.push(release ? "release-setup" : "delivery-setup");
            }),
            end: vi.fn((sql) => {
              chargeSetup(sql);
              if (release) {
                expect(sql).toBe(
                  ` select pg_temp.finish_terminal_release('${actions[index]}'); commit;\n`,
                );
                tick += [100, 200, 300][index];
                order.push(actions[index]);
                child.stdout.emit(
                  "data",
                  JSON.stringify({ status: statuses[index] }) + "\n",
                );
              } else {
                expect(sql).toContain(
                  `pg_temp.prepare_request_notice('request_${statuses[index]}',role)`,
                );
                expect(sql).toContain(
                  "(values ('customer'),('cottage_owner')) recipients(role)",
                );
                expect(sql).not.toMatch(/\b(?:begin|commit|rollback);/);
                tick += [10, 20, 30][index];
                order.push("delivery");
                child.stdout.emit(
                  "data",
                  '[{"status":"delivered"},{"status":"delivered"}]\n',
                );
              }
              child.emit("close", 0, null);
            }),
          };
          child.kill = vi.fn();
          children.push(child);
          return child;
        },
      });
      harness.markTimingPhase("execution");
      const running = verifyTerminalReleaseNotifications(harness);
      for (let position = 0; position < 6; position++) {
        expect(children).toHaveLength(position + 1);
        const child = children[position];
        expect(child.stdin.write).toHaveBeenCalledTimes(1);
        expect(child.stdin.end).not.toHaveBeenCalled();
        const setup = child.stdin.write.mock.calls[0][0];
        expect(setup).toMatch(/select 'RC330_SQL_SETUP_READY';\n$/);
        if (position % 2 === 0) {
          expect(setup).toContain("insert into auth.users");
          expect(setup).toContain(
            "create function pg_temp.finish_terminal_release",
          );
          expect(setup).not.toContain(
            `select pg_temp.finish_terminal_release('${actions[Math.floor(position / 2)]}');`,
          );
          expect(setup).toContain("begin;");
          expect(setup).not.toContain("commit;");
          if (position === 4)
            expect(setup).toContain(
              "statement_timestamp()-interval '4 hours 1 second'",
            );
        } else {
          expect(setup).toContain("create function pg_temp.notice_call");
          expect(setup).not.toContain("insert into auth.users");
          expect(setup).not.toMatch(/\b(?:begin|commit|rollback);/);
        }
        child.stdout.emit("data", "setup-output\nRC330_SQL_SETUP_");
        await vi.advanceTimersByTimeAsync(20);
        expect(child.stdin.end).not.toHaveBeenCalled();
        child.stdout.emit("data", "READY\n");
        await vi.advanceTimersByTimeAsync(20);
        expect(child.stdin.end).toHaveBeenCalledTimes(1);
        expect(child.kill).not.toHaveBeenCalled();
      }
      await running;
      harness.finishTiming({ outcome: "passed", cleanupDisposition: "local" });
      expect(lines.at(-1)).toMatchObject({
        setupMs: 66,
        executionMs: 660,
        outcome: "passed",
      });
      expect(order).toEqual([
        "cleanup",
        "release-setup",
        "decline",
        "events",
        "delivery-setup",
        "delivery",
        "receipts",
        "cleanup",
        "release-setup",
        "withdraw",
        "events",
        "delivery-setup",
        "delivery",
        "receipts",
        "cleanup",
        "release-setup",
        "expire",
        "events",
        "delivery-setup",
        "delivery",
        "receipts",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("acknowledges actual history setup before readers and preserves owned rollback", async () => {
    vi.useFakeTimers();
    try {
      const { verifyProviderResolution, prepareHistorySession } =
        await import("./verify-booking-request-payment-history-concurrency.mjs");
      const physicalAttemptId = "authorization-attempt";
      const transition = {
        source: "provider-operation",
        kind: "state-transition",
        fromState: "indeterminate",
        toState: "succeeded",
        outcome: "succeeded",
        physicalAttemptId,
        providerRequestId: "internal-request:operation-1",
        providerReference: "internal-reference:operation-1",
        movementReference: "internal-movement:operation-1",
      };
      const before = {
        historyCoverage: "complete",
        events: [
          { kind: "physical-attempt", outcome: "indeterminate" },
          transition,
        ],
      };
      const timeEvidence = {
        ...before,
        events: [
          ...before.events,
          {
            kind: "state-transition",
            fromState: "succeeded",
            toState: "succeeded",
            physicalAttemptId,
            providerOccurredAt: "2099-01-01T00:00:00+00:00",
          },
        ],
      };
      const movementEvidence = {
        ...timeEvidence,
        events: [
          ...timeEvidence.events,
          {
            kind: "state-transition",
            fromState: "succeeded",
            toState: "succeeded",
            physicalAttemptId,
            movementReference: "sim-movement-1234567890abcdef1234567890abcdef",
          },
        ],
      };
      const output =
        [
          `RESOLVED:${JSON.stringify(before)}`,
          `SOURCE:${JSON.stringify({ id: "operation-1", physicalAttemptId, originalOutcome: "indeterminate", outcome: "succeeded", executions: 1 })}`,
          "RECEIPTS:0",
          "REPEAT:succeeded",
          `RESOLVED:${JSON.stringify(before)}`,
          `EVIDENCE_TIME:${JSON.stringify(timeEvidence)}`,
          `EVIDENCE_MOVEMENT:${JSON.stringify(movementEvidence)}`,
          `EVIDENCE_MOVEMENT:${JSON.stringify(movementEvidence)}`,
          "RC330_HISTORY_EXECUTION_READY",
        ].join("\n") + "\n";
      function childProcess() {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.stdout.setEncoding = vi.fn();
        child.stderr.setEncoding = vi.fn();
        child.stdin = {
          write: vi.fn(),
          end: vi.fn(() => child.emit("close", 0, null)),
          destroyed: false,
          writableEnded: false,
        };
        child.kill = vi.fn(() => child.emit("close", null, "SIGTERM"));
        return child;
      }
      let tick = 0;
      const lines = [];
      const child = childProcess();
      child.stdin.end.mockImplementation(() => {
        tick += 7;
        child.emit("close", 0, null);
      });
      const harness = createLocalSupabaseConcurrencyHarness({
        timing: { check: "actual-history", isolation: "serial" },
        monotonicNow: () => tick,
        stdout: (line) => lines.push(JSON.parse(line)),
        spawnProcess: () => child,
      });
      const running = verifyProviderResolution(harness);
      const setup = child.stdin.write.mock.calls[0][0];
      expect(setup).toContain(
        "'successful authorization finalizes one Pending Booking Request'",
      );
      expect(setup).toContain("create temp table history_reference");
      expect(setup).toContain(
        "grant select on history_reference to authenticated",
      );
      expect(setup).not.toContain("select 'RESOLVED:'");
      expect(child.stdin.write).toHaveBeenCalledTimes(1);
      tick = 20;
      child.stdout.emit(
        "data",
        "ok 1 - established submission\nRC330_SQL_SETUP_READY\n",
      );
      await vi.advanceTimersByTimeAsync(20);
      expect(child.stdin.write).toHaveBeenCalledTimes(2);
      const body = child.stdin.write.mock.calls[1][0];
      expect(body).toMatch(/^\s*select 'RESOLVED:'/);
      for (const statement of [
        "select 'SOURCE:'",
        "select 'RECEIPTS:'",
        "select 'REPEAT:'",
        "select 'EVIDENCE_TIME:'",
        "select 'EVIDENCE_MOVEMENT:'",
        "select 'RC330_HISTORY_EXECUTION_READY';",
      ])
        expect(body).toContain(statement);
      expect(body).not.toContain("rollback;");
      expect(child.stdin.end).not.toHaveBeenCalled();
      tick = 50;
      child.stdout.emit("data", output);
      await vi.advanceTimersByTimeAsync(20);
      await running;
      expect(child.stdin.end).toHaveBeenCalledExactlyOnceWith("rollback;\n");
      expect(child.kill).not.toHaveBeenCalled();
      harness.finishTiming({ outcome: "passed", cleanupDisposition: "local" });
      expect(lines.at(-1)).toMatchObject({
        setupMs: 20,
        executionMs: 30,
        cleanupMs: 7,
      });

      const children = [childProcess(), childProcess()];
      let position = 0;
      const paired = createLocalSupabaseConcurrencyHarness({
        spawnProcess: () => children[position++],
      });
      const sessions = [];
      for (const [offset, index] of [141, 142].entries()) {
        const opening = prepareHistorySession(paired, index);
        const actor = children[offset];
        const preparation = actor.stdin.write.mock.calls[0][0];
        expect(preparation).toContain("-- BEGIN PAYMENT EVIDENCE FIXTURE");
        expect(preparation).toContain("begin;");
        expect(preparation).toContain(`00000000${index}3`);
        expect(preparation).toContain('"aal":"aal2"');
        expect(preparation).not.toContain("create temp table history_lease");
        expect(actor.stdin.write).toHaveBeenCalledTimes(1);
        actor.stdout.emit("data", "fixture-output\nRC330_SQL_SETUP_READY\n");
        await vi.advanceTimersByTimeAsync(20);
        const session = await opening;
        sessions.push(session);
        const operation = actor.stdin.write.mock.calls[1][0];
        expect(operation).toMatch(/^\s*create temp table history_lease/);
        expect(operation).toContain(
          `lease_booking_request_capture_work('60000000-0000-4000-8000-00000000${index}1'`,
        );
        expect(operation.indexOf("history_lease")).toBeLessThan(
          operation.indexOf("history_execution"),
        );
        expect(operation.indexOf("history_execution")).toBeLessThan(
          operation.indexOf("select 'HISTORY:'"),
        );
        expect(operation).toContain("select 'SEQUENCES:'");
        expect(operation).toContain("select 'HISTORY_READY';");
        expect(operation).not.toMatch(/\b(?:commit|rollback);/);
        actor.stdout.emit("data", "HISTORY_READY\n");
      }
      await Promise.all(
        sessions.map((session) =>
          paired.waitForMarker(session, "HISTORY_READY"),
        ),
      );
      for (const session of sessions) {
        expect(session.exit).toBeUndefined();
        expect(session.child.stdin.end).not.toHaveBeenCalled();
        expect(session.child.stdin.write).toHaveBeenCalledTimes(2);
      }
      for (const session of sessions)
        await paired.finishSession(session, { action: "rollback" });
      for (const actor of children)
        expect(actor.stdin.end).toHaveBeenCalledExactlyOnceWith("rollback;\n");
      const source = readFileSync(
        "scripts/verify-booking-request-payment-history-concurrency.mjs",
        "utf8",
      );
      const readyBarrier = source.indexOf(
        'harness.waitForMarker(session, "HISTORY_READY")',
      );
      expect(
        source.indexOf("sessions.push({ index, request, session })"),
      ).toBeLessThan(readyBarrier);
      expect(readyBarrier).toBeLessThan(
        source.indexOf("select public.record_booking_request_capture_failure"),
      );
      expect(source).toContain(
        "assert.equal(new Set(allSequences).size, allSequences.length)",
      );
      expect(source).toContain('"payment_required"');

      for (const failure of [
        "setup",
        "body",
        "body-timeout",
        "setup-assertion",
      ]) {
        const failedChild = childProcess();
        const primary = new Error("actual history setup failure");
        const failed = createLocalSupabaseConcurrencyHarness({
          spawnProcess: () => failedChild,
          waitLimitMilliseconds: 30,
        });
        const failureRun = verifyProviderResolution(failed).catch(
          (error) => error,
        );
        if (failure === "setup") {
          failedChild.emit("error", primary);
          await vi.advanceTimersByTimeAsync(20);
          expect(await failureRun).toBe(primary);
          expect(failedChild.stdin.write).toHaveBeenCalledTimes(1);
          expect(failedChild.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
        } else {
          failedChild.stdout.emit(
            "data",
            (failure === "setup-assertion"
              ? "not ok 1 - submission setup\n"
              : "ok 1 - setup\n") + "RC330_SQL_SETUP_READY\n",
          );
          await vi.advanceTimersByTimeAsync(20);
          if (failure === "body") {
            failedChild.stderr.emit("data", "actual history body SQL failure");
            failedChild.emit("close", 9, null);
          } else if (failure === "setup-assertion") {
            failedChild.stdout.emit("data", output);
          }
          await vi.advanceTimersByTimeAsync(40);
          const error = await failureRun;
          expect(error.message).toContain(
            failure === "body"
              ? "actual history body SQL failure"
              : failure === "body-timeout"
                ? "PostgreSQL session did not reach RC330_HISTORY_EXECUTION_READY"
                : "The established submission setup must pass",
          );
          if (failure === "body-timeout")
            expect(failedChild.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
          if (failure === "setup-assertion")
            expect(failedChild.stdin.end).toHaveBeenCalledExactlyOnceWith(
              "rollback;\n",
            );
        }
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("declares mixed concurrency checks serial with acknowledged setup", () => {
    for (const name of [
      "verify-booking-request-payment-history-concurrency",
      "verify-booking-event-notification-concurrency",
      "verify-booking-request-notification-concurrency",
      "verify-booking-payout-concurrency",
    ]) {
      const source = readFileSync(`scripts/${name}.mjs`, "utf8");
      expect(source).toMatch(
        new RegExp(`check: "${name}",\\s*isolation: "serial"`),
      );
      expect(source).toMatch(/(?:runSqlAfterSetup|startSessionAfterSetup)\(/);
      expect(source).toContain('harness.markTimingPhase("setup")');
      expect(source).toContain('harness.markTimingPhase("execution")');
      expect(source).toContain('harness.markTimingPhase("cleanup")');
      expect(source).toContain('outcome: passed ? "passed" : "failed"');
      expect(source).toContain('cleanupDisposition: "local"');
    }
  });

  it("awaits the exact ownership inspection before granting asynchronous access", async () => {
    let resolveInspection;
    let settled = false;
    const execute = vi.fn(
      () =>
        new Promise((resolveResult) => {
          resolveInspection = resolveResult;
        }),
    );
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-verification",
        SUPABASE_LOCAL_PROJECT: "rentcottage-verification",
      },
      workingDirectory: "/tmp/rentcottage-worktree",
    });

    const guarded = harness
      .guardDisposableLocalDatabaseAsync(execute)
      .then(() => {
        settled = true;
      });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(execute).toHaveBeenCalledWith("docker", ownershipCommand[1], {
      encoding: "utf8",
      input: undefined,
      maxBuffer: 1024 * 1024,
    });
    resolveInspection({
      status: 0,
      stdout: "rentcottage-verification|/tmp/rentcottage-worktree\n",
      stderr: "",
    });
    await guarded;
    expect(settled).toBe(true);
  });

  it("installs captured function definitions through one session per list", () => {
    for (const name of [
      "verify-booking-request-payment-required-expiry-concurrency",
      "verify-booking-request-payment-recovery-concurrency",
    ]) {
      const source = readFileSync(`scripts/${name}.mjs`, "utf8");
      expect(source).toContain("harness.runStatementsAfterSetup(");
      expect(source).not.toMatch(
        /for \(const \w+ of (?:definitions|signatures|clockSignatures)\b/,
      );
    }
  });

  it("declares payment prefix concurrency checks serial with acknowledged setup", () => {
    const checks = [
      "verify-booking-request-concurrency",
      "verify-booking-request-capture-concurrency",
      "verify-booking-request-payment-recovery-concurrency",
      "verify-booking-request-payment-required-expiry-concurrency",
    ];
    expect(
      databaseCheckCommands
        .map(([, args]) => basename(args[0], ".mjs"))
        .filter((check) => checks.includes(check)),
    ).toEqual(checks);
    for (const check of checks) {
      const source = readFileSync(`scripts/${check}.mjs`, "utf8");
      expect(source).toMatch(
        new RegExp(
          `timing:\\s*\\{\\s*check:\\s*"${check}",\\s*isolation:\\s*"serial"`,
        ),
      );
      expect(source).toContain("runSqlAfterSetup");
      expect(source).toContain("startSessionAfterSetup");
      expect(source).not.toMatch(/paymentEvidenceSql\s*\+/);
    }
  });

  it("rejects an invalid asynchronous guard before execution", async () => {
    const execute = vi.fn();
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_elsewhere",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
    });

    await expect(
      harness.guardDisposableLocalDatabaseAsync(execute),
    ).rejects.toThrow(
      "The guarded local Supabase database identity is invalid.",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "unavailable inspection",
      result: { status: 1, stdout: "", stderr: "unavailable" },
      message: "The guarded local Supabase database container is unavailable.",
    },
    {
      name: "wrong project",
      result: {
        status: 0,
        stdout: "foreign|/tmp/rentcottage-worktree\n",
        stderr: "",
      },
      message:
        "The Supabase database container does not belong to this disposable local checkout.",
    },
    {
      name: "wrong worktree",
      result: {
        status: 0,
        stdout: "rentcottage|/tmp/foreign-worktree\n",
        stderr: "",
      },
      message:
        "The Supabase database container does not belong to this disposable local checkout.",
    },
    {
      name: "execution error result",
      result: { error: new Error("docker unavailable") },
      message: "Unable to execute local Docker.",
    },
  ])(
    "rejects asynchronous ownership for $name",
    async ({ result, message }) => {
      const harness = createLocalSupabaseConcurrencyHarness({
        environment: {
          SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
          SUPABASE_LOCAL_PROJECT: "rentcottage",
        },
        workingDirectory: "/tmp/rentcottage-worktree",
      });

      await expect(
        harness.guardDisposableLocalDatabaseAsync(async () => result),
      ).rejects.toThrow(message);
    },
  );

  it.each([
    new Error("inspection rejected"),
    Object.assign(new Error("inspection cancelled"), { name: "AbortError" }),
  ])("propagates asynchronous inspection rejection: %s", async (error) => {
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
    });

    await expect(
      harness.guardDisposableLocalDatabaseAsync(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });

  it("fails closed before Docker when the local project identity is invalid", () => {
    const spawnSyncProcess = vi.fn();
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_elsewhere",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
      spawnSyncProcess,
      workingDirectory: "/tmp/rentcottage-worktree",
    });

    expect(() => harness.guardDisposableLocalDatabase()).toThrow(
      "The guarded local Supabase database identity is invalid.",
    );
    expect(spawnSyncProcess).not.toHaveBeenCalled();
  });

  it("fails closed when the guarded database container is unavailable", () => {
    const spawnSyncProcess = vi.fn().mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "container unavailable",
    });
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
      spawnSyncProcess,
      workingDirectory: "/tmp/rentcottage-worktree",
    });

    expect(() => harness.guardDisposableLocalDatabase()).toThrow(
      "The guarded local Supabase database container is unavailable.",
    );
    expect(spawnSyncProcess).toHaveBeenCalledTimes(1);
  });

  it("fails closed when Docker reports a different Supabase project", () => {
    const spawnSyncProcess = vi.fn().mockReturnValue({
      status: 0,
      stdout: "foreign-project|/tmp/rentcottage-worktree\n",
      stderr: "",
    });
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
      spawnSyncProcess,
      workingDirectory: "/tmp/rentcottage-worktree",
    });

    expect(() => harness.guardDisposableLocalDatabase()).toThrow(
      "The Supabase database container does not belong to this disposable local checkout.",
    );
    expect(spawnSyncProcess).toHaveBeenCalledTimes(1);
  });

  it("fails closed when Docker reports a different Supabase worktree", () => {
    const spawnSyncProcess = vi.fn().mockReturnValue({
      status: 0,
      stdout: "rentcottage|/tmp/foreign-worktree\n",
      stderr: "",
    });
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
      spawnSyncProcess,
      workingDirectory: "/tmp/rentcottage-worktree",
    });

    expect(() => harness.guardDisposableLocalDatabase()).toThrow(
      "The Supabase database container does not belong to this disposable local checkout.",
    );
    expect(spawnSyncProcess).toHaveBeenCalledTimes(1);
  });

  it("guards the project and worktree before running exact local psql", () => {
    const spawnSyncProcess = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: "rentcottage|/tmp/rentcottage-worktree\n",
        stderr: "",
      })
      .mockReturnValueOnce({ status: 0, stdout: "1\n", stderr: "" });
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage",
        SUPABASE_LOCAL_PROJECT: "rentcottage",
      },
      spawnSyncProcess,
      workingDirectory: "/tmp/rentcottage-worktree",
    });

    harness.guardDisposableLocalDatabase();
    expect(harness.runSql("select 1;")).toBe("1");
    expect(spawnSyncProcess).toHaveBeenNthCalledWith(
      2,
      "docker",
      [
        "exec",
        "-i",
        "supabase_db_rentcottage",
        "psql",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "postgres",
      ],
      expect.objectContaining({ encoding: "utf8", input: "select 1;\n" }),
    );
  });

  it("guards an isolated RentCottage project against its exact container and worktree", () => {
    const spawnSyncProcess = vi.fn().mockReturnValue({
      status: 0,
      stdout: "rentcottage-issue-32-v3|/tmp/rentcottage-issue-32-worktree\n",
      stderr: "",
    });
    const harness = createLocalSupabaseConcurrencyHarness({
      environment: {
        SUPABASE_DB_CONTAINER: "supabase_db_rentcottage-issue-32-v3",
        SUPABASE_LOCAL_PROJECT: "rentcottage-issue-32-v3",
      },
      spawnSyncProcess,
      workingDirectory: "/tmp/rentcottage-issue-32-worktree",
    });

    expect(() => harness.guardDisposableLocalDatabase()).not.toThrow();
    expect(spawnSyncProcess).toHaveBeenCalledWith(
      "docker",
      [
        "inspect",
        "supabase_db_rentcottage-issue-32-v3",
        "--format",
        '{{ index .Config.Labels "com.supabase.cli.project" }}|{{ index .Config.Labels "com.supabase.cli.workdir" }}',
      ],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });
});
