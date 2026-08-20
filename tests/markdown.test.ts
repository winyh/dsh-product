import { describe, expect, it } from 'vitest'
import { listValue, parseNote } from '../src/markdown.js'

describe('product markdown helpers', () => {
  it('parses artifact metadata and headings', () => {
    const note = parseNote('mvp.md', `---\ntype: mvp-plan\nstatus: active\nowner: product\nupdated: 2026-08-20\nsource: brief.md\n---\n# MVP\n\n## Scope\n\n| item | status |\n| --- | --- |\n| core flow | ready |`)
    expect(note.artifactType).toBe('mvp-plan')
    expect(note.title).toBe('MVP')
    expect(note.headings).toContain('Scope')
    expect(note.tables[0]?.rows[0]?.item).toBe('core flow')
  })

  it('parses JSON and newline lists', () => {
    expect(listValue('["a", "b"]')).toEqual(['a', 'b'])
    expect(listValue('- a\n- b')).toEqual(['a', 'b'])
  })
})
