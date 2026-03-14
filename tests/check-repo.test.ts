import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findDuplicateCategoryMappings,
  getMissingCategories,
  hasExpectedPublicLabel,
} from '../scripts/check-repo';

const states = {
  prediscussion: { category: 'Pre-Discussion', label: 'Pre-Discussion', color: '#9ca3af' },
  discussion: { category: 'Discussion', label: 'Discussion', color: '#f59e0b' },
  published: { category: 'Published', label: 'Published', color: '#10b981' },
};

test('findDuplicateCategoryMappings detects duplicates case-insensitively', () => {
  const dupes = findDuplicateCategoryMappings({
    one: { category: 'Discussion', label: 'One', color: '#111' },
    two: { category: ' discussion ', label: 'Two', color: '#222' },
    three: { category: 'Published', label: 'Three', color: '#333' },
  });

  assert.equal(dupes.length, 1);
  assert.equal(dupes[0].category, 'Discussion');
  assert.deepEqual(dupes[0].stateKeys, ['one', 'two']);
});

test('findDuplicateCategoryMappings returns empty for unique categories', () => {
  const dupes = findDuplicateCategoryMappings(states);
  assert.deepEqual(dupes, []);
});

test('getMissingCategories returns only categories absent from repo', () => {
  const existing = new Set(['discussion', 'published']);
  const missing = getMissingCategories(states, existing);

  assert.deepEqual(missing, [
    { stateKey: 'prediscussion', categoryLabel: 'Pre-Discussion' },
  ]);
});

test('hasExpectedPublicLabel handles false and case-insensitive matches', () => {
  assert.equal(hasExpectedPublicLabel(false, new Set()), true);
  assert.equal(hasExpectedPublicLabel('Public', new Set(['public'])), true);
  assert.equal(hasExpectedPublicLabel('public', new Set(['internal'])), false);
});
