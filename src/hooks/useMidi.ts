import { useCallback, useEffect, useRef, useState } from 'react'

interface MidiMessageLike {
  data: Uint8Array
  timeStamp?: number
  receivedTime?: number
}

interface MidiPortLike {
  id: string
  name?: string | null
  manufacturer?: string | null
  state: 'connected' | 'disconnected'
  connection: 'open' | 'closed' | 'pending'
  onmidimessage: ((event: MidiMessageLike) => void) | null
}

interface MidiAccessLike {
  inputs: Map<string, MidiPortLike>
  onstatechange: ((event: { port: MidiPortLike }) => void) | null
}

interface MidiNavigatorLike {
  requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<MidiAccessLike>
}

export type MidiStatus =
  | 'scanning'
  | 'connected'
  | 'no-device'
  | 'permission-denied'
  | 'unsupported'
  | 'disconnected'
  | 'error'

export interface MidiState {
  status: MidiStatus
  deviceName?: string
  attempts: number
  lastNote?: number
  activity: number
  message: string
  devices: Array<{ id: string; name: string }>
  selectedDeviceId?: string
}

export interface MidiScope { channel: number; atMs: number; inputId?: string }
interface MidiCallbacks {
  onNoteOn(note: number, velocity: number, metadata: { channel: number; atMs: number; rawVelocity: number; inputId?: string }): void
  onNoteOff(note: number, metadata: { channel: number; atMs: number; releaseVelocity: number; inputId?: string }): void
  onControlChange?(controller: number, value: number, metadata: { channel: number; atMs: number; inputId?: string }): void
  onPitchBend?(value: number, metadata: { channel: number; atMs: number; inputId?: string }): void
  onAllNotesOff(scope?: MidiScope): void
  onInputDisconnected?(id: string): void
}
export interface MidiOptions {
  pinnedDeviceId?: string | null
  excludeInput?: (id: string) => boolean
}

const initialState: MidiState = {
  status: 'scanning',
  attempts: 0,
  activity: 0,
  message: 'Looking for a MIDI keyboard…',
  devices: [],
}

export function useMidi(callbacks: MidiCallbacks, options: MidiOptions = {}) {
  const [state, setState] = useState<MidiState>(initialState)
  const accessRef = useRef<MidiAccessLike | undefined>(undefined)
  const accessRequestRef = useRef<Promise<MidiAccessLike> | undefined>(undefined)
  const activeInputRef = useRef<MidiPortLike | undefined>(undefined)
  const automaticAttemptsRef = useRef(0)
  const automaticBlockedRef = useRef(false)
  const callbackRef = useRef(callbacks)
  const mountedRef = useRef(true)
  const optionsRef = useRef(options)

  useEffect(() => {
    callbackRef.current = callbacks
    optionsRef.current = options
  }, [callbacks, options])

  const silence = useCallback(() => {
    callbackRef.current.onAllNotesOff()
  }, [])

  const handleMessage = useCallback((event: MidiMessageLike) => {
    const [command = 0, note = 0, velocity = 0] = event.data
    const type = command & 0xf0
    const channel = command & 0x0f
    const atMs = event.timeStamp ?? event.receivedTime ?? performance.now()
    const inputId = activeInputRef.current?.id
    if (inputId && optionsRef.current.excludeInput?.(inputId)) return
    if (optionsRef.current.pinnedDeviceId !== undefined && optionsRef.current.pinnedDeviceId !== inputId) return
    if (type === 0x90 && velocity > 0) {
      callbackRef.current.onNoteOn(note, velocity / 127, { channel, atMs, rawVelocity: velocity, inputId })
      setState((current) => ({
        ...current,
        lastNote: note,
        activity: current.activity + 1,
        message: `Receiving notes from ${current.deviceName ?? 'your keyboard'}.`,
      }))
    } else if (type === 0x80 || (type === 0x90 && velocity === 0)) {
      callbackRef.current.onNoteOff(note, { channel, atMs, releaseVelocity: velocity, inputId })
    } else if (type === 0xb0) {
      callbackRef.current.onControlChange?.(note, velocity, { channel, atMs, inputId })
      if (note === 120 || note === 123) callbackRef.current.onAllNotesOff({ channel, atMs, inputId })
    } else if (type === 0xe0) {
      callbackRef.current.onPitchBend?.(note + (velocity << 7), { channel, atMs, inputId })
    }
  }, [])

  const selectInput = useCallback(
    (access: MidiAccessLike, disconnected = false, requestedId?: string) => {
      const connectedInputs = [...access.inputs.values()].filter(
        (input) => input.state === 'connected' && !optionsRef.current.excludeInput?.(input.id),
      )
      const devices = connectedInputs.map((input) => ({
        id: input.id,
        name: input.name?.trim() || 'Unnamed MIDI input',
      }))
      const pinned = optionsRef.current.pinnedDeviceId
      const preferredId = pinned ?? requestedId ?? activeInputRef.current?.id
      const next = pinned === null ? undefined :
        connectedInputs.find((input) => input.id === preferredId) ??
        (pinned !== undefined ? undefined : connectedInputs[0])
      if (activeInputRef.current && activeInputRef.current !== next) {
        activeInputRef.current.onmidimessage = null
        silence()
      }
      if (!next) {
        activeInputRef.current = undefined
        setState((current) => ({
          ...current,
          status: disconnected ? 'disconnected' : 'no-device',
          deviceName: undefined,
          devices,
          selectedDeviceId: undefined,
          message: disconnected
            ? 'The keyboard disconnected. Your work is safe; reconnect it or use screen keys.'
            : 'No MIDI keyboard is visible yet. Connect one, then rescan.',
        }))
        return
      }

      next.onmidimessage = handleMessage
      activeInputRef.current = next
      const exactName = next.name?.trim() || 'Unnamed MIDI input'
      setState((current) => ({
        ...current,
        status: 'connected',
        deviceName: exactName,
        devices,
        selectedDeviceId: next.id,
        message: `${exactName} is connected and listening.`,
      }))
    },
    [handleMessage, silence],
  )

  const scan = useCallback(
    async (automatic = false) => {
      if (
        automatic &&
        (automaticBlockedRef.current ||
          automaticAttemptsRef.current >= 3 ||
          activeInputRef.current?.state === 'connected')
      ) {
        return
      }

      // Only auto-request without a click when permission is already granted. Requesting
      // automatically on page load can get silently denied by the browser (no prompt shown),
      // which then blocks the native prompt from ever reappearing for a later manual click.
      // When we can't confirm 'granted' (including browsers without Permissions API support
      // for MIDI), stay quiet and wait for an explicit Connect MIDI click instead of guessing.
      if (automatic) {
        let granted = false
        try {
          const status = await navigator.permissions?.query({ name: 'midi' as PermissionName, sysex: false } as never)
          granted = status?.state === 'granted'
        } catch { /* Treated as not granted below. */ }
        if (!granted) { automaticBlockedRef.current = true; return }
      }

      if (automatic) automaticAttemptsRef.current += 1
      else automaticBlockedRef.current = false

      const midiNavigator = navigator as unknown as MidiNavigatorLike
      if (!midiNavigator.requestMIDIAccess) {
        automaticBlockedRef.current = true
        setState((current) => ({
          ...current,
          status: 'unsupported',
          attempts: automatic ? automaticAttemptsRef.current : current.attempts,
          message:
            'This browser does not offer Web MIDI. Screen keys and the computer keyboard still work.',
        }))
        return
      }

      setState((current) => ({
        ...current,
        status: current.status === 'connected' ? 'connected' : 'scanning',
        attempts: automatic ? automaticAttemptsRef.current : current.attempts,
        message:
          current.status === 'connected'
            ? current.message
            : 'Looking for a MIDI keyboard…',
      }))

      try {
        if (!accessRef.current && !accessRequestRef.current) {
          accessRequestRef.current = midiNavigator.requestMIDIAccess({ sysex: false })
        }
        const access =
          accessRef.current ?? (await accessRequestRef.current as MidiAccessLike)
        if (!mountedRef.current) return
        accessRef.current = access
        accessRequestRef.current = undefined
        access.onstatechange = (event) => {
          if (event.port.state === 'disconnected' && event.port.id === activeInputRef.current?.id) {
            silence(); callbackRef.current.onInputDisconnected?.(event.port.id)
          }
          selectInput(access, event.port.state === 'disconnected')
        }
        selectInput(access)
      } catch (error) {
        if (!mountedRef.current) return
        accessRequestRef.current = undefined
        const name = error instanceof DOMException ? error.name : ''
        const denied = name === 'SecurityError' || name === 'NotAllowedError'
        if (denied) automaticBlockedRef.current = true
        silence()
        setState((current) => ({
          ...current,
          status: denied ? 'permission-denied' : 'error',
          message: denied
            ? 'MIDI permission was already blocked, so the browser won’t show the prompt again from here. Click the icon at the left of your address bar (padlock or “i”), find MIDI in site permissions, set it to Allow, then reload this page and choose Rescan.'
            : 'MIDI did not open this time. Your work is safe; try Rescan or use screen keys.',
        }))
      }
    },
    [selectInput, silence],
  )

  useEffect(() => {
    mountedRef.current = true
    const timers = [0, 900, 2400].map((delay) =>
      window.setTimeout(() => void scan(true), delay),
    )
    return () => {
      mountedRef.current = false
      timers.forEach((timer) => window.clearTimeout(timer))
      if (activeInputRef.current) activeInputRef.current.onmidimessage = null
      if (accessRef.current) accessRef.current.onstatechange = null
      silence()
    }
  }, [scan, silence])

  useEffect(() => {
    const handleBlur = () => silence()
    window.addEventListener('blur', handleBlur)
    return () => window.removeEventListener('blur', handleBlur)
  }, [silence])

  const refreshInputs = useCallback(() => {
    if (accessRef.current) selectInput(accessRef.current)
  }, [selectInput])

  return {
    state,
    rescan: () => void scan(false),
    refreshInputs,
    selectDevice: (id: string) => {
      if (optionsRef.current.pinnedDeviceId !== undefined) return
      if (accessRef.current) selectInput(accessRef.current, false, id)
    },
    silence,
  }
}
