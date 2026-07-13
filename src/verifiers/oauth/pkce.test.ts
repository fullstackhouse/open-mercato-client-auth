import crypto from 'node:crypto'
import { generatePkcePair } from './pkce.js'

describe('pkce', () => {
  test('challenge is the S256 digest of the verifier', () => {
    const { codeVerifier, codeChallenge } = generatePkcePair()
    const expected = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
    expect(codeChallenge).toBe(expected)
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43)
  })

  test('every pair is unique', () => {
    const a = generatePkcePair()
    const b = generatePkcePair()
    expect(a.codeVerifier).not.toBe(b.codeVerifier)
  })
})
