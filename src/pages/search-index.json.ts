import { getCollection } from 'astro:content';
import { toSearchIndexItem } from '../lib/search-index';

export const prerender = true;

export async function GET(): Promise<Response> {
  const rfds = await getCollection('rfds');
  const items = rfds
    .sort((a, b) => b.data.number.localeCompare(a.data.number))
    .map(toSearchIndexItem);

  return new Response(JSON.stringify(items), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
