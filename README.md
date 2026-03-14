# OpenFieldnotes

OpenFieldnotes is a GitHub template repository that turns GitHub Discussions into an RFD (Requests for Discussion) static site, inspired by [Oxide's RFD process](https://rfd.shared.oxide.computer). It fetches Discussions from your GitHub repo, converts them to markdown, and publishes a searchable, filterable site to GitHub Pages — all via GitHub Actions.

---

## Quick Start

1. **Use this template** — Click "Use this template" on GitHub to create your own repo.
2. **Edit `fieldnotes.config.mjs`** — Set your `org`, `repo`, `title`, `description`, and any state/label customisations.
3. **Set up Discussion categories** — Create categories in your repo matching the state keys in your config (e.g. `prediscussion`, `discussion`, `published`, `committed`, `abandoned`).
4. **Enable GitHub Pages** — In your repo settings, go to *Pages* → *Source* → select **GitHub Actions**.
5. **Trigger the first build** — Go to *Actions* → *Build and Deploy* → *Run workflow*.

---

## Discussion Title Convention

Discussions must follow this title format for the RFD number to be parsed correctly:

```
RFD 0042: My Proposal
```

If a Discussion title doesn't match this pattern, the discussion number is used as a fallback slug and a warning is logged during the build.

---

## State Tracking

Each RFD's state is determined in this order (category takes priority):

1. **Category-based**: if the Discussion's category name matches a key in `config.states`, that key is used as the state.
2. **Label-based**: if any label on the Discussion matches a key in `config.states`, that is used.
3. **Default**: falls back to `"discussion"` if neither matches.

Configure your states in `fieldnotes.config.mjs`:

```js
states: {
  prediscussion: { label: "Pre-Discussion", color: "#9ca3af" },
  discussion:    { label: "Discussion",     color: "#f59e0b" },
  published:     { label: "Published",      color: "#10b981" },
  committed:     { label: "Committed",      color: "#3b82f6" },
  abandoned:     { label: "Abandoned",      color: "#ef4444" },
}
```

---

## Public vs Private RFDs

Only Discussions tagged with the label matching `config.publicLabel` (default: `"public"`) are included in the build. Discussions without that label are silently excluded. This lets your org keep drafts and internal RFDs in the same repo without exposing them on the public site.

Set `publicLabel: false` in your config to include **all** Discussions (useful for fully internal deployments).

---

## Local Development

```bash
GITHUB_TOKEN=ghp_xxx npm run dev
```

This runs the fetch script (writing markdown files to `src/content/rfds/`) and then starts the Astro dev server.

> **Note:** `src/content/rfds/*.md` is in `.gitignore` — these files are generated at build time and should never be committed.

---

## Configuration Reference (`fieldnotes.config.mjs`)

| Key | Description |
|-----|-------------|
| `org` | GitHub organisation or user that owns the source repo |
| `repo` | Repository name where Discussions live |
| `title` | Site title shown in the header |
| `description` | Site description shown on the index page |
| `base` | Base URL path. Use `"/"` for a user/org site; use `"/repo-name/"` for a project site |
| `publicLabel` | Label name that marks a Discussion as public. Set to `false` to include all. |
| `states` | Map of state keys to `{ label, color }` objects for badge rendering |

---

## Who is this for?

OpenFieldnotes is designed for open map data and civic tech organisations that want a transparent, Git-native process for proposing and tracking technical decisions — but it works for any team that uses GitHub Discussions.

