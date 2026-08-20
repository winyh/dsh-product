import { describe, expect, it } from 'vitest'
import { parseNote } from '../src/markdown.js'
import { buildProductDecisionReview } from '../src/product.js'

describe('buildProductDecisionReview', () => {
  it('proceeds when every gate passes', () => {
    const review = buildProductDecisionReview({
      productName: 'Example',
      stage: 'poc',
      gates: [{ id: 'value', label: '核心价值', status: 'pass', evidence: '8/10 用户完成核心任务', threshold: '至少 6/10' }],
    })

    expect(review.decision).toBe('proceed')
    expect(review.nextStage).toBe('mvp')
    expect(review.evidenceSummary.pass).toBe(1)
  })

  it('iterates on non-blocking failures or warnings', () => {
    const review = buildProductDecisionReview({
      productName: 'Example',
      stage: 'mvp',
      gates: [
        { id: 'retention', label: '留存', status: 'fail', evidence: '低于目标', blocking: false },
        { id: 'quality', label: '质量', status: 'warning', evidence: '偶发错误' },
      ],
    })

    expect(review.decision).toBe('iterate')
    expect(review.nextStage).toBeUndefined()
  })

  it('holds when evidence is missing', () => {
    const review = buildProductDecisionReview({
      productName: 'Example',
      stage: 'strategy',
      gates: [{ id: 'demand', label: '需求证据', status: 'missing', threshold: '至少 5 个目标用户完成验证' }],
    })

    expect(review.decision).toBe('hold')
    expect(review.nextActions[0]).toContain('补齐证据')
  })

  it('abandons only on an explicit blocking failure', () => {
    const review = buildProductDecisionReview({
      productName: 'Example',
      stage: 'poc',
      gates: [{ id: 'technical', label: '关键技术可行性', status: 'fail', evidence: '核心约束无法满足', blocking: true }],
    })

    expect(review.decision).toBe('abandon')
    expect(review.nextActions[0]).toContain('记录被证伪')
  })

  it('scales only when scale readiness is explicit', () => {
    const review = buildProductDecisionReview({
      productName: 'Example',
      stage: 'pmf',
      scaleReady: true,
      gates: [{ id: 'pmf', label: 'PMF 交叉证据', status: 'pass', evidence: '价值、留存和付费信号一致' }],
    })

    expect(review.decision).toBe('scale')
    expect(review.nextStage).toBe('growth-handoff')
  })

  it('does not trust a pass gate without evidence', () => {
    const review = buildProductDecisionReview({
      productName: 'Example',
      stage: 'beta',
      gates: [{ id: 'release', label: '发布准备度', status: 'pass' }],
    })

    expect(review.decision).toBe('hold')
    expect(review.evidenceSummary.missing).toBe(1)
  })
})

describe('decision-review Markdown detection', () => {
  it('recognizes an explicit decision-review artifact', () => {
    const note = parseNote('decision.md', '---\ntype: decision-review\n---\n# 产品决策')
    expect(note.artifactType).toBe('decision-review')
  })
})
