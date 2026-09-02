import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore.js'

const MODE_LABEL = { multi: '복층', single: '단층' }

export default function Header() {
  const mode = useAppStore((s) => s.mode)
  const setMode = useAppStore((s) => s.setMode)
  const [open, setOpen] = useState(false)
  const ddRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => {
      if (ddRef.current && !ddRef.current.contains(e.target)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <header className="top-header">
      <div className="h-title">
        <h1>
          AI Data Center 인터랙티브 인프라 용어사전 :{' '}
          <span className="mode-dd" ref={ddRef}>
            <button
              className="mode-current"
              aria-haspopup="listbox"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {MODE_LABEL[mode]}<span className="mode-caret">▼</span>
            </button>
            {open && (
              <span className="mode-menu" role="listbox">
                {Object.entries(MODE_LABEL).map(([key, label]) => (
                  <button
                    key={key}
                    role="option"
                    aria-selected={mode === key}
                    className={`mode-item${mode === key ? ' on' : ''}`}
                    onClick={() => { setMode(key); setOpen(false) }}
                  >
                    {label}
                  </button>
                ))}
              </span>
            )}
          </span>
        </h1>
      </div>
      <div className="h-meta">AIDC · INFRASTRUCTURE</div>
    </header>
  )
}
