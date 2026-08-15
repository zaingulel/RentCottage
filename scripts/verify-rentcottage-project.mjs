#!/usr/bin/env node

import { runRentCottageProjectVerifier } from "./lib/rentcottage-verifier.mjs";

const { status } = runRentCottageProjectVerifier({});
process.exitCode = status;
