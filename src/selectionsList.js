export function renderSelectionsList(listEl, sortedRegions, activeId, { onActivate, onDelete }) {
  listEl.innerHTML = ''

  sortedRegions.forEach((region) => {
    const li = document.createElement('li')
    li.className = region.id === activeId ? 'active' : ''

    const label = document.createElement('span')
    label.textContent = `${region.start.toFixed(2)}s – ${region.end.toFixed(2)}s`
    label.addEventListener('click', () => onActivate(region.id))

    const deleteBtn = document.createElement('button')
    deleteBtn.textContent = 'Delete'
    deleteBtn.addEventListener('click', () => onDelete(region.id))

    li.append(label, deleteBtn)
    listEl.append(li)
  })
}
