/*
 * Publish hygiene: the package manifest and the runtime must agree, and
 * every path the exports map promises must exist after a build.
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import Moviola from '../../src/index'

const root = path.join(import.meta.dirname, '../..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

describe('package manifest', () => {
  test('Moviola.version matches package.json', () => {
    expect(Moviola.version).toBe(pkg.version)
  })

  test('every exports target exists on disk', () => {
    const targets: string[] = []
    const walk = (v: unknown) => {
      if (typeof v === 'string') targets.push(v)
      else if (v && typeof v === 'object') Object.values(v).forEach(walk)
    }
    walk(pkg.exports)
    for (const t of targets.filter(t => !t.includes('*'))) {
      expect(existsSync(path.join(root, t)), t).toBe(true)
    }
  })

  test('files whitelist covers dist, src, and themes', () => {
    expect(pkg.files).toEqual(expect.arrayContaining(['dist', 'src', 'themes']))
  })
})
