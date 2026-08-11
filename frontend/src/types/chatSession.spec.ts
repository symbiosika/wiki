import { describe, it, expect } from 'vitest'
import { sessionLabel, type ChatSession } from './chatSession'

const session = (patch: Partial<ChatSession> = {}): ChatSession => ({
  id: 's1',
  title: null,
  preview: null,
  createdAt: '2026-08-11 10:00:00',
  updatedAt: '2026-08-11 10:00:00',
  ...patch,
})

describe('sessionLabel', () => {
  it('prefers the title', () => {
    expect(
      sessionLabel(session({ title: 'Urlaub', preview: 'Wie geht das?' }), '—'),
    ).toBe('Urlaub')
  })

  it('falls back to the preview while no title exists', () => {
    expect(sessionLabel(session({ preview: 'Wie geht das?' }), '—')).toBe(
      'Wie geht das?',
    )
  })

  it('falls back to the given placeholder for an empty conversation', () => {
    expect(sessionLabel(session(), 'Ohne Titel')).toBe('Ohne Titel')
  })

  it('treats a blank title as no title', () => {
    expect(sessionLabel(session({ title: '   ', preview: 'Frage' }), '—')).toBe(
      'Frage',
    )
  })
})
