#!/usr/bin/env node
/*
 * Story validator — SPEC §14 made executable against an arbitrary scrolly
 * HTML file. Checks choreography, never artwork: it drives every step to
 * its trigger position (forward, reverse, and out-of-order) and asserts the
 * lib's own contract (§5) held, using real network interception and real
 * runtime instrumentation rather than any text/name matching.
 *
 * Usage: node test/validate-story.mjs <file.html> [--tier1]
 * Exits 0 if every story on the page passes; prints one JSON report.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import puppeteer from 'puppeteer-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const HERE = path.dirname(new URL(import.meta.url).pathname)
const REPO_ROOT = path.join(HERE, '..')

const PIXEL_CHANNEL_THRESHOLD = 24 // per-channel delta below this counts as "same"
const DISTINCT_PIXEL_FRACTION = 0.02 // >2% of pixels differing => visually distinct
const DWELL_MS = 500

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs (argv) {
  const args = argv.slice(2)
  const flags = new Set(args.filter(a => a.startsWith('--')))
  const files = args.filter(a => !a.startsWith('--'))
  if (files.length !== 1) {
    console.error('usage: node test/validate-story.mjs <file.html> [--tier1]')
    process.exit(1)
  }
  return { file: path.resolve(process.cwd(), files[0]), tier1: flags.has('--tier1') }
}

// ---------------------------------------------------------------------------
// Static source analysis: script-block line ranges + byte-identical lib match
// + the (https?:)?// attribute/CSS source scan for external references.
// ---------------------------------------------------------------------------

function lineOf (text, index) {
  let n = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

// A "script source" is either an inline block (attributed by line range
// within the document) or a separately-loaded local file (attributed by its
// own file:// URL, since every line in that file belongs to it wholesale).
function findScriptSources (html, htmlFile, libSource) {
  const sources = []
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  let m
  while ((m = re.exec(html))) {
    const attrs = m[1]
    const srcMatch = attrs.match(/\bsrc\s*=\s*(["']?)([^"'\s>]+)\1/)
    if (srcMatch) {
      const resolved = path.resolve(path.dirname(htmlFile), srcMatch[2])
      let content = ''
      try { content = fs.readFileSync(resolved, 'utf8') } catch { /* unreadable: treat as author, no content */ }
      sources.push({ kind: 'external', url: `file://${resolved}`, isLib: content === libSource })
      continue
    }
    const contentStart = m.index + m[0].indexOf('>', m[0].indexOf('<script')) + 1
    const content = m[2]
    const contentEnd = contentStart + content.length
    sources.push({
      kind: 'inline',
      content,
      startLine: lineOf(html, contentStart),
      endLine: lineOf(html, contentEnd),
      isLib: content === libSource
    })
  }
  return sources
}

function scanSourceForExternalRefs (html) {
  const found = []
  const isExternalRef = v => /^(https?:)?\/\//i.test(v.trim())

  const attrRe = /\b(?:src|href|xlink:href)\s*=\s*(["'])([^"']*)\1/gi
  let m
  while ((m = attrRe.exec(html))) {
    if (isExternalRef(m[2])) found.push(m[2])
  }

  const srcsetRe = /\bsrcset\s*=\s*(["'])([^"']*)\1/gi
  while ((m = srcsetRe.exec(html))) {
    for (const candidate of m[2].split(',')) {
      const url = candidate.trim().split(/\s+/)[0] || ''
      if (isExternalRef(url)) found.push(url)
    }
  }

  const cssUrlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi
  while ((m = cssUrlRe.exec(html))) {
    if (isExternalRef(m[2])) found.push(m[2])
  }

  return [...new Set(found)]
}

// AST-light: strip comments and string literals, then check every remaining
// statement is a bare Scrolly.init(...) call (optionally destructured/assigned).
function isOnlyInitStatements (jsSource) {
  const stripped = jsSource
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""')
  const statements = stripped.split(/[;\n]/).map(s => s.trim()).filter(Boolean)
  const initStatement = /^(?:(?:const|let|var)\s+(?:\[[^\]]*\]|\{[^}]*\}|\w+)\s*=\s*)?Scrolly\.init\([^()]*\)$/
  return statements.length > 0 && statements.every(s => initStatement.test(s))
}

// ---------------------------------------------------------------------------
// PNG decode (Chrome screenshot output: 8-bit RGBA, non-interlaced) + a
// simple pixel-fraction difference — enough to tell "same graphic" from
// "different graphic" without a decoder/diff dependency.
// ---------------------------------------------------------------------------

function decodePng (buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let offset = 8
  let width, height, bitDepth, colorType
  const idatChunks = []
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const data = buf.subarray(offset + 8, offset + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idatChunks.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset += 12 + len
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG format (bitDepth=${bitDepth} colorType=${colorType})`)
  }
  const channels = colorType === 6 ? 4 : 3
  const raw = zlib.inflateSync(Buffer.concat(idatChunks))
  const stride = width * channels
  const out = Buffer.alloc(height * stride)
  let rawPos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[rawPos++]
    const rowStart = y * stride
    const prevRowStart = (y - 1) * stride
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rawPos++]
      const a = x >= channels ? out[rowStart + x - channels] : 0
      const b = y > 0 ? out[prevRowStart + x] : 0
      const c = (y > 0 && x >= channels) ? out[prevRowStart + x - channels] : 0
      let value
      switch (filter) {
        case 0: value = rawByte; break
        case 1: value = rawByte + a; break
        case 2: value = rawByte + b; break
        case 3: value = rawByte + ((a + b) >> 1); break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
          const pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
          value = rawByte + pred
          break
        }
        default: throw new Error(`unsupported PNG filter type ${filter}`)
      }
      out[rowStart + x] = value & 0xff
    }
  }
  return { width, height, channels, pixels: out }
}

function pixelsDiffer (a, b) {
  if (a.width !== b.width || a.height !== b.height) return true
  const n = a.width * a.height
  let diffCount = 0
  for (let i = 0; i < n; i++) {
    const off = i * a.channels
    let delta = 0
    for (let c = 0; c < 3; c++) delta += Math.abs(a.pixels[off + c] - b.pixels[off + c])
    if (delta > PIXEL_CHANNEL_THRESHOLD) diffCount++
  }
  return diffCount / n > DISTINCT_PIXEL_FRACTION
}

// ---------------------------------------------------------------------------
// In-page instrumentation, installed before any page script runs.
// ---------------------------------------------------------------------------

function installInstrumentation () {
  window.__scrollyProbe = { calls: [], errors: [] }

  window.addEventListener('error', e => {
    window.__scrollyProbe.errors.push(String(e.error?.message || e.message))
  })
  window.addEventListener('unhandledrejection', e => {
    window.__scrollyProbe.errors.push(String(e.reason?.message || e.reason))
  })

  const record = (api) => {
    window.__scrollyProbe.calls.push({ api, stack: new Error().stack || '' })
  }

  const origAdd = EventTarget.prototype.addEventListener
  EventTarget.prototype.addEventListener = function (type, listener, opts) {
    if (['scroll', 'wheel', 'touchstart', 'touchmove'].includes(type)) {
      record(`addEventListener(${type})`)
    }
    return origAdd.call(this, type, listener, opts)
  }

  for (const prop of ['onwheel', 'onscroll']) {
    const desc = Object.getOwnPropertyDescriptor(window, prop)
    if (desc && desc.set) {
      Object.defineProperty(window, prop, {
        configurable: true,
        get: desc.get,
        set (fn) { record(prop); return desc.set.call(this, fn) }
      })
    }
  }

  const OrigIO = window.IntersectionObserver
  window.IntersectionObserver = function (...args) {
    record('IntersectionObserver')
    return new OrigIO(...args)
  }
  window.IntersectionObserver.prototype = OrigIO.prototype

  const origRect = Element.prototype.getBoundingClientRect
  Element.prototype.getBoundingClientRect = function (...args) {
    record('getBoundingClientRect')
    return origRect.apply(this, args)
  }
}

// ---------------------------------------------------------------------------
// Glue-tier classification from collected calls + static script sources.
// ---------------------------------------------------------------------------

function classifyGlue (calls, scriptSources, pageUrl) {
  const flagged = new Set()
  for (const call of calls) {
    const frames = call.stack.split('\n').slice(1)
    for (const frame of frames) {
      const direct = frame.match(/(file:\/\/[^\s():]+):(\d+):(\d+)/)
      if (!direct) continue
      const urlPart = direct[1]
      const line = parseInt(direct[2], 10)
      const source = urlPart === pageUrl
        ? scriptSources.find(s => s.kind === 'inline' && line >= s.startLine && line <= s.endLine)
        : scriptSources.find(s => s.kind === 'external' && s.url === urlPart)
      if (!source) continue // frame belongs to a file we don't track (e.g. puppeteer's own eval context)
      if (!source.isLib) flagged.add(call.api)
      break // first frame that resolves into a known source wins attribution
    }
  }
  return [...flagged]
}

// ---------------------------------------------------------------------------
// Driving the story: compute trigger scroll positions, settle, capture state.
// ---------------------------------------------------------------------------

async function settleAtStep (page, storyIndex, stepIndex) {
  const info = await page.evaluate((si, i) => {
    const root = document.querySelectorAll('.scrolly')[si]
    const step = root.querySelectorAll(':scope > .step')[i]
    const offset = parseFloat(root.dataset.offset || '0.5')
    const rect = step.getBoundingClientRect()
    const absoluteTop = rect.top + window.scrollY
    const trigger = window.innerHeight * offset
    const targetY = Math.max(0, absoluteTop - trigger + 2)
    const id = step.id || String(i)
    return { targetY, id }
  }, storyIndex, stepIndex)

  await page.evaluate(y => window.scrollTo(0, y), info.targetY)
  try {
    await page.waitForFunction(
      (si, id) => document.querySelectorAll('.scrolly')[si].getAttribute('data-active-step') === id,
      { timeout: 3000 },
      storyIndex, info.id
    )
  } catch { /* captured state below reflects whatever settled; consistency check will catch it */ }
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)))
  await new Promise(r => setTimeout(r, DWELL_MS))
  return info.id
}

async function captureState (page, storyIndex) {
  const dom = await page.evaluate((si) => {
    const root = document.querySelectorAll('.scrolly')[si]
    const shown = [...root.querySelectorAll('[data-show].is-shown')]
      .map(el => el.dataset.show).sort()
    const figure = root.querySelector(':scope > figure')
    const clipEl = figure || root
    const r = clipEl.getBoundingClientRect()
    // page.screenshot({clip}) takes coordinates relative to the document,
    // not the current scroll position — getBoundingClientRect is viewport-
    // relative, so the current scroll offset has to be added back in.
    return {
      activeStep: root.getAttribute('data-active-step'),
      shown,
      clip: {
        x: Math.max(0, r.x + window.scrollX),
        y: Math.max(0, r.y + window.scrollY),
        width: Math.max(1, r.width),
        height: Math.max(1, r.height)
      }
    }
  }, storyIndex)
  // captureBeyondViewport:false keeps this an honest snapshot of what's
  // currently rendered at the current scroll position — the default (true)
  // re-lays the page out at a synthetic viewport size to fit the clip,
  // which breaks position:sticky entirely.
  const png = await page.screenshot({ clip: dom.clip, captureBeyondViewport: false })
  return { activeStep: dom.activeStep, shown: dom.shown, screenshot: decodePng(png) }
}

function statesMatch (a, b) {
  if (a.activeStep !== b.activeStep) return false
  if (a.shown.join(',') !== b.shown.join(',')) return false
  if (pixelsDiffer(a.screenshot, b.screenshot)) return false
  return true
}

async function driveStory (page, storyIndex, stepCount) {
  const forward = []
  for (let i = 0; i < stepCount; i++) {
    await settleAtStep(page, storyIndex, i)
    forward.push(await captureState(page, storyIndex))
  }

  let bidirectionalConsistent = true

  for (let i = stepCount - 1; i >= 0; i--) {
    await settleAtStep(page, storyIndex, i)
    const state = await captureState(page, storyIndex)
    if (!statesMatch(forward[i], state)) bidirectionalConsistent = false
  }

  const jumpOrder = stepCount >= 2
    ? [stepCount - 1, 1, stepCount - 1, 0]
    : [stepCount - 1]
  for (const i of jumpOrder) {
    await settleAtStep(page, storyIndex, i)
    const state = await captureState(page, storyIndex)
    if (!statesMatch(forward[i], state)) bidirectionalConsistent = false
  }

  let distinctGraphicStates = 0
  const groups = []
  for (const state of forward) {
    const found = groups.some(g => !pixelsDiffer(g.screenshot, state.screenshot))
    if (!found) { groups.push(state); distinctGraphicStates++ }
  }

  return { bidirectionalConsistent, distinctGraphicStates }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main () {
  const { file, tier1 } = parseArgs(process.argv)
  if (!fs.existsSync(file)) {
    console.error(`no such file: ${file}`)
    process.exit(1)
  }
  const html = fs.readFileSync(file, 'utf8')
  const libSource = fs.readFileSync(path.join(REPO_ROOT, 'src/scrolly.js'), 'utf8')
  const scriptSources = findScriptSources(html, file, libSource)
  const sourceExternalRefs = scanSourceForExternalRefs(html)

  const fixtureDir = fs.realpathSync(path.dirname(file))
  const pageUrl = `file://${file}`

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true })
  const page = await browser.newPage()
  await page.setViewport({ width: 1000, height: 800 })

  // Chrome logs its own "Failed to load resource" notice for every request
  // we choose to abort below (external-request blocking is this validator's
  // doing, not an authored bug) — that network noise is not a console error.
  const isNetworkNotice = text => /^Failed to load resource:/.test(text)

  const consoleErrors = []
  page.on('console', msg => {
    if (msg.type() === 'error' && !isNetworkNotice(msg.text())) consoleErrors.push(msg.text())
  })
  page.on('pageerror', err => { consoleErrors.push(String(err.message || err)) })

  const interceptedUrls = []
  await page.setRequestInterception(true)
  page.on('request', req => {
    const url = req.url()
    let isLocal = false
    if (url.startsWith('file://')) {
      try {
        const p = fs.realpathSync(decodeURIComponent(new URL(url).pathname))
        isLocal = p === fs.realpathSync(file) || p.startsWith(fixtureDir + path.sep)
      } catch { isLocal = false }
    }
    if (!isLocal) interceptedUrls.push(url)
    if (url === pageUrl || isLocal) req.continue()
    else req.abort().catch(() => {})
  })

  await page.evaluateOnNewDocument(installInstrumentation)
  await page.goto(pageUrl)
  await new Promise(r => setTimeout(r, DWELL_MS))

  const roots = await page.evaluate(() =>
    [...document.querySelectorAll('.scrolly')].map((el, i) => ({
      key: el.id || String(i),
      stepCount: el.querySelectorAll(':scope > .step').length
    }))
  )

  const stories = []
  for (const [index, rootMeta] of roots.entries()) {
    const { bidirectionalConsistent, distinctGraphicStates } = rootMeta.stepCount > 0
      ? await driveStory(page, index, rootMeta.stepCount)
      : { bidirectionalConsistent: true, distinctGraphicStates: 0 }

    const failures = []
    if (rootMeta.stepCount < 4) failures.push('stepCount<4')
    if (distinctGraphicStates < 4) failures.push('distinctGraphicStates<4')

    stories.push({
      key: rootMeta.key,
      stepCount: rootMeta.stepCount,
      distinctGraphicStates,
      bidirectionalConsistent,
      _failuresSoFar: failures
    })
  }

  await new Promise(r => setTimeout(r, DWELL_MS))
  const probe = await page.evaluate(() => window.__scrollyProbe)
  await browser.close()

  const glueFlags = classifyGlue(probe.calls, scriptSources, pageUrl)
  const authorInlineBlocks = scriptSources.filter(s => s.kind === 'inline' && !s.isLib)
  const hasAuthorExternal = scriptSources.some(s => s.kind === 'external' && !s.isLib)
  const onlyInit = !hasAuthorExternal && authorInlineBlocks.every(b => isOnlyInitStatements(b.content))
  const glueTier = glueFlags.length > 0 ? 'fail' : (onlyInit ? 'tier1' : 'tier2')

  const requestExternals = interceptedUrls.filter(u => u !== pageUrl)
  const sourceResolved = new Set(
    sourceExternalRefs.map(r => { try { return new URL(r, pageUrl).href } catch { return null } }).filter(Boolean)
  )
  const extraFromRequests = requestExternals.filter(u => !sourceResolved.has(u))
  const externalUrls = [...new Set([...sourceExternalRefs, ...extraFromRequests])]

  const allErrors = [...new Set([...consoleErrors, ...(probe.errors || [])])]

  const finalStories = stories.map(s => {
    const failures = [...s._failuresSoFar]
    if (glueTier === 'fail') failures.push(`glueTier:fail(${glueFlags.join(',')})`)
    if (tier1 && glueTier !== 'tier1') failures.push('glueTier:not-tier1')
    if (externalUrls.length) failures.push('externalUrls')
    if (allErrors.length) failures.push('consoleErrors')
    if (!s.bidirectionalConsistent) failures.push('bidirectionalConsistent')
    const { _failuresSoFar, ...rest } = s
    return {
      ...rest,
      glueTier,
      glueFlags,
      externalUrls,
      consoleErrors: allErrors,
      failures,
      pass: failures.length === 0
    }
  })

  const report = {
    file,
    stories: finalStories,
    pass: finalStories.every(s => s.pass)
  }

  console.log(JSON.stringify(report, null, 2))
  process.exit(report.pass ? 0 : 1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
