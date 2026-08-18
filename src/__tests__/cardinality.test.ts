import { describe, it, expect } from 'vitest'
import { collectsMany, requiresAtLeastOne } from '../cardinality'

describe('requiresAtLeastOne', () => {
  it('should treat a bare requirement as mandatory', () => {
    expect(requiresAtLeastOne({})).toBe(true)
  })

  it('should honour optional as the older spelling of 0..1', () => {
    expect(requiresAtLeastOne({ optional: true })).toBe(false)
    expect(requiresAtLeastOne({ optional: false })).toBe(true)
  })

  it('should read the lower bound of a cardinality', () => {
    expect(requiresAtLeastOne({ cardinality: '1..1' })).toBe(true)
    expect(requiresAtLeastOne({ cardinality: '1..n' })).toBe(true)
    expect(requiresAtLeastOne({ cardinality: '0..1' })).toBe(false)
    expect(requiresAtLeastOne({ cardinality: '0..n' })).toBe(false)
  })

  it('should let an explicit cardinality win over optional', () => {
    // Both fields say the same thing in different words; the newer one decides,
    // so a manifest that sets cardinality is not silently overruled by a
    // leftover optional flag
    expect(requiresAtLeastOne({ optional: true, cardinality: '1..1' })).toBe(true)
    expect(requiresAtLeastOne({ optional: false, cardinality: '0..1' })).toBe(false)
  })
})

describe('collectsMany', () => {
  it('should be true only for the n-variants', () => {
    expect(collectsMany({ cardinality: '0..n' })).toBe(true)
    expect(collectsMany({ cardinality: '1..n' })).toBe(true)
    expect(collectsMany({ cardinality: '0..1' })).toBe(false)
    expect(collectsMany({ cardinality: '1..1' })).toBe(false)
  })

  it('should default to a single provider', () => {
    expect(collectsMany({})).toBe(false)
    expect(collectsMany({ optional: true })).toBe(false)
  })
})
