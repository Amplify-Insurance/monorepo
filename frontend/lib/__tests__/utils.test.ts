import { describe, it, expect } from 'vitest'
import { cn } from '../utils'


describe('cn utility', () => {
  it('merges class names and objects', () => {
    const result = cn('foo', { bar: true, baz: false }, 'qux')
    expect(result).toBe('foo bar qux')
  })

  it('deduplicates conflicting tailwind classes', () => {
    const result = cn('p-2', 'p-4')
    // tailwind-merge keeps the latter class
    expect(result).toBe('p-4')
  })
})
