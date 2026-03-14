#!/usr/bin/env tsx
/**
 * check-repo.ts
 *
 * Validates that the configured GitHub repository is set up correctly for
 * open-fieldnotes. Emits warnings for common misconfigurations but does not
 * exit non-zero so it never blocks the build.
 *
 * Checks:
 *   1. Discussions are enabled on the repository.
 *   2. Each configured state category in fieldnotes.config.json has a matching Discussion category.
 *   3. The configured publicLabel exists as a repository label.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx npx tsx scripts/check-repo.ts
 */

import { graphql as createGraphqlClient } from '@octokit/graphql';
import configData from '../fieldnotes.config.json';
import { pathToFileURL } from 'node:url';
import type {
  DiscussionCategory,
  DiscussionCategoryConnection,
  Label,
  LabelConnection,
  Maybe,
} from '@octokit/graphql-schema';

// ── Types ──────────────────────────────────────────────────────────────────────
interface Config {
  org: string;
  repo: string;
  publicLabel: string | null | false;
  states: Record<string, { category: string; label: string; color: string }>;
}

interface RepoCheckResult {
  repository: {
    hasDiscussionsEnabled: boolean;
    discussionCategories: DiscussionCategoryConnection;
    labels: LabelConnection;
  };
}

export function findDuplicateCategoryMappings(statesMap: Config['states']): Array<{
  category: string;
  stateKeys: string[];
}> {
  const categoryToStateKeys = new Map<string, { display: string; stateKeys: string[] }>();
  for (const [stateKey, cfg] of Object.entries(statesMap)) {
    const normalizedCategory = cfg.category.trim().toLowerCase();
    const existing = categoryToStateKeys.get(normalizedCategory) ?? {
      display: cfg.category.trim(),
      stateKeys: [],
    };
    existing.stateKeys.push(stateKey);
    categoryToStateKeys.set(normalizedCategory, existing);
  }

  return Array.from(categoryToStateKeys.values())
    .filter((entry) => entry.stateKeys.length > 1)
    .map((entry) => ({
      category: entry.display,
      stateKeys: entry.stateKeys,
    }));
}

export function getMissingCategories(
  statesMap: Config['states'],
  existingCategories: Set<string>
): Array<{ stateKey: string; categoryLabel: string }> {
  const expectedCategories = Object.entries(statesMap).map(([stateKey, cfg]) => ({
    stateKey,
    categoryLabel: cfg.category.trim(),
  }));

  return expectedCategories.filter(
    ({ categoryLabel }) => !existingCategories.has(categoryLabel.toLowerCase())
  );
}

export function hasExpectedPublicLabel(
  configuredPublicLabel: string | null | false,
  existingLabels: Set<string>
): boolean {
  if (!configuredPublicLabel) {
    return true;
  }
  return existingLabels.has(configuredPublicLabel.toLowerCase());
}

// ── Load config ────────────────────────────────────────────────────────────────
const { org, repo, publicLabel, states } = configData as Config;
/* node:coverage ignore next 3 */
const IS_DIRECT_RUN = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

/* node:coverage disable */
// ── Auth ───────────────────────────────────────────────────────────────────────
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  if (IS_DIRECT_RUN) {
    console.warn(
      '⚠️   GITHUB_TOKEN is not set - skipping repository health checks.\n' +
      '    Set GITHUB_TOKEN to enable pre-build validation.'
    );
    process.exit(0);
  }
}

const graphql = createGraphqlClient.defaults({
  headers: {
    authorization: `token ${GITHUB_TOKEN ?? ''}`,
    'user-agent': 'open-fieldnotes/check-repo',
  },
});

// ── Query ──────────────────────────────────────────────────────────────────────
const REPO_CHECK_QUERY = `
  query CheckRepo($owner: String!, $repo: String!) {
    repository(owner: $owner, name: $repo) {
      hasDiscussionsEnabled
      discussionCategories(first: 25) {
        nodes {
          name
        }
      }
      labels(first: 100) {
        nodes {
          name
        }
      }
    }
  }
`;

// ── Main ───────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`\n🔎  Checking repo setup for ${org}/${repo} …\n`);

  const data: RepoCheckResult = await graphql<RepoCheckResult>(REPO_CHECK_QUERY, {
    owner: org,
    repo,
  });

  const { hasDiscussionsEnabled, discussionCategories, labels } = data.repository;

  let warnings = 0;

  // 0. Duplicate category mappings in config ──────────────────────────────────
  for (const entry of findDuplicateCategoryMappings(states)) {
      console.warn(
        `  ⚠️   Duplicate state category mapping: "${entry.category}" is used by states [${entry.stateKeys.join(', ')}].\n` +
        '      Category-to-state resolution becomes ambiguous; keep category values unique in fieldnotes.config.json.'
      );
      warnings++;
  }

  // 1. Discussions enabled ─────────────────────────────────────────────────────
  if (!hasDiscussionsEnabled) {
    console.warn(
      '  ⚠️   Discussions are disabled on this repository.\n' +
      `      Enable them at https://github.com/${org}/${repo}/settings → Features → Discussions.`
    );
    warnings++;
  }

  // 2. Discussion categories ───────────────────────────────────────────────────
  const existingCategories = new Set(
    (discussionCategories.nodes ?? [])
      .flatMap((n: Maybe<DiscussionCategory>) => (n ? [n.name.toLowerCase()] : []))
  );

  const missingCategories = getMissingCategories(states, existingCategories);

  for (const { stateKey, categoryLabel } of missingCategories) {
    console.warn(
      `  ⚠️   Missing Discussion category: "${categoryLabel}" (from state "${stateKey}")\n` +
      `      Add it at <https://github.com/${org}/${repo}/discussions/categories/new> or edit fieldnotes.config.json`
    );
    warnings++;
  }

  // 3. publicLabel ─────────────────────────────────────────────────────────────
  if (publicLabel) {
    const existingLabels = new Set(
      (labels.nodes ?? [])
        .flatMap((n: Maybe<Label>) => (n ? [n.name.toLowerCase()] : []))
    );

    if (!hasExpectedPublicLabel(publicLabel, existingLabels)) {
      console.warn(
        `  ⚠️   Missing label: "${publicLabel}" (configured as publicLabel)\n` +
        `      Add it at https://github.com/${org}/${repo}/labels`
      );
      warnings++;
    }
  }

  if (warnings === 0) {
    console.log(`  ✅  Repository meets all pre-requisites for OpenFieldnotes.\n`);
  } else {
    console.warn(`\n  ${warnings} warning(s) found. Discussions with missing setup may not render correctly.\n`);
  }
}

if (IS_DIRECT_RUN) {
  main().catch((err: Error) => {
    // Non-fatal: a check failure should never block the build.
    console.warn(`⚠️   Repo check failed (skipping): ${err.message}`);
    process.exit(0);
  });
}
/* node:coverage enable */
