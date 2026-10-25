import { describe, it, expect } from 'vitest'
import {
  ARTIFACT_IFRAME_SANDBOX,
  artifactContentUrl,
  artifactTitleFromFileName,
  formatBytes,
  isArtifactFile,
} from './artifacts'

describe('artifacts', () => {
  it('accepts ZIP and HTML uploads only', () => {
    expect(isArtifactFile('dashboard.zip')).toBe(true)
    expect(isArtifactFile('Report.HTML')).toBe(true)
    expect(isArtifactFile('page.htm')).toBe(true)
    expect(isArtifactFile('notes.md')).toBe(false)
    expect(isArtifactFile('zip')).toBe(false)
  })

  it('derives a title from the file name', () => {
    expect(artifactTitleFromFileName('kpi-dashboard_2026.zip')).toBe(
      'kpi dashboard 2026',
    )
    expect(artifactTitleFromFileName('Quartalsbericht.html')).toBe(
      'Quartalsbericht',
    )
  })

  it('never grants the iframe the app origin', () => {
    expect(ARTIFACT_IFRAME_SANDBOX).toContain('allow-scripts')
    expect(ARTIFACT_IFRAME_SANDBOX).not.toContain('allow-same-origin')
  })

  it('builds the content URL below the API base', () => {
    expect(
      artifactContentUrl({
        pageId: 'p',
        contentPath: '/artifact-content/tok/index.html',
        current: {} as never,
        versions: [],
      }),
    ).toBe('/api/v1/artifact-content/tok/index.html')
  })

  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
