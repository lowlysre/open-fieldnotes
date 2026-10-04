/**
 * Writes .pa11yci.json for pa11y-ci-action: the index page plus every fetched RFD page.
 * Run after `npm run fetch`; expects the site to be served at http://127.0.0.1:4321.
 */
import { readdir, writeFile } from 'node:fs/promises';
import fieldnotesConfig from '../fieldnotes.config.json' with { type: 'json' };

const origin = `http://127.0.0.1:4321${fieldnotesConfig.base.replace(/\/$/, '')}`;
const rfdDir = new URL('../src/content/rfds/', import.meta.url);

const entries = await readdir(rfdDir, { withFileTypes: true });
const slugs = entries
  .filter((e) => e.isFile() && e.name.endsWith('.md'))
  .map((e) => e.name.slice(0, -3))
  .sort();

const config = {
  defaults: {
    standard: 'WCAG2AA',
    timeout: 30000,
    chromeLaunchConfig: { args: ['--no-sandbox'] },
  },
  urls: [`${origin}/`, ...slugs.map((slug) => `${origin}/rfd/${slug}/`)],
};

await writeFile(new URL('../.pa11yci.json', import.meta.url), `${JSON.stringify(config, null, 2)}\n`);
console.log(`Wrote .pa11yci.json with ${config.urls.length} URL(s)`);