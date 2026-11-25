import { noteNames, pianoRollRows } from '../data'

export function PianoRoll({
  notes,
  onToggle,
}: {
  notes: readonly number[]
  onToggle: (note: number) => void
}) {
  return (
    <div className="piano-roll" aria-label="One-bar piano roll">
      <div className="piano-roll__ruler">
        <span>Pitch</span>
        <span>1</span><span>2</span><span>3</span><span>4</span>
      </div>
      {pianoRollRows.map((note) => (
        <div className="piano-roll__row" key={note}>
          <span className="piano-roll__note">{noteNames[note]}</span>
          {[0, 1, 2, 3].map((beat) => (
            <button
              type="button"
              key={beat}
              className={`piano-roll__cell ${beat === 0 && notes.includes(note) ? 'has-note' : ''}`}
              onClick={() => beat === 0 && onToggle(note)}
              disabled={beat !== 0}
              aria-label={beat === 0 ? `Toggle ${noteNames[note]} at bar 1` : `Beat ${beat + 1}`}
            >
              {beat === 0 && notes.includes(note) && <span>{noteNames[note]}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
