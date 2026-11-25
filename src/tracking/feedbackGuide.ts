/** Deterministic software orientation; never interprets feedback as creative commands. */
export function feedbackGuide(hasComposition: boolean, measures?: string | null) {
  return {
    steps: [
      hasComposition ? 'Open the linked composition and saved revision. Keep the tutor’s discussion available for reference.' : 'Open the composition or assignment your tutor is discussing. Ask which work they mean if it is unclear.',
      measures ? `Find the referenced measures (${measures}). Use Full screen and zoom to inspect the notes.` : 'Find the passage mentioned by your tutor. Use Full screen and zoom to inspect the notes.',
      'In your editable studio, select the relevant note or part. Drag a note to move it, or use its length handle to resize it. Undo reverses your last edit.',
      'Choose your own revision in response to the tutor. Play and stop to compare it with the saved version; Mira does not choose the musical change.',
      'Save, wait for sharing confirmation, then reply to the tutor explaining what you changed or what still needs clarification.',
    ],
    checks: ['Am I working on the intended composition, instrument and passage?', 'Have I understood the tutor’s request? If not, ask before changing the work.', 'Have I listened to the result and decided whether it expresses my intention?', 'Is the revision saved and sharing confirmed before I say it has been sent?'],
  }
}
