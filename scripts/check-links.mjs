#!/usr/bin/env node
// Link checker for the docs set — finds relative markdown links
// (`[text](path)`) and HTML hrefs (`href="path"`) and confirms each
// resolves to a real file on disk. Absolute URLs (scheme present),
// same-page fragments (`#id`), and root-absolute paths (`/…`) are out of
// scope — "relative" means relative to the linking file.
//
// Code fences (```…```) are blanked before scanning: fenced blocks are
// illustrative HTML/CSS snippets showing what an *author's own* page
// should contain (e.g. `<link href="scrolly.css">`), not real references
// from this repo's docs — flagging them would be noise, not a defect.
//
// Usage: node scripts/check-links.mjs [file ...]
// Defaults to the root docs set plus docs/*.md. Exits 1 and lists every
// unresolved target; exits 0 once everything resolves.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DEFAULT_FILES = [
  'README.md',
  'SPEC.md',
  'ARCHITECTURE.md',
  'CONTRIBUTING.md',
  'docs/api.md',
  'docs/philosophy.md',
  'docs/recipes.md',
].map(f => path.join(ROOT, f))

const MD_LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g
const HREF_RE = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')/g

function stripFencedCode(text) {
  let inFence = false
  return text
    .split('\n')
    .map(line => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence
        return ''
      }
      return inFence ? '' : line
    })
    .join('\n')
}

function isInScope(target) {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) return false // scheme (http:, mailto:, …)
  if (target.startsWith('#')) return false // same-page fragment
  if (target.startsWith('/')) return false // root-absolute, not relative
  return true
}

const lineOf = (text, offset) => text.slice(0, offset).split('\n').length

/*
 * Scanned as one string, not line by line: a link whose text wraps — a long
 * image alt, a sentence-length label — is still one link, and matching per
 * line skipped it silently, which is the worst failure a checker has (a green
 * run over a link it never read). `](` must still be adjacent, so a wrap
 * between the label and the target does not match, and stripFencedCode blanks
 * fenced lines while keeping their newlines, so offsets still name the right
 * line.
 */
function findLinks(text) {
  const scanned = stripFencedCode(text)
  const links = []
  for (const re of [MD_LINK_RE, HREF_RE]) {
    re.lastIndex = 0
    let m
    while ((m = re.exec(scanned))) {
      const raw = (m[1] ?? m[2]).trim().split(/\s+/)[0] // drop a markdown title suffix
      if (isInScope(raw)) links.push({ line: lineOf(scanned, m.index), target: raw })
    }
  }
  return links
}

function checkFile(file) {
  const text = fs.readFileSync(file, 'utf8')
  const unresolved = []
  for (const { line, target } of findLinks(text)) {
    const clean = target.replace(/[#?].*$/, '')
    const resolved = path.resolve(path.dirname(file), clean)
    if (!fs.existsSync(resolved)) unresolved.push({ file, line, target, resolved })
  }
  return unresolved
}

function main() {
  const argFiles = process.argv.slice(2)
  const files = (argFiles.length ? argFiles : DEFAULT_FILES).map(f =>
    path.resolve(process.cwd(), f)
  )

  const missing = files.filter(f => !fs.existsSync(f))
  if (missing.length) {
    for (const f of missing) console.error(`no such file: ${f}`)
    process.exit(1)
  }

  const allUnresolved = files.flatMap(checkFile)

  if (allUnresolved.length) {
    for (const u of allUnresolved) {
      console.error(
        `${path.relative(process.cwd(), u.file)}:${u.line}: unresolved link "${u.target}" -> ${u.resolved}`
      )
    }
    process.exit(1)
  }

  console.log(`check-links: ${files.length} file(s) scanned, all relative links resolve`)
  process.exit(0)
}

main()
