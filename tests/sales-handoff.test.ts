import { describe, expect, it } from 'vitest'
import { buildProductSalesHandoff } from '../src/product.js'

describe('product to sales handoff', () => {
  it('requires product evidence and commercial context before ready status', () => {
    const handoff = buildProductSalesHandoff({
      productName: 'Example',
      productDecision: 'proceed',
      targetBuyer: '运营负责人',
      customerProblem: '交付过程不可追踪',
      desiredOutcome: '每周能定位阻塞',
      valueEvidence: ['3 个试点团队完成复盘'],
      proofPoints: ['阻塞定位时间从 2 天降到 2 小时'],
      requiredCapabilities: ['导入现有数据'],
      implementationConstraints: ['不改 CRM'],
      commercialContext: ['dsh-business：报价需遵守已批准价格底线'],
      commercialQuestions: ['确认付款周期'],
      nextCustomerAction: '客户确认试点范围和评审日期',
      source: 'pmf-review.md',
    })

    expect(handoff.status).toBe('ready')
    expect(handoff.artifactType).toBe('product-sales-handoff')
    expect(handoff.handoffTo).toBe('dsh-sales')
    expect(handoff.markdown).toContain('dsh-business')
  })

  it('blocks an incomplete commercial handoff without hiding the gap', () => {
    const handoff = buildProductSalesHandoff({
      productName: 'Example',
      productDecision: 'scale',
      targetBuyer: '运营负责人',
      customerProblem: '问题',
      desiredOutcome: '结果',
      valueEvidence: [],
      proofPoints: [],
      requiredCapabilities: [],
      implementationConstraints: [],
      commercialContext: [],
      commercialQuestions: [],
      nextCustomerAction: '',
    })

    expect(handoff.status).toBe('partial')
    expect(handoff.warnings.length).toBeGreaterThan(0)
  })
})
