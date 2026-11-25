import { useEffect, useRef, useState } from 'react'
import type { Track } from './model'

interface Props {
  tracks: readonly Track[]
  disabled: boolean
  onRouteChange: (output?: MIDIOutput, trackId?: string, channel?: number, monitorLocal?: boolean, matchingInputs?: string[], onFailure?: () => void) => void
}

type OpenResult = { output: MIDIOutput; attempt: number; error?: string }
const portWork = new WeakMap<MIDIOutput, Promise<void>>()
const channels = Array.from({ length: 16 }, (_, index) => index + 1)
const outputLabel = (port: MIDIOutput) => port.name?.trim() || 'Unnamed MIDI output'
const visibleOutputs = (access: MIDIAccess) => [...access.outputs.values()].filter(port => port.state === 'connected')

export function ExternalMidiSettings({ tracks, disabled, onRouteChange }: Props) {
  const [access, setAccess] = useState<MIDIAccess>()
  const [outputs, setOutputs] = useState<MIDIOutput[]>([])
  const [outputId, setOutputId] = useState('')
  const [trackId, setTrackId] = useState('')
  const [channel, setChannel] = useState(1)
  const [monitorLocal, setMonitorLocal] = useState(false)
  const [status, setStatus] = useState('')
  const [connecting, setConnecting] = useState(false)
  const request = useRef(0)
  const [openAttempt, setOpenAttempt] = useState(0)
  const [openResult, setOpenResult] = useState<OpenResult>()

  useEffect(() => () => { request.current++ }, [])
  useEffect(() => {
    if (!access) return
    const refresh = () => {
      const connected = visibleOutputs(access)
      setOutputs(connected)
      if (outputId && !connected.some(port => port.id === outputId)) {
        setOutputId('')
        setOpenResult(undefined)
        setStatus('MIDI output disconnected. Reconnect the port and select it again to use the external instrument.')
      } else {
        const selected = connected.find(port => port.id === outputId)
        if (selected && selected.connection !== 'open') setOpenResult(previous =>
          previous?.output === selected && !previous.error
            ? { ...previous, error: `Connection to ${outputLabel(selected)} closed. Retry or choose another output.` }
            : previous)
      }
    }
    access.addEventListener('statechange', refresh)
    return () => access.removeEventListener('statechange', refresh)
  }, [access, outputId])

  const output = outputs.find(port => port.id === outputId)
  const track = tracks.find(item => item.id === trackId)
  const routedTrackId = track?.id
  const outcome = openResult?.output === output && openResult?.attempt === openAttempt ? openResult : undefined
  const activeOutput = outcome && !outcome.error && output?.state === 'connected' && output.connection === 'open' ? output : undefined
  useEffect(() => {
    if (!output) return
    let current = true, openedHere = false
    // If this port was quickly selected again, finish its prior close before
    // opening it. A superseded open can never reactivate an old route.
    const open = (portWork.get(output) ?? Promise.resolve()).then(async () => {
      if (!current) return
      const alreadyOpen = output.connection === 'open'
      try {
        await output.open()
        openedHere = !alreadyOpen
        if (!current) return
        if (output.state !== 'connected' || output.connection !== 'open') throw new Error('MIDI output unavailable')
        setOpenResult({ output, attempt: openAttempt })
      } catch {
        if (current) setOpenResult({ output, attempt: openAttempt, error: `Could not open ${outputLabel(output)}. Check that the port is available, then retry or choose another output. NADI will use its own sound when available.` })
      }
    })
    portWork.set(output, open)
    return () => {
      current = false
      const close = open.then(async () => {
        if (openedHere && output.state === 'connected') await output.close()
      }).catch(() => { /* A disappearing MIDI port may reject close. */ })
      portWork.set(output, close)
      void close.then(() => { if (portWork.get(output) === close) portWork.delete(output) })
    }
  }, [output, openAttempt])

  useEffect(() => {
    if (!access || !activeOutput || !routedTrackId) return
    const name = activeOutput.name?.trim().toLowerCase()
    // A virtual port can appear as both an input and an output in this browser.
    const matchingInputs = [...access.inputs.values()].filter(input =>
      input.id === activeOutput.id || (name && input.name?.trim().toLowerCase() === name),
    ).map(input => input.id)
    const failed = () => setOpenResult({ output: activeOutput, attempt: openAttempt, error: `MIDI delivery to ${outputLabel(activeOutput)} failed. Check the port, then retry or choose another output. NADI will use its own sound when available.` })
    onRouteChange(activeOutput, routedTrackId, channel, monitorLocal, matchingInputs, failed)
    return () => onRouteChange()
  }, [access, activeOutput, routedTrackId, channel, monitorLocal, openAttempt, onRouteChange])

  async function connect() {
    if (!navigator.requestMIDIAccess) {
      setStatus('MIDI output is unavailable in this browser. Try Chrome or Edge.')
      return
    }
    const attempt = ++request.current
    setConnecting(true)
    setStatus('')
    try {
      const next = await navigator.requestMIDIAccess({ sysex: false })
      if (request.current === attempt) {
        setAccess(next)
        setOutputs(visibleOutputs(next))
      }
    } catch {
      if (request.current === attempt) setStatus('MIDI access was blocked. Check the browser’s site permissions and try again.')
    } finally {
      if (request.current === attempt) setConnecting(false)
    }
  }

  return <details>
    <summary>External MIDI instrument</summary>
    <div className="studio-range">
      {!access && <button type="button" disabled={disabled || connecting} onClick={() => void connect()}>{connecting ? 'Finding MIDI outputs…' : 'Find MIDI outputs'}</button>}
      {access && <>
        <label>MIDI output<select value={outputId} disabled={disabled} onChange={event => { setOpenResult(undefined); setStatus(''); setOutputId(event.target.value) }}>
          <option value="">Off</option>
          {outputs.map(port => <option key={port.id} value={port.id}>{outputLabel(port)}</option>)}
        </select></label>
        {!outputs.length && <small>No MIDI outputs found. Open a MIDI port for the receiving app.</small>}
        <label>Route track<select value={track?.id ?? ''} disabled={disabled || !output} onChange={event => setTrackId(event.target.value)}>
          <option value="">Choose a track</option>
          {tracks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>MIDI channel<select value={channel} disabled={disabled || !output} onChange={event => setChannel(Number(event.target.value))}>
          {channels.map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <label><input type="checkbox" checked={monitorLocal} disabled={disabled || !output} onChange={event => setMonitorLocal(event.target.checked)} />Also play the NADI sound</label>
        {output && !outcome && <small role="status">Opening {outputLabel(output)}…</small>}
        {outcome?.error && <><small role="status">{outcome.error}</small><button type="button" disabled={disabled} onClick={() => { setOpenResult(undefined); setOpenAttempt(attempt => attempt + 1) }}>Retry MIDI output</button></>}
        {activeOutput && track && <small role="status">{track.name} → {outputLabel(activeOutput)} · Channel {channel}</small>}
        <small>Choose the same port and channel in the other app. This route lasts for the current studio session.</small>
      </>}
      {status && <small role="status">{status}</small>}
    </div>
  </details>
}
