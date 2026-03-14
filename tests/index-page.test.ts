import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createIndexController,
  initIndexPage,
  mapRowsToItems,
  type RowLike,
} from '../src/scripts/index-page';

interface FakeRow extends RowLike {
  attrs: Record<string, string>;
}

function makeRow(attrs: Record<string, string>): FakeRow {
  return {
    attrs,
    style: { display: '' },
    getAttribute(name: string): string | null {
      return this.attrs[name] ?? null;
    },
  };
}

function makeTbody() {
  const appended: FakeRow[] = [];
  return {
    appended,
    appendChild(row: FakeRow) {
      appended.push(row);
    },
  };
}

test('mapRowsToItems reads row dataset fields', () => {
  const rows = [
    makeRow({
      'data-state': 'published',
      'data-title': 'test title',
      'data-number': '0001',
      'data-updated': '2026-01-01T00:00:00.000Z',
      'data-labels': 'public docs',
      'data-author': 'lowlydba',
    }),
  ];

  const items = mapRowsToItems(rows);
  assert.equal(items.length, 1);
  assert.equal(items[0].state, 'published');
  assert.equal(items[0].title, 'test title');
  assert.equal(items[0].number, '0001');
  assert.equal(items[0].updatedAt, '2026-01-01T00:00:00.000Z');
  assert.equal(items[0].labels, 'public docs');
  assert.equal(items[0].author, 'lowlydba');
});

test('controller applies state-only filters without loading index', async () => {
  const rows = [
    makeRow({ 'data-state': 'discussion', 'data-title': 'db', 'data-number': '0001', 'data-updated': '2026-01-01T00:00:00.000Z', 'data-labels': 'public', 'data-author': 'a' }),
    makeRow({ 'data-state': 'published', 'data-title': 'obs', 'data-number': '0002', 'data-updated': '2026-01-02T00:00:00.000Z', 'data-labels': 'public', 'data-author': 'b' }),
  ];
  const rowItems = mapRowsToItems(rows);
  const tbody = makeTbody();
  const noResults = { style: { display: 'none' } };

  let loadCalls = 0;
  const controller = createIndexController({
    rowItems,
    rowByNumber: new Map(rowItems.map((item) => [item.number, item.row])),
    appendRow: (row) => {
      tbody.appendChild(row);
    },
    noResults,
    initialActiveStates: new Set(['published']),
    loadSearchIndex: async () => {
      loadCalls++;
      return [];
    },
  });

  await controller.applyFilters();

  assert.equal(loadCalls, 0);
  assert.equal(rows[0].style.display, 'none');
  assert.equal(rows[1].style.display, '');
  assert.equal(noResults.style.display, 'none');
});

test('controller loads index for search and maps matches back to rows', async () => {
  const rows = [
    makeRow({ 'data-state': 'discussion', 'data-title': 'db migration', 'data-number': '0001', 'data-updated': '2026-01-01T00:00:00.000Z', 'data-labels': 'public', 'data-author': 'a' }),
    makeRow({ 'data-state': 'published', 'data-title': 'observability', 'data-number': '0002', 'data-updated': '2026-01-02T00:00:00.000Z', 'data-labels': 'public', 'data-author': 'b' }),
  ];
  const rowItems = mapRowsToItems(rows);
  const tbody = makeTbody();
  const noResults = { style: { display: 'none' } };

  let loadCalls = 0;
  const controller = createIndexController({
    rowItems,
    rowByNumber: new Map(rowItems.map((item) => [item.number, item.row])),
    appendRow: (row) => {
      tbody.appendChild(row);
    },
    noResults,
    loadSearchIndex: async () => {
      loadCalls++;
      return [
        {
          number: '0001',
          updatedAt: '2026-01-01T00:00:00.000Z',
          state: 'discussion',
          title: 'db migration strategy',
          labels: 'public',
          author: 'a',
          searchText: 'phased rollout',
        },
      ];
    },
  });

  controller.setSearchTerm('rollout');
  await controller.applyFilters();

  assert.equal(loadCalls, 1);
  assert.equal(rows[0].style.display, '');
  assert.equal(rows[1].style.display, 'none');
  assert.equal(tbody.appended[tbody.appended.length - 1], rows[0]);
  assert.equal(noResults.style.display, 'none');
});

test('controller falls back when index loading fails', async () => {
  const rows = [
    makeRow({ 'data-state': 'discussion', 'data-title': 'database migration', 'data-number': '0001', 'data-updated': '2026-01-01T00:00:00.000Z', 'data-labels': 'public', 'data-author': 'a' }),
  ];
  const rowItems = mapRowsToItems(rows);
  const tbody = makeTbody();
  const noResults = { style: { display: 'none' } };

  let loadCalls = 0;
  const controller = createIndexController({
    rowItems,
    rowByNumber: new Map(rowItems.map((item) => [item.number, item.row])),
    appendRow: (row) => {
      tbody.appendChild(row);
    },
    noResults,
    loadSearchIndex: async () => {
      loadCalls++;
      throw new Error('network error');
    },
  });

  controller.setSearchTerm('migration');
  await controller.applyFilters();

  assert.equal(loadCalls, 1);
  assert.equal(rows[0].style.display, '');
  assert.equal(noResults.style.display, 'none');
});

test('controller returns early when appendRow is null', async () => {
  const rows = [
    makeRow({ 'data-state': 'discussion', 'data-title': 'db', 'data-number': '0001', 'data-updated': '2026-01-01T00:00:00.000Z', 'data-labels': 'public', 'data-author': 'a' }),
  ];
  const rowItems = mapRowsToItems(rows);
  const controller = createIndexController({
    rowItems,
    rowByNumber: new Map(rowItems.map((item) => [item.number, item.row])),
    appendRow: null,
    noResults: null,
    loadSearchIndex: async () => rowItems,
  });

  await controller.applyFilters();
  assert.equal(rows[0].style.display, '');
});

test('controller tolerates matched item without resolvable row and noResults null', async () => {
  const rows = [
    makeRow({ 'data-state': 'discussion', 'data-title': 'db', 'data-number': '0001', 'data-updated': '2026-01-01T00:00:00.000Z', 'data-labels': 'public', 'data-author': 'a' }),
  ];
  const rowItems = mapRowsToItems(rows);
  const tbody = makeTbody();

  const controller = createIndexController({
    rowItems,
    rowByNumber: new Map(),
    appendRow: (row) => {
      tbody.appendChild(row);
    },
    noResults: null,
    loadSearchIndex: async () => [
      {
        number: '9999',
        updatedAt: '2026-01-01T00:00:00.000Z',
        state: 'discussion',
        title: 'missing row',
        labels: 'public',
        author: 'a',
        searchText: 'missing',
      },
    ],
  });

  controller.setSearchTerm('missing');
  await controller.applyFilters();
  assert.equal(tbody.appended.length, 0);
});

test('ensureSearchIndexLoaded only loads once after success', async () => {
  const rows = [
    makeRow({ 'data-state': 'discussion', 'data-title': 'db', 'data-number': '0001', 'data-updated': '2026-01-01T00:00:00.000Z', 'data-labels': 'public', 'data-author': 'a' }),
  ];
  const rowItems = mapRowsToItems(rows);
  const tbody = makeTbody();
  let loadCalls = 0;

  const controller = createIndexController({
    rowItems,
    rowByNumber: new Map(rowItems.map((item) => [item.number, item.row])),
    appendRow: (row) => {
      tbody.appendChild(row);
    },
    noResults: { style: { display: 'none' } },
    loadSearchIndex: async () => {
      loadCalls++;
      return rowItems;
    },
  });

  await controller.ensureSearchIndexLoaded();
  await controller.ensureSearchIndexLoaded();
  assert.equal(loadCalls, 1);
});

test('ensureSearchIndexLoaded returns early after prior load failure', async () => {
  const rows = [
    makeRow({ 'data-state': 'discussion', 'data-title': 'db', 'data-number': '0001', 'data-updated': '2026-01-01T00:00:00.000Z', 'data-labels': 'public', 'data-author': 'a' }),
  ];
  const rowItems = mapRowsToItems(rows);

  let loadCalls = 0;
  const controller = createIndexController({
    rowItems,
    rowByNumber: new Map(rowItems.map((item) => [item.number, item.row])),
    appendRow: (row) => {
      row.style.display = '';
    },
    noResults: null,
    loadSearchIndex: async () => {
      loadCalls++;
      throw new Error('boom');
    },
  });

  await controller.ensureSearchIndexLoaded();
  await controller.ensureSearchIndexLoaded();
  assert.equal(loadCalls, 1);
});

test('controller toggles noResults when zero items match', async () => {
  const rows = [
    makeRow({ 'data-state': 'discussion', 'data-title': 'db', 'data-number': '0001', 'data-updated': '2026-01-01T00:00:00.000Z', 'data-labels': 'public', 'data-author': 'a' }),
  ];
  const rowItems = mapRowsToItems(rows);
  const tbody = makeTbody();
  const noResults = { style: { display: 'none' } };

  const controller = createIndexController({
    rowItems,
    rowByNumber: new Map(rowItems.map((item) => [item.number, item.row])),
    appendRow: (row) => {
      tbody.appendChild(row);
    },
    noResults,
    loadSearchIndex: async () => rowItems,
  });

  controller.setSearchTerm('no-match-term');
  await controller.applyFilters();
    // When zero rows match, the controller explicitly sets 'block' so the message
    // overrides the CSS `display: none` default on `.no-results`.
    assert.equal(noResults.style.display, 'block');
});

test('controller sorts matched rows by selected sort key', async () => {
  const rows = [
    makeRow({ 'data-state': 'discussion', 'data-title': 'beta', 'data-number': '0002', 'data-updated': '2026-01-02T00:00:00.000Z', 'data-labels': 'public', 'data-author': 'a' }),
    makeRow({ 'data-state': 'discussion', 'data-title': 'alpha', 'data-number': '0001', 'data-updated': '2026-01-03T00:00:00.000Z', 'data-labels': 'public', 'data-author': 'a' }),
  ];
  const rowItems = mapRowsToItems(rows);
  const appended: string[] = [];

  const controller = createIndexController({
    rowItems,
    rowByNumber: new Map(rowItems.map((item) => [item.number, item.row])),
    appendRow: (row) => {
      appended.push(row.getAttribute('data-number') ?? '');
    },
    noResults: { style: { display: 'none' } },
    loadSearchIndex: async () => rowItems,
  });

  await controller.applyFilters();
  assert.deepEqual(appended.slice(-2), ['0002', '0001']);

  controller.setSortKey('number-asc');
  await controller.applyFilters();
  assert.deepEqual(appended.slice(-2), ['0001', '0002']);

  controller.setSortKey('title-desc');
  await controller.applyFilters();
  assert.deepEqual(appended.slice(-2), ['0002', '0001']);

  controller.setSortKey('updated-desc');
  await controller.applyFilters();
  assert.deepEqual(appended.slice(-2), ['0001', '0002']);
});

test('initIndexPage returns null when root is missing', () => {
  const fakeDoc = {
    querySelector: () => null,
  } as any;

  const controller = initIndexPage(fakeDoc);
  assert.equal(controller, null);
});

test('initIndexPage wires events and drives controller', async () => {
  const rows = [
    makeRow({ 'data-state': 'discussion', 'data-title': 'db migration', 'data-number': '0001', 'data-updated': '2026-01-01T00:00:00.000Z', 'data-labels': 'public', 'data-author': 'a' }),
  ];

  const listeners: Record<string, Function> = {};
  const searchInput = {
    value: '',
    addEventListener(event: string, cb: Function) {
      listeners[`search:${event}`] = cb;
    },
  };

  const buttonListeners: Record<string, Function> = {};
  const button = {
    getAttribute(name: string) {
      if (name === 'data-state') return 'discussion';
      return null;
    },
    classList: {
      add: () => undefined,
      remove: () => undefined,
      toggle: () => undefined,
      contains: () => false,
    },
     setAttribute(_name: string, _value: string) {},
    addEventListener(event: string, cb: Function) {
      buttonListeners[event] = cb;
    },
  };

  const resultsList = {
    appended: [] as FakeRow[],
    querySelectorAll(selector: string) {
      if (selector === '[data-rfd-row]') return rows;
      return [];
    },
    appendChild(row: FakeRow) {
      this.appended.push(row);
    },
  };

  const noResults = { style: { display: 'none' } };
  const pageRoot = {
    getAttribute(name: string) {
      if (name === 'data-search-index-url') return '/search-index.json';
      return null;
    },
  };

  const fakeDoc = {
    querySelector(selector: string) {
      if (selector === '.index-page') return pageRoot;
      return null;
    },
    getElementById(id: string) {
      if (id === 'rfd-results-list') return resultsList;
      if (id === 'no-results') return noResults;
      if (id === 'search-input') return searchInput;
      return null;
    },
    querySelectorAll(selector: string) {
      if (selector === '.state-btn') return [button];
      return [];
    },
  } as any;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => [
      {
        number: '0001',
        updatedAt: '2026-01-01T00:00:00.000Z',
        state: 'discussion',
        title: 'db migration',
        labels: 'public',
        author: 'a',
        searchText: 'migration',
      },
    ],
  })) as any;

  try {
    const controller = initIndexPage(fakeDoc);
    assert.ok(controller);

    listeners['search:input']({ target: { value: 'migration' } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    listeners['search:focus']();
    await new Promise((resolve) => setTimeout(resolve, 0));

    buttonListeners.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(rows[0].style.display, '');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
