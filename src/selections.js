export function sortRegionsByStart(regions) {
  return [...regions].sort((a, b) => a.start - b.start)
}

export function getAdjacentRegionId(sortedRegions, activeId, direction) {
  if (sortedRegions.length === 0) return null

  const currentIndex = sortedRegions.findIndex((r) => r.id === activeId)
  if (currentIndex === -1) {
    return direction === 'next'
      ? sortedRegions[0].id
      : sortedRegions[sortedRegions.length - 1].id
  }

  const step = direction === 'next' ? 1 : -1
  const nextIndex = (currentIndex + step + sortedRegions.length) % sortedRegions.length
  return sortedRegions[nextIndex].id
}
