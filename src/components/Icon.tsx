import type { SVGProps } from 'react'

export type IconName =
  | 'home'
  | 'paths'
  | 'projects'
  | 'notebook'
  | 'connections'
  | 'settings'
  | 'play'
  | 'stop'
  | 'piano'
  | 'spark'
  | 'check'
  | 'refresh'
  | 'save'
  | 'volume'
  | 'clock'
  | 'headphones'
  | 'arrow'
  | 'close'
  | 'help'
  | 'grid'
  | 'music'

const paths: Record<IconName, React.ReactNode> = {
  home: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V21h13V10.5M9 21v-6h6v6"/></>,
  paths: <><path d="M4 19V5l6 3 4-3 6 3v14l-6-3-4 3-6-3Z"/><path d="M10 8v14M14 5v14"/></>,
  projects: <><path d="M3 7h7l2 2h9v11H3Z"/><path d="M3 7V5h7l2 2"/></>,
  notebook: <><rect x="5" y="3" width="15" height="18" rx="1"/><path d="M8 3v18M11 8h6M11 12h6M11 16h4"/></>,
  connections: <><path d="M8 7a6 6 0 0 0 0 10M16 7a6 6 0 0 1 0 10"/><path d="M5 4a10 10 0 0 0 0 16M19 4a10 10 0 0 1 0 16"/><circle cx="12" cy="12" r="2"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5L9 6.1a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 3.1h5l.4-3.1a7 7 0 0 0 1.7-1l2.4 1 2-3.4L19 13a7 7 0 0 0 .1-1Z"/></>,
  play: <path d="m8 5 11 7-11 7Z" fill="currentColor"/>,
  stop: <rect x="7" y="7" width="10" height="10" fill="currentColor"/>,
  piano: <><path d="M3 5h18v14H3Z"/><path d="M7 5v14M12 5v14M17 5v14"/><path d="M5.5 5v8h3V5M10.5 5v8h3V5M15.5 5v8h3V5" fill="currentColor"/></>,
  spark: <><path d="m12 3 1.2 5.3L18 10l-4.8 1.7L12 17l-1.2-5.3L6 10l4.8-1.7Z"/><path d="m19 16 .6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6Z"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  refresh: <><path d="M20 7v5h-5"/><path d="M18.5 9A7 7 0 1 0 19 15"/></>,
  save: <><path d="M4 3h14l2 2v16H4Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></>,
  volume: <><path d="M4 10v4h4l5 4V6l-5 4Z"/><path d="M16 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></>,
  headphones: <><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14h4v7H6a2 2 0 0 1-2-2ZM20 14h-4v7h2a2 2 0 0 0 2-2Z"/></>,
  arrow: <path d="m9 5 7 7-7 7"/>,
  close: <><path d="M6 6l12 12M18 6 6 18"/></>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.8 9a2.4 2.4 0 1 1 3.4 2.2c-.8.4-1.2 1-1.2 1.8v.4M12 17h.01"/></>,
  grid: <><rect x="4" y="4" width="16" height="16"/><path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16"/></>,
  music: <><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5" fill="currentColor"/><circle cx="16.5" cy="16" r="2.5" fill="currentColor"/></>,
}

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
}

export function Icon({ name, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}
