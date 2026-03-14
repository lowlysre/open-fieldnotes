import assert from 'node:assert/strict';
import test from 'node:test';

import { createSearchEngine, exactContains, filterSearchItems, type RfdSearchFields } from '../src/lib/rfd-search';

interface Item extends RfdSearchFields {
  id: string;
}

const items: Item[] = [
  {
    id: '0001',
    state: 'discussion',
    title: 'Database migration strategy',
    number: '0001',
    labels: 'public architecture',
    author: 'lowlydba',
    searchText: 'proposal to move postgres workloads from vm to k8s with phased rollout',
  },
  {
    id: '0002',
    state: 'published',
    title: 'Observability baseline',
    number: '0002',
    labels: 'public monitoring',
    author: 'opsbot',
    searchText: 'dashboards metrics traces and alert routing runbook updates',
  },
  {
    id: '0003',
    state: 'abandoned',
    title: 'Legacy rollback policy',
    number: '0003',
    labels: 'internal rollback',
    author: 'dbadmin',
    searchText: 'rollback script deprecation and maintenance burden summary',
  },
];

function run(activeStates: Set<string>, searchTerm: string): Item[] {
  const fuse = createSearchEngine(items);
  return filterSearchItems({
    items,
    fuse,
    activeStates,
    searchTerm,
  });
}

const ALL = new Set<string>(); // empty = show all

test('returns all items when no search term and all states', () => {
  const result = run(ALL, '');
  assert.equal(result.length, 3);
});

test('filters by state when no search term', () => {
  const result = run(new Set(['published']), '');
  assert.deepEqual(result.map((r) => r.id), ['0002']);
});

test('fuzzy title search matches typo', () => {
  const result = run(ALL, 'migratoin');
  assert.ok(result.some((r) => r.id === '0001'));
});

test('search can match labels and author fields', () => {
  const byLabel = run(ALL, 'monitoring');
  assert.ok(byLabel.some((r) => r.id === '0002'));

  const byAuthor = run(ALL, 'dbadmin');
  assert.ok(byAuthor.some((r) => r.id === '0003'));
});

test('search can match precomputed full-text field', () => {
  const result = run(ALL, 'phased rollout');
  assert.ok(result.some((r) => r.id === '0001'));
});

test('search and state filter compose together', () => {
  const result = run(new Set(['published']), 'monitor');
  assert.deepEqual(result.map((r) => r.id), ['0002']);

  const mismatch = run(new Set(['published']), 'rollback');
  assert.equal(mismatch.length, 0);
});

test('multiple active states work as OR filter', () => {
  const result = run(new Set(['published', 'abandoned']), '');
  assert.deepEqual(result.map((r) => r.id).sort(), ['0002', '0003']);
});

test('exactContains matches substring across all indexed fields', () => {
  const hits = exactContains(items, 'phased rollout');
  assert.deepEqual(hits.map((r) => r.id), ['0001']);

  assert.deepEqual(exactContains(items, 'zzz'), []);
});

test('exact match is preferred over fuzzy when both could match', () => {
  // 'monitoring' is an exact substring of labels field; no fuzzy needed
  const result = run(ALL, 'monitoring');
  assert.ok(result.some((r) => r.id === '0002'));
  // 'loremat' has no exact match and no fuzzy match against this dataset
  const noMatch = run(ALL, 'loremat');
  assert.equal(noMatch.length, 0);
});
