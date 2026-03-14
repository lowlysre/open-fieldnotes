import Fuse from 'fuse.js';

export interface RfdSearchFields {
  state: string;
  title: string;
  number: string;
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

// Two-stage strategy: prefer exact substring matches across all fields;
// fall back to Fuse.js fuzzy matching only when no exact match exists.
// State filter is applied after text matching.
export function filterSearchItems<T extends RfdSearchFields>(params: {
  items: T[];
  fuse: Fuse<T>;
  activeStates: Set<string>;
  searchTerm: string;
}): T[] {
  const { items, fuse, activeStates, searchTerm } = params;

  const filterByState = (list: T[]): T[] =>
    activeStates.size === 0 ? list : list.filter((item) => activeStates.has(item.state));

  if (!searchTerm) {
    return filterByState(items);
  }

  const exact = exactContains(items, searchTerm);
  const matches = exact.length > 0
    ? exact
    : fuse.search(searchTerm).map((result) => result.item);
  return filterByState(matches);
}
