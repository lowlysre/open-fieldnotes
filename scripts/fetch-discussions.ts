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

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Types ──────────────────────────────────────────────────────────────────────
interface Config {
  org: string;
  repo: string;
  title: string;
  description: string;
  base: string;
  publicLabel: string | null | false;
  states: Record<string, { label: string; color: string }>;
}

interface Label {
  name: string;
}

interface Discussion {
  number: number;
  title: string;
  body: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  category: { name: string } | null;
  author: { login: string } | null;
  labels: { nodes: Label[] };
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface DiscussionsPage {
  repository: {
    discussions: {
      pageInfo: PageInfo;
      nodes: Discussion[];
    };
  };
}

// ── Load config ────────────────────────────────────────────────────────────────
const config = (await import('../fieldnotes.config.mjs')) as { default: Config };
const { org, repo, publicLabel, states } = config.default;

// ── Validate env ───────────────────────────────────────────────────────────────
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  console.error(
    '❌  GITHUB_TOKEN is not set.\n' +
    '   Export it before running this script:\n' +
    '   GITHUB_TOKEN=ghp_xxx npx tsx scripts/fetch-discussions.ts'
  );
  process.exit(1);
}

// ── GraphQL helper ─────────────────────────────────────────────────────────────
async function graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'open-fieldnotes/fetch-discussions',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json() as { data?: T; errors?: { message: string }[] };

  if (json.errors) {
    throw new Error(
      `GraphQL errors:\n${json.errors.map((e) => `  ${e.message}`).join('\n')}`
    );
  }

  if (!json.data) {
    throw new Error('No data returned from GitHub API');
  }

  return json.data;
}

// ── Paginated fetch ────────────────────────────────────────────────────────────
const DISCUSSIONS_QUERY = `
  query FetchDiscussions($owner: String!, $repo: String!, $after: String) {
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
            }
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

  console.log(`\n🔍  Fetching discussions from ${org}/${repo} …`);

  while (true) {
    console.log(`   Fetching page ${page}…`);
    const data = await graphql<DiscussionsPage>(DISCUSSIONS_QUERY, {
      owner: org,
      repo,
      after,
    });
    const { nodes, pageInfo } = data.repository.discussions;

    discussions.push(...nodes);

    if (!pageInfo.hasNextPage) break;
    after = pageInfo.endCursor;
    page++;
  }

  console.log(`   Retrieved ${discussions.length} discussion(s) total.`);
  return discussions;
}

// ── RFD number / title parsing ─────────────────────────────────────────────────
// Expected format: "RFD 0042: My Proposal"
const RFD_TITLE_RE = /^RFD\s+(\d+):\s+(.+)$/i;

function parseTitle(rawTitle: string): { number: string | null; title: string } {
  const m = RFD_TITLE_RE.exec(rawTitle.trim());
  if (m) {
    const number = String(parseInt(m[1], 10)).padStart(4, '0');
    return { number, title: m[2].trim() };
  }
  return { number: null, title: rawTitle.trim() };
}

// ── State resolution ──────────────────────────────────────────────────────────
function resolveState(discussion: Discussion): string {
  const stateKeys = Object.keys(states);

  // 1. Category takes priority
  const categoryName = discussion.category?.name?.toLowerCase();
  if (categoryName && stateKeys.includes(categoryName)) {
    return categoryName;
  }

  // 2. Label-based fallback
  const labelNames = discussion.labels.nodes.map((l) => l.name.toLowerCase());
  for (const labelName of labelNames) {
    if (stateKeys.includes(labelName)) {
      return labelName;
    }
  }

  // 3. Default
  return 'discussion';
}

// ── Frontmatter serialisation ──────────────────────────────────────────────────
function escapeYamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function buildFrontmatter(fields: Record<string, string | string[]>): string {
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

// ── Write markdown file ────────────────────────────────────────────────────────
async function writeRfd(discussion: Discussion, number: string): Promise<string> {
  const { title } = parseTitle(discussion.title);
  const state = resolveState(discussion);
  const labels = discussion.labels.nodes
    .map((l) => l.name)
    .filter((n) => n.toLowerCase() !== String(publicLabel ?? '').toLowerCase());

  const frontmatter = buildFrontmatter({
    number,
    title,
    state,
    labels,
    createdAt: discussion.createdAt,
    updatedAt: discussion.updatedAt,
    discussionUrl: discussion.url,
    author: discussion.author?.login ?? 'unknown',
  });

  const body = discussion.body ?? '';
  const content = `${frontmatter}\n\n${body}\n`;

  const outDir = join(ROOT, 'src', 'content', 'rfds');
  await mkdir(outDir, { recursive: true });
  const filePath = join(outDir, `${number}.md`);
  await writeFile(filePath, content, 'utf8');
  return filePath;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const allDiscussions = await fetchAllDiscussions();

  let written = 0;
  let skippedPrivate = 0;
  let skippedNoNumber = 0;

  for (const discussion of allDiscussions) {
    const labelNames = discussion.labels.nodes.map((l) => l.name.toLowerCase());

    // Filter by publicLabel unless disabled
    if (publicLabel) {
      if (!labelNames.includes(publicLabel.toLowerCase())) {
        skippedPrivate++;
        continue;
      }
    }

    const { number: rawNumber } = parseTitle(discussion.title);
    let number: string;

    if (rawNumber) {
      number = rawNumber;
    } else {
      console.warn(
        `   ⚠  Discussion #${discussion.number} ("${discussion.title}") ` +
        `doesn't match "RFD NNNN: Title" — using discussion number as slug.`
      );
      number = String(discussion.number).padStart(4, '0');
      skippedNoNumber++;
    }

    const filePath = await writeRfd(discussion, number);
    console.log(`   ✔  Wrote ${filePath.replace(ROOT, '.')}`);
    written++;
  }

  console.log(
    `\n✅  Done.\n` +
    `   Written                : ${written}\n` +
    `   Skipped (private)      : ${skippedPrivate}\n` +
    `   Skipped (no RFD number): ${skippedNoNumber}`
  );
}

main().catch((err: Error) => {
  console.error('❌  Fetch failed:', err.message);
  process.exit(1);
});
