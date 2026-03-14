export default {
  org: "your-github-org",
  repo: "your-github-repo",
  title: "Our Field Notes",
  description: "Requests for Discussion for our organization.",
  base: "/",  // set to "/repo-name/" if deploying to GitHub Pages project site
  publicLabel: "public",  // only Discussions with this label will be built
  states: {
    prediscussion: { label: "Pre-Discussion", color: "#9ca3af" },
    discussion:    { label: "Discussion",     color: "#f59e0b" },
    published:     { label: "Published",      color: "#10b981" },
    committed:     { label: "Committed",      color: "#3b82f6" },
    abandoned:     { label: "Abandoned",      color: "#ef4444" },
  }
}
