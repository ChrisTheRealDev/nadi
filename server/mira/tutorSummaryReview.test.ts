import { describe,expect,it,vi } from 'vitest'
import { createStudioProject } from '../../src/creation/v4/model'
import { buildTutorEvidence,tutorFactText } from '../../src/tracking/tutorSummaryData'
import { createTutorSummaryHandler } from './tutorSummaryHandler'
import { loadGroqConfig } from './groqConfig'
const config=loadGroqConfig({MIRA_PROVIDER:'groq',MIRA_LIVE_ENABLED:'true',GROQ_API_KEY:'gsk_test-not-a-real-secret',MIRA_GROQ_FREE_TIER_CONFIRMED:'true',MIRA_ADULT_DEMO_CONFIRMED:'true'})
describe('independent tutor summary review',()=>{
 it('does not describe equal tempo evidence as a tempo change',()=>{const p=createStudioProject(),previous=structuredClone(p);previous.revision=0;p.revision=1;const fact=buildTutorEvidence(p,previous).facts.find(f=>f.id==='tempo');if(fact)expect(tutorFactText(fact).toLowerCase()).not.toContain('changed')})
 it('does not send an already-cancelled tutor request to the provider',async()=>{const controller=new AbortController();controller.abort();const fetcher=vi.fn<typeof fetch>(async()=>new Response('',{status:503})),quota={reserve:vi.fn(async()=>({ok:true})),settle:vi.fn(async()=>{})};const handler=createTutorSummaryHandler({config,quota,fetchImpl:fetcher});const request=new Request('http://127.0.0.1:5176/api/mira/creation/tutor-summary',{method:'POST',headers:{host:'127.0.0.1:5176',origin:'http://127.0.0.1:5176','content-type':'application/json'},signal:controller.signal,body:JSON.stringify({requestId:'aborted-review',evidence:buildTutorEvidence(createStudioProject())})});await handler(request,'127.0.0.1');expect(fetcher).not.toHaveBeenCalled();expect(quota.reserve).not.toHaveBeenCalled()})
})
