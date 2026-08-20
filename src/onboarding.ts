import type { ProductOnboardingDimension, ProductOnboardingResult, ProductSopStep, ProductStage } from './types.js'
import type { ProductVaultScan } from './types.js'

const stages: Array<{ id: ProductStage; label: string; type: string; objective: string; gate: string; tool: string; prompt: string; action: string }> = [
  { id: 'handoff', label: '机会交接', type: 'product-context', objective: '把已确认机会转成产品上下文。', gate: '目标、结果、价值主张和来源可追溯。', tool: 'product_brief', prompt: '把已确认的机会整理为产品 Brief；不要重新做需求发现。', action: '补齐产品目标、目标用户、期望结果和价值主张。' },
  { id: 'strategy', label: '产品策略', type: 'product-brief', objective: '明确产品要交付的核心结果和边界。', gate: '成功标准、约束和非目标明确。', tool: 'product_brief', prompt: '审阅产品 Brief，检查目标、价值、成功标准和非目标。', action: '补齐成功标准和非目标，避免直接进入功能堆叠。' },
  { id: 'poc', label: 'POC', type: 'poc-plan', objective: '先验证最高风险，而不是先做完整产品。', gate: '关键风险有测试方法、成功阈值和失败阈值。', tool: 'product_poc_plan', prompt: '为最高影响 × 可能性风险生成 POC 计划。', action: '列出技术、工作流、价值和合规风险，并选择最小验证。' },
  { id: 'mvp', label: 'MVP', type: 'mvp-plan', objective: '定义最小可交付、可观测的产品范围。', gate: '范围、非目标、流程、验收标准和成功指标齐全。', tool: 'product_mvp_plan', prompt: '将通过 POC 的方向转成 MVP 范围和验收标准。', action: '补齐 MVP in-scope、out-of-scope、验收标准和埋点。' },
  { id: 'beta', label: 'Beta/发布', type: 'release-review', objective: '以受控人群发布并观察真实使用。', gate: '发布检查项有证据、负责人和回滚/反馈机制。', tool: 'product_release_check', prompt: '运行 Beta/发布检查，区分阻塞项和带条件项。', action: '补齐发布检查、观测窗口、反馈入口和回滚条件。' },
  { id: 'pmf', label: 'PMF', type: 'pmf-review', objective: '判断价值、使用、留存、商业和推荐证据是否收敛。', gate: '至少形成价值信号与留存/商业信号的交叉证据。', tool: 'product_pmf_review', prompt: '按分群复盘 PMF 证据，不输出单一分数。', action: '补充价值感知、使用、留存、付费/续费或推荐数据。' },
  { id: 'iteration', label: '版本迭代', type: 'mvp-plan', objective: '把 PMF 缺口转成下一轮产品假设和版本决策。', gate: '问题、证据、迭代目标和决策日期明确。', tool: 'product_review', prompt: '根据当前证据生成下一轮迭代决策。', action: '把最高价值缺口转成一个有验收标准的版本目标。' },
  { id: 'growth-handoff', label: '增长交接', type: 'growth-handoff', objective: '把产品结果和测量口径交给增长运营。', gate: '产品结果、主指标、护栏指标和未决问题齐全。', tool: 'product_growth_handoff', prompt: '生成产品到增长的交接包，交给 dsh-growth。', action: '补齐主指标、护栏指标、证据来源和未决问题。' },
]

function statusFor(count: number, hasArtifact: boolean, hasHealthy: boolean): 'ready' | 'partial' | 'missing' {
  if (hasArtifact && hasHealthy) return 'ready'
  if (count > 0 || hasArtifact) return 'partial'
  return 'missing'
}

export function buildProductOnboarding(options: { root: string; scan: ProductVaultScan }): ProductOnboardingResult {
  const { root, scan } = options
  const dimensions: ProductOnboardingDimension[] = stages.map((stage) => {
    const acceptedTypes = stage.id === 'handoff' ? ['product-context', 'product-brief'] : [stage.type]
    const notes = scan.productNotes.filter((note) => acceptedTypes.includes(note.artifactType))
    const count = notes.length
    const healthy = notes.some((note) => note.reasons.length === 1 && note.reasons[0] === 'healthy')
    const status = statusFor(count, count > 0, healthy)
    const evidence = notes.slice(0, 3).map((note) => `${note.path}（${note.status}）`)
    const missing = status === 'ready' ? [] : [stage.gate]
    return {
      id: stage.id,
      label: stage.label,
      status,
      score: status === 'ready' ? 100 : status === 'partial' ? 50 : 0,
      evidence,
      missing,
      nextAction: status === 'ready' ? `复核 ${stage.label} 的证据是否仍然有效。` : stage.action,
    }
  })
  const current = dimensions.find((dimension) => dimension.status !== 'ready')?.id ?? 'growth-handoff'
  const sop: ProductSopStep[] = stages.map((stage, index) => {
    const dimension = dimensions[index]
    return { id: stage.id, order: index + 1, status: dimension?.status ?? 'missing', objective: stage.objective, gate: stage.gate, tool: stage.tool, prompt: stage.prompt }
  })
  const readyCount = dimensions.filter((dimension) => dimension.status === 'ready').length
  const overallScore = Math.round(dimensions.reduce((sum, dimension) => sum + (dimension.score ?? 0), 0) / dimensions.length)
  const overallStatus = readyCount === dimensions.length ? 'ready' : readyCount > 0 ? 'partial' : 'blocked'
  const topActions = dimensions.filter((dimension) => dimension.status !== 'ready').slice(0, 2).map((dimension) => dimension.nextAction)
  const questions = dimensions.filter((dimension) => dimension.status !== 'ready').slice(0, 3).map((dimension) => `${dimension.label}：${dimension.missing[0] ?? '证据是否存在？'}`)
  const warnings = [...scan.errors]
  if (scan.dataFiles.length === 0) warnings.push('没有发现可能用于 PMF/使用/留存复盘的本地数据文件；可以先完成方法论文档，再补数据。')
  return {
    generatedAt: new Date().toISOString(),
    root,
    overallStatus,
    overallScore,
    sources: { productNotes: scan.productNotes.length, dataFiles: scan.dataFiles, byType: scan.byType, byStatus: scan.byStatus },
    dimensions,
    sop: { currentStep: current, steps: sop },
    topActions,
    questions,
    warnings,
  }
}
