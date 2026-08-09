// Re-inject the built library into every place that embeds a copy of it:
//   - examples/*.html and e2e fixtures   between  <!-- moviola:css/js -->  markers
//   - skill/assets/                      plain file copies
// dist/moviola.min.js is the canonical artifact; embedded copies must stay
// byte-identical (asserted by test/unit/embeds.test.ts). Author glue stays
// outside the markers — the §14 validator classifies anything inside them
// as "the lib".
//
// Runs as the last build step (vite.config.ts `moviola:artifacts` plugin);
// also directly runnable: node scripts/sync-embeds.mjs
import { cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

export const EMBED_DIRS = ['examples', 'e2e/fixtures-broken', 'e2e/fixtures-clean']

export function syncEmbeds(root = ROOT) {
  const css = readFileSync(path.join(root, 'dist/moviola.css'), 'utf8')
  const js = readFileSync(path.join(root, 'dist/moviola.min.js'), 'utf8')

  const blocks = [
    { open: '<!-- moviola:css -->', close: '<!-- /moviola:css -->', body: `<style>${css}</style>` },
    { open: '<!-- moviola:js -->', close: '<!-- /moviola:js -->', body: `<script>${js}</script>` },
  ]

  for (const dir of EMBED_DIRS) {
    for (const name of readdirSync(path.join(root, dir)).filter(f => f.endsWith('.html'))) {
      const file = path.join(root, dir, name)
      let html = readFileSync(file, 'utf8')
      for (const { open, close, body } of blocks) {
        const start = html.indexOf(open)
        const end = html.indexOf(close)
        if (start === -1 || end === -1 || end < start) {
          throw new Error(`sync-embeds: ${dir}/${name} is missing a well-formed ${open} block`)
        }
        if (html.indexOf(open, start + 1) !== -1 || html.indexOf(close, end + 1) !== -1) {
          throw new Error(`sync-embeds: ${dir}/${name} has duplicate ${open} markers`)
        }
        html = `${html.slice(0, start + open.length)}\n${body}\n${html.slice(end)}`
      }
      writeFileSync(file, html)
    }
  }

  cpSync(path.join(root, 'dist/moviola.min.js'), path.join(root, 'skill/assets/moviola.js'))
  cpSync(path.join(root, 'dist/moviola.css'), path.join(root, 'skill/assets/moviola.css'))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) syncEmbeds()
