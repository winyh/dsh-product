import { describe, expect, it } from 'vitest'
import { buildProductOnboarding } from '../src/onboarding.js'
import type { ProductVaultScan } from '../src/types.js'

describe('product onboarding', () => {
  it('routes to the first missing product gate', () => {
    const scan: ProductVaultScan = {
      root: '.',
      generatedAt: '2026-08-20T00:00:00Z',
      files: [],
      productNotes: [
        { path: 'brief.md', title: 'Brief', artifactType: 'product-brief', status: 'active', reasons: ['healthy'] },
        { path: 'poc.md', title: 'POC', artifactType: 'poc-plan', status: 'active', reasons: ['missing owner'] },
      ],
      dataFiles: [],
      skippedFiles: 0,
      errors: [],
      byType: { 'product-brief': 1, 'poc-plan': 1 },
      byStatus: { active: 2 },
    }
    const result = buildProductOnboarding({ root: '.', scan })
    expect(result.overallStatus).toBe('partial')
    expect(result.sop.currentStep).toBe('poc')
    expect(result.topActions.length).toBeGreaterThan(0)
    expect(result.warnings.some((warning) => warning.includes('PMF'))).toBe(true)
  })
})
