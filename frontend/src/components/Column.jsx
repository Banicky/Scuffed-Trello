import { useState } from 'react'
import Card from './Card.jsx'
import { TAG_COLORS, COLUMN_PALETTE } from '../constants.js'

function AddCardForm({ onAdd, onCancel }) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [tag, setTag] = useState('Design')

  function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) return
    onAdd({ title: title.trim(), description: desc.trim(), label_name: tag, label_color: TAG_COLORS[tag]?.color })
    setTitle('')
    setDesc('')
  }

  return (
    <form className="add-card-form" onSubmit={handleSubmit}>
      <select className="card-input" value={tag} onChange={e => setTag(e.target.value)}>
        {Object.keys(TAG_COLORS).map(t => <option key={t}>{t}</option>)}
      </select>
      <input
        className="card-input"
        placeholder="Card title"
        value={title}
        onChange={e => setTitle(e.target.value)}
        autoFocus
      />
      <textarea
        className="card-input card-desc-input"
        placeholder="Description (optional)"
        value={desc}
        onChange={e => setDesc(e.target.value)}
        rows={3}
      />
      <div className="add-card-actions">
        <button className="btn-primary" type="submit">Add card</button>
        <button className="btn-ghost" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

// onDragOver: tells App which column is being hovered so it can apply the drag-over highlight
// onDragLeave: clears the highlight when the drag leaves this column
// onDrop: when a card is dropped, passes the event
// isDragOver: when true, applies the purple border/background highlight to the column
// onDragOverCard / dragOverCardId: passed through to each Card so the insertion indicator works
export default function Column({ column, colorIndex, onAddCard, onDeleteCard, onToggleStar, onEdit, onReact, currentUserId, onRenameColumn, onDeleteColumn, onDragOver, onDrop, isDragOver, isDraggingCol, isColDropTarget, colDragDirection, anyColDragging, onDragOverCard, dragOverCardId, onColumnDragStart, onColumnDrop, onColumnDragEnd, onOpenDetail }) {
  const [adding, setAdding] = useState(false)
  const [editingTitle, setEditingTitle] = useState(!!column.editingTitle)
  const [confirming, setConfirming] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  async function handleAdd(cardData) {
    await onAddCard(column.id, cardData, column.cards.length + 1)
    setAdding(false)
  }

  return (
    <div
      draggable
      className={`kanban-column${isDragOver ? ' drag-over' : ''}${collapsed ? ' collapsed' : ''}${isDraggingCol ? ' col-dragging' : ''}${anyColDragging && !isDraggingCol && !isColDropTarget ? ' col-dim' : ''}`}
      onDragStart={e => {
        if (e.target !== e.currentTarget) return
        e.dataTransfer.setData('type', 'column')
        e.dataTransfer.setData('columnId', String(column.id))
        onColumnDragStart(column.id)
      }}
      onDragEnd={() => onColumnDragEnd?.()}
      onDragOver={e => { e.preventDefault(); onDragOver(column.id) }}
      onDragLeave={() => onDragOver(null)}
      onDrop={e => {
        if (e.dataTransfer.getData('type') === 'column') onColumnDrop(e, column.id)
        else onDrop(e, column.id)
      }}
    >
      {isDraggingCol && colDragDirection && (
        <div className="col-drag-overlay col-drag-overlay--source">
          <span className="col-drag-arrow">{colDragDirection === 'right' ? '→' : '←'}</span>
        </div>
      )}
      {isColDropTarget && colDragDirection && (
        <div className="col-drag-overlay col-drag-overlay--target">
          <span className="col-drag-arrow">{colDragDirection === 'right' ? '←' : '→'}</span>
        </div>
      )}
      <div className="column-header">
        {confirming ? (
          <div className="column-confirm">
            <span className="column-confirm-msg">Delete column?</span>
            <button className="btn-danger-sm" onClick={() => onDeleteColumn(column.id)}>Delete</button>
            <button className="btn-ghost-sm" onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        ) : (
          <>
            <span className="column-dot" style={{ background: COLUMN_PALETTE[colorIndex % COLUMN_PALETTE.length] }} />
            <div className="column-title-group">
              {editingTitle ? (
                <input
                  className="column-title-input"
                  defaultValue={column.title}
                  autoFocus
                  onBlur={e => { onRenameColumn(column.id, e.target.value); setEditingTitle(false) }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { onRenameColumn(column.id, e.target.value); setEditingTitle(false) }
                    if (e.key === 'Escape') setEditingTitle(false)
                  }}
                />
              ) : (
                <h2 className="column-title" onClick={() => setEditingTitle(true)} title="Click to rename">
                  {column.title}
                </h2>
              )}
              <span className="column-count">{column.cards.length}</span>
            </div>
            <button draggable={false} className="column-collapse" onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Expand column' : 'Collapse column'}>
              {collapsed ? '▶' : '▼'}
            </button>
            <button draggable={false} className="column-delete" onClick={() => setConfirming(true)} title="Delete column">✕</button>
          </>
        )}
      </div>
      <div className={`column-cards${collapsed ? ' column-cards--collapsed' : ''}`}>
        {column.cards.map(card => (
          <Card
            key={card.id}
            card={card}
            onDelete={id => onDeleteCard(column.id, id)}
            onToggleStar={onToggleStar}
            onEdit={(cardId, data) => onEdit(column.id, cardId, data)}
            onReact={onReact}
            currentUserId={currentUserId}
            onDragStart={e => e.dataTransfer.setData('cardId', card.id)}
            onDragOverCard={onDragOverCard}
            isDropTarget={dragOverCardId === card.id}
            onOpenDetail={() => onOpenDetail(card)}
          />
        ))}
        {adding
          ? <AddCardForm onAdd={handleAdd} onCancel={() => setAdding(false)} />
          : (
            <button className="add-card-btn" onClick={() => setAdding(true)}>
              <span className="add-card-plus">+</span> Add a card
            </button>
          )
        }
      </div>
    </div>
  )
}
