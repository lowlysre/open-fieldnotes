// Defines the serialised shape written to search-index.json and consumed by the
// client-side search engine on the index page.
export interface SearchIndexItem {
  number: string;
  state: string;
  title: string;
  labels: string;
  author: string;
  searchText: string;
}

// Minimal shape expected from an Astro content collection entry.
interface SearchableRfd {
  data: {
    number: string;
    state: string;
    title: string;
    labels: string[];
    author: string;
  };
  body: string;
}

// Caps the pre-computed full-text blob to keep the JSON payload small while
// still covering the vast majority of RFD bodies.
const MAX_SEARCH_TEXT_LENGTH = 2400;

// Removes code fences, inline code, images, links (keep text), HTML tags,
// heading markers, blockquote markers, and emphasis so the search index only
// contains prose words.
function stripMarkdownAndHtml(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, ' ')
    .replace(/^>+\s?/gm, ' ')
    .replace(/[\*_~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(input: string, maxLength: number): string {
  const normalized = input.toLowerCase().trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(0, maxLength);
}

export function buildSearchText(rfd: SearchableRfd): string {
  const textParts = [
    rfd.data.title,
    rfd.data.number,
    rfd.data.author,
    rfd.data.state,
    rfd.data.labels.join(' '),
    stripMarkdownAndHtml(rfd.body ?? ''),
  ];

  return compactText(textParts.filter(Boolean).join(' '), MAX_SEARCH_TEXT_LENGTH);
}

export function toSearchIndexItem(rfd: SearchableRfd): SearchIndexItem {
  return {
    number: rfd.data.number.toLowerCase(),
    state: rfd.data.state.toLowerCase(),
    title: rfd.data.title.toLowerCase(),
    labels: rfd.data.labels.join(' ').toLowerCase(),
    author: rfd.data.author.toLowerCase(),
    searchText: buildSearchText(rfd),
  };
}
