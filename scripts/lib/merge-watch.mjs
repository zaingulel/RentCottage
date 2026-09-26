// merge-watch.mjs — watches one pull request until it merges or can no longer merge unattended.
//
// Read-only: every `gh` call reads pull request state, branch protection, rulesets or checks.
// `gh pr checks --required` lists a check only once GitHub has created its run, so the full
// required set is read first, from the base branch's classic protection and every page of its
// rules; a required name the checks have not listed yet counts as `unreported`. The first `gh`
// failure stops the watch with no retry and no further read, and so does a successful reply it cannot read: a
// required-check list that is not a list of names, a pull request state or merge state it does not know,
// or a required check without a known bucket. There is no wall-clock cap: the caller's runtime
// waits on the process itself.

export const WATCH_INTERVAL_MS = 30_000;

// Rule types that make GitHub require checks the rule does not name.
const UNNAMED_RULE_TYPES = new Set(['workflows', 'code_scanning']);

// The pull request states, GitHub's MergeStateStatus values and the check buckets gh reports.
const PR_STATES = new Set(['OPEN', 'CLOSED', 'MERGED']);
const MERGE_STATES = new Set(['BEHIND', 'BLOCKED', 'CLEAN', 'DIRTY', 'DRAFT', 'HAS_HOOKS', 'UNKNOWN', 'UNSTABLE']);
const BUCKETS = new Set(['pass', 'fail', 'pending', 'skipping', 'cancel']);

// gh's own wording when no check at all has reported on the branch yet.
const NOTHING_REPORTED = 'checks reported on the';

// The text gh printed, on one line so it can stand as the watch's last line of output.
function failureText(err) {
  const text = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim() || err.message;
  return text.replace(/\s*\n\s*/g, ' ');
}

function readRequiredSet(pr, ghExec) {
  const { baseRefName } = JSON.parse(ghExec(['pr', 'view', pr, '--json', 'baseRefName']));
  const branch = JSON.parse(ghExec(['api', `repos/{owner}/{repo}/branches/${baseRefName}`]));
  const classicChecks = branch.protection?.required_status_checks;
  const classic = classicChecks == null ? [] : classicChecks.contexts;
  if (!Array.isArray(classic) || !classic.every((name) => typeof name === 'string' && name !== '')) {
    throw new Error(`unreadable required set: classic required_status_checks ${JSON.stringify(classicChecks)}`);
  }
  const pages = JSON.parse(ghExec(['api', '--paginate', '--slurp', `repos/{owner}/{repo}/rules/branches/${baseRefName}`]));
  if (!Array.isArray(pages) || !pages.every(Array.isArray)) {
    throw new Error(`unreadable required set: rules ${JSON.stringify(pages)}`);
  }
  const ruled = [];
  for (const rule of pages.flat()) {
    if (rule.type === 'required_status_checks') {
      const checks = rule.parameters?.required_status_checks;
      if (!Array.isArray(checks) || !checks.every((check) => typeof check?.context === 'string' && check.context !== '')) {
        throw new Error(`unreadable required set: rule ${JSON.stringify(rule)}`);
      }
      ruled.push(...checks.map((check) => check.context));
    } else if (UNNAMED_RULE_TYPES.has(rule.type)) {
      ruled.push({ unnamed: rule.type });
    }
  }
  return { classic, ruled };
}

// One bucket per reported required check, plus `unreported` for each required name not listed yet.
function readRequiredBuckets(pr, required, ghExec) {
  let checks;
  try {
    checks = JSON.parse(ghExec(['pr', 'checks', pr, '--required', '--json', 'name,bucket']));
  } catch (err) {
    if (!failureText(err).includes(NOTHING_REPORTED)) throw err;
    return required.size === 0 ? [] : ['unreported'];
  }
  if (!Array.isArray(checks)) throw new Error(`unreadable required checks: ${JSON.stringify(checks)}`);
  for (const check of checks) {
    if (!BUCKETS.has(check.bucket)) {
      throw new Error(`unreadable bucket on required check ${JSON.stringify(check.name)}: ${JSON.stringify(check.bucket ?? null)}`);
    }
  }
  const reported = new Set(checks.map((check) => check.name));
  const unreported = [...required].filter((name) => !reported.has(name)).map(() => 'unreported');
  return [...unreported, ...checks.map((check) => check.bucket)];
}

// Resolves to { exitCode, reason }: 0 only when the pull request merged, 1 for every other stop.
export async function watchMerge({ pr, ghExec, sleep }) {
  try {
    const { classic, ruled } = readRequiredSet(pr, ghExec);
    if (ruled.some((entry) => typeof entry !== 'string')) {
      return {
        exitCode: 1,
        reason: `a ruleset requires checks it does not name, so the full required set is unknown: ${JSON.stringify(ruled)}`,
      };
    }
    const required = new Set([...classic, ...ruled]);
    for (;;) {
      const { state, mergeStateStatus } = JSON.parse(ghExec(['pr', 'view', pr, '--json', 'state,mergeStateStatus']));
      if (!PR_STATES.has(state) || !MERGE_STATES.has(mergeStateStatus)) {
        return { exitCode: 1, reason: `unreadable pull request state: ${JSON.stringify({ state, mergeStateStatus })}` };
      }
      const buckets = readRequiredBuckets(pr, required, ghExec);
      const view = `${state} ${mergeStateStatus}`;
      if (state === 'MERGED') return { exitCode: 0, reason: 'merged' };
      if (state === 'CLOSED') return { exitCode: 1, reason: 'closed without merging' };
      if (buckets.includes('fail')) return { exitCode: 1, reason: `a required check failed: ${buckets.join(' ')}` };
      if (mergeStateStatus === 'DIRTY' || mergeStateStatus === 'BEHIND') {
        return { exitCode: 1, reason: `merge blocked: ${view}` };
      }
      if (mergeStateStatus === 'BLOCKED' && !buckets.some((bucket) => bucket === 'pending' || bucket === 'unreported')) {
        return { exitCode: 1, reason: `merge blocked with every required check finished: ${view} ${buckets.join(' ')}`.trimEnd() };
      }
      await sleep(WATCH_INTERVAL_MS);
    }
  } catch (err) {
    return { exitCode: 1, reason: failureText(err) };
  }
}
