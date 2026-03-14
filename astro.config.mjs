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
  vite: {
    build: {
      // Suppress noisy upstream Vite tree-shaking warnings from Astro internals.
      rollupOptions: {
        onwarn(warning, defaultHandler) {
          if (warning.code === 'UNUSED_EXTERNAL_IMPORT' && warning.exporter?.includes('@astrojs/')) {
            return;
          }
          defaultHandler(warning);
        },
      },
    },
  },
});
