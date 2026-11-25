/** Fixed local explanations only: never display raw provider errors or credentials. */
export function miraFailureMessage(reason: string): string {
  if (reason.includes('429') || reason.includes('rate-limited')) return 'AI is busy or rate-limited. Wait a moment before asking again.'
  if (reason.includes('401') || reason.includes('403') || reason === 'provider-auth') return 'The AI provider rejected access. Check the account and key in the server setup.'
  if (reason === 'provider-model-unavailable') return 'The configured AI model is unavailable. Check the server setup.'
  if (reason.includes('quota') || reason.includes('budget')) return 'The live-AI allowance is unavailable or used up.'
  if (reason.includes('timeout') || reason === 'cancelled') return 'The reply did not finish in time. You can ask again.'
  if (reason === 'local-safety') return 'Please ask about music without private details, passwords or instructions to override Mira.'
  if (reason === 'unsupported-local') return 'That feature is not supported in this NADI version.'
  if (reason === 'authorization-required' || reason === 'live-disabled') return 'Live AI is not available. Check AI settings below.'
  return 'Mira could not return a usable live reply. Your music has not changed.'
}
