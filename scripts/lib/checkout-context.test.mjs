// checkout-context.test.mjs — git's own answer to "is this the root checkout?", on a throwaway
// repository with one linked worktree, so the resolver the hook injects is proven against real git
// rather than against a path convention. Mutation: compare gitDir to itself and the worktree reads
// as the root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkoutContext } from './checkout-context.mjs';

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

test('checkoutContext tells the main working tree from a linked worktree, and says when it cannot read the directory', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'checkout-context-'));
  try {
    const root = join(scratch, 'repo');
    mkdirSync(root);
    git(root, 'init', '-q', '-b', 'main');
    git(root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'init');
    const job = join(root, '.claude', 'worktrees', '1170');
    git(root, 'worktree', 'add', '-q', job, '-b', 'worktree-1170');
    mkdirSync(join(root, 'src'));

    const fromRoot = checkoutContext(root).checkout;
    assert.equal(fromRoot.cwd, root);
    assert.equal(fromRoot.isRootCheckout(root), true);
    assert.equal(fromRoot.isRootCheckout(join(root, 'src')), true, 'a subdirectory of the root is still the root checkout');
    assert.equal(fromRoot.isRootCheckout(job), false);

    const fromJob = checkoutContext(job).checkout;
    assert.equal(fromJob.isRootCheckout(job), false);
    assert.equal(fromJob.isRootCheckout(root), true);
    assert.equal(fromJob.isRootCheckout(join(scratch, 'missing')), false, 'a directory git cannot read is not the root');

    const outside = checkoutContext(scratch);
    assert.equal(outside.checkout, undefined);
    assert.match(outside.unresolved, /cannot resolve the working directory/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
