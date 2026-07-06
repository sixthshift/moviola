// dist/ packaging — additive to src/, which stays a zero-build classic script.
// Always regenerates dist/ from scratch; never skips, never stamps dates.
import { rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import * as esbuild from 'esbuild'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const src = readFileSync(path.join(root, 'src/scrolly.js'), 'utf8')
const distDir = path.join(root, 'dist')

rmSync(distDir, { recursive: true, force: true })
mkdirSync(distDir)

// 1. IIFE — the classic script, verbatim.
writeFileSync(path.join(distDir, 'scrolly.iife.js'), src)

// 2. Minified — same IIFE, esbuild-minified (including internal `_`-prefixed
// method/property names, which are never part of the public contract).
const { code: min } = await esbuild.transform(src, {
  minify: true,
  mangleProps: /^_/,
  target: 'es2019'
})
writeFileSync(path.join(distDir, 'scrolly.min.js'), min)

// 3. ESM — the same IIFE run against `globalThis` as `window`, so it behaves
// identically whether loaded as <script type=module> or via bare `import()`
// in a DOM-less runtime; then re-exports what the IIFE attached.
const esm = `const window = globalThis;\n${src}\nexport default globalThis.Scrolly;\n`
writeFileSync(path.join(distDir, 'scrolly.esm.js'), esm)
