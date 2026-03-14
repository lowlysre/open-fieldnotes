import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseTitle,
  getDefaultStateKey,
  escapeYamlString,
  buildFrontmatter,
  linkifyGithubMentions,
  toBlockquote,
  formatDisplayDate,
  formatFullTimestamp,
  extractFrontmatterDiscussionUrl,
  getStaleSlugsForDiscussion,
  planRfds,
  parsePositiveIntEnv,
  resolveFetchRateLimitConfig,
  computeResetWaitMs,
} from '../scripts/fetch-discussions';

function discussion(overrides: Record<string, unknown> = {}): any {
  return {
    number: 1,
    title: 'RFD 0001: Test Proposal',
    body: 'Body',
    url: 'https://github.com/org/repo/discussions/1',
    createdAt: '2026-03-14T10:00:00Z',
    updatedAt: '2026-03-14T10:00:00Z',
    category: { name: 'Discussion' },
    author: { login: 'alice' },
    labels: { nodes: [{ name: 'public' }] },
    ...overrides,
  };
}

test('parseTitle parses valid format and trims title', () => {
  assert.deepEqual(parseTitle('RFD 42:  My Proposal  '), {
    number: '0042',
    title: 'My Proposal',
  });
});

test('parseTitle returns null number for non-matching titles', () => {
  assert.deepEqual(parseTitle('General thread'), {
    number: null,
    title: 'General thread',
  });
});

test('getDefaultStateKey chooses discussion key first', () => {
  const result = getDefaultStateKey({
    discussion: { category: 'Anything', label: 'Discussion', color: '#f59e0b' },
    published: { category: 'Published', label: 'Published', color: '#10b981' },
  });
  assert.equal(result, 'discussion');
});

test('getDefaultStateKey falls back to category named Discussion', () => {
  const result = getDefaultStateKey({
    draft: { category: 'Pre-Discussion', label: 'Pre', color: '#aaa' },
    active: { category: 'Discussion', label: 'Active', color: '#bbb' },
  });
  assert.equal(result, 'active');
});

test('getDefaultStateKey falls back to first state and throws on empty', () => {
  const result = getDefaultStateKey({
    one: { category: 'One', label: 'One', color: '#111' },
  });
  assert.equal(result, 'one');

  assert.throws(() => getDefaultStateKey({}), /must define at least one state/i);
});

test('escapeYamlString and buildFrontmatter escape special characters', () => {
  assert.equal(escapeYamlString('a"b\\c'), '"a\\"b\\\\c"');

  const fm = buildFrontmatter({
    title: 'A "Quote"',
    labels: ['x', 'y"z'],
  });

  assert.ok(fm.includes('title: "A \\"Quote\\""'));
  assert.ok(fm.includes('labels: ["x", "y\\"z"]'));
});

test('linkifyGithubMentions and toBlockquote format output', () => {
  const linked = linkifyGithubMentions('Thanks @octocat and @hubot');
  assert.ok(linked.includes('[@octocat](https://github.com/octocat)'));
  assert.ok(linked.includes('[@hubot](https://github.com/hubot)'));

  const quoted = toBlockquote('line 1\n\nline 2');
  assert.equal(quoted, '> line 1\n>\n> line 2');
});

test('date formatters return fallback for missing dates', () => {
  assert.equal(formatDisplayDate(undefined), 'unknown date');
  assert.equal(formatFullTimestamp(undefined), 'unknown timestamp');
});

test('planRfds filters private entries and uses gh fallback slugs', () => {
  const d1 = discussion({ number: 7, title: 'General topic', labels: { nodes: [{ name: 'public' }] } });
  const d2 = discussion({ number: 8, title: 'RFD 0008: Explicit', labels: { nodes: [{ name: 'public' }] } });
  const d3 = discussion({ number: 9, title: 'RFD 0009: Private', labels: { nodes: [{ name: 'internal' }] } });

  const result = planRfds([d1, d2, d3], 'public');

  assert.equal(result.skippedPrivate, 1);
  assert.equal(result.fallbackSlug, 1);
  assert.deepEqual(result.planned.map((p) => p.slug), ['gh-7', '0008']);
  assert.ok(result.warnings.some((w) => w.includes('fallback slug "gh-7"')));
});

test('planRfds warns on title collisions but allows unique slugs', () => {
  const a = discussion({ number: 1, title: 'Duplicate Title', url: 'u1' });
  const b = discussion({ number: 2, title: 'Duplicate Title', url: 'u2' });

  const result = planRfds([a, b], false);
  assert.equal(result.planned.length, 2);
  assert.ok(result.warnings.some((w) => w.includes('Title collision')));
});

test('planRfds throws on slug conflict', () => {
  const a = discussion({ number: 1, title: 'RFD 0001: First', url: 'u1' });
  const b = discussion({ number: 2, title: 'RFD 0001: Second', url: 'u2' });

  assert.throws(
    () => planRfds([a, b], false),
    /RFD number conflict \(0001\)/
  );
});

test('extractFrontmatterDiscussionUrl reads URL from frontmatter', () => {
  const markdown = [
    '---',
    'number: "gh-2"',
    'discussionUrl: "https://github.com/org/repo/discussions/2"',
    'author: "alice"',
    '---',
    '',
    'Body',
  ].join('\n');

  assert.equal(
    extractFrontmatterDiscussionUrl(markdown),
    'https://github.com/org/repo/discussions/2'
  );
  assert.equal(extractFrontmatterDiscussionUrl('No frontmatter here'), null);
});

test('getStaleSlugsForDiscussion excludes only planned slug', () => {
  const stale = getStaleSlugsForDiscussion(['0002', 'gh-2'], 'gh-2');
  assert.deepEqual(stale, ['0002']);
});

test('buildFrontmatter includes labelColors parallel to labels', () => {
  const fm = buildFrontmatter({
    number: '0001',
    title: 'Test',
    state: 'discussion',
    labels: ['bug', 'docs'],
    labelColors: ['d73a4a', '0075ca'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    discussionUrl: 'https://github.com/org/repo/discussions/1',
    author: 'alice',
  });
  assert.ok(fm.includes('labelColors: ["d73a4a", "0075ca"]'));
  assert.ok(fm.includes('labels: ["bug", "docs"]'));
});

test('parsePositiveIntEnv returns fallback for invalid values', () => {
  assert.equal(parsePositiveIntEnv(undefined, 42), 42);
  assert.equal(parsePositiveIntEnv('', 42), 42);
  assert.equal(parsePositiveIntEnv('0', 42), 42);
  assert.equal(parsePositiveIntEnv('-5', 42), 42);
  assert.equal(parsePositiveIntEnv('abc', 42), 42);
  assert.equal(parsePositiveIntEnv('25', 42), 25);
});

test('resolveFetchRateLimitConfig uses defaults and env overrides', () => {
  const defaults = resolveFetchRateLimitConfig({} as NodeJS.ProcessEnv);
  assert.equal(defaults.maxGraphqlRequests, 180);
  assert.equal(defaults.minRemaining, 100);
  assert.equal(defaults.requestThrottleMs, 150);

  const overridden = resolveFetchRateLimitConfig({
    OPEN_FIELDNOTES_MAX_GRAPHQL_REQUESTS: '250',
    OPEN_FIELDNOTES_MIN_RATE_REMAINING: '75',
    OPEN_FIELDNOTES_RATE_RESET_BUFFER_SECONDS: '20',
    OPEN_FIELDNOTES_MAX_WAIT_FOR_RESET_SECONDS: '1200',
    OPEN_FIELDNOTES_RATE_LOG_EVERY: '10',
    OPEN_FIELDNOTES_REQUEST_THROTTLE_MS: '500',
  } as NodeJS.ProcessEnv);

  assert.equal(overridden.maxGraphqlRequests, 250);
  assert.equal(overridden.minRemaining, 75);
  assert.equal(overridden.resetBufferSeconds, 20);
  assert.equal(overridden.maxWaitSeconds, 1200);
  assert.equal(overridden.logEveryRequests, 10);
  assert.equal(overridden.requestThrottleMs, 500);
});

test('computeResetWaitMs includes reset delta and safety buffer', () => {
  const now = Date.parse('2026-03-14T10:00:00Z');
  const wait = computeResetWaitMs('2026-03-14T10:01:00Z', now, 15);
  assert.equal(wait, 75_000);

  const pastReset = computeResetWaitMs('2026-03-14T09:59:00Z', now, 15);
  assert.equal(pastReset, 15_000);
});
