// @ts-check
import { defineConfig } from 'astro/config';
import fieldnotesConfig from './fieldnotes.config.json';

const site = `https://${fieldnotesConfig.org}.github.io`;
const base = fieldnotesConfig.base;

// https://astro.build/config
export default defineConfig({
  output: 'static',
  site,
  base,
});
