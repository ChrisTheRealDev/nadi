import { describe, expect, it, vi } from 'vitest'
import { createStudioProject } from '../creation/v4/model'
import { createAudioIdea } from '../creation/ideas'
import { captureManifest } from './accountStore'
import { hydrateRevision, revisionSummary } from './sharedReviewData'
import type { TrackingClient } from './client'

describe('complete shared musical evidence', () => {
  it('uploads immutable originals by hash without changing the local project', async () => {
    const project = createStudioProject(); project.ideas.push(createAudioIdea('YWJj', 'audio/webm', 3, 1200))
    const upload = vi.fn(async () => {})
    const manifest = await captureManifest(project, upload) as typeof project
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ base64: 'YWJj', hash: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' }))
    expect(manifest.ideas[0].original).not.toHaveProperty('base64')
    expect(project.ideas[0].original).toHaveProperty('base64', 'YWJj')
    const client = { capture: vi.fn(async () => ({ base64: 'YWJj', mimeType: 'audio/webm' })) } as unknown as TrackingClient
    expect(await hydrateRevision(manifest, client, 'a', 'b')).toEqual(project)
  })
  it('rejects altered original audio before displaying a shared revision', async () => {
    const project = createStudioProject(); project.ideas.push(createAudioIdea('YWJj', 'audio/webm', 3, 1200))
    const manifest = await captureManifest(project, async () => {})
    const client = { capture: vi.fn(async () => ({ base64: 'ZGVm', mimeType: 'audio/webm' })) } as unknown as TrackingClient
    await expect(hydrateRevision(manifest, client, 'a', 'b')).rejects.toThrow('integrity')
  })
  it('reports observed rhythm/pitch changes including unplaced patterns without learning claims', () => {
    const before = createStudioProject(); before.patterns[0].notes.push({ id: 'n', pitch: 60, startTick: 0, durationTicks: 120, velocity: 80 }); before.clips = []
    const after = structuredClone(before); after.patterns[0].notes[0].pitch = 62; after.patterns[0].notes[0].durationTicks = 240
    const summary = revisionSummary(after, before).join(' ')
    expect(summary).toContain('duration changed for 1'); expect(summary).toContain('pitch changed for 1'); expect(summary).toContain('do not establish')
  })
})
