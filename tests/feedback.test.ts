import { describe, expect, it } from 'vitest'
import { buildBetaFeedbackImport, buildChangeImpactReview, buildProductDecisionLog } from '../src/feedback.js'

describe('beta feedback and decision artifacts', () => {
  it('redacts contact identifiers before grouping feedback', () => {
    const result = buildBetaFeedbackImport({ feedback: [{ id: '1', text: '联系 me@example.com，速度太慢' }] })
    expect(result.records[0]?.text).not.toContain('me@example.com')
    expect(result.records[0]?.themes).toContain('效率')
    expect(result.redacted).toBe(true)
  })

  it('creates a versioned decision log and change impact review', () => {
    const log = buildProductDecisionLog({ productName: 'Demo', stage: 'mvp', decision: 'proceed', rationale: '核心任务完成', evidence: ['5/6 users completed'], owner: 'product' })
    expect(log.schemaVersion).toBe('1.0')
    expect(log.artifactId).toContain('demo-mvp')
    const impact = buildChangeImpactReview({ productName: 'Demo', before: { scope: ['core'] }, after: { scope: ['core', 'export'] } })
    expect(impact.changed).toBe(true)
    expect(impact.impacts[0]?.added).toContain('export')
  })
})
