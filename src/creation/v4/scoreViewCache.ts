import type { StudioProject } from './model'
import type { ScoreMapping, ScoreResult } from './sheetMusic'
import type { bindScoreDrag } from './scoreDrag'

export interface EngravedView {
  host: HTMLDivElement
  score: ScoreResult
  status: string
  drags: ReturnType<typeof bindScoreDrag>[]
  clearDisplay?: () => void
  handlers?: {
    select: (source: ScoreMapping, extend: boolean) => void
    commit: (project: StudioProject, label: string) => boolean
    report: (text: string) => void
  }
}

export interface ScoreViewCache {
  project: StudioProject
  editable: boolean
  views: Map<string, EngravedView>
}

export function createScoreViewCache(project: StudioProject, editable: boolean): ScoreViewCache {
  return { project, editable, views: new Map() }
}

export function detachView(view: EngravedView) {
  view.handlers = undefined
  for (const drag of view.drags) drag.cancel()
  view.host.remove()
}

export function disposeView(view: EngravedView) {
  view.handlers = undefined
  for (const drag of view.drags) drag.dispose()
  view.drags.length = 0
  view.clearDisplay?.()
  view.host.remove()
}

export function clearScoreViews(cache: ScoreViewCache) {
  cache.views.forEach(disposeView)
  cache.views.clear()
}
