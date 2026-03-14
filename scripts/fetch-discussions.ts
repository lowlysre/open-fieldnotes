#!/usr/bin/env tsx
/**
 * fetch-discussions.ts
 *
 * Fetches GitHub Discussions from the configured repo using the GitHub GraphQL
 * API and writes each one as a markdown file with YAML front-matter to
 * src/content/rfds/{number}.md.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx npx tsx scripts/fetch-discussions.ts
 */

import { graphql as createGraphqlClient } from '@octokit/graphql';
import type { Discussion, DiscussionComment, PageInfo, Maybe } from '@octokit/graphql-schema';
import { writeFile, mkdir, readFile, readdir, unlink } from 'node:fs/promises';
import configData from '../fieldnotes.config.json';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
/* node:coverage ignore next 3 */
const IS_DIRECT_RUN = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

// ── Types ──────────────────────────────────────────────────────────────────────
// Discussion and PageInfo are imported from @octokit/graphql-schema.
interface Config {
  org: string;
  repo: string;
  title: string;
  description: string;
  base: string;
  publicLabel: string | null | false;
  states: Record<string, { category: string; label: string; color: string }>;
}

export type StateMap = Config['states'];

interface DiscussionsPage {
  rateLimit: GraphqlRateLimit;
  repository: {
    discussions: {
      pageInfo: PageInfo;
      nodes: Discussion[];
    };
  };
}

interface DiscussionCommentsPage {
  rateLimit: GraphqlRateLimit;
  repository: {
    discussion: {
      comments: {
        pageInfo: PageInfo;
        nodes?: Array<Maybe<DiscussionComment>>;
      };
    } | null;
  };
}

interface GraphqlRateLimit {
  limit: number;
  remaining: number;
  used: number;
  cost: number;
  resetAt: string;
}

export interface FetchRateLimitConfig {
  maxGraphqlRequests: number;
  minRemaining: number;
  resetBufferSeconds: number;
  maxWaitSeconds: number;
  logEveryRequests: number;
  requestThrottleMs: number;
}

const DEFAULT_FETCH_RATE_LIMIT_CONFIG: FetchRateLimitConfig = {
  // Similar spirit to actions/stale operations-per-run: cap total API work per run.
  maxGraphqlRequests: 180,
  // Start waiting before we hit zero to avoid hard 403 rate-limit failures.
  minRemaining: 100,
  resetBufferSeconds: 15,
  maxWaitSeconds: 900,
  logEveryRequests: 20,
  requestThrottleMs: 150,
};

export function parsePositiveIntEnv(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveFetchRateLimitConfig(env: NodeJS.ProcessEnv = process.env): FetchRateLimitConfig {
  return {
    maxGraphqlRequests: parsePositiveIntEnv(
      env.OPEN_FIELDNOTES_MAX_GRAPHQL_REQUESTS,
      DEFAULT_FETCH_RATE_LIMIT_CONFIG.maxGraphqlRequests
    ),
    minRemaining: parsePositiveIntEnv(
      env.OPEN_FIELDNOTES_MIN_RATE_REMAINING,
      DEFAULT_FETCH_RATE_LIMIT_CONFIG.minRemaining
    ),
    resetBufferSeconds: parsePositiveIntEnv(
      env.OPEN_FIELDNOTES_RATE_RESET_BUFFER_SECONDS,
      DEFAULT_FETCH_RATE_LIMIT_CONFIG.resetBufferSeconds
    ),
    maxWaitSeconds: parsePositiveIntEnv(
      env.OPEN_FIELDNOTES_MAX_WAIT_FOR_RESET_SECONDS,
      DEFAULT_FETCH_RATE_LIMIT_CONFIG.maxWaitSeconds
    ),
    logEveryRequests: parsePositiveIntEnv(
      env.OPEN_FIELDNOTES_RATE_LOG_EVERY,
      DEFAULT_FETCH_RATE_LIMIT_CONFIG.logEveryRequests
    ),
    requestThrottleMs: parsePositiveIntEnv(
      env.OPEN_FIELDNOTES_REQUEST_THROTTLE_MS,
      DEFAULT_FETCH_RATE_LIMIT_CONFIG.requestThrottleMs
    ),
  };
}

export function computeResetWaitMs(
  resetAtIso: string,
  nowMs: number = Date.now(),
  bufferSeconds: number = DEFAULT_FETCH_RATE_LIMIT_CONFIG.resetBufferSeconds
): number {
  const resetAtMs = new Date(resetAtIso).getTime();
  if (!Number.isFinite(resetAtMs)) {
    return bufferSeconds * 1000;
  }
  const delta = Math.max(0, resetAtMs - nowMs);
  return delta + bufferSeconds * 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDuration(ms: number): string {
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem === 0 ? `${min}m` : `${min}m ${rem}s`;
}

const ANSI = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
} as const;

function useColor(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR && env.FORCE_COLOR !== '0') return true;
  if (!process.stdout.isTTY) return false;
  return env.TERM !== 'dumb';
}

const COLOR_ENABLED = useColor();

function accent(text: string, color: keyof typeof ANSI): string {
  if (!COLOR_ENABLED || color === 'reset') {
    return text;
  }
  return `${ANSI[color]}${text}${ANSI.reset}`;
}

const LOG_PREFIX = {
  info: accent('ℹ', 'blue'),
  warn: accent('⚠', 'yellow'),
  ok: accent('✔', 'green'),
  search: accent('🔍', 'cyan'),
  error: accent('❌', 'red'),
};

const rateLimitConfig = resolveFetchRateLimitConfig();
let graphqlRequestCount = 0;

interface RateUsageSummary {
  initialRemaining: number | null;
  latestRemaining: number | null;
  latestLimit: number | null;
  latestResetAt: string | null;
  totalCost: number;
}

const rateUsageSummary: RateUsageSummary = {
  initialRemaining: null,
  latestRemaining: null,
  latestLimit: null,
  latestResetAt: null,
  totalCost: 0,
};

function trackRateUsage(rateLimit: GraphqlRateLimit): void {
  if (rateUsageSummary.initialRemaining === null) {
    rateUsageSummary.initialRemaining = rateLimit.remaining;
  }

  rateUsageSummary.latestRemaining = rateLimit.remaining;
  rateUsageSummary.latestLimit = rateLimit.limit;
  rateUsageSummary.latestResetAt = rateLimit.resetAt;
  rateUsageSummary.totalCost += rateLimit.cost;
}

function buildRateUsageSummaryLine(): string | null {
  if (
    rateUsageSummary.initialRemaining === null ||
    rateUsageSummary.latestRemaining === null ||
    rateUsageSummary.latestLimit === null
  ) {
    return null;
  }

  const consumedFromRemaining = rateUsageSummary.initialRemaining - rateUsageSummary.latestRemaining;
  return [
    `   GraphQL requests       : ${graphqlRequestCount}/${rateLimitConfig.maxGraphqlRequests}`,
    `   GraphQL cost (sum)     : ${rateUsageSummary.totalCost}`,
    `   GraphQL consumed*      : ${consumedFromRemaining}`,
    `   GraphQL remaining      : ${rateUsageSummary.latestRemaining}/${rateUsageSummary.latestLimit}`,
    `   GraphQL resets at      : ${rateUsageSummary.latestResetAt ?? 'unknown'}`,
    '   *Based on remaining delta for this run; can include concurrent token usage.',
  ].join('\n');
}

function logRateStatus(context: string, rateLimit: GraphqlRateLimit): void {
  console.log(
    `   ${LOG_PREFIX.info}  Rate limit (${context}): remaining ${rateLimit.remaining}/${rateLimit.limit}` +
    ` (cost ${rateLimit.cost}, used ${rateLimit.used}), resets ${rateLimit.resetAt}`
  );
}

async function enforceRateLimitPolicy(context: string, rateLimit: GraphqlRateLimit): Promise<void> {
  const shouldLog = graphqlRequestCount === 1 ||
    graphqlRequestCount % rateLimitConfig.logEveryRequests === 0 ||
    rateLimit.remaining <= rateLimitConfig.minRemaining;

  if (shouldLog) {
    logRateStatus(context, rateLimit);
  }

  if (rateLimit.remaining > rateLimitConfig.minRemaining) {
    return;
  }

  const waitMs = computeResetWaitMs(
    rateLimit.resetAt,
    Date.now(),
    rateLimitConfig.resetBufferSeconds
  );
  const maxWaitMs = rateLimitConfig.maxWaitSeconds * 1000;

  if (waitMs > maxWaitMs) {
    throw new Error(
      'Rate limit remaining is too low and reset wait is too long. ' +
      `remaining=${rateLimit.remaining}, wait=${formatDuration(waitMs)}, ` +
      `maxWait=${formatDuration(maxWaitMs)}. ` +
      'Increase OPEN_FIELDNOTES_MAX_WAIT_FOR_RESET_SECONDS or re-run later.'
    );
  }

  console.warn(
    `   ${LOG_PREFIX.warn}  Rate limit low (${rateLimit.remaining} remaining). ` +
    `Sleeping ${formatDuration(waitMs)} until reset.`
  );
  await sleep(waitMs);
}

function isRateLimitError(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  const message = ((error as { message?: string })?.message ?? '').toLowerCase();
  return status === 403 && message.includes('rate limit');
}

function extractResetAtFromError(error: unknown): string | null {
  const response = (error as { response?: { headers?: Record<string, string> } })?.response;
  const resetRaw = response?.headers?.['x-ratelimit-reset'];
  if (!resetRaw) return null;
  const resetEpoch = Number.parseInt(resetRaw, 10);
  if (!Number.isFinite(resetEpoch)) return null;
  return new Date(resetEpoch * 1000).toISOString();
}

async function graphqlWithRateLimit<T extends { rateLimit: GraphqlRateLimit }>(
  query: string,
  variables: Record<string, unknown>,
  context: string
): Promise<T> {
  if (graphqlRequestCount >= rateLimitConfig.maxGraphqlRequests) {
    throw new Error(
      `Reached max GraphQL requests for this run (${rateLimitConfig.maxGraphqlRequests}). ` +
      'Stop early to avoid rate-limit lockouts. Increase OPEN_FIELDNOTES_MAX_GRAPHQL_REQUESTS if needed.'
    );
  }

  if (graphqlRequestCount > 0 && rateLimitConfig.requestThrottleMs > 0) {
    await sleep(rateLimitConfig.requestThrottleMs);
  }

  graphqlRequestCount++;

  try {
    const data = await graphql<T>(query, variables);
    trackRateUsage(data.rateLimit);
    await enforceRateLimitPolicy(context, data.rateLimit);
    return data;
  } catch (error) {
    if (!isRateLimitError(error)) {
      throw error;
    }

    const resetAt = extractResetAtFromError(error);
    if (!resetAt) {
      throw error;
    }

    const waitMs = computeResetWaitMs(resetAt, Date.now(), rateLimitConfig.resetBufferSeconds);
    const maxWaitMs = rateLimitConfig.maxWaitSeconds * 1000;

    if (waitMs > maxWaitMs) {
      throw new Error(
        'Rate limited by GitHub and computed wait exceeds configured max. ' +
        `wait=${formatDuration(waitMs)}, maxWait=${formatDuration(maxWaitMs)}.`
      );
    }

    console.warn(
      `   ${LOG_PREFIX.warn}  GitHub rate limit hit. Waiting ${formatDuration(waitMs)} and retrying once…`
    );
    await sleep(waitMs);

    const retryData = await graphql<T>(query, variables);
    trackRateUsage(retryData.rateLimit);
    await enforceRateLimitPolicy(`${context} (retry)`, retryData.rateLimit);
    return retryData;
  }
}

// ── Load config ────────────────────────────────────────────────────────────────
const { org, repo, publicLabel, states } = configData as Config;

/* node:coverage disable */
// ── Validate env ───────────────────────────────────────────────────────────────
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  if (IS_DIRECT_RUN) {
    console.error(
      `${LOG_PREFIX.error}  GITHUB_TOKEN is not set.\n` +
      '   Export it before running this script:\n' +
      '   GITHUB_TOKEN=ghp_xxx npx tsx scripts/fetch-discussions.ts'
    );
    process.exit(1);
  }
}

// ── GraphQL client ─────────────────────────────────────────────────────────────
const graphql = createGraphqlClient.defaults({
  headers: {
    authorization: `token ${GITHUB_TOKEN ?? ''}`,
    'user-agent': 'open-fieldnotes/fetch-discussions',
  },
});

// ── Paginated fetch ────────────────────────────────────────────────────────────
const DISCUSSIONS_QUERY = `
  query FetchDiscussions($owner: String!, $repo: String!, $after: String) {
    rateLimit {
      limit
      remaining
      used
      cost
      resetAt
    }
    repository(owner: $owner, name: $repo) {
      discussions(first: 100, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          number
          title
          body
          url
          createdAt
          updatedAt
          category {
            name
          }
          author {
            login
          }
          labels(first: 20) {
            nodes {
              name
              color
            }
          }
        }
      }
    }
  }
`;

const DISCUSSION_COMMENTS_QUERY = `
  query FetchDiscussionComments(
    $owner: String!
    $repo: String!
    $number: Int!
    $after: String
  ) {
    rateLimit {
      limit
      remaining
      used
      cost
      resetAt
    }
    repository(owner: $owner, name: $repo) {
      discussion(number: $number) {
        comments(first: 100, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            author {
              login
            }
            body
            createdAt
            updatedAt
            url
          }
        }
      }
    }
  }
`;

async function fetchAllDiscussions(): Promise<Discussion[]> {
  const discussions: Discussion[] = [];
  let after: string | null = null;
  let page = 1;

  console.log(`\n${LOG_PREFIX.search}  Fetching discussions from ${org}/${repo} …`);
  console.log(
    `   API safety caps: maxRequests=${rateLimitConfig.maxGraphqlRequests}, ` +
    `minRemaining=${rateLimitConfig.minRemaining}, throttle=${rateLimitConfig.requestThrottleMs}ms`
  );

  while (true) {
    console.log(`   ${LOG_PREFIX.info}  Fetching page ${page}…`);
    const data: DiscussionsPage = await graphqlWithRateLimit<DiscussionsPage>(
      DISCUSSIONS_QUERY,
      {
      owner: org,
      repo,
      after,
      },
      `discussions page ${page}`
    );
    const { nodes, pageInfo } = data.repository.discussions;

    discussions.push(...nodes);

    if (!pageInfo.hasNextPage) break;
    after = pageInfo.endCursor ?? null;
    page++;
  }

  console.log(`   ${LOG_PREFIX.info}  Retrieved ${discussions.length} discussion(s) total.`);
  return discussions;
}

async function fetchAllDiscussionComments(discussionNumber: number): Promise<DiscussionComment[]> {
  const comments: DiscussionComment[] = [];
  let after: string | null = null;

  while (true) {
    const data: DiscussionCommentsPage = await graphqlWithRateLimit<DiscussionCommentsPage>(
      DISCUSSION_COMMENTS_QUERY,
      {
        owner: org,
        repo,
        number: discussionNumber,
        after,
      },
      `discussion #${discussionNumber} comments`
    );

    const discussion = data.repository.discussion;
    if (!discussion) {
      break;
    }

    const { pageInfo, nodes } = discussion.comments;
    comments.push(...(nodes ?? []).flatMap((node) => (node ? [node] : [])));

    if (!pageInfo.hasNextPage) {
      break;
    }

    after = pageInfo.endCursor ?? null;
  }

  return comments;
}
/* node:coverage enable */

// ── RFD number / title parsing ─────────────────────────────────────────────────
// Expected format: "RFD 0042: My Proposal"
const RFD_TITLE_RE = /^RFD\s+(\d+):\s+(.+)$/i;

export function parseTitle(rawTitle: string): { number: string | null; title: string } {
  const m = RFD_TITLE_RE.exec(rawTitle.trim());
  if (m) {
    const number = String(parseInt(m[1], 10)).padStart(4, '0');
    return { number, title: m[2].trim() };
  }
  return { number: null, title: rawTitle.trim() };
}

export function getDefaultStateKey(statesMap: StateMap): string {
  if ('discussion' in statesMap) {
    return 'discussion';
  }

  const discussionByCategory = Object.entries(statesMap).find(
    ([, cfg]) => cfg.category.trim().toLowerCase() === 'discussion'
  );
  if (discussionByCategory) {
    return discussionByCategory[0];
  }

  const firstState = Object.keys(statesMap)[0];
  if (!firstState) {
    throw new Error('fieldnotes.config.json must define at least one state.');
  }

  return firstState;
}

const DEFAULT_STATE_KEY = getDefaultStateKey(states);

// ── State resolution ──────────────────────────────────────────────────────────
export function resolveState(discussion: Discussion): string {
  const stateEntries = Object.entries(states);
  const stateKeys = stateEntries.map(([key]) => key.toLowerCase());

  // 1. Category takes priority and maps to a configured state's category.
  const categoryName = discussion.category?.name?.toLowerCase();
  if (categoryName) {
    const categoryMatch = stateEntries.find(
      ([, cfg]) => cfg.category.trim().toLowerCase() === categoryName
    );
    if (categoryMatch) {
      return categoryMatch[0];
    }
  }

  // 2. Label-based fallback using state keys.
  const labelNames = (discussion.labels?.nodes ?? []).flatMap((l) => l ? [l.name.toLowerCase()] : []);
  for (const labelName of labelNames) {
    const matchedIndex = stateKeys.indexOf(labelName);
    if (matchedIndex >= 0) {
      return stateEntries[matchedIndex][0];
    }
  }

  // 3. Default
  return DEFAULT_STATE_KEY;
}

// ── Frontmatter serialisation ──────────────────────────────────────────────────
export function escapeYamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function buildFrontmatter(fields: Record<string, string | string[]>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      const items = value.map((v) => `"${String(v).replace(/"/g, '\\"')}"`).join(', ');
      lines.push(`${key}: [${items}]`);
    } else {
      lines.push(`${key}: ${escapeYamlString(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

export function linkifyGithubMentions(text: string): string {
  return text.replace(
    /(^|[^A-Za-z0-9/])@([A-Za-z0-9-]{1,39})\b/g,
    (_match, prefix: string, username: string) =>
      `${prefix}[@${username}](https://github.com/${username})`
  );
}

export function toBlockquote(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .map((line) => (line.trim().length === 0 ? '>' : `> ${line}`))
    .join('\n');
}

export function formatDisplayDate(value: string | null | undefined): string {
  if (!value) {
    return 'unknown date';
  }

  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function formatFullTimestamp(value: string | null | undefined): string {
  if (!value) {
    return 'unknown timestamp';
  }

  return new Date(value).toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

// ── Write markdown file ────────────────────────────────────────────────────────
/* node:coverage disable */
async function writeRfd(
  discussion: Discussion,
  number: string
): Promise<{ filePath: string; commentCount: number }> {
  const { title } = parseTitle(discussion.title);
  const state = resolveState(discussion);
  const publicLabelLower = String(publicLabel ?? '').toLowerCase();
  const labelNodes = (discussion.labels?.nodes ?? []).flatMap((l) => l ? [l] : []);
  const labels = labelNodes
    .filter((l) => l.name.toLowerCase() !== publicLabelLower)
    .map((l) => l.name);
  const labelColors = labelNodes
    .filter((l) => l.name.toLowerCase() !== publicLabelLower)
    .map((l) => (l as any).color ?? '');

  const frontmatter = buildFrontmatter({
    number,
    title,
    state,
    labels,
    labelColors,
    createdAt: discussion.createdAt,
    updatedAt: discussion.updatedAt,
    discussionUrl: discussion.url,
    author: discussion.author?.login ?? 'unknown',
  });

  const body = discussion.body ?? '';
  const comments = await fetchAllDiscussionComments(discussion.number);

  const commentsSection = comments.length > 0
    ? [
        '<h2 id="discussion-comments">Discussion Comments</h2>',
        '',
        ...comments.flatMap((comment, index) => {
          const author = comment.author?.login ?? 'unknown';
          const authorLink = author === 'unknown'
            ? '@unknown'
            : `<a class="comment-author-link" href="https://github.com/${author}" target="_blank" rel="noopener noreferrer">@${author}</a>`;
          const createdAtDisplay = formatDisplayDate(comment.createdAt ?? null);
          const createdAtFull = formatFullTimestamp(comment.createdAt ?? null);
          const createdAt = comment.createdAt
            ? `<time datetime="${comment.createdAt}" title="${createdAtFull}">${createdAtDisplay}</time>`
            : createdAtDisplay;
          const commentBody = linkifyGithubMentions(comment.body?.trim() || '_No comment body._');
          const block = toBlockquote([
            `**${index + 1}. ${authorLink} · ${createdAt}**`,
            '',
            commentBody,
            '',
            comment.url ? `<div><sub><a href="${comment.url}" target="_blank" rel="noopener noreferrer">View Comment ↗</a></sub></div>` : null,
          ].filter((line): line is string => line !== null).join('\n'));

          return [
            block,
            '',
          ];
        }),
      ].join('\n')
    : '';

  const content = [frontmatter, '', body, commentsSection ? `\n${commentsSection}` : '', '']
    .join('\n');

  const outDir = join(ROOT, 'src', 'content', 'rfds');
  await mkdir(outDir, { recursive: true });
  const filePath = join(outDir, `${number}.md`);
  await writeFile(filePath, content, 'utf8');
  return { filePath, commentCount: comments.length };
}

// ── Main ───────────────────────────────────────────────────────────────────────
export interface PlannedRfd {
  discussion: Discussion;
  slug: string;
  isExplicitNumber: boolean;
}

const DISCUSSION_URL_FRONTMATTER_RE = /^discussionUrl:\s*["']?([^"'\n]+)["']?$/m;

export function extractFrontmatterDiscussionUrl(markdown: string): string | null {
  const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return null;
  }

  const urlMatch = frontmatterMatch[1].match(DISCUSSION_URL_FRONTMATTER_RE);
  return urlMatch ? urlMatch[1].trim() : null;
}

export function getStaleSlugsForDiscussion(existingSlugs: string[], plannedSlug: string): string[] {
  return existingSlugs.filter((slug) => slug !== plannedSlug);
}

async function indexExistingRfdsByDiscussionUrl(outDir: string): Promise<Map<string, string[]>> {
  const byDiscussionUrl = new Map<string, string[]>();

  const entries = await readdir(outDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === '.gitkeep') {
      continue;
    }

    const slug = entry.name.slice(0, -3);
    const filePath = join(outDir, entry.name);
    const content = await readFile(filePath, 'utf8');
    const discussionUrl = extractFrontmatterDiscussionUrl(content);

    if (!discussionUrl) {
      continue;
    }

    const slugs = byDiscussionUrl.get(discussionUrl) ?? [];
    slugs.push(slug);
    byDiscussionUrl.set(discussionUrl, slugs);
  }

  return byDiscussionUrl;
}

export function planRfds(
  allDiscussions: Discussion[],
  configuredPublicLabel: string | null | false
): { planned: PlannedRfd[]; skippedPrivate: number; fallbackSlug: number; warnings: string[] } {
  let skippedPrivate = 0;
  let fallbackSlug = 0;
  const warnings: string[] = [];

  interface SlugOwner {
    slug: string;
    discussionNumber: number;
    title: string;
    url: string;
    isExplicitNumber: boolean;
  }

  const planned: PlannedRfd[] = [];
  const slugOwners = new Map<string, SlugOwner>();
  const titleOwners = new Map<string, { discussionNumber: number; url: string; title: string }>();

  for (const discussion of allDiscussions) {
    const labelNames = (discussion.labels?.nodes ?? []).flatMap((l) => l ? [l.name.toLowerCase()] : []);

    // Filter by publicLabel unless disabled
    if (configuredPublicLabel) {
      if (!labelNames.includes(configuredPublicLabel.toLowerCase())) {
        skippedPrivate++;
        continue;
      }
    }

    const { number: rawNumber } = parseTitle(discussion.title);
    let slug: string;
    let isExplicitNumber = false;

    if (rawNumber) {
      slug = rawNumber;
      isExplicitNumber = true;
    } else {
      warnings.push(
        `   ${LOG_PREFIX.warn}  Discussion #${discussion.number} ("${discussion.title}") ` +
        `doesn't match "RFD NNNN: Title" - using fallback slug "gh-${discussion.number}".`
      );
      slug = `gh-${discussion.number}`;
      fallbackSlug++;
    }

    const existingSlugOwner = slugOwners.get(slug);
    if (existingSlugOwner) {
      const conflictType = existingSlugOwner.isExplicitNumber && isExplicitNumber
        ? `RFD number conflict (${slug})`
        : `Output slug conflict (${slug})`;

      throw new Error(
        `${conflictType}:
  #${existingSlugOwner.discussionNumber} "${existingSlugOwner.title}" (${existingSlugOwner.url})
  #${discussion.number} "${discussion.title}" (${discussion.url})
Resolve by using unique "RFD NNNN: Title" values (or allow fallback slugs for non-RFD discussions).`
      );
    }

    slugOwners.set(slug, {
      slug,
      discussionNumber: discussion.number,
      title: discussion.title,
      url: discussion.url,
      isExplicitNumber,
    });

    const titleKey = discussion.title.trim().toLowerCase();
    const existingTitleOwner = titleOwners.get(titleKey);
    if (existingTitleOwner) {
      warnings.push(
        `   ${LOG_PREFIX.warn}  Title collision: "${discussion.title}" appears in both ` +
        `#${existingTitleOwner.discussionNumber} and #${discussion.number}.` +
        ` Slugs are unique, so both will still be included.`
      );
    } else {
      titleOwners.set(titleKey, {
        discussionNumber: discussion.number,
        url: discussion.url,
        title: discussion.title,
      });
    }

    planned.push({ discussion, slug, isExplicitNumber });
  }

  return { planned, skippedPrivate, fallbackSlug, warnings };
}

async function main(): Promise<void> {
  const allDiscussions = await fetchAllDiscussions();
  const outDir = join(ROOT, 'src', 'content', 'rfds');
  await mkdir(outDir, { recursive: true });
  const existingByDiscussionUrl = await indexExistingRfdsByDiscussionUrl(outDir);

  let written = 0;
  let removedStale = 0;
  const { planned, skippedPrivate, fallbackSlug, warnings } = planRfds(allDiscussions, publicLabel);

  for (const warning of warnings) {
    console.warn(warning);
  }

  for (const item of planned) {
    const existingSlugs = existingByDiscussionUrl.get(item.discussion.url) ?? [];
    const staleSlugs = getStaleSlugsForDiscussion(existingSlugs, item.slug);

    for (const staleSlug of staleSlugs) {
      const stalePath = join(outDir, `${staleSlug}.md`);
      await unlink(stalePath);
      console.log(`   ${accent('↺', 'yellow')}  Removed stale ${stalePath.replace(ROOT, '.')}`);
      removedStale++;
    }

    const { filePath, commentCount } = await writeRfd(item.discussion, item.slug);
    console.log(`      ${LOG_PREFIX.info}  Included ${commentCount} discussion comment(s).`);
    console.log(`   ${LOG_PREFIX.ok}  Wrote ${filePath.replace(ROOT, '.')}`);
    written++;
  }

  console.log(
    `\n${accent('✅  Done.', 'green')}\n` +
    `   Written                : ${written}\n` +
    `   Removed stale          : ${removedStale}\n` +
    `   Skipped (private)      : ${skippedPrivate}\n` +
    `   Included (fallback slug): ${fallbackSlug}`
  );

  const rateSummary = buildRateUsageSummaryLine();
  if (rateSummary) {
    console.log(`\n${accent('📊  GraphQL Token Summary', 'cyan')}\n${rateSummary}`);
  }
}

if (IS_DIRECT_RUN) {
  main().catch((err: Error) => {
    console.error(`${LOG_PREFIX.error}  Fetch failed:`, err.message);
    process.exit(1);
  });
}
/* node:coverage enable */
