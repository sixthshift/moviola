/*
 * Exercises scripts/validate-story.mjs against every broken fixture — each
 * run from a copy at a randomized temp filename, so nothing in the validator
 * can be keyed off a fixture's name — and asserts the exact, exclusive
 * failure reason the ticket's ACCEPTANCE specifies for that fixture.
 *
 * The validator spawns its own browser per run, so these tests carry a
 * generous per-test timeout.
 */
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'

// Each test spawns a full Chromium via the CLI; running them all in parallel
// workers can crash the browsers on memory-constrained machines. This file
// is pinned to its own single-worker Playwright project (see
// playwright.config.ts's "chromium-validator" project) so its tests never
// run concurrently with each other, while the rest of e2e keeps parallelism.

const ROOT = path.join(import.meta.dirname, '..')
const VALIDATOR = path.join(ROOT, 'scripts/validate-story.mjs')

interface StoryReport {
  pass: boolean
  stepCount: number
  glueTier: string
  glueFlags: string[]
  externalUrls: string[]
  consoleErrors: string[]
  bidirectionalConsistent: boolean
  failures: string[]
}

interface Report {
  pass: boolean
  stories: StoryReport[]
}

function runValidator(
  absHtmlPath: string,
  extraArgs: string[] = []
): { code: number | null; report: Report } {
  const result = spawnSync('node', [VALIDATOR, absHtmlPath, ...extraArgs], { encoding: 'utf8' })
  let report: Report
  try {
    report = JSON.parse(result.stdout)
  } catch {
    throw new Error(
      `validator produced non-JSON output\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    )
  }
  return { code: result.status, report }
}

/** The single story every fixture contains; throws loudly if the report is empty. */
function firstStory(report: Report): StoryReport {
  const story = report.stories[0]
  if (!story) throw new Error('validator report contains no stories')
  return story
}

// Copies the fixture into a fresh temp dir under a random UUID filename —
// nothing about the original path or basename survives the copy.
function runValidatorOnRandomizedCopy(fixtureRelPath: string) {
  const src = path.join(import.meta.dirname, fixtureRelPath)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrolly-validator-'))
  const dest = path.join(tmpDir, `${crypto.randomUUID()}.html`)
  fs.copyFileSync(src, dest)
  try {
    return runValidator(dest)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

test('dead-steps: fails solely on distinctGraphicStates, never glue/external', () => {
  const { code, report } = runValidatorOnRandomizedCopy('fixtures-broken/dead-steps.html')
  expect(code).toBe(1)
  const story = firstStory(report)
  expect(story.failures).toContain('distinctGraphicStates<4')
  expect(story.failures.some(f => f.startsWith('glueTier'))).toBe(false)
  expect(story.failures).not.toContain('externalUrls')
})

test('external-url: fails listing both the absolute https:// and the protocol-relative URL, nothing else', () => {
  const { code, report } = runValidatorOnRandomizedCopy('fixtures-broken/external-url.html')
  expect(code).toBe(1)
  const story = firstStory(report)
  expect(story.failures).toEqual(['externalUrls'])
  expect(story.externalUrls.some(u => /^https:\/\//.test(u))).toBe(true)
  expect(story.externalUrls.some(u => /^\/\//.test(u))).toBe(true)
})

test('fetch-external: fails listing the runtime-constructed, intercepted request URL', () => {
  const { code, report } = runValidatorOnRandomizedCopy('fixtures-broken/fetch-external.html')
  expect(code).toBe(1)
  const story = firstStory(report)
  expect(story.failures).toEqual(['externalUrls'])
  expect(
    story.externalUrls.some(u => u.startsWith('https://') && u.includes('should-not-be-fetched'))
  ).toBe(true)
})

test('scroll-jack: glueTier fails naming addEventListener(wheel), nothing else', () => {
  const { code, report } = runValidatorOnRandomizedCopy('fixtures-broken/scroll-jack.html')
  expect(code).toBe(1)
  const story = firstStory(report)
  expect(story.glueTier).toBe('fail')
  expect(story.glueFlags).toContain('addEventListener(wheel)')
  expect(story.failures).toEqual(['glueTier:fail(addEventListener(wheel))'])
})

test('scroll-jack-obfuscated: glueTier fails the same way despite bracket-notation + string-concat obfuscation', () => {
  const { code, report } = runValidatorOnRandomizedCopy(
    'fixtures-broken/scroll-jack-obfuscated.html'
  )
  expect(code).toBe(1)
  const story = firstStory(report)
  expect(story.glueTier).toBe('fail')
  expect(story.glueFlags).toContain('addEventListener(wheel)')
  expect(story.failures).toEqual(['glueTier:fail(addEventListener(wheel))'])
})

test('asymmetric-state: fails solely on bidirectionalConsistent', () => {
  const { code, report } = runValidatorOnRandomizedCopy('fixtures-broken/asymmetric-state.html')
  expect(code).toBe(1)
  const story = firstStory(report)
  expect(story.failures).toEqual(['bidirectionalConsistent'])
  expect(story.bidirectionalConsistent).toBe(false)
})

test('runtime-error: fails solely on consoleErrors', () => {
  const { code, report } = runValidatorOnRandomizedCopy('fixtures-broken/runtime-error.html')
  expect(code).toBe(1)
  const story = firstStory(report)
  expect(story.failures).toEqual(['consoleErrors'])
  expect(story.consoleErrors.length).toBeGreaterThan(0)
})

test('fixtures-clean/wheel-in-comment: passes — "wheel" in a comment never trips glue detection', () => {
  const { code, report } = runValidatorOnRandomizedCopy('fixtures-clean/wheel-in-comment.html')
  expect(code).toBe(0)
  expect(firstStory(report).pass).toBe(true)
  expect(firstStory(report).glueTier).not.toBe('fail')
})

test('--report: writes a self-contained storyboard with one <img> per step per direction and no external refs', () => {
  const src = path.join(import.meta.dirname, 'fixtures-clean/wheel-in-comment.html')
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrolly-validator-'))
  const dest = path.join(tmpDir, `${crypto.randomUUID()}.html`)
  const reportPath = path.join(tmpDir, 'report.html')
  fs.copyFileSync(src, dest)
  try {
    const { code, report } = runValidator(dest, ['--report', reportPath])
    expect(code).toBe(0)
    expect(report.pass).toBe(true)
    expect(fs.existsSync(reportPath)).toBe(true)

    const reportHtml = fs.readFileSync(reportPath, 'utf8')
    const stepCount = report.stories[0]?.stepCount ?? 0
    expect(stepCount).toBeGreaterThan(0)
    const imgCount = (reportHtml.match(/<img\b/g) || []).length
    expect(imgCount).toBe(stepCount * 2) // forward + reverse shot per step

    // The same (https?:)?// external-reference scan the validator runs
    // against authored pages, applied to its own generated report: must
    // find nothing — every image is a data: URI, every style inline.
    const isExternalRef = (v: string) => /^(https?:)?\/\//i.test(v.trim())
    const attrRe = /\b(?:src|href|xlink:href)\s*=\s*(["'])([^"']*)\1/gi
    const cssUrlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi
    const found: string[] = []
    for (const re of [attrRe, cssUrlRe]) {
      let m: RegExpExecArray | null
      while ((m = re.exec(reportHtml))) {
        const ref = m[2] ?? ''
        if (isExternalRef(ref)) found.push(ref)
      }
    }
    expect(found).toEqual([])
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('--report: stdout and exit code are byte-identical to a run without the flag', () => {
  const src = path.join(import.meta.dirname, 'fixtures-clean/wheel-in-comment.html')
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrolly-validator-'))
  const dest = path.join(tmpDir, `${crypto.randomUUID()}.html`)
  const reportPath = path.join(tmpDir, 'report.html')
  fs.copyFileSync(src, dest)
  try {
    const plain = spawnSync('node', [VALIDATOR, dest], { encoding: 'utf8' })
    const reported = spawnSync('node', [VALIDATOR, dest, '--report', reportPath], {
      encoding: 'utf8',
    })
    expect(reported.status).toBe(plain.status)
    expect(reported.stdout).toBe(plain.stdout)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('index.html: the repo demo passes end to end', () => {
  const { code, report } = runValidator(path.join(ROOT, 'index.html'))
  expect(code).toBe(0)
  expect(report.pass).toBe(true)
})

test('no fixture-name special-casing in the validator source', () => {
  const source = fs.readFileSync(VALIDATOR, 'utf8')
  expect(source).not.toMatch(
    /dead-steps|external-url|scroll-jack|asymmetric|runtime-error|fetch-external/
  )
})
