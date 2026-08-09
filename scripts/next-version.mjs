#!/usr/bin/env node
// Decides the next version from the conventional commits since the last
// `v*` tag, and prints it — or prints nothing at all when the range holds
// no releasable change. The release workflow reads silence as "skip",
// which is what keeps a `docs:`-only push from burning a version number
// that can never be reused.
//
// Conventional Commits, restricted to the types that can move a published
// consumer contract: `feat` is a minor, `fix`/`perf`/`revert` are patches,
// and a `!` marker or a `BREAKING CHANGE` footer is a major. Everything
// else — `docs`, `chore`, `test`, `ci`, `style`, and a plain `refactor` —
// is invisible to consumers by definition, so it releases nothing. A
// breaking `refactor!` still lands as a major via the `!`, which is how
// the moviola rename (e1b622b) would have been caught.
//
// Usage: node scripts/next-version.mjs
// Prints `0.2.0` (no `v`) and exits 0, or prints nothing and exits 0.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const BUMP_BY_TYPE = { feat: 'minor', fix: 'patch', perf: 'patch', revert: 'patch' }
const RANK = { patch: 1, minor: 2, major: 3 }

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()

/** The strongest bump a single commit justifies, or null if it ships nothing. */
const bumpFor = message => {
  const header = message.split('\n', 1)[0]
  const m = header.match(/^(?<type>[a-z]+)(?:\([^)]*\))?(?<breaking>!)?:/i)
  if (!m) return null // not conventional — unparseable is not releasable
  if (m.groups.breaking || /^BREAKING[ -]CHANGE:/m.test(message)) return 'major'
  return BUMP_BY_TYPE[m.groups.type.toLowerCase()] ?? null
}

const strongestBump = messages =>
  messages.reduce((best, message) => {
    const bump = bumpFor(message)
    if (!bump) return best
    return !best || RANK[bump] > RANK[best] ? bump : best
  }, null)

// Pre-1.0, a breaking change is a minor: 1.0.0 is a statement about
// stability, and letting `feat!` make it automatically would have this
// script decide something only a human can.
const applyBump = (current, bump) => {
  const [major, minor, patch] = current.split('.').map(Number)
  if (major === 0 && bump === 'major') return `0.${minor + 1}.0`
  if (bump === 'major') return `${major + 1}.0.0`
  if (bump === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

const lastTag = (() => {
  try {
    // stderr ignored: "No names found" is the expected answer before the
    // first tag, and letting git print it makes a healthy run look broken.
    return execFileSync('git', ['describe', '--tags', '--match', 'v[0-9]*', '--abbrev=0'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null // no tag yet: the whole history is the range
  }
})()

// %B (full body) rather than %s: a `BREAKING CHANGE:` footer is the other
// half of the major-bump contract and never appears in the subject. The
// ASCII record separator delimits commits because bodies contain blank
// lines, so no newline-based split is safe.
const range = lastTag ? [`${lastTag}..HEAD`] : []
const messages = git('log', '--format=%B%x1e', ...range)
  .split('\x1e')
  .map(m => m.trim())
  .filter(Boolean)

const bump = strongestBump(messages)
if (!bump) process.exit(0)

const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

// Whichever of the two is further ahead wins. They normally agree — the
// release commit stamps the manifest and tags it in one step — but moviola
// 0.1.0 was published by hand before this workflow existed, so the manifest
// can name a version no tag does. Compared numerically: `0.10.0` sorts below
// `0.9.0` as a string.
const isNewer = (a, b) => {
  const [x, y] = [a, b].map(v => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i]
  }
  return false
}
const tagged = lastTag?.slice(1)
const base = tagged && isNewer(tagged, version) ? tagged : version
process.stdout.write(applyBump(base, bump))
