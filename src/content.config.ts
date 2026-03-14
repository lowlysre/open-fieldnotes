import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const rfds = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/rfds' }),
  schema: z.object({
    number: z.string(),
    title: z.string(),
    state: z.union([
      z.literal('prediscussion'),
      z.literal('discussion'),
      z.literal('published'),
      z.literal('committed'),
      z.literal('abandoned'),
    ]),
    labels: z.array(z.string()).default([]),
    createdAt: z.string(),
    updatedAt: z.string(),
    discussionUrl: z.string().url(),
    author: z.string(),
  }),
});

export const collections = { rfds };
