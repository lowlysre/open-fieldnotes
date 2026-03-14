import { getCollection } from 'astro:content';
import fieldnotesConfig from '../../fieldnotes.config.json';
import { buildLlmsTxt } from '../lib/llms';

export const prerender = true;

const site = `https://${fieldnotesConfig.org}.github.io`;

export async function GET(): Promise<Response> {
  const rfds = await getCollection('rfds');
  const stateCounts = Object.entries(fieldnotesConfig.states).map(([key, state]) => ({
    key,
    label: state.label,
    count: rfds.filter((rfd) => rfd.data.state === key).length,
  }));

  const body = buildLlmsTxt({
    site,
    config: fieldnotesConfig,
    stats: {
      rfdCount: rfds.length,
      stateCounts,
    },
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
