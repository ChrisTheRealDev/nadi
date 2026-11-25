import { useRef, useState } from 'react'

export function NameDraft({ value, label, disabled, onCommit }: { value: string; label: string; disabled?: boolean; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value), cancelled = useRef(false)
  return <input aria-label={label} value={draft} maxLength={80} disabled={disabled} onChange={event => setDraft(event.target.value)} onBlur={() => {
    if (cancelled.current) { cancelled.current = false; return }
    const next = draft.trim(); if (next && next !== value) onCommit(next); else setDraft(value)
  }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { event.stopPropagation(); cancelled.current = true; setDraft(value); event.currentTarget.blur() } }} />
}

export function ColourDraft({ value, disabled, onCommit }: { value: string; disabled?: boolean; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  return <span onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setDraft(value) } }}><input aria-label="Track colour" type="color" value={draft} disabled={disabled} onInput={event => setDraft(event.currentTarget.value)} onChange={event => setDraft(event.target.value)} />{draft !== value && <><button disabled={disabled} onClick={() => onCommit(draft)}>Apply colour</button><button onClick={() => setDraft(value)}>Cancel</button></>}</span>
}
