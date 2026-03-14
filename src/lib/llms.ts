export interface LlmsSiteConfig {
  title: string;
  description: string;
  org: string;
  repo: string;
  base: string;
  publicLabel: string | false;
  states: Record<string, { category: string; label: string; color: string }>;
}

export interface LlmsStats {
  rfdCount: number;
  stateCounts: Array<{ key: string; label: string; count: number }>;
}

export function joinSiteUrl(site: string, base: string, path = ''): string {
  const siteRoot = site.replace(/\/$/, '');
  const basePath = base === '/' ? '' : base.replace(/\/$/, '');
  const suffix = path ? `/${path.replace(/^\//, '')}` : '';
  return `${siteRoot}${basePath}${suffix}`;
}

export function buildLlmsTxt(params: {
  site: string;
  config: LlmsSiteConfig;
  stats: LlmsStats;
}): string {
  const { site, config, stats } = params;
  const indexUrl = joinSiteUrl(site, config.base);
  const sitemapUrl = joinSiteUrl(site, config.base, 'sitemap-index.xml');
  const searchIndexUrl = joinSiteUrl(site, config.base, 'search-index.json');
  const stateLines = stats.stateCounts.length > 0
    ? stats.stateCounts.map((state) => `- ${state.label} (${state.key}): ${state.count}`).join('\n')
    : '- No RFDs published yet';
  const publicLabelLine = config.publicLabel === false
    ? 'All GitHub Discussions are eligible for publication.'
    : `Only discussions labeled "${config.publicLabel}" are published.`;

  return [
    `# ${config.title}`,
    '',
    `> ${config.description}`,
    '',
    '## Site Purpose',
    `${config.title} is a static RFD (Request for Discussion) site generated from GitHub Discussions for ${config.org}/${config.repo}.`,
    '',
    '## Canonical URLs',
    `- Index: ${indexUrl}`,
    `- Search index JSON: ${searchIndexUrl}`,
    `- Sitemap: ${sitemapUrl}`,
    '',
    '## How To Interpret This Site',
    '- Each RFD page is generated from a GitHub Discussion and should be treated as the authoritative published snapshot for this site.',
    '- The index page is the best starting point for discovering RFDs by number, title, state, labels, and updated date.',
    '- Search is optimized for title, number, labels, author, body text, and discussion comments.',
    `- ${publicLabelLine}`,
    '',
    '## Current Inventory',
    `- Total RFDs: ${stats.rfdCount}`,
    '- RFDs by state:',
    stateLines,
    '',
    '## Configured States',
    ...Object.entries(config.states).map(([key, state]) => `- ${state.label} (${key}): maps to GitHub Discussion category "${state.category}"`),
    '',
    '## Guidance For LLM Consumers',
    '- Prefer the individual RFD pages for detailed reasoning and proposal context.',
    '- Use the index page to discover relevant proposals by state, recency, and title.',
    '- Treat state labels as workflow metadata, not topical taxonomy.',
    '- Discussion comments are included in search text and may contain important follow-up context or clarifications.',
  ].join('\n');
}
