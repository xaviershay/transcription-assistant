import { describe, it, expect } from 'vitest'
import { sortRegionsByStart, getAdjacentRegionId } from './selections.js'

function region(id, start) {
  return { id, start }
}

describe('sortRegionsByStart', () => {
  it('sorts regions by start time ascending', () => {
    const list = [region('b', 5), region('a', 1), region('c', 3)]
    const sorted = sortRegionsByStart(list)
    expect(sorted.map((r) => r.id)).toEqual(['a', 'c', 'b'])
  })

  it('returns empty array for empty input', () => {
    expect(sortRegionsByStart([])).toEqual([])
  })

  it('does not mutate the input array', () => {
    const list = [region('b', 5), region('a', 1)]
    sortRegionsByStart(list)
    expect(list.map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('getAdjacentRegionId', () => {
  const sorted = [region('a', 1), region('b', 3), region('c', 5)]

  it('returns null when there are no regions', () => {
    expect(getAdjacentRegionId([], 'a', 'next')).toBeNull()
  })

  it('returns the next region id', () => {
    expect(getAdjacentRegionId(sorted, 'a', 'next')).toBe('b')
  })

  it('wraps to the first region when advancing past the last', () => {
    expect(getAdjacentRegionId(sorted, 'c', 'next')).toBe('a')
  })

  it('returns the previous region id', () => {
    expect(getAdjacentRegionId(sorted, 'b', 'prev')).toBe('a')
  })

  it('wraps to the last region when going previous from the first', () => {
    expect(getAdjacentRegionId(sorted, 'a', 'prev')).toBe('c')
  })

  it('returns the first region when nothing is active and direction is next', () => {
    expect(getAdjacentRegionId(sorted, null, 'next')).toBe('a')
  })

  it('returns the last region when nothing is active and direction is prev', () => {
    expect(getAdjacentRegionId(sorted, null, 'prev')).toBe('c')
  })
})
