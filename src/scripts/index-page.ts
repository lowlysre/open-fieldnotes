import { createSearchEngine, filterSearchItems, type RfdSearchFields } from '../lib/rfd-search';

export interface RowLike {
  getAttribute(name: string): string | null;
  style: { display: string };
}

export interface IndexSearchItem extends RfdSearchFields {
  number: string;
  createdAt: string;
  updatedAt: string;
  commentCount: number;
  row?: RowLike;
  index?: number;
}

export interface IndexController<RowT extends RowLike> {
  toggleState(state: string): void;
  setSearchTerm(term: string): void;
  setSortKey(sortKey: SortKey): void;
  ensureSearchIndexLoaded(): Promise<void>;
  applyFilters(): Promise<void>;
}

export type SortKey =
  | 'number-desc'
  | 'number-asc'
  | 'title-asc'
  | 'title-desc'
  | 'created-desc'
  | 'created-asc'
  | 'updated-desc'
  | 'updated-asc'
  | 'comments-desc'
  | 'comments-asc'
  | 'state-asc'
  | 'state-desc';

export interface CreateIndexControllerParams<RowT extends RowLike> {
  rowItems: Array<IndexSearchItem & { row: RowT }>;
  rowByNumber: Map<string, RowT>;
  appendRow: ((row: RowT) => void) | null;
  noResults: { style: { display: string } } | null;
  loadSearchIndex: () => Promise<IndexSearchItem[]>;
  initialActiveStates?: Set<string>;
  initialSortKey?: SortKey;
}

function sortItems<T extends IndexSearchItem>(items: T[], sortKey: SortKey): T[] {
  const sorted = [...items];
  const cmpNumber = (a: T, b: T) => a.number.localeCompare(b.number, undefined, { numeric: true, sensitivity: 'base' });
  const cmpState = (a: T, b: T) => a.state.localeCompare(b.state, undefined, { sensitivity: 'base' });
  const cmpTitle = (a: T, b: T) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  const cmpCreated = (a: T, b: T) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
  const cmpUpdated = (a: T, b: T) => a.updatedAt.localeCompare(b.updatedAt);
  const cmpComments = (a: T, b: T) => a.commentCount - b.commentCount;

  if (sortKey === 'number-asc') {
    sorted.sort(cmpNumber);
    return sorted;
  }
  if (sortKey === 'number-desc') {
    sorted.sort((a, b) => cmpNumber(b, a));
    return sorted;
  }
  if (sortKey === 'title-desc') {
    sorted.sort((a, b) => cmpTitle(b, a));
    return sorted;
  }
  if (sortKey === 'updated-asc') {
    sorted.sort(cmpUpdated);
    return sorted;
  }
  if (sortKey === 'created-asc') {
    sorted.sort(cmpCreated);
    return sorted;
  }
  if (sortKey === 'created-desc') {
    sorted.sort((a, b) => cmpCreated(b, a));
    return sorted;
  }
  if (sortKey === 'updated-desc') {
    sorted.sort((a, b) => cmpUpdated(b, a));
    return sorted;
  }
  if (sortKey === 'comments-asc') {
    sorted.sort((a, b) => cmpComments(a, b) || cmpUpdated(b, a));
    return sorted;
  }
  if (sortKey === 'comments-desc') {
    sorted.sort((a, b) => cmpComments(b, a) || cmpUpdated(b, a));
    return sorted;
  }
  if (sortKey === 'state-asc') {
    sorted.sort((a, b) => cmpState(a, b) || cmpUpdated(b, a));
    return sorted;
  }
  if (sortKey === 'state-desc') {
    sorted.sort((a, b) => cmpState(b, a) || cmpUpdated(b, a));
    return sorted;
  }
  sorted.sort(cmpTitle);
  return sorted;
}

export function mapRowsToItems<RowT extends RowLike>(rows: RowT[]): Array<IndexSearchItem & { row: RowT }> {
  return rows.map((row, index) => ({
    index,
    row,
    state: row.getAttribute('data-state') ?? '',
    title: row.getAttribute('data-title') ?? '',
    number: row.getAttribute('data-number') ?? '',
    createdAt: row.getAttribute('data-created') ?? '',
    updatedAt: row.getAttribute('data-updated') ?? '',
    commentCount: Number.parseInt(row.getAttribute('data-comment-count') ?? '0', 10) || 0,
    labels: row.getAttribute('data-labels') ?? '',
    author: row.getAttribute('data-author') ?? '',
  }));
}

export function createIndexController<RowT extends RowLike>(
  params: CreateIndexControllerParams<RowT>
): IndexController<RowT> {
  const { rowItems, rowByNumber, appendRow, noResults, loadSearchIndex, initialActiveStates, initialSortKey } = params;

  const derivedStates = new Set(rowItems.map((i) => i.state).filter(Boolean));
  let activeStates: Set<string> = initialActiveStates ?? derivedStates;
  let sortKey: SortKey = initialSortKey ?? 'number-desc';
  let searchTerm = '';
  // Lazily populated the first time a search is executed or the input is focused.
  let indexedItems: IndexSearchItem[] | null = null;
  let fuse: ReturnType<typeof createSearchEngine<IndexSearchItem>> | null = null;
  let indexLoadError = false;

  async function ensureSearchIndexLoaded(): Promise<void> {
    // Guard: only fetch once, and fall back to row-metadata search on error.
    if (indexedItems || indexLoadError) return;

    try {
      indexedItems = await loadSearchIndex();
      fuse = createSearchEngine(indexedItems);
    } catch (_err) {
      // Fallback to row metadata search if index fails to load.
      indexLoadError = true;
      indexedItems = rowItems;
      fuse = createSearchEngine(indexedItems);
    }
  }

  async function applyFilters(): Promise<void> {
    if (!appendRow) return;

    if (searchTerm && !fuse) {
      await ensureSearchIndexLoaded();
    }

    const sourceItems = indexedItems ?? rowItems;
    const sourceFuse = fuse ?? createSearchEngine(sourceItems);
    const matchedItems = filterSearchItems({
      items: sourceItems,
      fuse: sourceFuse,
      activeStates,
      searchTerm,
    });
    const orderedItems = sortItems(matchedItems, sortKey);

    rowItems.forEach((item) => {
      item.row.style.display = 'none';
    });

    let visible = 0;
    orderedItems.forEach((item) => {
      const row = (item.row as RowT | undefined) ?? rowByNumber.get(item.number);
      if (!row) return;
      row.style.display = '';
      appendRow(row);
      visible++;
    });

    if (noResults) {
      // Use explicit 'block' (not '') so the message overrides the CSS `display: none` default.
      noResults.style.display = visible === 0 ? 'block' : 'none';
    }
  }

  return {
    toggleState(state: string) {
      if (activeStates.has(state)) {
        activeStates.delete(state);
      } else {
        activeStates.add(state);
      }
    },
    setSearchTerm(term: string) {
      searchTerm = term.toLowerCase().trim();
    },
    setSortKey(nextSortKey: SortKey) {
      sortKey = nextSortKey;
    },
    ensureSearchIndexLoaded,
    applyFilters,
  };
}

export function initIndexPage(doc: Document = document): IndexController<HTMLElement> | null {
  const pageRoot = doc.querySelector('.index-page');
  if (!pageRoot) return null;

  const searchIndexUrl = pageRoot.getAttribute('data-search-index-url') ?? '/search-index.json';
  const resultsList = doc.getElementById('rfd-results-list');
  const noResults = doc.getElementById('no-results');
  const searchInput = doc.getElementById('search-input') as HTMLInputElement | null;
  const sortSelect = doc.getElementById('sort-select') as HTMLSelectElement | null;
  const stateButtons = doc.querySelectorAll('.state-btn');
  const initialActiveStates = new Set(
    Array.from(stateButtons)
      .filter((btn) => btn.classList.contains('active'))
      .map((btn) => btn.getAttribute('data-state') ?? '')
      .filter(Boolean)
  );

  const rows = resultsList ? Array.from(resultsList.querySelectorAll('[data-rfd-row]')) as HTMLElement[] : [];
  const rowItems = mapRowsToItems(rows);
  const rowByNumber = new Map(rowItems.map((item) => [item.number, item.row]));

  const controller = createIndexController({
    rowItems,
    rowByNumber,
    appendRow: resultsList ? (row) => {
      resultsList.appendChild(row);
    } : null,
    noResults,
    initialActiveStates,
    loadSearchIndex: async () => {
      const response = await fetch(searchIndexUrl);
      if (!response.ok) {
        throw new Error(`Failed to load search index (${response.status})`);
      }
      return await response.json() as IndexSearchItem[];
    },
  });

  stateButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const isNowActive = !btn.classList.contains('active');
      btn.classList.toggle('active');
      btn.setAttribute('aria-pressed', isNowActive ? 'true' : 'false');
      controller.toggleState(btn.getAttribute('data-state') ?? '');
      void controller.applyFilters();
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      controller.setSearchTerm(target.value);
      void controller.applyFilters();
    });

    searchInput.addEventListener('focus', () => {
      void controller.ensureSearchIndexLoaded();
    }, { once: true });
  }

  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      controller.setSortKey(target.value as SortKey);
      void controller.applyFilters();
    });
  }

  return controller;
}

if (typeof document !== 'undefined') {
  initIndexPage(document);
}
