#!/usr/bin/env node

import { checkClaudeHandoff } from "../../scripts/lib/handoff-hook-adapters.mjs";
import { runHandoffHook } from "../../scripts/lib/handoff-hook-runtime.mjs";

process.exitCode = await runHandoffHook(checkClaudeHandoff);
