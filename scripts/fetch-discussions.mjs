#!/usr/bin/env node
/**
 * fetch-discussions.mjs
 *
 * Fetches GitHub Discussions from the configured repo and writes each one as a
 * markdown file with YAML front-matter to src/content/rfds/{number}.md.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx node scripts/fetch-discussions.mjs
 */

import { createWriteStream, mkdirSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── Load config ────────────────────────────────────────────────────────────────
const config = (await import('../fieldnotes.config.mjs')).default;

const { org, repo, publicLabel, states } = config;

// ── Validate env ───────────────────────────────────────────────────────────────
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  console.error(
    '❌  GITHUB_TOKEN is not set.\n' +
    '   Export it before running this script:\n' +
    '   GITHUB_TOKEN=ghp_xxx node scripts/fetch-discussions.mjs'
  );
  process.exit(1);
}

// ── GraphQL helper ─────────────────────────────────────────────────────────────
async function graphql(query, variables = {}) {
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

  const json = await res.json();

  if (json.errors) {
    throw new Error(
      `GraphQL errors:\n${json.errors.map(e => `  ${e.message}`).join('\n')}`
    );
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

async function fetchAllDiscussions() {
  const discussions = [];
  let after = null;
  let page = 1;

  console.log(`\n🔍  Fetching discussions from ${org}/${repo} …`);

  while (true) {
    console.log(`   Fetching page ${page}…`);
    const data = await graphql(DISCUSSIONS_QUERY, { owner: org, repo, after });
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

function parseTitle(rawTitle) {
  const m = RFD_TITLE_RE.exec(rawTitle.trim());
  if (m) {
    const number = String(parseInt(m[1], 10)).padStart(4, '0');
    return { number, title: m[2].trim() };
  }
  // Graceful fallback
  return { number: null, title: rawTitle.trim() };
}

// ── State resolution ──────────────────────────────────────────────────────────
function resolveState(discussion) {
  const stateKeys = Object.keys(states);

  // 1. Category takes priority
  const categoryName = discussion.category?.name?.toLowerCase();
  if (categoryName && stateKeys.includes(categoryName)) {
    return categoryName;
  }

  // 2. Label-based fallback
  const labelNames = discussion.labels.nodes.map(l => l.name.toLowerCase());
  for (const labelName of labelNames) {
    if (stateKeys.includes(labelName)) {
      return labelName;
    }
  }

  // 3. Default
  return 'discussion';
}

// ── Frontmatter serialisation ──────────────────────────────────────────────────
function toYamlString(value) {
  if (typeof value === 'string') {
    // Escape double-quotes and wrap in double-quotes for safety
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return String(value);
}

function buildFrontmatter(fields) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      const items = value.map(v => `"${String(v).replace(/"/g, '\\"')}"`).join(', ');
      lines.push(`${key}: [${items}]`);
    } else {
      lines.push(`${key}: ${toYamlString(value)}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

// ── Write markdown file ────────────────────────────────────────────────────────
async function writeRfd(discussion, number) {
  const { title } = parseTitle(discussion.title);
  const state = resolveState(discussion);
  const labels = discussion.labels.nodes
    .map(l => l.name)
    .filter(n => n.toLowerCase() !== (publicLabel || '').toLowerCase());

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
async function main() {
  const allDiscussions = await fetchAllDiscussions();

  let written = 0;
  let skippedPrivate = 0;
  let skippedNoNumber = 0;

  for (const discussion of allDiscussions) {
    const labelNames = discussion.labels.nodes.map(l => l.name.toLowerCase());

    // Filter by publicLabel unless disabled
    if (publicLabel) {
      if (!labelNames.includes(publicLabel.toLowerCase())) {
        skippedPrivate++;
        continue;
      }
    }

    const { number: rawNumber } = parseTitle(discussion.title);
    let number;

    if (rawNumber) {
      number = rawNumber;
    } else {
      // Use the Discussion number as a fallback slug
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
    `   Written  : ${written}\n` +
    `   Skipped (private)      : ${skippedPrivate}\n` +
    `   Skipped (no RFD number): ${skippedNoNumber}`
  );
}

main().catch(err => {
  console.error('❌  Fetch failed:', err.message);
  process.exit(1);
});
