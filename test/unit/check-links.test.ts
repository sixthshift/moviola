/*
 * The link checker, checked — a scanner that reports green on links it never
 * read is worse than no scanner, and that is exactly what a line-by-line
 * scan did to any link whose label wrapped (a long image alt, a
 * sentence-length label). Each case below is a contrast pair: the same
 * wrapped link resolving and not resolving, so a regression shows up as a
 * pass where a failure belongs rather than as a missing test.
 *
 * Driven as a subprocess because the CLI contract — exit code plus the
 * unresolved path on stderr — is what `bun run check` consumes.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'

const SCRIPT = path.join(import.meta.dirname, '../../scripts/check-links.mjs')
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moviola-links-'))

afterAll(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

/** Write `body` beside a real `target.md`, then run the checker over it. */
function check(name: string, body: string) {
  const file = path.join(tmpDir, `${name}.md`)
  fs.writeFileSync(path.join(tmpDir, 'target.md'), '# real\n')
  fs.writeFileSync(file, body)
  try {
    execFileSync('node', [SCRIPT, file], { encoding: 'utf8', stdio: 'pipe' })
    return { code: 0, stderr: '' }
  } catch (err) {
    const e = err as { status: number; stderr: string }
    return { code: e.status, stderr: e.stderr }
  }
}

describe('check-links', () => {
  test('a link whose label wraps across lines is still scanned', () => {
    const { code, stderr } = check(
      'wrapped-broken',
      '![a very long image description that keeps going\nand wraps onto a second line](missing.png)\n'
    )
    expect(code).toBe(1)
    expect(stderr).toContain('missing.png')
  })

  test('the same wrapped link passes when its target exists', () => {
    const { code } = check(
      'wrapped-ok',
      '![a very long image description that keeps going\nand wraps onto a second line](target.md)\n'
    )
    expect(code).toBe(0)
  })

  test('a wrapped link reports the line it starts on', () => {
    const { stderr } = check('wrapped-line', 'intro\n\n[label that spans\ntwo lines](missing.md)\n')
    expect(stderr).toMatch(/:3: unresolved link "missing\.md"/)
  })

  test('single-line links and href attributes still resolve', () => {
    expect(check('inline-ok', '[real](target.md) <a href="target.md">x</a>\n').code).toBe(0)
    expect(check('inline-broken', '<a href="gone.html">x</a>\n').code).toBe(1)
  })

  test('fenced code is still exempt, wrapped or not', () => {
    const { code } = check(
      'fenced',
      '```html\n<link rel="stylesheet"\n      href="moviola.css">\n```\n'
    )
    expect(code).toBe(0)
  })

  test('a label wrapping does not let the target itself wrap', () => {
    // `](` must stay adjacent, so a break between label and target is not a
    // link at all — scanning the whole file must not invent one.
    const { code } = check('split-target', '[label]\n(missing.md)\n')
    expect(code).toBe(0)
  })
})
