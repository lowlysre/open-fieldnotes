import Fuse from 'fuse.js';

export interface RfdSearchFields {
  state: string;
  title: string;
  number: string;
  updatedAt: string;
  labels: string;
  author: string;
  searchText?: string;
}

export function createSearchEngine<T extends RfdSearchFields>(items: T[]): Fuse<T> {
  return new Fuse(items, {
    includeScore: true,
    shouldSort: true,
    ignoreLocation: true,
    threshold: 0.35,
    minMatchCharLength: 2,
    keys: [
      { name: 'title', weight: 0.35 },
      { name: 'searchText', weight: 0.35 },
      { name: 'number', weight: 0.15 },
      { name: 'labels', weight: 0.08 },
      { name: 'state', weight: 0.04 },
      { name: 'author', weight: 0.03 },
    ],
  });
}

// Fast substring check across all fields. Used before Fuse to surface exact
// hits first and avoid fuzzy false-positives for short common terms.
export function exactContains<T extends RfdSearchFields>(items: T[], term: string): T[] {
  return items.filter(
    (item) =>
      item.title.includes(term) ||
      (item.searchText?.includes(term) ?? false) ||
      item.number.includes(term) ||
      item.labels.includes(term) ||
      item.author.includes(term) ||
      item.state.includes(term)
  );
}

// Two-stage strategy: apply state filters first to reduce search work,
// then prefer exact substring matches and fall back to Fuse fuzzy matching.
export function filterSearchItems<T extends RfdSearchFields>(params: {
  items: T[];
  fuse: Fuse<T>;
  activeStates: Set<string>;
  searchTerm: string;
}): T[] {
  const { items, fuse, activeStates, searchTerm } = params;

  const filterByState = (list: T[]): T[] =>
    activeStates.size === 0 ? list : list.filter((item) => activeStates.has(item.state));

  const scopedItems = filterByState(items);
  if (!searchTerm) return scopedItems;

  const exact = exactContains(scopedItems, searchTerm);
  if (exact.length > 0) return exact;

  // Reuse the pre-built index when no state filter is active.
  if (scopedItems.length === items.length) {
    return fuse.search(searchTerm).map((result) => result.item);
  }

  return createSearchEngine(scopedItems)
    .search(searchTerm)
    .map((result) => result.item);
}
