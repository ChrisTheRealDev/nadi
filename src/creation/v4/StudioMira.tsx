import { useEffect, useRef, useState } from 'react'
import type { StudioProject } from './model'
import type { MiraExchange } from '../../tracking/accountStore'
import { observedStudioStep, routeStudioQuestion, STUDIO_HELP_TOPICS, studioQuestionAnswer, studioQuestionClarification, type StudioHelpAnswer, type StudioHelpTopic, type StudioObservedAction } from './studioHelp'
import { authoredStudioResponse, studioFactsV6, type StudioMiraRequest, type StudioMiraResponse, type StudioMiraUiContext } from './miraContract'
import { requestStudioMira, studioMiraConnection, type StudioMiraAvailability, type StudioMiraConnection } from './miraClient'
import { groqLivePreference, rememberGroqLivePreference } from './miraLivePreference'
import { miraFailureMessage } from './miraFailure'
import { isMelodicSound } from './model'
import { matchesHelpDestination, type HelpDestination } from '../helpTarget'
import { buildMiraPassage, type MiraPassageSnapshot } from './miraPassage'
import { readableMiraAdvice } from './miraAdviceText'
import { advanceFirstSongGuide, confirmFirstSongListening, createFirstSongGuide, observeFirstSongGuide, resolveFirstSongStep, retargetFirstSongGuide, type FirstSongGuideSession } from './firstSongGuide'
import './studioMira.css'

export interface StudioMiraProps {
  onArchiveExchange?: (exchange: MiraExchange) => Promise<void>
  open: boolean
  onClose: () => void
  onRevealTarget?: (target: string, destination?: HelpDestination) => void
  project: StudioProject
  selectedTrackId?: string | null
  selectedClipId?: string | null
  uiContext?: Partial<StudioMiraUiContext>
  observedAction?: StudioObservedAction
  canUndo?: boolean
  saved?: boolean
  passageContext?: { trackId: string; clipId: string; selectedNoteIds: readonly string[]; shownRange: { startTick: number; endTick: number } }
  audioContext?: { soundReadiness: 'unknown' | 'loading' | 'ready' | 'error'; playback: 'stopped' | 'playing' | 'paused'; recording: boolean }
}
interface Guide { id: string; projectId: string; trackId?: string; clipId?: string; topic: StudioHelpTopic | null; question: string; sequence: number; completed: boolean; context: string; selectionKey?: string; ui?: Partial<StudioMiraUiContext>; response?: StudioMiraResponse; attachment?: MiraPassageSnapshot; authoredAnswer?: StudioHelpAnswer }
export function StudioMira({ open, onClose, onRevealTarget, onArchiveExchange, project, selectedTrackId, selectedClipId, uiContext, observedAction, canUndo = false, saved = false, passageContext, audioContext }: StudioMiraProps) {
  const [question, setQuestion] = useState(''), [guides, setGuides] = useState<Guide[]>([])
  const [different, setDifferent] = useState(false), [revealAttempt, setRevealAttempt] = useState(0)
  const [controlNotice, setControlNotice] = useState('')
  const [live, setLive] = useState(false), [pendingId, setPendingId] = useState<string | null>(null)
  const [conversation, setConversation] = useState<{ projectId: string; turns: StudioMiraRequest['history'] }>({ projectId: project.id, turns: [] })
  const [availability, setAvailability] = useState<StudioMiraAvailability | 'checking'>('checking')
  const [provider, setProvider] = useState<'groq' | 'openai' | null>(null)
  const [quota, setQuota] = useState<Pick<StudioMiraConnection, 'remainingRequests' | 'blocker'>>({})
  const [statusCheck, setStatusCheck] = useState(0)
  const [goal, setGoal] = useState('')
  const [songGuide, setSongGuide] = useState<FirstSongGuideSession | null>(null)
  const [attachment, setAttachment] = useState<MiraPassageSnapshot | null>(null)
  const [attachmentError, setAttachmentError] = useState('')
  const [songDifferent, setSongDifferent] = useState(false)
  const [songRevealContext, setSongRevealContext] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const liveChoiceRef = useRef(false)
  const contextKey = JSON.stringify([project.id, project.revision, selectedTrackId, selectedClipId, passageContext?.selectedNoteIds, passageContext?.shownRange, audioContext?.soundReadiness, audioContext?.playback, audioContext?.recording])
  // Panel/tool changes are navigation, not a change to the music being discussed.
  const requestContextKey = contextKey
  const contextRef = useRef(requestContextKey)
  const request = guides.at(-1), sameProject = request?.projectId === project.id
  const selectionKey = JSON.stringify([passageContext?.trackId, passageContext?.clipId, passageContext?.selectedNoteIds])
  const sameUi = request?.ui?.activePanel !== uiContext?.activePanel || (['noteSelection', 'activeTool', 'latestRejection', 'shownBars'] as const).every(key => request?.ui?.[key] === uiContext?.[key])
  const currentGuide = request?.context === contextKey && sameUi && request?.selectionKey === selectionKey
  const sameDestination = sameProject && request?.trackId === (selectedTrackId ?? undefined) && request?.clipId === (selectedClipId ?? undefined)
  const guideValid = sameDestination && (currentGuide || request?.completed)
  const answer = guideValid && request?.topic ? studioQuestionAnswer(request.question, request.topic, project, selectedTrackId, selectedClipId, uiContext) : null
  const updatedSongGuide = songGuide ? observeFirstSongGuide(songGuide, observedAction, project) : null
  if (updatedSongGuide !== songGuide) setSongGuide(updatedSongGuide)
  const songStep = songGuide ? resolveFirstSongStep(songGuide, project, selectedTrackId, selectedClipId, { canUndo, activeTool: uiContext?.activeTool }) : null
  const songHighlight = songRevealContext === `${contextKey}:${songGuide?.currentStep}` && songStep?.ready && !songStep.completed ? songStep.target : null
  const highlightTarget = songHighlight ?? (request?.completed ? null : answer?.target)
  if (sameDestination && request?.topic && !request.completed && observedStudioStep(request.topic, request.sequence, observedAction, { projectId: request.projectId, trackId: request.trackId, clipId: request.clipId })) {
    setGuides(guides.map(guide => guide.id === request.id ? { ...guide, completed: true } : guide))
  }
  useEffect(() => { contextRef.current = requestContextKey; controllerRef.current?.abort() }, [requestContextKey])
  useEffect(() => () => controllerRef.current?.abort(), [])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => { controller.abort(); setAvailability('unavailable') }, 5000)
    void studioMiraConnection(controller.signal).then(value => { if (!controller.signal.aborted) { setAvailability(value.availability); setProvider(value.provider); setQuota({ remainingRequests: value.remainingRequests, blocker: value.blocker }); if (value.provider === 'groq' && value.availability === 'ready' && !liveChoiceRef.current) setLive(groqLivePreference()) } }).finally(() => window.clearTimeout(timer))
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [open, statusCheck])
  useEffect(() => {
    if (!open || !highlightTarget) return
    let highlighted: HTMLElement | undefined
    const update = () => {
      const selector = '[data-help-target="' + highlightTarget + '"]'
      const trackControl = ['track-controls', 'track-settings', 'track-sound', 'delete-track', 'instrument-picker'].includes(highlightTarget)
      const selectedTrack = project.tracks.find(track => track.id === selectedTrackId)
      const panel = highlightTarget === 'make-independent' && selectedTrack ? isMelodicSound(selectedTrack.soundId) ? 'notes' : 'drums' : trackControl ? 'sounds' : ['select-chord', 'note-body', 'note-resize'].includes(highlightTarget) ? 'notes' : null
      const scope = panel ? document.querySelector(`[data-work-panel="${panel}"]`) : document
      const node = Array.from(scope?.querySelectorAll<HTMLElement>(selector) ?? []).find(item => matchesHelpDestination(highlightTarget, { trackId: item.dataset.helpTrackId ?? item.closest<HTMLElement>('[data-help-track-id]')?.dataset.helpTrackId, clipId: item.dataset.helpClipId }, { trackId: songHighlight ? songGuide?.trackId : request?.trackId, clipId: songHighlight ? songGuide?.clipId : request?.clipId }) && item.getClientRects().length > 0 && !item.closest('[hidden], [inert]') && !item.matches(':disabled'))
      if (highlighted !== node) { highlighted?.classList.remove('mira-help-highlight'); highlighted = node; highlighted?.classList.add('mira-help-highlight') }
    }
    update()
    // Revealing a slot and expanding its menu can finish after the React render.
    const frame = requestAnimationFrame(update)
    const observer = new MutationObserver(update)
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden', 'inert', 'open', 'disabled'] })
    return () => { cancelAnimationFrame(frame); observer.disconnect(); highlighted?.classList.remove('mira-help-highlight') }
  }, [open, request?.trackId, request?.clipId, highlightTarget, songHighlight, songGuide?.trackId, songGuide?.clipId, project.id, project.revision, project.tracks, selectedTrackId, selectedClipId, revealAttempt])
  const choose = async (topic: StudioHelpTopic | null, text?: string, attached?: MiraPassageSnapshot) => {
    if (attached && (attached.projectId !== project.id || attached.revision !== project.revision || attached.trackId !== selectedTrackId || attached.clipId !== selectedClipId)) {
      setAttachmentError('The music or destination changed. Remove this attachment and choose the notes again before sending.'); return
    }
    controllerRef.current?.abort(); setPendingId(null); setDifferent(false); setSongRevealContext('')
    const controller = new AbortController(); controllerRef.current = controller
    const requestedContext = requestContextKey
    const id = crypto.randomUUID(), guide: Guide = { id, projectId: project.id, trackId: selectedTrackId ?? undefined, clipId: selectedClipId ?? undefined, topic, question: text ?? (topic ? STUDIO_HELP_TOPICS[topic] : question), sequence: observedAction?.sequence ?? 0, completed: false, context: contextKey, selectionKey, ui: uiContext, attachment: attached }
    if (topic) guide.authoredAnswer = studioQuestionAnswer(guide.question, topic, project, selectedTrackId, selectedClipId, uiContext)
    const exchange: MiraExchange = { requestId: id, projectId: project.id, revision: project.revision, prompt: guide.question, response: guide.authoredAnswer ? [guide.authoredAnswer.idea, guide.authoredAnswer.action].filter(Boolean).join('\n') : studioQuestionClarification(guide.question) ?? 'Built-in help cannot answer that question conversationally. Try a specific editing question or a help topic. Mira cannot hear your audio or change your music.', status: text && live ? 'pending' : 'complete', source: text && live ? provider ?? 'live' : 'built-in', createdAt: new Date().toISOString() }
    if (onArchiveExchange) {
      try { await onArchiveExchange(exchange) }
      catch { setControlNotice('Your question could not be saved for tutor review. Please retry; it has not been sent to AI.'); return }
    }
    if (controller.signal.aborted || contextRef.current !== requestedContext) {
      if (onArchiveExchange && exchange.status === 'pending') await onArchiveExchange({ ...exchange, status: 'failed', response: 'Cancelled before sending to AI because the context changed.' }).catch(() => {})
      return
    }
    setQuestion('')
    if (attached) { setAttachment(null); setAttachmentError('') }
    setGuides(previous => [...previous, guide])
    if (!text || !live) return
    setPendingId(id)
    const dto: StudioMiraRequest = { version: 6, requestId: id, revision: project.revision, question: text, history: conversation.projectId === project.id ? conversation.turns.slice(-8) : [], workspace: studioFactsV6(project, selectedTrackId, selectedClipId, canUndo, saved, uiContext, audioContext), passage: attached?.passage ?? null, session: { goal: goal.trim().slice(0, 160), currentStep: songGuide && !songGuide.finished ? songGuide.currentStep : null } }
    let timedOut = false
    const timer = window.setTimeout(() => { timedOut = true; controller.abort() }, 12000)
    void requestStudioMira(dto, controller.signal).then(async response => {
      const accepted = timedOut ? authoredStudioResponse(dto, 'provider-timeout', response.transmission) : response
      if (onArchiveExchange) await onArchiveExchange({ ...exchange, response: accepted.selection.explanation || guide.authoredAnswer?.idea || `Built-in fallback: ${accepted.reason ?? 'unavailable'}`, source: accepted.source, status: controller.signal.aborted ? 'failed' : 'complete' })
      if ((controller.signal.aborted && !timedOut) || contextRef.current !== requestedContext) return
      setGuides(previous => previous.at(-1)?.id === id ? previous.map(item => item.id === id ? { ...item, topic: accepted.selection.topic, response: accepted } : item) : previous)
      // Never add authored text containing local track/project names to transmitted history.
      if (accepted.source === 'live') setConversation(previous => ({ projectId: project.id, turns: [...(previous.projectId === project.id ? previous.turns : []), { role: 'user' as const, text }, ...(accepted.selection.explanation ? [{ role: 'assistant' as const, text: accepted.selection.explanation }] : [])].slice(-8) }))
    }).catch(async () => {
      if (onArchiveExchange) await onArchiveExchange({ ...exchange, status: 'failed', response: 'The response could not be completed or archived.' }).catch(() => {})
      setControlNotice('The response could not be completed or archived. Your saved question remains available for review.')
    }).finally(() => { window.clearTimeout(timer); setPendingId(current => current === id ? null : current); setStatusCheck(value => value + 1) })
  }
  const attach = (source: 'selected' | 'shown') => {
    if (!passageContext || passageContext.trackId !== selectedTrackId || passageContext.clipId !== selectedClipId) { setAttachmentError('Open Notes and choose the part you want to discuss first.'); return }
    const result = buildMiraPassage({ project, trackId: passageContext.trackId, clipId: passageContext.clipId,
      ...(source === 'selected' ? { selectedNoteIds: passageContext.selectedNoteIds } : { shownRange: passageContext.shownRange }) })
    if (!result.ok) { setAttachmentError(result.error); return }
    setAttachment(result.snapshot); setAttachmentError('')
    if (!question.trim()) setQuestion('Explain what you notice in my shared notes, without composing or supplying replacement notes.')
  }
  const nextSongStep = (skip = false) => { if (songGuide) { setSongGuide(advanceFirstSongGuide(songGuide, observedAction?.sequence ?? 0, selectedTrackId, selectedClipId, skip)); setSongDifferent(false) } }
  const showControl = () => {
    if (!answer?.target || !onRevealTarget) return
    setControlNotice('')
    onRevealTarget(answer.target, { trackId: request?.trackId, clipId: request?.clipId }); setRevealAttempt(value => value + 1)
    if (answer.target === 'note-resize') requestAnimationFrame(() => requestAnimationFrame(() => {
      const handles = Array.from(document.querySelectorAll<HTMLElement>('[data-help-target="note-resize"]'))
      if (!handles.some(item => matchesHelpDestination('note-resize', { trackId: item.dataset.helpTrackId, clipId: item.dataset.helpClipId }, request) && item.getClientRects().length && !item.closest('[hidden], [inert]'))) setControlNotice('Show the bar containing the selected note’s right edge, then try Show control again.')
    }))
  }
  const close = () => { controllerRef.current?.abort(); onClose() }
  if (!open) return null
  const liveCurrent = !!request && sameProject && request.response?.source === 'live'
  const aiExplanation = liveCurrent ? request?.response?.selection.explanation : ''
  const advice = liveCurrent && request?.response?.version === 6 ? request.response.selection : undefined
  const previousExchanges = guides.filter(guide => guide.projectId === project.id && guide.id !== request?.id && guide.response?.source === 'live')
  const guideContent = answer && <>
    <p>{different ? answer.differently : answer.idea}</p>
    {request?.topic === 'undo' && !canUndo ? <p>There is no earlier edit in this session’s Undo history. Reopening a project does not restore old Undo history.</p> : <p className="studio-mira-action">{answer.action}</p>}
    {request?.completed && <p>That action is done. Want to try it once without the highlight?</p>}
    <div className="studio-mira-actions">{!liveCurrent && <button type="button" onClick={() => setDifferent(value => !value)}>Explain differently</button>}{answer.target && onRevealTarget && !request?.completed && <button type="button" onClick={showControl}>Show control</button>}</div>
  </>
  return <aside className="creation-mira studio-mira" aria-label="Mira help">
    <header><img className="mira-avatar" src="/assets/mira/mira-encouraging.png" alt="" /><h2>Mira</h2><button type="button" onClick={close}>Close help</button></header>

    <p className="mira-source">{pendingId ? 'Requesting live AI…' : request ? liveCurrent ? currentGuide ? 'Live AI explanation' : 'Live AI explanation · earlier context' : 'Built-in help · not a live AI answer' : availability === 'ready' && live ? 'Live AI enabled · ask below' : 'Built-in help'}</p>
    {controlNotice && currentGuide && <small role="status">{controlNotice}</small>}
    {!!previousExchanges.length && <details className="studio-mira-history"><summary>Earlier conversation</summary><small>Earlier advice is context, not current control guidance.</small>{previousExchanges.map(guide => <div key={guide.id}><p><strong>You:</strong> {guide.question}</p><p><strong>Mira:</strong> {guide.response?.selection.explanation}</p></div>)}</details>}
    <div aria-live="polite" className="studio-mira-answer">
      {request && sameProject && <p className="studio-mira-user"><strong>You:</strong> {request.question}</p>}
      {!request && <p>Tell me what you want to make, or what got confusing. We can work through one step at a time.</p>}
      {pendingId ? null : request && !sameProject ? <p>Your workspace changed. Ask again so I do not point at an old editing destination.</p> : aiExplanation ? <>
        {!currentGuide && <small>This explanation is earlier context. Ask again for control guidance in the current workspace.</small>}
        {request?.attachment && <small>Explanation of shared notes only. Mira has not heard the audio. You choose and create the music.</small>}
        {advice ? <div className="studio-mira-live-reply">{advice.observation && <p>{readableMiraAdvice(advice.observation)}</p>}{advice.rationale && <p><strong>Why:</strong> {readableMiraAdvice(advice.rationale)}</p>}{advice.clarification ? <p className="studio-mira-action">{advice.clarification}</p> : advice.action && <p className="studio-mira-action"><strong>Try this:</strong> {readableMiraAdvice(advice.action)}</p>}</div> : <p className="studio-mira-live-reply">{aiExplanation}</p>}
        <div className="studio-mira-actions"><button type="button" disabled={!live || !!pendingId} onClick={() => choose(null, 'Please explain your previous answer more simply using plain language or an analogy, not a musical passage.')}>Explain differently</button><button type="button" disabled={!live || !!pendingId} onClick={() => choose(null, 'What is the next single action for my current task in NADI, and why? Use the exact control label; leave the musical choices to me.')}>Next step</button>{answer?.target && onRevealTarget && !request?.completed && <button type="button" onClick={showControl}>Show control</button>}<button type="button" onClick={() => { setQuestion(''); document.getElementById('studio-mira-question')?.focus() }}>Ask a follow-up</button></div>
        {answer && <details className="studio-mira-guide"><summary>Optional built-in control guide</summary>{guideContent}</details>}
      </> : answer ? guideContent : request && !guideValid ? <><small>Earlier context. Ask again for a current control guide.</small><p>{request.authoredAnswer?.idea}</p><p>{request.authoredAnswer?.action}</p></> : request ? <p>{studioQuestionClarification(request.question) ?? 'Built-in help cannot answer that question conversationally. Try a specific editing question or one of the topics below. Live AI can explain music concepts and follow-up questions; I cannot hear your audio, compose for you or change your music.'}</p> : null}
    </div>
    {pendingId && <p className="studio-mira-pending" role="status">Mira is thinking… <button type="button" onClick={() => { controllerRef.current?.abort(); setPendingId(null) }}>Cancel reply</button></p>}
    {request?.response?.source === 'authored' && <div role="status" className="studio-mira-failure">{miraFailureMessage(request.response.reason)} Built-in help is available.<button type="button" onClick={() => { setQuestion(request.question); setAttachment(request.attachment ?? null); setAttachmentError(''); document.getElementById('studio-mira-question')?.focus() }}>Retry / edit question</button><small>Review it, then Send again. A live retry uses the normal allowance.</small><details><summary>Technical detail</summary>{request.response.reason}</details></div>}
    <form className="studio-mira-composer" onSubmit={event => { event.preventDefault(); if (question.trim() && !pendingId) choose(routeStudioQuestion(question), question.trim(), attachment ?? undefined) }}>
      <label htmlFor="studio-mira-question">What are you trying to do?</label>
      <textarea id="studio-mira-question" maxLength={500} value={question} onChange={event => setQuestion(event.target.value)} placeholder="For example: how can I move all three notes of my chord together?" />
      {attachment && <div className="studio-mira-attachment" aria-label="Notes attachment preview"><strong>Notes to share</strong><p>{attachment.passage.soundId} · {attachment.passage.notes.length} notes · part bars {Math.floor(attachment.passage.rangeStartTick / 1920) + 1}–{Math.ceil(attachment.passage.rangeEndTick / 1920)}</p><small>Exact notes and timing, not audio. Only this question receives them. No project or track names.</small><button type="button" onClick={() => { setAttachment(null); setAttachmentError('') }}>Remove attachment</button>{!live && <small>Enable live AI to receive advice about these notes. Built-in help cannot analyse the passage.</small>}</div>}
      {attachmentError && <p role="alert">{attachmentError}</p>}
      <button type="submit" disabled={!question.trim() || !!pendingId || (!!attachment && !live)}>{pendingId ? 'Thinking…' : attachment ? 'Send question and notes' : 'Ask Mira'}</button>
      <div className="studio-mira-starters" aria-label="Help question starters"><button type="button" disabled={!!pendingId} onClick={() => { attach('selected'); setQuestion('Explain what you notice in my shared notes, without composing or supplying replacement notes.') }}>Explain these notes</button><button type="button" disabled={!!pendingId} onClick={() => { setQuestion('I want to '); document.getElementById('studio-mira-question')?.focus() }}>Help me do something</button><button type="button" disabled={!!pendingId} onClick={() => { setQuestion('I am trying to , but '); document.getElementById('studio-mira-question')?.focus() }}>Something isn’t working</button></div>
      <details open={!!attachment}><summary>Ask about my notes</summary><div className="studio-mira-actions"><button type="button" disabled={!!pendingId} onClick={() => attach('selected')}>Ask about selected notes</button><button type="button" disabled={!!pendingId} onClick={() => attach('shown')}>Use shown bars instead</button></div><small>One part, up to four bars and 64 notes. Preview before sending.</small>
      </details>
    </form>
    <details className="studio-mira-goal"><summary>My musical goal</summary><label htmlFor="mira-song-goal">What I want to make</label><input id="mira-song-goal" maxLength={160} value={goal} onChange={event => setGoal(event.target.value)} /><small>Remembered for this project during this session. No course required.</small></details>
    {(request || songGuide) && <button type="button" disabled={!!pendingId} onClick={() => { if (live) choose(null, songStep ? `I'm stuck on this action: ${songStep.action} Please explain it another way with one small action.`.slice(0, 500) : "I'm stuck. Please explain the previous action another way, with one small action I can try."); else { setDifferent(true); setSongDifferent(true) } }}>I’m stuck</button>}
    <details className="studio-mira-song" open={!!songGuide && !songGuide.finished}>
      <summary>{songGuide ? 'My song guide' : 'Help me make a song'}</summary>
      {!songGuide ? <><small>Optional steps, not a course. You choose the music and can skip or stop anytime.</small><button type="button" onClick={() => setSongGuide(createFirstSongGuide(project.id, goal, observedAction?.sequence ?? 0, selectedTrackId, selectedClipId))}>Start song help</button></> : songGuide.finished ? <><p>The guide is finished. Listen and decide what still needs work—Mira cannot judge your satisfaction.</p><button type="button" onClick={() => setSongGuide(null)}>Close song guide</button></> : songStep && <>
        <h3>{songStep.title}</h3><p>{songDifferent ? songStep.differently : songStep.idea}</p><p className="studio-mira-action">{songStep.action}</p>
        {songStep.completed && <small>Relevant action observed. Continue when you are ready.</small>}
        <div className="studio-mira-actions">
          {songStep.target && <button type="button" onClick={() => { onRevealTarget?.(songStep.target!, { trackId: songGuide.trackId, clipId: songGuide.clipId }); setSongRevealContext(`${contextKey}:${songGuide.currentStep}`); setRevealAttempt(value => value + 1) }}>Show song control</button>}
          <button type="button" onClick={() => setSongDifferent(value => !value)}>Explain this step differently</button>
          {songStep.confirmationRequired ? <button type="button" onClick={() => { setSongGuide(confirmFirstSongListening(songGuide)) }}>I listened — continue</button> : null}
          <button type="button" disabled={!songStep.completed} onClick={() => nextSongStep()}>Continue guide</button>
          <button type="button" onClick={() => nextSongStep(true)}>Skip this step</button>
          <button type="button" onClick={() => setSongGuide(null)}>Stop song guide</button>
          {!songStep.ready && <button type="button" onClick={() => setSongGuide(retargetFirstSongGuide(songGuide, observedAction?.sequence ?? 0, selectedTrackId, selectedClipId))}>Use selected part for this step</button>}
        </div>
      </>}
    </details>
    {!!guides.length && <><button type="button" disabled={guides.length < 2} onClick={() => {
      controllerRef.current?.abort(); setPendingId(null)
      const previous = guides.at(-2)
      setQuestion(previous?.question ?? ''); setGuides(value => value.slice(0, -1)); setDifferent(false)
      // A follow-up must refer to the answer now displayed, not a later answer left behind.
      setConversation({ projectId: project.id, turns: live && previous?.projectId === project.id && previous.response?.source === 'live'
        ? [{ role: 'user', text: previous.question }, { role: 'assistant', text: previous.response.selection.explanation }].filter(turn => turn.text) as StudioMiraRequest['history'] : [] })
    }}>Back</button>
    <button type="button" disabled={!guides.length} onClick={() => { controllerRef.current?.abort(); setPendingId(null); setGuides([]); setConversation({ projectId: project.id, turns: [] }); setQuestion('') }}>{onArchiveExchange ? 'Reset AI context (tutor history retained)' : 'Clear conversation'}</button></>}
    <details className="studio-mira-topics"><summary>Things I can help with</summary><div>{Object.entries(STUDIO_HELP_TOPICS).map(([topic, label]) => <button type="button" key={topic} disabled={!!pendingId} onClick={() => choose(topic as StudioHelpTopic, `How do I ${label.toLowerCase()}?`)}>{label}</button>)}</div></details>
    <details className="mira-connection-details"><summary>AI settings</summary>
    <div className="studio-mira-connection" role="status">
      {availability === 'checking' ? 'Checking server setup…' : quota.blocker === 'quota-exhausted' ? 'The local live-AI request allowance is used up. Built-in help remains available; no paid fallback was started.' : quota.blocker === 'quota-unavailable' ? 'The local request allowance could not be checked. Live AI is paused to protect the limit; built-in help still works.' : availability === 'ready' ? (live ? 'Live AI is configured. The provider connection is tested when you ask.' : 'Live AI is configured. Enable it below to send your questions.') : availability === 'disabled' ? 'Live AI is not configured on this server. Replies currently use built-in help, not an AI model.' : availability === 'unauthorized' ? 'Live AI is configured, but this browser session is not authorised. Built-in help is available.' : 'Cannot check the server setup. Built-in help still works.'}
      <button type="button" onClick={() => { setAvailability('checking'); setStatusCheck(value => value + 1) }}>Check connection</button>
    </div>
    {provider === 'groq' && <small>Groq · adult demo · owner-confirmed free account. Quotas apply; no automatic paid fallback.{quota.remainingRequests !== undefined && <> Last check: {quota.remainingRequests} local requests remaining.</>}</small>}
    <label><input type="checkbox" checked={live} onChange={event => { liveChoiceRef.current = true; if (provider === 'groq') rememberGroqLivePreference(event.target.checked); setLive(event.target.checked); controllerRef.current?.abort(); setPendingId(null); if (!event.target.checked) setConversation({ projectId: project.id, turns: [] }) }} />{provider === 'groq' ? 'Use live AI' : 'Use live AI if authorised'}</label>
    {(availability !== 'ready' || request?.response?.reason === 'provider-auth') && <details className="studio-mira-setup"><summary>Why am I getting built-in replies?</summary><p>Real conversation needs a working AI account and key. For this local Groq demo, run <code>npm run mira:setup:groq</code> in the NADI terminal to update the key, then restart the server. No browser pairing or sign-in is needed. Do not paste an API key into this chat. The older OpenAI route retains its separate access requirements.</p></details>}
    </details>
    <details className="mira-privacy-details"><summary>About your data</summary><small>{onArchiveExchange && 'Your assigned tutor can review every submitted question and response. Resetting AI context does not delete this history. '}Read-only advice. I have not listened to your audio. {live ? 'When you ask, your question, session goal/current step, up to eight recent live text turns and minimal workspace facts are sent to the configured AI provider. Notes are sent only after you preview an attachment and press Send. No recordings or project names are attached automatically; avoid private details in your question. Earlier answers may mention shared notes. Clear conversation removes that outbound text context. Turn off Use live AI for built-in help only.' : onArchiveExchange ? 'Built-in mode does not send questions to an AI provider. Questions and responses are still saved for your assigned tutor.' : 'Built-in mode keeps new questions in this browser; enable live AI to send questions to the configured provider.'} Trying a control is not a test of understanding.</small></details>
  </aside>
}
