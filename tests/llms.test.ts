import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLlmsTxt, joinSiteUrl } from '../src/lib/llms';

test('joinSiteUrl respects base path and child paths', () => {
  assert.equal(joinSiteUrl('https://lowlydba.github.io', '/open-fieldnotes/'), 'https://lowlydba.github.io/open-fieldnotes');
  assert.equal(joinSiteUrl('https://lowlydba.github.io', '/open-fieldnotes/', 'search-index.json'), 'https://lowlydba.github.io/open-fieldnotes/search-index.json');
  assert.equal(joinSiteUrl('https://lowlydba.github.io', '/', 'llms.txt'), 'https://lowlydba.github.io/llms.txt');
});

test('buildLlmsTxt injects config and live stats', () => {
  const text = buildLlmsTxt({
    site: 'https://lowlydba.github.io',
    config: {
      title: "OpenFieldNotes's Field Notes",
      description: 'Requests for Discussion for the OpenFieldNotes project.',
      org: 'lowlydba',
      repo: 'open-fieldnotes',
      base: '/open-fieldnotes/',
      publicLabel: 'public',
      states: {
        discussion: { category: 'Discussion', label: 'Discussion', color: '#f59e0b' },
        published: { category: 'Published', label: 'Published', color: '#10b981' },
      },
    },
    stats: {
      rfdCount: 12,
      stateCounts: [
        { key: 'discussion', label: 'Discussion', count: 7 },
        { key: 'published', label: 'Published', count: 5 },
      ],
    },
  });

  assert.ok(text.includes("# OpenFieldNotes's Field Notes"));
  assert.ok(text.includes('https://lowlydba.github.io/open-fieldnotes'));
  assert.ok(text.includes('Total RFDs: 12'));
  assert.ok(text.includes('- Discussion (discussion): 7'));
  assert.ok(text.includes('Only discussions labeled "public" are published.'));
});
