// Run with: node tools/build-stats.js
// Bundles the engine and the stats page into one self-contained HTML file
// (dist/stats.html) for publishing as an artifact preview.

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { measure, measureDivisionGap, measureFormations } from '../js/calibrate.js';

const root = new URL('..', import.meta.url).pathname;

const bundle = await build({
  entryPoints: [`${root}stats/main.js`],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
});

const baked = {
  stats: measure(60),
  gaps: measureDivisionGap(),
  formations: measureFormations(),
};

const template = readFileSync(`${root}stats/template.html`, 'utf8');
const html = template
  .replace('/*__BAKED__*/null', () => JSON.stringify(baked))
  .replace('/*__BUNDLE__*/', () => bundle.outputFiles[0].text.replace(/<\/script/g, '<\\/script'));

mkdirSync(`${root}dist`, { recursive: true });
writeFileSync(`${root}dist/stats.html`, html);
console.log(`dist/stats.html ${(html.length / 1024).toFixed(0)} KB, ${baked.stats.matches} matches baked in`);
