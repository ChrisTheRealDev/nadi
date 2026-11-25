import { noteNames } from '../data'

interface KeySpec {
  note: number
  black?: boolean
  left?: number
}

const whiteKeys: KeySpec[] = [
  { note: 57 },
  { note: 59 },
  { note: 60 },
  { note: 62 },
  { note: 64 },
  { note: 65 },
  { note: 67 },
  { note: 69 },
]

const blackKeys: KeySpec[] = [
  { note: 58, black: true, left: 8.5 },
  { note: 61, black: true, left: 33.4 },
  { note: 63, black: true, left: 45.9 },
  { note: 66, black: true, left: 70.9 },
  { note: 68, black: true, left: 83.4 },
]

export function PianoKeyboard({
  activeNotes,
  onPress,
  onRelease,
  showNames,
  highlighted = [],
  hideGuidance = false,
}: {
  activeNotes: readonly number[]
  onPress: (note: number) => void
  onRelease?: (note: number) => void
  showNames: boolean
  highlighted?: readonly number[]
  hideGuidance?: boolean
}) {
  const isActive = (note: number) => activeNotes.includes(note)
  const isHighlighted = (note: number) =>
    !hideGuidance && highlighted.some((item) => item % 12 === note % 12)

  const handlers = (note: number) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      onPress(note)
    },
    onPointerUp: () => onRelease?.(note),
    onPointerCancel: () => onRelease?.(note),
    onPointerLeave: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.buttons) onRelease?.(note)
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
        event.preventDefault()
        onPress(note)
      }
    },
    onKeyUp: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onRelease?.(note)
      }
    },
    onBlur: () => onRelease?.(note),
  })

  return (
    <div className="piano-keyboard" aria-label="Playable piano keyboard">
      <div className="piano-keyboard__whites">
        {whiteKeys.map(({ note }) => (
          <button
            type="button"
            className={`piano-key ${isActive(note) ? 'is-active' : ''} ${isHighlighted(note) ? 'is-highlighted' : ''}`}
            key={note}
            aria-label={`Play ${noteNames[note]}`}
            aria-pressed={isActive(note)}
            {...handlers(note)}
          >
            {showNames && !hideGuidance && <span>{noteNames[note]}</span>}
          </button>
        ))}
      </div>
      <div className="piano-keyboard__blacks" aria-hidden="false">
        {blackKeys.map(({ note, left }) => (
          <button
            type="button"
            className={`piano-key piano-key--black ${isActive(note) ? 'is-active' : ''}`}
            style={{ left: `${left}%` }}
            key={note}
            aria-label={`Play ${noteNames[note]}`}
            aria-pressed={isActive(note)}
            {...handlers(note)}
          >
            {showNames && !hideGuidance && <span>{noteNames[note]}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
