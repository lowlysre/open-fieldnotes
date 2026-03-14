import fieldnotesConfig from '../../fieldnotes.config.json';
import { joinSiteUrl } from '../lib/llms';

export const prerender = true;

const site = `https://${fieldnotesConfig.org}.github.io`;
const sitemapUrl = joinSiteUrl(site, fieldnotesConfig.base, 'sitemap-index.xml');

const body = `User-agent: *
Allow: /

# LLM crawlers — this site is intentionally public and AI-readable
User-agent: GPTBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: ClaudeBot
Allow: /

Sitemap: ${sitemapUrl}
`;

export async function GET(): Promise<Response> {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
