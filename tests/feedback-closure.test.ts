import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { attachArtifactMetadata } from '../src/artifacts.js'
import { closeProductFeedback } from '../src/feedback-closure.js'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-22T12:00:00Z')) })
afterEach(() => vi.useRealTimers())
const input = { initiativeId: 'demo', action: '修复导出并复验', owner: '产品负责人', dueDate: '2026-09-30', status: 'verified', evidence: 'recheck.md',
  verificationJson: JSON.stringify({ method: '重复客户原失败步骤', source: 'recheck.md', observedAt: '2026-09-22T11:00:00Z', result: 'passed' }) }
function source(changes: Record<string, unknown> = {}) {
  return attachArtifactMetadata({ artifactType: 'sales-feedback-handoff', generatedAt: '2026-09-22T10:00:00Z',
    handoffFrom: 'dsh-sales', handoffTo: 'dsh-product', feedback: [{ reason: '导出失败', count: 2 }], ...changes }, { staleAfterDays: 30 })
}
it('returns verification to the original sales loop without claiming business impact', () => {
  const result = closeProductFeedback(source(), input)
  expect(result.status).toBe('verified')
  expect(result.handoffTo).toBe('dsh-sales')
  expect(result.businessImpact).toBe('not-measured')
})
it('blocks wrong targets, unsupported types, stale evidence and failed tools', () => {
  for (const value of [source({ handoffTo: 'dsh-idea' }), source({ artifactType: 'pricing' }),
    source({ generatedAt: '2026-08-01', staleAfter: '2026-08-31' }), { ok: false, data: source() }]) {
    expect(closeProductFeedback(value, input).status).toBe('blocked')
  }
})
it('cannot verify or implement merely by changing a status', () => {
  expect(closeProductFeedback(source(), { ...input, evidence: '' }).status).toBe('partial')
  expect(closeProductFeedback(source(), { ...input, verificationJson: undefined }).status).toBe('partial')
  expect(closeProductFeedback(source(), { ...input, status: 'implemented', evidence: '' }).status).toBe('partial')
  expect(closeProductFeedback(source(), { ...input, verificationJson: input.verificationJson.replace('passed', 'failed') }).status).toBe('partial')
  expect(closeProductFeedback(source(), { ...input, verificationJson: input.verificationJson.replace('11:00', '09:00') }).status).toBe('partial')
  expect(closeProductFeedback(source(), { ...input, owner: ' ' }).status).toBe('blocked')
})
