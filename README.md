# OpenFieldnotes <!-- omit in toc -->

[![Unit & axe Tests](https://github.com/lowlydba/open-fieldnotes/actions/workflows/test.yml/badge.svg?label=Unit+%26+axe+Tests)](https://github.com/lowlydba/open-fieldnotes/actions/workflows/test.yml)
![WCAG 2.2 AA](https://img.shields.io/badge/WCAG_2.2-AA-blue)
[![sustainable-npm](https://img.shields.io/badge/sustainable--npm-🌱-blue?style=flat)](https://github.com/lowlydba/sustainable-npm)

OpenFieldnotes turns GitHub Discussions into a static RFD (Request for Discussion) site using Astro.

It is designed for teams that already use GitHub Discussions and want:

1. A lightweight RFD workflow.
2. A searchable, state-based index.
3. Markdown pages generated directly from Discussions.

- [Tutorial](#tutorial)
  - [Publish your first RFD site](#publish-your-first-rfd-site)
- [How-To Guides](#how-to-guides)
  - [How to configure your repository](#how-to-configure-your-repository)
  - [How to include only public discussions](#how-to-include-only-public-discussions)
  - [How to run accessibility tests](#how-to-run-accessibility-tests)
  - [How to run tests and coverage](#how-to-run-tests-and-coverage)
  - [How to deploy to GitHub Pages](#how-to-deploy-to-github-pages)
- [Reference](#reference)
  - [Scripts](#scripts)
  - [Fetch rate-limit controls](#fetch-rate-limit-controls)
  - [Configuration (`fieldnotes.config.json`)](#configuration-fieldnotesconfigjson)
  - [Discussion title and slug policy](#discussion-title-and-slug-policy)
  - [State resolution order](#state-resolution-order)
  - [Generated content](#generated-content)
  - [Search architecture](#search-architecture)
- [Explanation](#explanation)
  - [Why this project uses GitHub Discussions as source of truth](#why-this-project-uses-github-discussions-as-source-of-truth)
  - [Why fallback slugs use `gh-<number>`](#why-fallback-slugs-use-gh-number)
  - [Why search index is lazy-loaded](#why-search-index-is-lazy-loaded)
  - [Intended audience](#intended-audience)


## Tutorial

### Publish your first RFD site

1. Create a repository from this template.
2. Edit `fieldnotes.config.json` with your org/repo/title/indexHeading/description.
3. Create Discussion categories in GitHub that match your state keys.
4. Create the `public` label (or set your own `publicLabel` value).
5. Set a token and run local dev.

```bash
GITHUB_TOKEN=ghp_xxx npm run dev
```

What this does:

1. `npm run check` validates repo setup and warns for missing prerequisites.
2. `npm run fetch` pulls Discussions and writes markdown files to `src/content/rfds/`.
3. Astro serves the generated site.

## How-To Guides

### How to configure your repository

1. Enable GitHub Discussions in repository settings.
2. Add categories matching your configured states.
3. Add the label configured by `publicLabel` (default: `public`).

Quick check:

```bash
GITHUB_TOKEN=ghp_xxx npm run check
```

### How to include only public discussions

Set `publicLabel` in `fieldnotes.config.json`:

```json
{
  "publicLabel": "public"
}
```

Only discussions with that label are published.

To include all discussions:

```json
{
  "publicLabel": false
}
```

### How to run accessibility tests

Install browser binaries once:

```bash
npx playwright install chromium
```

Run accessibility checks:

```bash
npm run test:a11y
```

The suite starts `astro dev` directly, scans the index page and one RFD page with `axe-core`, and fails on `serious` or `critical` violations.

### How to run tests and coverage

Run unit tests:

```bash
npm run test
```

Run Node test coverage:

```bash
node --import tsx --experimental-test-coverage --test "tests/**/*.test.ts"
```

### How to deploy to GitHub Pages

1. In repository settings, open Pages.
2. Set source to GitHub Actions.
3. Run the build/deploy workflow.
4. Set `base` in `fieldnotes.config.json`.

Use:

1. `"/"` for user or org pages.
2. `"/repo-name/"` for project pages.

## Reference

### Scripts

| Script | Purpose |
| --- | --- |
| `npm run check` | Validate Discussions enabled, expected categories, and public label |
| `npm run fetch` | Fetch discussions and write markdown content into `src/content/rfds/` |
| `npm run dev` | Run check + fetch, then start Astro dev server |
| `npm run build` | Run check + fetch, then build static site |
| `npm run preview` | Preview built site |
| `npm run test` | Run Node test runner on `tests/**/*.test.ts` |
| `npm run test:a11y` | Run browser accessibility checks with Playwright + axe |

### Fetch rate-limit controls

`npm run fetch` now applies built-in API safety limits to reduce the chance of hitting GitHub GraphQL rate limits on large Discussion sets.

Defaults:

1. `OPEN_FIELDNOTES_MAX_GRAPHQL_REQUESTS=180`
2. `OPEN_FIELDNOTES_MIN_RATE_REMAINING=100`
3. `OPEN_FIELDNOTES_REQUEST_THROTTLE_MS=150`
4. `OPEN_FIELDNOTES_RATE_LOG_EVERY=20`
5. `OPEN_FIELDNOTES_RATE_RESET_BUFFER_SECONDS=15`
6. `OPEN_FIELDNOTES_MAX_WAIT_FOR_RESET_SECONDS=900`

Example override for very large repos:

```bash
OPEN_FIELDNOTES_MAX_GRAPHQL_REQUESTS=300 \
OPEN_FIELDNOTES_MIN_RATE_REMAINING=150 \
OPEN_FIELDNOTES_REQUEST_THROTTLE_MS=250 \
GITHUB_TOKEN=ghp_xxx npm run fetch
```

### Configuration (`fieldnotes.config.json`)

| Key | Type | Description |
| --- | --- | --- |
| `org` | `string` | GitHub org/user owning Discussions |
| `repo` | `string` | Repository name containing Discussions |
| `title` | `string` | Site title |
| `indexHeading` | `string` | Main heading shown on the index page |
| `description` | `string` | Site description |
| `base` | `string` | URL base path (`/` or `/repo-name/`) |
| `publicLabel` | `string \| false` | Required label for published discussions, or `false` for all |
| `states` | `Record<string, { category: string; label: string; color: string }>` | RFD states used by UI and state resolution. Keys are arbitrary  define as many or as few as your workflow needs. The included defaults are suggestive, not required. |

Each state object:

| Key | Description |
| --- | --- |
| `category` | GitHub Discussion category name this state maps to |
| `label` | Display label shown in the UI |
| `color` | Hex color used for the state badge and filter button |

Example (the defaults shipped with the template - replace freely):

```json
{
  "states": {
    "prediscussion": { "category": "Pre-Discussion", "label": "Pre-Discussion", "color": "#9ca3af" },
    "discussion":    { "category": "Discussion",     "label": "Discussion",     "color": "#f59e0b" },
    "published":     { "category": "Published",      "label": "Published",      "color": "#10b981" },
    "committed":     { "category": "Committed",      "label": "Committed",      "color": "#3b82f6" },
    "abandoned":     { "category": "Abandoned",      "label": "Abandoned",      "color": "#ef4444" }
  }
}
```

### Discussion title and slug policy

Expected title format:

```text
RFD 0042: My Proposal
```

Slug rules:

1. If title matches `RFD NNNN: ...`, slug is the parsed number (`0042`).
2. If it does not match, slug is fallback `gh-<discussionNumber>` (example: `gh-17`).

Conflict rules:

1. Slug conflicts are fatal and fail `npm run fetch` before file writes.
2. Explicit RFD number conflicts are treated as fatal conflicts.
3. Title conflicts only warn (not fatal) if slugs are unique.

### State resolution order

For each discussion:

1. Category name match against configured state `category` values.
2. Label name match against configured state keys.
3. Default to the first state key that has a `category` named `Discussion`, then the first key named `discussion`, then the first state defined.

### Generated content

Each fetched discussion becomes `src/content/rfds/<slug>.md` with frontmatter and body content.

Discussion comments are appended under a `Discussion Comments` section.

Generated files are build artifacts and should not be committed.

### Search architecture

Index page search uses Fuse.js with lazy loading:

1. Table rows render immediately from content collection.
2. Full search corpus is fetched on demand from `/search-index.json`.
3. Search corpus contains compact `searchText` (normalized and truncated) to keep payload bounded.

## Explanation

### Why this project uses GitHub Discussions as source of truth

Teams already discuss proposals there. OpenFieldnotes treats those discussions as canonical and makes them browseable as a static documentation site.

### Why fallback slugs use `gh-<number>`

A plain numeric fallback can collide with explicit `RFD NNNN` titles. Namespacing fallback slugs avoids accidental overwrite and makes source provenance obvious.

### Why search index is lazy-loaded

RFD bodies and comments can be large. Loading full-text search data only when needed keeps initial page load fast while still enabling richer search.

### Intended audience

OpenFieldnotes is useful for open-source teams, public-sector projects, and internal engineering groups that want transparent technical decision records without adding heavyweight tooling.

