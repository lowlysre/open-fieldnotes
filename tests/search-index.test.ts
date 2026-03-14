import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSearchText, toSearchIndexItem } from '../src/lib/search-index';

test('buildSearchText strips markdown and html and normalizes case/whitespace', () => {
  const entry = {
    data: {
      title: 'RFD Title',
      number: '0007',
      author: 'Someone',
      state: 'discussion',
      labels: ['public', 'platform'],
    },
    body: '# Header\n\nSome **bold** text with [a link](https://example.com) and <time>tag</time>.\n\n```ts\nconst x = 1;\n```',
  } as any;

  const text = buildSearchText(entry);

  assert.equal(text.includes('```'), false);
  assert.equal(text.includes('<time>'), false);
  assert.equal(text.includes('[a link]'), false);
  assert.ok(text.includes('rfd title'));
  assert.ok(text.includes('some bold text with a link and tag'));
});

test('buildSearchText caps output length', () => {
  const longBody = 'lorem ipsum '.repeat(600);
  const entry = {
    data: {
      title: 'Big',
      number: '0099',
      author: 'author',
      state: 'discussion',
      labels: ['public'],
    },
    body: longBody,
  } as any;

  const text = buildSearchText(entry);
  // combined content budget (10_000) + small metadata overhead
  assert.ok(text.length <= 10100);
});

test('toSearchIndexItem lowercases fields and includes compact searchText', () => {
  const entry = {
    data: {
      title: 'My Title',
      number: '0012',
      author: 'SomeUser',
      state: 'Published',
      labels: ['Public', 'Docs'],
    },
    body: 'Hello **World**',
  } as any;

  const item = toSearchIndexItem(entry);
  assert.equal(item.title, 'my title');
  assert.equal(item.number, '0012');
  assert.equal(item.author, 'someuser');
  assert.equal(item.state, 'published');
  assert.equal(item.labels, 'public docs');
  assert.ok(item.searchText.includes('hello world'));
});

test('buildSearchText handles undefined body input', () => {
  const entry = {
    data: {
      title: 'No Body',
      number: '0013',
      author: 'ghost',
      state: 'discussion',
      labels: ['public'],
    },
    body: undefined,
  } as any;

  const text = buildSearchText(entry);
  assert.ok(text.includes('no body'));
});

test('buildSearchText includes comments after HTML discussion heading', () => {
  const longPrefix = 'intro '.repeat(500);
  const entry = {
    data: {
      title: 'Comment Body',
      number: '0014',
      author: 'ghost',
      state: 'discussion',
      labels: ['public'],
    },
    body: `${longPrefix}\n\n<h2 id="discussion-comments">Discussion Comments</h2>\n\n> bleep`,
  } as any;

  const text = buildSearchText(entry);
  assert.ok(text.includes('bleep'));
});
