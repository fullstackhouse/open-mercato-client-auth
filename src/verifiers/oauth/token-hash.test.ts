import crypto from 'node:crypto'
import { hashToken } from './token-hash.js'

describe('token-hash', () => {
  test('hashes tokens with sha256', () => {
    expect(hashToken('abc')).toBe(crypto.createHash('sha256').update('abc').digest('hex'))
  })

  test('returns null for empty input', () => {
    expect(hashToken(null)).toBeNull()
    expect(hashToken(undefined)).toBeNull()
    expect(hashToken('')).toBeNull()
  })
})
