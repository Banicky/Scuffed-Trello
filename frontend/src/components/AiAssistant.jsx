import { useState, useRef, useEffect } from 'react'
import { aiChat, getAiKeyStatus } from '../api.js'

// A VSCode-style side panel. Lives docked to the right; the parent layout shifts
// to make room (see `.ai-open` in App.css). Used both inside a board (full
// tool access — can create/move cards, fires onBoardChanged) and on the
// dashboard (read-only planning chat, no boardId).
export default function AiAssistant({ boardId = null, open, onClose, onBoardChanged }) {
  const [messages, setMessages] = useState([]) // { role: 'user'|'assistant', content }
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [configured, setConfigured] = useState(null) // null = unknown, false = no key
  const listRef = useRef(null)
  const inputRef = useRef(null)

  // Check key status when the panel opens, so we can prompt for setup if missing.
  useEffect(() => {
    if (!open) return
    let alive = true
    getAiKeyStatus()
      .then(s => { if (alive) setConfigured(s.configured) })
      .catch(() => { if (alive) setConfigured(false) })
    return () => { alive = false }
  }, [open])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  // Keep the transcript scrolled to the newest message.
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  async function send(e) {
    e?.preventDefault()
    const text = input.trim()
    if (!text || sending) return
    setError('')
    setInput('')
    const history = messages.map(m => ({ role: m.role, content: m.content }))
    setMessages(m => [...m, { role: 'user', content: text }])
    setSending(true)
    try {
      const { reply, applied, boardChanged } = await aiChat({ boardId, message: text, history })
      setMessages(m => [...m, { role: 'assistant', content: reply, applied }])
      if (boardChanged) onBoardChanged?.()
    } catch (err) {
      setError(err.message)
      // restore the input so the user doesn't lose what they typed
      setInput(text)
      setMessages(m => m.slice(0, -1))
    }
    setSending(false)
  }

  return (
    <aside className={`ai-panel${open ? ' open' : ''}`} aria-hidden={!open} aria-label="AI assistant">
      <header className="ai-panel-header">
        <span className="ai-panel-title">
          <span className="ai-panel-spark" aria-hidden="true">✦</span>
          Assistant
        </span>
        <button className="ai-panel-close" onClick={onClose} title="Close assistant" aria-label="Close assistant">✕</button>
      </header>

      <div className="ai-panel-body" ref={listRef}>
        {configured === false && (
          <div className="ai-panel-setup">
            <p className="ai-panel-setup-title">Set up your assistant</p>
            <p className="ai-panel-setup-text">
              Add your own Anthropic API key in <strong>Settings → AI Assistant</strong> to start chatting.
              The assistant runs under your key.
            </p>
          </div>
        )}

        {configured !== false && messages.length === 0 && (
          <div className="ai-panel-intro">
            <p className="ai-panel-intro-title">How can I help?</p>
            <p className="ai-panel-intro-text">
              {boardId
                ? 'Ask me to plan work, create columns and cards, or move cards around this board.'
                : 'Ask me to help plan a project or break work into tasks. Open a board to let me create and move cards.'}
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`ai-msg ai-msg--${m.role}`}>
            <div className="ai-msg-bubble">{m.content}</div>
            {m.applied?.length > 0 && (
              <ul className="ai-msg-actions">
                {m.applied.map((a, j) => <li key={j}>✓ {a}</li>)}
              </ul>
            )}
          </div>
        ))}

        {sending && (
          <div className="ai-msg ai-msg--assistant">
            <div className="ai-msg-bubble ai-msg-typing"><span /><span /><span /></div>
          </div>
        )}
      </div>

      {error && <p className="ai-panel-error">{error}</p>}

      <form className="ai-panel-input-row" onSubmit={send}>
        <textarea
          ref={inputRef}
          className="ai-panel-input"
          placeholder={configured === false ? 'Add your API key in Settings first…' : 'Message the assistant…'}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) send(e) }}
          rows={1}
          disabled={configured === false}
        />
        <button className="ai-panel-send" type="submit" disabled={sending || !input.trim() || configured === false} title="Send">
          ➤
        </button>
      </form>
    </aside>
  )
}
