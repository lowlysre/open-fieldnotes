import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import config from '../fieldnotes.config.json';

// Pre-compute the set of valid state keys so we can validate content front-matter
// against fieldnotes.config.json at build time rather than hard-coding values.
const validStateKeys = new Set(Object.keys(config.states));

const rfds = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/rfds' }),
  schema: z.object({
    number: z.string(),
    title: z.string(),
    state: z.string().refine((value: string) => validStateKeys.has(value), {
      message: 'State must be one of the keys configured in fieldnotes.config.json',
    }),
    labels: z.array(z.string()).default([]),
    labelColors: z.array(z.string()).default([]),
    createdAt: z.string(),
    updatedAt: z.string(),
    discussionUrl: z.string().url(),
    author: z.string(),
  }),
});

export const collections = { rfds };
