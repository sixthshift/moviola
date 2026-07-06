/*
 * Exercises test/validate-story.mjs against every broken fixture — each run
 * from a copy at a randomized temp filename, so nothing in the validator can
 * be keyed off a fixture's name — and asserts the exact, exclusive failure
 * reason the ticket's ACCEPTANCE specifies for that fixture.
 */
import { test, expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = path.join(import.meta.dir, '..')
const VALIDATOR = path.join(import.meta.dir, 'validate-story.mjs')
const TIMEOUT = 60000

function runValidator (absHtmlPath) {
  const result = spawnSync('node', [VALIDATOR, absHtmlPath], { encoding: 'utf8' })
  let report
  try {
    report = JSON.parse(result.stdout)
  } catch {
    throw new Error(`validator produced non-JSON output\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return { code: result.status, report }
}

// Copies the fixture into a fresh temp dir under a random UUID filename —
// nothing about the original path or basename survives the copy.
function runValidatorOnRandomizedCopy (fixtureRelPath) {
  const src = path.join(import.meta.dir, fixtureRelPath)
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
  const story = report.stories[0]
  expect(story.failures).toContain('distinctGraphicStates<4')
  expect(story.failures.some(f => f.startsWith('glueTier'))).toBe(false)
  expect(story.failures).not.toContain('externalUrls')
}, TIMEOUT)

test('external-url: fails listing both the absolute https:// and the protocol-relative URL, nothing else', () => {
  const { code, report } = runValidatorOnRandomizedCopy('fixtures-broken/external-url.html')
  expect(code).toBe(1)
  const story = report.stories[0]
  expect(story.failures).toEqual(['externalUrls'])
  expect(story.externalUrls.some(u => /^https:\/\//.test(u))).toBe(true)
  expect(story.externalUrls.some(u => /^\/\//.test(u))).toBe(true)
}, TIMEOUT)

test('fetch-external: fails listing the runtime-constructed, intercepted request URL', () => {
  const { code, report } = runValidatorOnRandomizedCopy('fixtures-broken/fetch-external.html')
  expect(code).toBe(1)
  const story = report.stories[0]
  expect(story.failures).toEqual(['externalUrls'])
  expect(story.externalUrls.some(u => u.startsWith('https://') && u.includes('should-not-be-fetched'))).toBe(true)
}, TIMEOUT)

test('scroll-jack: glueTier fails naming addEventListener(wheel), nothing else', () => {
  const { code, report } = runValidatorOnRandomizedCopy('fixtures-broken/scroll-jack.html')
  expect(code).toBe(1)
  const story = report.stories[0]
  expect(story.glueTier).toBe('fail')
  expect(story.glueFlags).toContain('addEventListener(wheel)')
  expect(story.failures).toEqual([`glueTier:fail(addEventListener(wheel))`])
}, TIMEOUT)

test('scroll-jack-obfuscated: glueTier fails the same way despite bracket-notation + string-concat obfuscation', () => {
  const { code, report } = runValidatorOnRandomizedCopy('fixtures-broken/scroll-jack-obfuscated.html')
  expect(code).toBe(1)
  const story = report.stories[0]
  expect(story.glueTier).toBe('fail')
  expect(story.glueFlags).toContain('addEventListener(wheel)')
  expect(story.failures).toEqual([`glueTier:fail(addEventListener(wheel))`])
}, TIMEOUT)

test('asymmetric-state: fails solely on bidirectionalConsistent', () => {
  const { code, report } = runValidatorOnRandomizedCopy('fixtures-broken/asymmetric-state.html')
  expect(code).toBe(1)
  const story = report.stories[0]
  expect(story.failures).toEqual(['bidirectionalConsistent'])
  expect(story.bidirectionalConsistent).toBe(false)
}, TIMEOUT)

test('runtime-error: fails solely on consoleErrors', () => {
  const { code, report } = runValidatorOnRandomizedCopy('fixtures-broken/runtime-error.html')
  expect(code).toBe(1)
  const story = report.stories[0]
  expect(story.failures).toEqual(['consoleErrors'])
  expect(story.consoleErrors.length).toBeGreaterThan(0)
}, TIMEOUT)

test('fixtures-clean/wheel-in-comment: passes — "wheel" in a comment never trips glue detection', () => {
  const { code, report } = runValidatorOnRandomizedCopy('fixtures-clean/wheel-in-comment.html')
  expect(code).toBe(0)
  expect(report.stories[0].pass).toBe(true)
  expect(report.stories[0].glueTier).not.toBe('fail')
}, TIMEOUT)

test('index.html: the repo demo passes end to end', () => {
  const { code, report } = runValidator(path.join(ROOT, 'index.html'))
  expect(code).toBe(0)
  expect(report.pass).toBe(true)
}, TIMEOUT)

test('no fixture-name special-casing in the validator source', () => {
  const source = fs.readFileSync(VALIDATOR, 'utf8')
  expect(source).not.toMatch(/dead-steps|external-url|scroll-jack|asymmetric|runtime-error|fetch-external/)
})
