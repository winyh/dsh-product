import { describe, expect, it } from 'vitest'
import { buildMvpPlan, buildPocPlan, buildProductBrief, buildReleaseReview, reviewPmfRows } from '../src/product.js'
import type { Row } from '../src/types.js'

describe('product delivery methodology', () => {
  it('keeps the brief focused on a product outcome and creates a POC gate', () => {
    const brief = buildProductBrief({
      productName: 'Onboarding Copilot',
      productGoal: '让团队在首次使用当天完成核心设置',
      targetUser: 'SaaS 团队负责人',
      desiredOutcome: '用户完成设置并进入第一次价值行为',
      valueProposition: '减少首次设置中的重复判断和等待',
      successCriteria: ['首日完成核心设置的比例达到预设目标'],
      constraints: ['不改动现有计费系统'],
    })
    expect(brief.decision).toBe('ready-for-poc')
    expect(brief.nonGoals.some((item) => item.includes('需求发现'))).toBe(true)

    const poc = buildPocPlan({
      productName: brief.productName,
      objective: '验证核心建议是否能减少设置时间',
      criticalRisks: [{ id: 'R1', category: 'value', statement: '建议不能减少用户决策时间', impact: 'high', likelihood: 'high', test: 'concierge test', successCriteria: '5 个目标用户中 4 个完成核心设置', failureCriteria: '少于 3 个完成', owner: 'product' }],
      scope: ['人工生成建议', '记录完成时间'],
      nonGoals: ['完整自动化'],
      method: 'concierge workflow',
      duration: '3 days',
      decisionRule: '达到成功阈值进入 MVP，否则调整价值主张',
    })
    expect(poc.criticalRisks).toHaveLength(1)
    expect(poc.markdown).toContain('成功阈值')
  })

  it('flags MVP scope and release blockers', () => {
    const mvp = buildMvpPlan({
      productName: 'Onboarding Copilot',
      targetUser: 'SaaS 团队负责人',
      coreOutcome: '完成第一次价值行为',
      inScope: ['核心设置流程'],
      outOfScope: ['高级报表'],
      userFlow: ['导入资料', '完成设置'],
      acceptanceCriteria: ['用户可以完成核心设置'],
      successMetrics: ['首日核心设置完成率'],
      instrumentation: ['setup_completed'],
      dependencies: [],
      risks: [],
      duration: '2 weeks',
      decisionRule: '达到目标进入 Beta',
    })
    expect(mvp.warnings).toHaveLength(0)
    const release = buildReleaseReview({ productName: 'Onboarding Copilot', version: '0.1.0', targetAudience: '5 个试点团队', checks: [{ name: '核心流程', status: 'pass' }, { name: '回滚方案', status: 'blocker', evidence: '未准备' }] })
    expect(release.status).toBe('blocked')
    expect(release.decision).toBe('hold')
  })

  it('reviews PMF evidence without returning raw rows', () => {
    const rows: Row[] = [
      { user_id: 'u1', segment: 'team', very_disappointed: true, retained: true, paid: true, referred: true, usage_frequency: 5 },
      { user_id: 'u2', segment: 'team', very_disappointed: true, retained: true, paid: true, referred: false, usage_frequency: 4 },
      { user_id: 'u3', segment: 'team', very_disappointed: false, retained: true, paid: false, referred: false, usage_frequency: 2 },
      { user_id: 'u4', segment: 'solo', very_disappointed: true, retained: false, paid: false, referred: false, usage_frequency: 1 },
      { user_id: 'u5', segment: 'solo', very_disappointed: false, retained: false, paid: false, referred: false, usage_frequency: 1 },
    ]
    const review = reviewPmfRows({ productName: 'Onboarding Copilot', source: 'pmf.csv', rows, minSample: 5 })
    expect(review.evidenceSummary.rows).toBe(5)
    expect(review.signals.find((signal) => signal.id === 'value-perception')?.observedRate).toBe(60)
    expect(review.segments).toHaveLength(2)
    expect(review).not.toHaveProperty('rows')
    expect(review.assumptions.some((item) => item.includes('启发式'))).toBe(true)
  })
})
