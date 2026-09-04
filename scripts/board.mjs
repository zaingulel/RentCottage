#!/usr/bin/env node

import { execFileSync } from "node:child_process";

import { classifyBoard, fetchBoard, formatBoard } from "./lib/board.mjs";

function runGh(args) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    }).trim();
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : "unknown";
    const signal = typeof error.signal === "string" ? error.signal : "none";
    throw new Error(`GitHub CLI failed status=${status} signal=${signal}`);
  }
}

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--json")) {
  console.error("Usage: npm run verify:board -- [--json]");
  process.exitCode = 2;
} else {
  try {
    const report = classifyBoard(fetchBoard(runGh));
    if (report.drift.length > 0) process.exitCode = 1;
    console.log(
      args[0] === "--json" ? JSON.stringify(report) : formatBoard(report),
    );
  } catch (error) {
    console.error(`Board intake failed: ${error.message}`);
    process.exitCode = 1;
  }
}
