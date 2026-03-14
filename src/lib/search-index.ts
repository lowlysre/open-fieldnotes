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
// still covering the vast majority of RFD bodies and comments.
const MAX_BODY_LENGTH = 1800;
const MAX_COMMENTS_LENGTH = 1200;

// Heading used by the fetch script to separate body from comment content.
const COMMENTS_HEADING = '## Discussion Comments';

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
  const body = rfd.body ?? '';
  const commentIdx = body.indexOf(COMMENTS_HEADING);

  // Split body and comments so each gets its own budget — comments always
  // appear in the index even when the main body is long.
  const mainBody = commentIdx !== -1 ? body.slice(0, commentIdx) : body;
  const commentsBody = commentIdx !== -1 ? body.slice(commentIdx + COMMENTS_HEADING.length) : '';

  const textParts = [
    rfd.data.title,
    rfd.data.number,
    rfd.data.author,
    rfd.data.state,
    rfd.data.labels.join(' '),
    compactText(stripMarkdownAndHtml(mainBody), MAX_BODY_LENGTH),
    compactText(stripMarkdownAndHtml(commentsBody), MAX_COMMENTS_LENGTH),
  ];

  return textParts.filter(Boolean).join(' ').toLowerCase();
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
