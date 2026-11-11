// Run with: node tools/build-preview.js
// Builds dist/preview.html: the real app as one self-contained page for an artifact preview.
// Modules are bundled, the CSS is inlined and the fonts become data: URLs. There is no service
// worker in a preview (artifacts can't run one), and the artifact wrapper already pads for the
// notch and home bar, so the app's own safe-area padding is switched off.

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('..', import.meta.url).pathname;
const read = (file) => readFileSync(`${root}${file}`, 'utf8');

const bundle = await build({ entryPoints: [`${root}js/app.js`], bundle: true, format: 'iife', minify: true, write: false });
const css = read('css/app.css').replace(/url\('\.\.\/(fonts\/[^']+)'\)/g, (_, file) =>
  `url('data:font/woff2;base64,${readFileSync(`${root}${file}`).toString('base64')}')`);
const body = read('index.html').match(/<body>([\s\S]*)<script type="module"/)[1];

const html = `<title>Grassroots Manager</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}
/* Preview only: the artifact wrapper already pads the top and bottom. */
.topbar { padding-top: 10px } .start { padding-top: 20px } .tabbar { padding-bottom: 8px } .update { padding-top: 12px } .sheet { padding-bottom: 12px }
</style>
${body}
<script>${bundle.outputFiles[0].text.replace(/<\/script/g, '<\\/script')}</script>
`;
mkdirSync(`${root}dist`, { recursive: true });
writeFileSync(`${root}dist/preview.html`, html);
console.log(`dist/preview.html ${(html.length / 1024).toFixed(0)} KB`);
