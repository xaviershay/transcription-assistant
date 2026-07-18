export function renderSelectionsList(
  listEl,
  sortedRegions,
  activeId,
  { onActivate, onDelete, onSubdivide, onConfirmSubdivide, onCancelSubdivide, previewingId },
) {
  listEl.innerHTML = ''

  sortedRegions.forEach((region) => {
    const li = document.createElement('li')
    li.className = region.id === activeId ? 'active' : ''

    const label = document.createElement('span')
    label.textContent = `${region.start.toFixed(2)}s – ${region.end.toFixed(2)}s`
    label.addEventListener('click', () => onActivate(region.id))

    const buttonGroup = document.createElement('span')
    buttonGroup.className = 'row-buttons'

    if (region.id === previewingId) {
      const confirmBtn = document.createElement('button')
      confirmBtn.textContent = 'Confirm'
      confirmBtn.addEventListener('click', () => onConfirmSubdivide(region.id))

      const cancelBtn = document.createElement('button')
      cancelBtn.textContent = 'Cancel'
      cancelBtn.addEventListener('click', () => onCancelSubdivide(region.id))

      buttonGroup.append(confirmBtn, cancelBtn)
    } else {
      const subdivideBtn = document.createElement('button')
      subdivideBtn.textContent = 'Subdivide'
      subdivideBtn.disabled = previewingId !== null
      subdivideBtn.addEventListener('click', () => onSubdivide(region.id))

      const deleteBtn = document.createElement('button')
      deleteBtn.textContent = 'Delete'
      deleteBtn.addEventListener('click', () => onDelete(region.id))

      buttonGroup.append(subdivideBtn, deleteBtn)
    }

    li.append(label, buttonGroup)
    listEl.append(li)
  })
}
