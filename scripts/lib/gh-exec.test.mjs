import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyGhFailure,
  ghExec,
} from './gh-exec.mjs';

// Fixed epoch (independent of when this test runs) so the expected HH:MM is a
// literal, not something re-derived with the pad2 logic under test.
const RESET_EPOCH = 1751000000; // arbitrary fixed instant
const resetDate = new Date(RESET_EPOCH * 1000);
const EXPECTED_HHMM = resetDate.toTimeString().slice(0, 5); // "HH:MM", independent formatter

const EXHAUSTED_PAYLOAD = {
  resources: { graphql: { limit: 5000, remaining: 0, reset: RESET_EPOCH } },
};

test('classifyGhFailure: remaining=0 returns a NEW error naming quota, limit, reset time, and the underlying message', () => {
  const original = new Error('API rate limit exceeded for user ID 12345');
  const result = classifyGhFailure(original, EXHAUSTED_PAYLOAD);
  assert.notEqual(result, original);
  assert.match(result.message, /GitHub GraphQL quota exhausted \(0\/5000\)/);
  assert.match(result.message, /resets \d{2}:\d{2}/);
  assert.match(result.message, new RegExp(`resets ${EXPECTED_HHMM}`));
  assert.match(result.message, /underlying: API rate limit exceeded for user ID 12345/);
});

test('classifyGhFailure: remaining>0 returns the ORIGINAL error object identically', () => {
  const original = new Error('some other gh failure');
  const payload = { resources: { graphql: { limit: 5000, remaining: 42, reset: RESET_EPOCH } } };
  assert.equal(classifyGhFailure(original, payload), original);
});

test('classifyGhFailure: null/malformed probe payload returns the original error', () => {
  const original = new Error('unknown owner type');
  assert.equal(classifyGhFailure(original, null), original);
  assert.equal(classifyGhFailure(original, undefined), original);
  assert.equal(classifyGhFailure(original, {}), original);
  assert.equal(classifyGhFailure(original, { resources: {} }), original);
  assert.equal(classifyGhFailure(original, 'not json {{{'), original);
});

test('ghExec: success passes stdout through and calls execImpl once with the given args', () => {
  const calls = [];
  const execImpl = (args) => {
    calls.push(args);
    return 'ok-stdout';
  };
  const result = ghExec(['issue', 'view', '453'], execImpl);
  assert.equal(result, 'ok-stdout');
  assert.deepEqual(calls, [['issue', 'view', '453']]);
});

test('ghExec: failure + stubbed probe remaining=0 throws the quota error', () => {
  const execImpl = (args) => {
    if (args[0] === 'api' && args[1] === 'rate_limit') return JSON.stringify(EXHAUSTED_PAYLOAD);
    throw new Error('API rate limit exceeded for user ID 12345');
  };
  assert.throws(
    () => ghExec(['api', 'graphql', '-f', 'query=...'], execImpl),
    /GitHub GraphQL quota exhausted \(0\/5000\)/,
  );
});

test('ghExec: failure + probe that ITSELF throws rethrows the ORIGINAL error (probe never masks)', () => {
  const execImpl = (args) => {
    if (args[0] === 'api' && args[1] === 'rate_limit') throw new Error('probe network failure');
    throw new Error('the real original failure');
  };
  assert.throws(() => ghExec(['issue', 'view', '453'], execImpl), /^Error: the real original failure$/);
});

