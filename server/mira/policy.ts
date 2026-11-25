import type { MiraLivePayload, MiraRequestDto } from '../../src/lib/mira/contracts'

export type MiraPolicyCategory = 'high-risk' | 'personal-data' | 'instruction-injection' | 'unsafe-output'

export type MiraPolicyResult =
  | { safe: true }
  | { safe: false; category: MiraPolicyCategory }

// These narrow checks are one defence layer, not a claim of complete safety classification.
const highRiskPatterns = [
  /\b(?:suicide|suicidal|self[- ]?harm|kill myself|want to die)\b/i,
  /\b(?:sexual|nudes?|pornograph|grooming)\b/i,
  /\b(?:buy|sell|make)\s+(?:drugs?|weapon|explosive)\b/i,
  /\b(?:hurt|kill|attack)\s+(?:someone|them|him|her)\b/i,
]
const personalDataPatterns = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(?:\+?\d[\s().-]?){8,}/,
  /\b(?:my|their)\s+(?:full\s+)?(?:name|school|address|phone|email)\s+is\b/i,
  /\b(?:contact|message|call|email)\s+me\s+at\b/i,
]
const injectionPatterns = [
  /\bignore\b.{0,40}\b(?:instructions?|messages?)\b/i,
  /\b(?:reveal|print|repeat)\s+(?:the\s+)?(?:system prompt|developer message|api key|secret)\b/i,
  /\byou are now\b/i,
]
const unsafeOutputPatterns = [
  ...highRiskPatterns,
  ...personalDataPatterns,
  /<\/?(?:script|iframe|object|embed|style|img|a)\b/i,
  /\b(?:award|grant|mark)\s+(?:a\s+)?(?:checkpoint|mastery|independence|grade)\b/i,
  /\b(?:I heard|I can hear|I listened to)\s+your\s+(?:audio|microphone|performance|melody|track|music|playing)\b/i,
  /\b(?:report (?:was|has been) sent|I (?:told|messaged|contacted) your supervisor)\b/i,
]

export function screenMiraInput(request: MiraRequestDto): MiraPolicyResult {
  const text = [
    request.question,
    request.intention,
    request.attempt.summary,
    ...request.facts.flatMap((fact) => typeof fact.value === 'string'
      ? [fact.value]
      : Array.isArray(fact.value) ? fact.value.filter((item): item is string => typeof item === 'string') : []),
  ].join('\n')
  if (highRiskPatterns.some((pattern) => pattern.test(text))) return { safe: false, category: 'high-risk' }
  if (personalDataPatterns.some((pattern) => pattern.test(text))) return { safe: false, category: 'personal-data' }
  if (injectionPatterns.some((pattern) => pattern.test(text))) return { safe: false, category: 'instruction-injection' }
  return { safe: true }
}

export function screenMiraOutput(output: MiraLivePayload): MiraPolicyResult {
  const text = [output.observation, output.intentionConnection, output.nextStep, output.question ?? ''].join('\n')
  return unsafeOutputPatterns.some((pattern) => pattern.test(text))
    ? { safe: false, category: 'unsafe-output' }
    : { safe: true }
}

export class MiraTrafficGate {
  private readonly recent = new Map<string, number[]>()
  private active = 0

  constructor(
    private readonly requestsPerMinute: number,
    private readonly maxConcurrent: number,
    private readonly now: () => number,
  ) {}

  enter(sessionId: string): { ok: true; leave: () => void } | { ok: false; reason: 'rate' | 'concurrency' } {
    const cutoff = this.now() - 60_000
    for (const [key, timestamps] of this.recent) {
      const live = timestamps.filter((timestamp) => timestamp > cutoff)
      if (live.length) this.recent.set(key, live)
      else this.recent.delete(key)
    }
    if (!this.recent.has(sessionId) && this.recent.size >= 1_000) return { ok: false, reason: 'rate' }
    const requests = (this.recent.get(sessionId) ?? []).filter((timestamp) => timestamp > cutoff)
    if (requests.length >= this.requestsPerMinute) return { ok: false, reason: 'rate' }
    if (this.active >= this.maxConcurrent) return { ok: false, reason: 'concurrency' }
    requests.push(this.now())
    this.recent.set(sessionId, requests)
    this.active += 1
    let left = false
    return {
      ok: true,
      leave: () => {
        if (left) return
        left = true
        this.active = Math.max(0, this.active - 1)
      },
    }
  }
}
