import { Icon } from './Icon'

export function MiniArrangement({
  completed = false,
  compact = false,
}: {
  completed?: boolean
  compact?: boolean
}) {
  return (
    <div className={`mini-arrangement ${compact ? 'mini-arrangement--compact' : ''}`}>
      <div className="mini-arrangement__ruler">
        <span />
        {Array.from({ length: 8 }, (_, index) => <span key={index}>{index + 1}</span>)}
      </div>
      <div className="mini-arrangement__track">
        <div className="mini-arrangement__label"><Icon name="piano" /> Chords</div>
        {Array.from({ length: 8 }, (_, index) => (
          <span className={`clip clip--chord ${index === 0 ? 'clip--filled' : ''} ${index === 0 && completed ? 'clip--verified' : ''}`} key={index}>
            {index === 0 && <i />}
          </span>
        ))}
      </div>
      <div className="mini-arrangement__track">
        <div className="mini-arrangement__label"><Icon name="music" /> Melody</div>
        {Array.from({ length: 8 }, (_, index) => (
          <span className="clip clip--melody" key={index} />
        ))}
      </div>
    </div>
  )
}
