// cli-flags.mjs — the shared numeric-flag reader for the wait scripts.
//
// Numeric flags are validated at parse time because a bad value fails SILENTLY otherwise: Number('abc')
// is NaN, so `Date.now() - started > NaN` is never true and a bad timeout waits forever, a NaN sleep is
// coerced to 0 by setTimeout and turns the poll into a hot loop, and `polls >= NaN` is never true so a
// bad poll budget is no bound at all. An operator who asked for a bound would get none and be told
// nothing (#591). A flag PRESENT with no value (last argument, or followed by another flag) is an error
// too, not the default: substituting the default there discards what was asked for just as silently.
// The accepted range is PER-FLAG because the ranges genuinely differ — 0 and 0.5 minutes are
// legitimate bounds, while a zero or fractional poll budget is meaningless — so each flag passes
// its own { valid, expectation } pair. A rejected value THROWS: printing it and choosing the exit
// code are the CLI wrapper's job, so this file is pure and testable without spawning a script.
export function numericFlagReader(argv) {
  return (name, def, { valid, expectation }) => {
    const i = argv.indexOf(name);
    if (i < 0) return def;
    const raw = argv[i + 1];
    const value = raw?.trim() ? Number(raw) : NaN; // '' and undefined must not become Number('') === 0
    if (!valid(value)) throw new Error(`${name} needs ${expectation}, got "${raw ?? ''}"`);
    return value;
  };
}

export function rejectUnknownArgs(argv, { flags, positionals, expectation }) {
  let nextPositional = 0;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const valueCount = flags.get(arg);
    if (valueCount !== undefined) {
      for (let value = 0; value < valueCount && !argv[i + 1]?.startsWith('--'); value += 1) i += 1;
      continue;
    }
    if (positionals[nextPositional]?.(arg, i)) {
      nextPositional += 1;
      continue;
    }
    throw new Error(`unrecognised argument "${arg}" — ${expectation}`);
  }
}

// Predicate and its human-readable twin travel together: the phrase is what the operator is told
// the flag accepts, so it must not be able to drift from what the flag actually accepts.
export const NON_NEGATIVE = { valid: (v) => Number.isFinite(v) && v >= 0, expectation: 'a non-negative number' };
// The poll-budget range both wait scripts share: zero or fractional polls are meaningless, so the
// budget is a positive whole number. One home so the pair cannot drift between the two callers.
export const POSITIVE_INTEGER = { valid: (v) => Number.isSafeInteger(v) && v > 0, expectation: 'a positive whole number' };
