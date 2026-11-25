export interface NotesPanelView { bar: number; visible: 1 | 2 | 4; primary: string | null; cursor: number }
export function patchNotesPanelView(views: Readonly<Record<string, NotesPanelView>>, key: string, change: Partial<NotesPanelView>) {
  const next: NotesPanelView = { ...(views[key] ?? { bar: 0, visible: 4, primary: null, cursor: 0 }), ...change }
  return { next, views: { ...views, [key]: next } }
}
