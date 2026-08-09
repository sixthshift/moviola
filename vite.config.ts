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
 * Everything `vite build` must produce beyond the esm lib-mode bundle:
 *
 *  - dist/moviola.min.js — the canonical runtime artifact. Vite's iife
 *    lib-mode output is an in-memory intermediate only (never written to
 *    dist); esbuild minifies it here with mangleProps /^_/ (internal names
 *    only, never the public contract). Still a classic script attaching
 *    window.Moviola. The readable implementation reference is src/.
 *  - dist/moviola.css    — copied verbatim; the CSS is deliberately not
 *    imported by the JS (one <link>, one <script>, zero coupling).
 *  - dist/moviola.d.ts   — normalize the bundled-declaration filename.
 *  - embed re-sync       — scripts/sync-embeds.mjs re-injects
 *    dist/moviola.min.js into examples, e2e fixtures, and skill/assets so
 *    the byte-identity chain never drifts.
 */
const moviolaArtifacts = (): Plugin => ({
  name: 'moviola:artifacts',
  apply: 'build',
  enforce: 'post', // closeBundle must run after vite-plugin-dts has written its file
  async generateBundle(_options, bundle) {
    const iife = bundle['moviola.iife.js']
    if (iife?.type !== 'chunk') return // fires once, on the iife output pass
    const { code } = await transform(iife.code, {
      minify: true,
      mangleProps: /^_/,
      target: 'es2019',
    })
    this.emitFile({ type: 'asset', fileName: 'moviola.min.js', source: code })
    this.emitFile({
      type: 'asset',
      fileName: 'moviola.css',
      source: readFileSync('src/moviola.css', 'utf8'),
    })
    // The iife lib-mode chunk only exists to derive moviola.min.js above —
    // dropping it from the bundle here (before Rollup writes output) keeps
    // it out of dist entirely.
    delete bundle['moviola.iife.js']
  },
  async closeBundle() {
    const bundledDts = path.resolve('dist/moviola.esm.d.ts')
    if (existsSync(bundledDts)) renameSync(bundledDts, path.resolve('dist/moviola.d.ts'))
    if (!existsSync(path.resolve('dist/moviola.d.ts'))) {
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
      name: 'Moviola',
      formats: ['es', 'iife'],
      fileName: format => (format === 'es' ? 'moviola.esm.js' : 'moviola.iife.js'),
    },
    // iife stays unminified here — it's only the in-memory intermediate the
    // plugin's esbuild pass above derives moviola.min.js from; it's deleted
    // from the bundle before dist is written (see generateBundle).
    minify: false,
    target: 'es2019',
    emptyOutDir: true,
    rollupOptions: {
      output: { exports: 'default', banner },
    },
  },
  plugins: [dts({ bundleTypes: true, include: ['src'] }), moviolaArtifacts()],
  test: {
    include: ['test/unit/**/*.test.ts'],
    environment: 'node',
    // worker_threads instead of child-process forks: fork startup is
    // unreliable inside minimal containers, and nothing here needs isolation
    pool: 'threads',
  },
})
