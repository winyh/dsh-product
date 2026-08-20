import { numberValue, stringValue } from './data.js'
import { listValue, markdownList } from './markdown.js'
import type {
  CheckStatus,
  DecisionGateStatus,
  GrowthHandoff,
  MvpPlan,
  ProductDecision,
  ProductDecisionGate,
  ProductDecisionReview,
  PmfReview,
  PmfSegment,
  PmfSignal,
  PocPlan,
  PocRisk,
  ProductBrief,
  ProductBriefInput,
  ProductStage,
  ReleaseCheck,
  ReleaseReview,
  Row,
} from './types.js'

function yaml(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => String(item).replace(/]/g, '\\]')).join(', ')}]`
  if (value === undefined || value === null) return ''
  return String(value).replace(/\r?\n/g, ' ')
}

function arrayInput(value: string | undefined, label: string): string[] {
  try { return listValue(value) } catch (error) { throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`) }
}

function artifactHeader(type: string, title: string, status: string, extra: Record<string, unknown> = {}): string {
  const lines = ['---', `type: ${type}`, `title: ${title}`, `status: ${status}`]
  for (const [key, value] of Object.entries(extra)) lines.push(`${key}: ${yaml(value)}`)
  lines.push('---', '')
  return lines.join('\n')
}

function parseEnvelope(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value)
  const data = typeof parsed === 'object' && parsed !== null && 'data' in parsed ? (parsed as { data: unknown }).data : parsed
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('Expected a JSON object or a dsh-product result envelope.')
  return data as Record<string, unknown>
}

export function buildProductBrief(input: ProductBriefInput): ProductBrief {
  const warnings: string[] = []
  if (input.successCriteria.length === 0) warnings.push('No success criteria supplied; the POC gate cannot be evaluated yet.')
  if (!input.valueProposition.trim()) warnings.push('Value proposition is empty; keep it as a hypothesis until the product strategy is clearer.')
  const decision = input.productGoal.trim() && input.targetUser.trim() && input.desiredOutcome.trim() && input.valueProposition.trim() && input.successCriteria.length > 0
    ? 'ready-for-poc'
    : 'needs-strategy-clarification'
  const nonGoals = ['不重复开展需求发现；机会证据由 dsh-idea 或用户提供。', '不在 POC 前承诺完整产品范围。']
  const nextActions = decision === 'ready-for-poc'
    ? ['列出必须证明的技术、工作流和价值风险。', '为最高风险建立 POC 计划，并写明成功/失败阈值。']
    : ['补齐目标、价值主张和可观察成功标准，再进入 POC。']
  const brief: ProductBrief = {
    ...input,
    generatedAt: new Date().toISOString(),
    artifactType: 'product-brief',
    stage: input.stage ?? 'strategy',
    nonGoals,
    decision,
    warnings,
    nextActions,
    markdown: '',
  }
  brief.markdown = [
    artifactHeader('product-brief', input.productName, decision, { owner: input.owner, stage: brief.stage, source: input.source }),
    `# ${input.productName} 产品 Brief`,
    '',
    '## 产品目标',
    input.productGoal,
    '',
    '## 目标用户与结果',
    `- 目标用户：${input.targetUser}`,
    `- 期望结果：${input.desiredOutcome}`,
    '',
    '## 价值主张',
    input.valueProposition,
    '',
    '## 成功标准',
    markdownList(input.successCriteria),
    '',
    '## 约束',
    markdownList(input.constraints),
    '',
    '## 非目标',
    markdownList(nonGoals),
    '',
    '## 下一步',
    markdownList(nextActions),
    '',
  ].join('\n')
  return brief
}

export function buildPocPlan(input: {
  productName: string
  objective: string
  criticalRisks: PocRisk[]
  scope: string[]
  nonGoals: string[]
  method: string
  duration: string
  owner?: string
  decisionRule: string
}): PocPlan {
  const warnings: string[] = []
  if (input.criticalRisks.length === 0) warnings.push('No critical risk supplied; a POC without a falsifiable risk is likely to become an unfocused prototype.')
  if (!input.decisionRule.trim()) warnings.push('Decision rule is empty; define continue, revise or stop conditions before starting.')
  const nextActions = input.criticalRisks.length > 0
    ? ['Run the smallest test for the highest impact × likelihood risk.', 'Record raw evidence, threshold result and the decision date.', 'Only expand scope after the POC gate is passed.']
    : ['Identify the riskiest assumption before building a prototype.']
  const plan: PocPlan = {
    generatedAt: new Date().toISOString(),
    artifactType: 'poc-plan',
    productName: input.productName,
    objective: input.objective,
    criticalRisks: input.criticalRisks,
    scope: input.scope,
    nonGoals: input.nonGoals,
    method: input.method,
    duration: input.duration,
    owner: input.owner,
    decisionRule: input.decisionRule,
    warnings,
    nextActions,
    markdown: '',
  }
  plan.markdown = [
    artifactHeader('poc-plan', `${input.productName} POC`, 'draft', { owner: input.owner, stage: 'poc' }),
    `# ${input.productName} POC 计划`,
    '',
    '## POC 目标',
    input.objective,
    '',
    '## 关键风险',
    input.criticalRisks.length > 0
      ? input.criticalRisks.map((risk) => `### ${risk.id}｜${risk.category}\n- 风险：${risk.statement}\n- 影响/可能性：${risk.impact} / ${risk.likelihood}\n- 测试：${risk.test}\n- 成功阈值：${risk.successCriteria}\n- 失败阈值：${risk.failureCriteria}`).join('\n\n')
      : '- 暂无；先补齐风险。',
    '',
    '## 范围',
    markdownList(input.scope),
    '',
    '## 非目标',
    markdownList(input.nonGoals),
    '',
    '## 方法与周期',
    `- 方法：${input.method}`,
    `- 周期：${input.duration}`,
    `- 负责人：${input.owner ?? '待指定'}`,
    '',
    '## 决策规则',
    input.decisionRule || '待补齐',
    '',
    '## 下一步',
    markdownList(nextActions),
    '',
  ].join('\n')
  return plan
}

export function buildMvpPlan(input: {
  productName: string
  targetUser: string
  coreOutcome: string
  inScope: string[]
  outOfScope: string[]
  userFlow: string[]
  acceptanceCriteria: string[]
  successMetrics: string[]
  instrumentation: string[]
  dependencies: string[]
  risks: string[]
  owner?: string
  duration: string
  decisionRule: string
}): MvpPlan {
  const warnings: string[] = []
  if (input.inScope.length === 0) warnings.push('MVP has no in-scope items; it is not ready for delivery planning.')
  if (input.outOfScope.length === 0) warnings.push('MVP has no explicit non-goals; scope creep risk is high.')
  if (input.acceptanceCriteria.length === 0) warnings.push('No acceptance criteria supplied; engineering and QA cannot share a finish line.')
  if (input.successMetrics.length === 0) warnings.push('No success metric supplied; launch learning cannot be evaluated.')
  const nextActions = warnings.length === 0
    ? ['Review the core flow with design and engineering.', 'Confirm instrumentation before implementation.', 'Set the beta audience and decision date.']
    : ['Resolve the highest-risk missing MVP field before committing delivery capacity.']
  const plan: MvpPlan = {
    generatedAt: new Date().toISOString(),
    artifactType: 'mvp-plan',
    ...input,
    warnings,
    nextActions,
    markdown: '',
  }
  plan.markdown = [
    artifactHeader('mvp-plan', `${input.productName} MVP`, 'draft', { owner: input.owner, stage: 'mvp' }),
    `# ${input.productName} MVP 计划`,
    '',
    '## 核心结果',
    `- 目标用户：${input.targetUser}`,
    `- 核心结果：${input.coreOutcome}`,
    '',
    '## MVP 范围',
    markdownList(input.inScope),
    '',
    '## 明确不做',
    markdownList(input.outOfScope),
    '',
    '## 用户流程',
    input.userFlow.length > 0 ? input.userFlow.map((step, index) => `${index + 1}. ${step}`).join('\n') : '- 暂无',
    '',
    '## 验收标准',
    markdownList(input.acceptanceCriteria),
    '',
    '## 成功指标与埋点',
    '**成功指标**',
    markdownList(input.successMetrics),
    '',
    '**埋点**',
    markdownList(input.instrumentation),
    '',
    '## 依赖与风险',
    '**依赖**',
    markdownList(input.dependencies),
    '',
    '**风险**',
    markdownList(input.risks),
    '',
    '## 周期与决策规则',
    `- 周期：${input.duration}`,
    `- 决策规则：${input.decisionRule || '待补齐'}`,
    '',
    '## 下一步',
    markdownList(nextActions),
    '',
  ].join('\n')
  return plan
}

export function buildPrd(mvp: MvpPlan): { artifactType: 'prd'; productName: string; markdown: string; warnings: string[]; nextActions: string[] } {
  const warnings = [...mvp.warnings]
  const nextActions = ['完成设计评审和技术拆分。', '将验收标准转成测试用例。', '上线前回填真实结果，不把计划值当成事实。']
  const markdown = [
    artifactHeader('prd', `${mvp.productName} PRD`, 'draft', { owner: mvp.owner, stage: 'mvp' }),
    `# ${mvp.productName} PRD`,
    '',
    '## 背景与目标',
    `- 目标用户：${mvp.targetUser}`,
    `- 核心结果：${mvp.coreOutcome}`,
    '',
    '## 用户流程',
    mvp.userFlow.length > 0 ? mvp.userFlow.map((step, index) => `${index + 1}. ${step}`).join('\n') : '- 暂无',
    '',
    '## 功能范围',
    '**本期包含**',
    markdownList(mvp.inScope),
    '',
    '**本期不包含**',
    markdownList(mvp.outOfScope),
    '',
    '## 验收标准',
    markdownList(mvp.acceptanceCriteria),
    '',
    '## 数据与成功指标',
    markdownList([...mvp.successMetrics, ...mvp.instrumentation.map((item) => `埋点：${item}`)]),
    '',
    '## 依赖、风险与发布决策',
    `- 依赖：${mvp.dependencies.join('；') || '暂无'}`,
    `- 风险：${mvp.risks.join('；') || '暂无'}`,
    `- 决策规则：${mvp.decisionRule || '待补齐'}`,
    '',
    '## 交付检查',
    markdownList(nextActions),
    '',
  ].join('\n')
  return { artifactType: 'prd', productName: mvp.productName, markdown, warnings, nextActions }
}

export function buildReleaseReview(input: {
  productName: string
  version: string
  targetAudience: string
  owner?: string
  launchDate?: string
  checks: ReleaseCheck[]
}): ReleaseReview {
  const blockers = input.checks.filter((check) => check.status === 'blocker' || check.blocker).map((check) => check.name)
  const warnings = input.checks.filter((check) => check.status === 'warning' || check.status === 'not-checked').map((check) => `${check.name}: ${check.evidence ?? '缺少证据'}`)
  const status = blockers.length > 0 ? 'blocked' : input.checks.length > 0 && input.checks.every((check) => check.status === 'pass') ? 'ready' : 'partial'
  const decision = status === 'ready' ? 'release' : status === 'partial' ? 'release-with-conditions' : 'hold'
  const nextActions = blockers.length > 0
    ? blockers.map((item) => `解除发布阻塞项：${item}`)
    : warnings.length > 0 ? ['补齐带条件发布项的证据和负责人。', '明确上线后的回滚、反馈和观测窗口。'] : ['记录上线版本、目标人群和基线指标。', '进入 Beta/PMF 证据收集。']
  const review: ReleaseReview = {
    generatedAt: new Date().toISOString(),
    artifactType: 'release-review',
    productName: input.productName,
    version: input.version,
    targetAudience: input.targetAudience,
    owner: input.owner,
    launchDate: input.launchDate,
    status,
    checks: input.checks,
    blockers,
    warnings,
    decision,
    nextActions,
    markdown: '',
  }
  review.markdown = [
    artifactHeader('release-review', `${input.productName} ${input.version}`, status, { owner: input.owner, stage: 'beta', launchDate: input.launchDate }),
    `# ${input.productName} ${input.version} 发布检查`,
    '',
    `- 目标人群：${input.targetAudience}`,
    `- 决策：${decision}`,
    '',
    '## 检查项',
    input.checks.length > 0 ? input.checks.map((check) => `- [${check.status === 'pass' ? 'x' : ' '}] ${check.name}：${check.evidence ?? '缺少证据'}`).join('\n') : '- 暂无检查项',
    '',
    '## 阻塞项',
    markdownList(blockers),
    '',
    '## 下一步',
    markdownList(nextActions),
    '',
  ].join('\n')
  return review
}

function boolValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value > 0
  if (typeof value === 'string') {
    const lower = value.trim().toLowerCase()
    if (['true', 'yes', 'y', '1', '是', '有', 'paid', 'retained', 'active'].includes(lower)) return true
    if (['false', 'no', 'n', '0', '否', '无', 'unpaid', 'churned', 'inactive'].includes(lower)) return false
  }
  return undefined
}

function rateFromRows(rows: Row[], field: string | undefined): number | null {
  if (!field) return null
  const values = rows.map((row) => row[field]).filter((value) => value !== undefined && value !== null && value !== '')
  if (values.length === 0) return null
  const bools = values.map(boolValue)
  if (bools.every((value) => value !== undefined)) return (bools.filter((value) => value).length / values.length) * 100
  const nums = values.flatMap((value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return [value > 1 ? value / 100 : value]
    if (typeof value === 'string' && Number.isFinite(Number(value))) {
      const number = Number(value)
      return [number > 1 ? number / 100 : number]
    }
    return []
  })
  return nums.length > 0 ? (nums.reduce((sum, value) => sum + value, 0) / nums.length) * 100 : null
}

function findField(rows: Row[], requested: string | undefined, candidates: string[]): string | undefined {
  if (requested && rows.some((row) => Object.prototype.hasOwnProperty.call(row, requested))) return requested
  const keys = rows.flatMap((row) => Object.keys(row))
  return candidates.find((candidate) => keys.some((key) => key.toLowerCase() === candidate.toLowerCase()))
}

function segmentRows(rows: Row[], field: string | undefined): Array<[string, Row[]]> {
  if (!field) return [['all', rows]]
  const groups = new Map<string, Row[]>()
  for (const row of rows) {
    const key = stringValue(row, field) ?? 'unknown'
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.entries()]
}

export function reviewPmfRows(input: {
  productName: string
  source: string
  rows: Row[]
  segmentField?: string
  valueField?: string
  retentionField?: string
  paidField?: string
  referralField?: string
  usageField?: string
  minSample?: number
}): PmfReview {
  const minSample = input.minSample ?? 5
  const valueField = findField(input.rows, input.valueField, ['very_disappointed', 'veryDisappointed', 'would_miss', 'wouldMiss', 'value_signal', 'valueSignal', '价值感知', '非常失望'])
  const retentionField = findField(input.rows, input.retentionField, ['retained', 'retention', 'retention_rate', 'retentionRate', '留存'])
  const paidField = findField(input.rows, input.paidField, ['paid', 'renewed', 'converted', 'purchase', '付费', '续费', '成交'])
  const referralField = findField(input.rows, input.referralField, ['referred', 'referral', 'recommended', 'recommendation', '推荐'])
  const usageField = findField(input.rows, input.usageField, ['usage_frequency', 'usageFrequency', 'active_days', 'activeDays', 'sessions', '使用频率', '活跃天数'])
  const segmentField = input.segmentField ?? findField(input.rows, undefined, ['segment', 'cohort', 'persona', 'user_segment', '分群', '用户类型'])
  const detected = [valueField, retentionField, paidField, referralField, usageField, segmentField].filter((field): field is string => Boolean(field))
  const signals: PmfSignal[] = []
  const valueRate = rateFromRows(input.rows, valueField)
  const retentionRate = rateFromRows(input.rows, retentionField)
  const paidRate = rateFromRows(input.rows, paidField)
  const referralRate = rateFromRows(input.rows, referralField)
  const usageValues = usageField ? input.rows.flatMap((row) => {
    const value = numberValue(row, usageField)
    return value === undefined ? [] : [value]
  }) : []
  const addRateSignal = (id: string, label: string, field: string | undefined, rate: number | null, caveat?: string): void => {
    signals.push({
      id,
      label,
      status: rate === null ? 'missing' : input.rows.length < minSample ? 'partial' : 'ready',
      field,
      sampleSize: input.rows.length,
      observedRate: rate,
      evidence: rate === null ? '没有检测到可计算字段。' : `观测到 ${rate.toFixed(1)}% 的记录满足该信号。`,
      caveat,
    })
  }
  addRateSignal('value-perception', '价值感知', valueField, valueRate, '“非常失望/愿意失去”等 PMF 问法只是启发式信号，不能单独证明 PMF。')
  addRateSignal('retention', '持续使用/留存', retentionField, retentionRate, '留存必须结合产品周期、用户分群和时间窗口解读。')
  addRateSignal('commercial', '付费/续费', paidField, paidRate, '成交或续费是商业证据，但单笔交易不能代表可重复的产品价值。')
  addRateSignal('referral', '推荐/传播', referralField, referralRate, '推荐行为要区分主动推荐、被动分享和激励带来的传播。')
  signals.push({
    id: 'usage',
    label: '使用强度',
    status: usageValues.length === 0 ? 'missing' : input.rows.length < minSample ? 'partial' : 'ready',
    field: usageField,
    sampleSize: usageValues.length,
    observedValue: usageValues.length > 0 ? Number((usageValues.reduce((sum, value) => sum + value, 0) / usageValues.length).toFixed(2)) : null,
    evidence: usageValues.length > 0 ? `平均使用强度为 ${((usageValues.reduce((sum, value) => sum + value, 0) / usageValues.length)).toFixed(2)}。` : '没有检测到使用强度字段。',
    caveat: '使用次数本身不等于用户获得了价值，应和核心结果一起看。',
  })
  const segments: PmfSegment[] = segmentRows(input.rows, segmentField).map(([segment, rows]) => {
    const rates = { valueRate: rateFromRows(rows, valueField), retentionRate: rateFromRows(rows, retentionField), paidRate: rateFromRows(rows, paidField), referralRate: rateFromRows(rows, referralField) }
    const signalCount = Object.values(rates).filter((rate) => rate !== null).length + (usageField && rows.some((row) => numberValue(row, usageField) !== undefined) ? 1 : 0)
    const notes: string[] = []
    if (rows.length < minSample) notes.push(`样本量 ${rows.length} 小于配置的参考值 ${minSample}，不宜做稳定判断。`)
    if (rates.valueRate !== null && rates.valueRate < 40) notes.push('价值感知低于 40% 启发式参考线，优先核查用户分群和价值兑现。')
    return { segment, sampleSize: rows.length, ...rates, signalCount, status: signalCount >= 3 && rows.length >= minSample ? 'ready' : signalCount > 0 ? 'partial' : 'missing', notes }
  })
  const available = signals.filter((signal) => signal.status !== 'missing').length
  const coreConvergence = valueRate !== null && (retentionRate !== null || paidRate !== null)
  const status = input.rows.length === 0 ? 'blocked' : coreConvergence && available >= 3 ? 'ready' : available >= 2 ? 'partial' : 'blocked'
  const decision = status === 'ready' ? 'continue' : status === 'partial' ? 'iterate' : input.rows.length === 0 ? 'needs-more-evidence' : 'pause'
  const warnings: string[] = []
  if (input.rows.length === 0) warnings.push('PMF 数据集没有记录，无法判断。')
  if (input.rows.length > 0 && input.rows.length < minSample) warnings.push(`样本量 ${input.rows.length} 小于配置的参考值 ${minSample}；该参考值不是行业基准。`)
  if (!valueField) warnings.push('缺少价值感知字段，例如 very_disappointed、would_miss 或 value_signal。')
  if (!retentionField && !paidField) warnings.push('至少补充留存或付费/续费字段，才能形成价值之外的交叉证据。')
  const nextActions = status === 'ready'
    ? ['按分群复核价值感知、留存和商业行为是否一致。', '将 PMF 证据转为增长交接，明确主指标和护栏指标。']
    : status === 'partial'
      ? ['补齐缺失信号，并按核心用户分群重复观察。', '把价值主张或核心流程转成下一轮产品迭代假设。']
      : ['先补充真实使用、留存、付费或推荐证据，再做 PMF 判断。']
  const review: PmfReview = {
    generatedAt: new Date().toISOString(),
    artifactType: 'pmf-review',
    productName: input.productName,
    source: input.source,
    status,
    decision,
    evidenceSummary: { rows: input.rows.length, segments: segments.length, fieldsDetected: detected, convergence: coreConvergence ? '价值信号与留存/商业信号有初步交叉证据。' : '尚未形成价值信号与留存/商业信号的交叉证据。' },
    signals,
    segments,
    warnings,
    assumptions: ['40% 只作为 PMF Survey 的启发式参考线，不是产品市场匹配的判定标准。', '缺少时间窗口、分群定义或样本抽样说明时，结果只能作为方向性证据。'],
    nextActions,
    markdown: '',
  }
  review.markdown = renderPmfMarkdown(review)
  return review
}

function renderPmfMarkdown(review: PmfReview): string {
  return [
    artifactHeader('pmf-review', `${review.productName} PMF Review`, review.status, { stage: 'pmf', source: review.source }),
    `# ${review.productName} PMF 复盘`,
    '',
    `- 状态：${review.status}`,
    `- 决策：${review.decision}`,
    `- 数据源：${review.source}`,
    `- 样本：${review.evidenceSummary.rows}`,
    `- 证据收敛：${review.evidenceSummary.convergence}`,
    '',
    '## 信号',
    review.signals.map((signal) => `- **${signal.label}**（${signal.status}）：${signal.evidence}${signal.caveat ? ` 注意：${signal.caveat}` : ''}`).join('\n'),
    '',
    '## 分群',
    review.segments.length > 0 ? review.segments.map((segment) => `- **${segment.segment}**（n=${segment.sampleSize}，${segment.status}）：价值 ${segment.valueRate ?? '-'}%，留存 ${segment.retentionRate ?? '-'}%，付费/续费 ${segment.paidRate ?? '-'}%。${segment.notes.join(' ')}`).join('\n') : '- 暂无',
    '',
    '## 限制与假设',
    markdownList(review.assumptions),
    '',
    '## 下一步',
    markdownList(review.nextActions),
    '',
  ].join('\n')
}

const nextStageByStage: Partial<Record<ProductStage, ProductStage>> = {
  handoff: 'strategy',
  strategy: 'poc',
  poc: 'mvp',
  mvp: 'beta',
  beta: 'pmf',
  pmf: 'growth-handoff',
  iteration: 'iteration',
}

function decisionLabel(decision: ProductDecision): string {
  return {
    proceed: '更进一步',
    iterate: '调整后继续验证',
    hold: '暂缓决策',
    abandon: '放弃或关闭当前方向',
    scale: '扩大投入',
  }[decision]
}

function gateEvidence(gate: ProductDecisionGate): string {
  return gate.evidence?.trim() || '未提供证据'
}

function decisionGateStatus(gate: ProductDecisionGate): DecisionGateStatus {
  return gate.status === 'pass' && !gate.evidence?.trim() ? 'missing' : gate.status
}

export function buildProductDecisionReview(input: {
  productName: string
  stage: ProductStage
  gates: ProductDecisionGate[]
  decisionDate?: string
  scaleReady?: boolean
}): ProductDecisionReview {
  const scaleReady = input.scaleReady === true
  const gates = input.gates.map((gate) => ({ ...gate, status: decisionGateStatus(gate) }))
  const evidenceSummary = {
    total: gates.length,
    pass: gates.filter((gate) => gate.status === 'pass').length,
    warning: gates.filter((gate) => gate.status === 'warning').length,
    fail: gates.filter((gate) => gate.status === 'fail').length,
    missing: gates.filter((gate) => gate.status === 'missing').length,
    blockingFailures: gates.filter((gate) => gate.status === 'fail' && gate.blocking === true).length,
  }
  const warnings: string[] = []
  if (gates.length === 0) warnings.push('没有提供决策门；证据不足，不能判断继续或放弃。')
  const missingEvidence = input.gates.filter((gate) => gate.status !== 'missing' && !gate.evidence?.trim()).map((gate) => gate.label)
  if (missingEvidence.length > 0) warnings.push(`以下决策门缺少证据，已按 missing 处理：${missingEvidence.join('、')}`)

  let decision: ProductDecision
  if (evidenceSummary.blockingFailures > 0) decision = 'abandon'
  else if (evidenceSummary.fail > 0 || evidenceSummary.warning > 0) decision = 'iterate'
  else if (evidenceSummary.missing > 0 || evidenceSummary.total === 0) decision = 'hold'
  else if (scaleReady) decision = 'scale'
  else decision = 'proceed'

  const nextStage = decision === 'proceed' ? nextStageByStage[input.stage] : decision === 'scale' ? 'growth-handoff' : undefined
  const failed = gates.filter((gate) => gate.status === 'fail')
  const missing = gates.filter((gate) => gate.status === 'missing')
  const cautions = gates.filter((gate) => gate.status === 'warning')
  const reasons = decision === 'abandon'
    ? failed.filter((gate) => gate.blocking === true).map((gate) => `关键失败：${gate.label}；证据：${gateEvidence(gate)}`)
    : decision === 'iterate'
      ? [...failed, ...cautions].map((gate) => `${gate.status === 'fail' ? '失败' : '警告'}：${gate.label}；证据：${gateEvidence(gate)}`)
      : decision === 'hold'
        ? missing.map((gate) => `缺少证据：${gate.label}；需要：${gate.threshold ?? '补充可验证结果'}`)
        : ['所有已提供的决策门均已通过。']
  if (decision === 'scale') reasons.push('已明确标记 scaleReady=true，且所有决策门均通过。')

  const summary = decision === 'abandon'
    ? '存在明确的关键失败证据，不建议继续扩大投入；应记录学习并关闭或重新定义当前方向。'
    : decision === 'iterate'
      ? '已有部分证据，但仍有失败或警告项；先做一轮最小修正和验证，再重新决策。'
      : decision === 'hold'
        ? '证据尚不足以支持继续或放弃，先补齐缺失证据和观测窗口。'
        : decision === 'scale'
          ? '关键决策门全部通过，并满足扩大投入条件；可以在护栏指标下逐步规模化。'
          : `当前阶段的决策门已通过，可以${nextStage ? `进入${nextStage}阶段` : '进入下一轮产品工作'}。`

  const nextActions = decision === 'abandon'
    ? ['记录被证伪的核心假设、失败证据和可复用学习。', '决定关闭当前方向，或回到 dsh-idea 重新定义用户、场景和问题。']
    : decision === 'iterate'
      ? [...failed.map((gate) => `优先修正失败项：${gate.label}。`), ...cautions.map((gate) => `核查警告项：${gate.label}。`), '完成一轮最小修正后，记录新的决策日期并重新运行决策复盘。']
      : decision === 'hold'
        ? [...missing.map((gate) => `补齐证据：${gate.label}${gate.threshold ? `（阈值：${gate.threshold}）` : ''}。`), '在预先设定的观测窗口结束后再做继续或放弃判断。']
        : decision === 'scale'
          ? ['先在受控范围内扩大投入，并持续监控主指标和护栏指标。', '设定下一次规模化复盘日期和回滚条件。']
          : [`进入${nextStage ?? '下一轮'}，只扩大已通过验证的范围。`, '设定下一次决策日期，并继续记录成功、失败和护栏证据。']

  const assumptions = [
    '未标记 blocking=true 的失败默认进入 iterate，不自动判定为放弃。',
    '缺少证据的决策门按 missing 处理，missing 会导致 hold，而不是直接放弃。',
    '只有所有决策门通过且显式提供 scaleReady=true 时，才输出 scale。',
  ]
  const review: ProductDecisionReview = {
    generatedAt: new Date().toISOString(),
    artifactType: 'decision-review',
    productName: input.productName,
    stage: input.stage,
    decisionDate: input.decisionDate,
    decision,
    nextStage,
    scaleReady,
    gates,
    evidenceSummary,
    summary,
    reasons,
    warnings,
    assumptions,
    nextActions,
    markdown: '',
  }
  review.markdown = [
    artifactHeader('decision-review', `${input.productName} 产品决策`, decision, { stage: input.stage, decisionDate: input.decisionDate }),
    `# ${input.productName} 产品决策复盘`,
    '',
    `- 当前阶段：${input.stage}`,
    `- 决策：${decisionLabel(decision)}（${decision}）`,
    `- 决策日期：${input.decisionDate ?? '待补充'}`,
    `- 下一阶段：${nextStage ?? '暂不进入下一阶段'}`,
    '',
    '## 结论',
    summary,
    '',
    '## 决策门',
    '| 决策门 | 状态 | 阻断 | 阈值 | 证据 |',
    '| --- | --- | --- | --- | --- |',
    gates.length > 0 ? gates.map((gate) => `| ${gate.label} | ${gate.status} | ${gate.blocking === true ? '是' : '否'} | ${gate.threshold ?? '—'} | ${gateEvidence(gate)} |`).join('\n') : '| 暂无 | missing | — | — | 未提供 |',
    '',
    '## 判断依据',
    markdownList(reasons),
    '',
    '## 假设与限制',
    markdownList(assumptions),
    '',
    '## 下一步',
    markdownList(nextActions),
    '',
  ].join('\n')
  return review
}

export function buildGrowthHandoff(input: {
  productName: string
  productOutcome: string
  evidence: string[]
  primaryMetric: string
  guardrails: string[]
  openQuestions: string[]
  recommendedActions: string[]
  owner?: string
  source?: string
  pmf?: PmfReview
}): GrowthHandoff {
  const warnings: string[] = []
  if (!input.primaryMetric.trim()) warnings.push('No primary growth metric supplied; handoff is incomplete.')
  if (input.evidence.length === 0) warnings.push('No product evidence supplied; do not treat the handoff as a PMF claim.')
  const nextActions = warnings.length > 0
    ? ['补齐主指标和产品证据后再交接。']
    : ['由增长负责人确认数据口径、分群和时间窗口。', '把产品未决问题转成增长实验或产品迭代任务。']
  const handoff: GrowthHandoff = {
    generatedAt: new Date().toISOString(),
    artifactType: 'growth-handoff',
    productName: input.productName,
    productOutcome: input.productOutcome,
    evidence: input.evidence,
    primaryMetric: input.primaryMetric,
    guardrails: input.guardrails,
    openQuestions: input.openQuestions,
    recommendedActions: input.recommendedActions,
    owner: input.owner,
    source: input.source,
    warnings,
    nextActions,
    markdown: '',
  }
  handoff.markdown = [
    artifactHeader('growth-handoff', `${input.productName} Growth Handoff`, warnings.length === 0 ? 'ready' : 'partial', { owner: input.owner, stage: 'growth-handoff', source: input.source }),
    `# ${input.productName} 增长交接`,
    '',
    '## 产品结果',
    input.productOutcome,
    '',
    '## 已有证据',
    markdownList(input.evidence),
    '',
    '## 增长测量',
    `- 主指标：${input.primaryMetric || '待补齐'}`,
    `- 护栏指标：${input.guardrails.join('；') || '待补齐'}`,
    '',
    '## 未决问题',
    markdownList(input.openQuestions),
    '',
    '## 推荐动作',
    markdownList(input.recommendedActions),
    '',
    '## 交接下一步',
    markdownList(nextActions),
    '',
  ].join('\n')
  return handoff
}

export function mvpFromJson(value: string): MvpPlan {
  const data = parseEnvelope(value)
  if (data.artifactType !== 'mvp-plan' || typeof data.productName !== 'string') throw new Error('mvpJson must contain a product_mvp_plan result.')
  return data as unknown as MvpPlan
}

export function pmfFromJson(value: string): PmfReview {
  const data = parseEnvelope(value)
  if (data.artifactType !== 'pmf-review' || typeof data.productName !== 'string') throw new Error('pmfJson must contain a product_pmf_review result.')
  return data as unknown as PmfReview
}

export function releaseChecksFromJson(value: string): ReleaseCheck[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) throw new Error('checks must be a JSON array.')
  return parsed.map((item, index) => {
    if (typeof item !== 'object' || item === null) throw new Error(`checks[${index}] must be an object.`)
    const record = item as Record<string, unknown>
    const status = String(record.status ?? 'not-checked') as CheckStatus
    if (!['pass', 'warning', 'blocker', 'not-checked'].includes(status)) throw new Error(`checks[${index}].status is invalid.`)
    return { name: String(record.name ?? `check-${index + 1}`), status, evidence: record.evidence ? String(record.evidence) : undefined, owner: record.owner ? String(record.owner) : undefined, blocker: record.blocker === true }
  })
}

export { arrayInput, parseEnvelope }
