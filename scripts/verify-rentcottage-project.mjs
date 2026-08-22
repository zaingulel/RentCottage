#!/usr/bin/env node

import { runRentCottageProjectVerifierCommand } from "./lib/rentcottage-verifier.mjs";

const { status } = runRentCottageProjectVerifierCommand(process.argv.slice(2));
process.exitCode = status;
