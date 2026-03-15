// Defines the serialised shape written to search-index.json and consumed by the
// client-side search engine on the index page.
export interface SearchIndexItem {
  number: string;
  updatedAt: string;
  commentCount: number;
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
    updatedAt: string;
    commentCount: number;
    state: string;
    title: string;
    labels: string[];
    author: string;
  };
  body: string;
}

// Cap the combined body+comments search text per RFD to keep payloads bounded
// while allowing substantially longer discussions.
const MAX_CONTENT_LENGTH = 10_000;

// Heading variants used by the fetch script to separate body from comments.
const COMMENTS_HEADING_PATTERN = /##\s+Discussion Comments|<h2[^>]*>\s*Discussion Comments\s*<\/h2>/i;

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
  const commentMatch = COMMENTS_HEADING_PATTERN.exec(body);

  // Split body and comments so each gets its own budget — comments always
  // appear in the index even when the main body is long.
  const commentIdx = commentMatch?.index ?? -1;
  const commentStart = commentMatch ? commentIdx + commentMatch[0].length : -1;
  const mainBody = commentIdx !== -1 ? body.slice(0, commentIdx) : body;
  const commentsBody = commentStart !== -1 ? body.slice(commentStart) : '';

  const compactMainBody = compactText(stripMarkdownAndHtml(mainBody), MAX_CONTENT_LENGTH);
  const remainingForComments = Math.max(0, MAX_CONTENT_LENGTH - compactMainBody.length);
  const compactCommentsBody = compactText(stripMarkdownAndHtml(commentsBody), remainingForComments);

  const textParts = [
    rfd.data.title,
    rfd.data.number,
    rfd.data.author,
    rfd.data.state,
    rfd.data.labels.join(' '),
    compactMainBody,
    compactCommentsBody,
  ];

  return textParts.filter(Boolean).join(' ').toLowerCase();
}

export function toSearchIndexItem(rfd: SearchableRfd): SearchIndexItem {
  return {
    number: rfd.data.number.toLowerCase(),
    updatedAt: rfd.data.updatedAt,
    commentCount: rfd.data.commentCount ?? 0,
    state: rfd.data.state.toLowerCase(),
    title: rfd.data.title.toLowerCase(),
    labels: rfd.data.labels.join(' ').toLowerCase(),
    author: rfd.data.author.toLowerCase(),
    searchText: buildSearchText(rfd),
  };
}
