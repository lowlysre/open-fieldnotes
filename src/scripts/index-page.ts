import { createSearchEngine, filterSearchItems, type RfdSearchFields } from '../lib/rfd-search';

export interface RowLike {
  getAttribute(name: string): string | null;
  style: { display: string };
}

export interface IndexSearchItem extends RfdSearchFields {
  number: string;
  row?: RowLike;
  index?: number;
}

export interface IndexController<RowT extends RowLike> {
  toggleState(state: string): void;
  setSearchTerm(term: string): void;
  ensureSearchIndexLoaded(): Promise<void>;
  applyFilters(): Promise<void>;
}

export interface CreateIndexControllerParams<RowT extends RowLike> {
  rowItems: Array<IndexSearchItem & { row: RowT }>;
  rowByNumber: Map<string, RowT>;
  appendRow: ((row: RowT) => void) | null;
  noResults: { style: { display: string } } | null;
  loadSearchIndex: () => Promise<IndexSearchItem[]>;
  initialActiveStates?: Set<string>;
}

export function mapRowsToItems<RowT extends RowLike>(rows: RowT[]): Array<IndexSearchItem & { row: RowT }> {
  return rows.map((row, index) => ({
    index,
    row,
    state: row.getAttribute('data-state') ?? '',
    title: row.getAttribute('data-title') ?? '',
    number: row.getAttribute('data-number') ?? '',
    labels: row.getAttribute('data-labels') ?? '',
    author: row.getAttribute('data-author') ?? '',
  }));
}

export function createIndexController<RowT extends RowLike>(
  params: CreateIndexControllerParams<RowT>
): IndexController<RowT> {
  const { rowItems, rowByNumber, appendRow, noResults, loadSearchIndex, initialActiveStates } = params;

  const derivedStates = new Set(rowItems.map((i) => i.state).filter(Boolean));
  let activeStates: Set<string> = initialActiveStates ?? derivedStates;
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

    rowItems.forEach((item) => {
      item.row.style.display = 'none';
    });

    let visible = 0;
    matchedItems.forEach((item) => {
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

  return controller;
}

if (typeof document !== 'undefined') {
  initIndexPage(document);
}
