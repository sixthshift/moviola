import { existsSync, readFileSync, renameSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { transform } from 'esbuild'
import type { Plugin } from 'vite'
import dts from 'vite-plugin-dts'
import { defineConfig } from 'vitest/config'

// The /*! … */ banner from src/index.ts flows into every dist artifact so the
// license/identity comment survives bundling (and, later, minification).
const banner = readFileSync('src/index.ts', 'utf8').match(/^\/\*![\s\S]*?\*\//)?.[0] ?? ''

/**
 * Everything `vite build` must produce beyond the two lib-mode bundles:
 *
 *  - dist/scrolly.min.js — the iife, esbuild-minified with mangleProps /^_/
 *    (internal names only, never the public contract). A separate artifact
 *    because build.minify is all-or-nothing and the iife ships readable.
 *  - dist/scrolly.css    — copied verbatim; the CSS is deliberately not
 *    imported by the JS (one <link>, one <script>, zero coupling).
 *  - dist/scrolly.d.ts   — normalize the bundled-declaration filename.
 *  - embed re-sync       — dist/scrolly.iife.js is the canonical artifact;
 *    scripts/sync-embeds.mjs re-injects it into examples, e2e fixtures, and
 *    skill/assets so the byte-identity chain never drifts.
 */
const scrollyArtifacts = (): Plugin => ({
  name: 'scrolly:artifacts',
  apply: 'build',
  enforce: 'post', // closeBundle must run after vite-plugin-dts has written its file
  async generateBundle(_options, bundle) {
    const iife = bundle['scrolly.iife.js']
    if (iife?.type !== 'chunk') return // fires once, on the iife output pass
    const { code } = await transform(iife.code, {
      minify: true,
      mangleProps: /^_/,
      target: 'es2019',
    })
    this.emitFile({ type: 'asset', fileName: 'scrolly.min.js', source: code })
    this.emitFile({
      type: 'asset',
      fileName: 'scrolly.css',
      source: readFileSync('src/scrolly.css', 'utf8'),
    })
  },
  async closeBundle() {
    const bundledDts = path.resolve('dist/scrolly.esm.d.ts')
    if (existsSync(bundledDts)) renameSync(bundledDts, path.resolve('dist/scrolly.d.ts'))
    if (!existsSync(path.resolve('dist/scrolly.d.ts'))) {
      throw new Error('build: no bundled declaration file was emitted')
    }
    // absolute URL: Vite bundles this config to a temp file, so a relative
    // specifier would resolve against the wrong directory
    const { syncEmbeds } = await import(pathToFileURL(path.resolve('scripts/sync-embeds.mjs')).href)
    syncEmbeds()
  },
})

export default defineConfig({
  build: {
    lib: {
      entry: 'src/index.ts',
      name: 'Scrolly',
      formats: ['es', 'iife'],
      fileName: format => (format === 'es' ? 'scrolly.esm.js' : 'scrolly.iife.js'),
    },
    // The iife stays readable — dist/scrolly.min.js is the plugin's esbuild
    // pass above, so both variants ship.
    minify: false,
    target: 'es2019',
    emptyOutDir: true,
    rollupOptions: {
      output: { exports: 'default', banner },
    },
  },
  plugins: [dts({ bundleTypes: true, include: ['src'] }), scrollyArtifacts()],
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    // worker_threads instead of child-process forks: fork startup is
    // unreliable inside minimal containers, and nothing here needs isolation
    pool: 'threads',
  },
})
