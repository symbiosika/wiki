import { describe, expect, it } from 'vitest'
import { appNameFromTitle, DEFAULT_APP_NAME } from './appName'

describe('appNameFromTitle', () => {
  it('takes the title the server rendered', () => {
    expect(appNameFromTitle('  Acme Knowledge ')).toBe('Acme Knowledge')
  })

  it('falls back to a neutral name', () => {
    expect(appNameFromTitle('')).toBe(DEFAULT_APP_NAME)
    expect(appNameFromTitle(undefined)).toBe(DEFAULT_APP_NAME)
  })
})
