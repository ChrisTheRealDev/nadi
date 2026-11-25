import type { Note } from './model'
// Deliberately outside the editor lifecycle: panel switches and projects retain it.
let clipboard: Note[] = []
export function copyNotes(notes: Note[]): void { clipboard = notes.map(note => ({ ...note })) }
export function copiedNotes(): Note[] { return clipboard.map(note => ({ ...note })) }
