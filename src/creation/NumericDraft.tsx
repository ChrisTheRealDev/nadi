import { useState } from 'react'

/** Text stays local until blur/Enter: incomplete decimals must not mutate music. */
export function NumericDraft({ value, label, min = -Infinity, max = Infinity, integer = false, disabled, onCommit }: {
  value: number; label: string; min?: number; max?: number; integer?: boolean; disabled?: boolean
  onCommit: (value: number) => boolean | void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState('')
  function finish() {
    if (draft === null) return
    const number = Number(draft)
    if (!draft.trim() || !Number.isFinite(number) || number < min || number > max || (integer && !Number.isSafeInteger(number))) {
      setError(`Enter ${integer ? 'a whole number' : 'a number'}${Number.isFinite(min) ? ` from ${min}` : ''}${Number.isFinite(max) ? ` to ${max}` : ''}.`); return
    }
    if (number !== value && onCommit(number) === false) { setError('That value would put notes outside the project limits.'); return }
    setDraft(null); setError('')
  }
  return <span className="numeric-draft"><input aria-label={label} type="text" inputMode="decimal" value={draft ?? String(value)} disabled={disabled} aria-invalid={error ? true : undefined}
    onChange={event => { setDraft(event.target.value); setError('') }} onBlur={finish}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur() } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDraft(null); setError('') } }} />
    {error && <small role="alert">{error}</small>}</span>
}
