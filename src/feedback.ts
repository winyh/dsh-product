import type { BetaFeedbackImportResult, ProductChangeImpactReview, ProductDecisionLog, ProductDecision, ProductStage } from './types.js'

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).trim()
}

function redact(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[redacted-phone]')
    .replace(/(?:姓名|name)\s*[:：]\s*[^,，;；\n]+/gi, '$1: [redacted-name]')
}

function themesFor(value: string): string[] {
  const themes: string[] = []
  if (/慢|耗时|time|slow|效率/i.test(value)) themes.push('效率')
  if (/错误|失败|bug|error|crash/i.test(value)) themes.push('可靠性')
  if (/难懂|复杂|confus|learn/i.test(value)) themes.push('易用性')
  if (/价格|付费|贵|price|pay/i.test(value)) themes.push('商业')
  return themes.length > 0 ? themes : ['其他']
}

export function buildBetaFeedbackImport(input: { feedback: unknown[]; source?: string }): BetaFeedbackImportResult {
  const warnings: string[] = []
  const records = input.feedback.flatMap((item, index) => {
    if (typeof item !== 'object' || item === null) return []
    const record = item as Record<string, unknown>
    const raw = text(record.text ?? record.feedback ?? record.comment ?? record.content)
    if (!raw) return []
    const redactedText = redact(raw)
    return [{ id: text(record.id) || `feedback-${index + 1}`, ...(text(record.segment) ? { segment: text(record.segment) } : {}), text: redactedText, themes: themesFor(redactedText) }]
  })
  if (records.length < input.feedback.length) warnings.push('部分反馈缺少可分析文本，已跳过。')
  const themeMap = new Map<string, { count: number; examples: string[] }>()
  for (const record of records) for (const theme of record.themes) {
    const current = themeMap.get(theme) ?? { count: 0, examples: [] }
    current.count += 1
    if (current.examples.length < 3) current.examples.push(record.text)
    themeMap.set(theme, current)
  }
  const themes = [...themeMap.entries()].map(([theme, value]) => ({ theme, ...value })).sort((a, b) => b.count - a.count)
  const nextActions = records.length > 0 ? ['按主题抽样核验去标识化结果，再将高频问题带入 product_decision_review。'] : ['补充带文本的 Beta 反馈，再进行主题归纳。']
  const generatedAt = new Date().toISOString()
  const markdown = ['---', 'artifactType: beta-feedback-import', `generatedAt: ${generatedAt}`, ...(input.source ? [`source: ${JSON.stringify(input.source)}`] : []), '---', '# Beta 反馈导入', '', `- 原始行数：${input.feedback.length}`, `- 接受行数：${records.length}`, '- 已去标识化：是', '', '## 主题', ...themes.map((item) => `- ${item.theme}：${item.count}`), '', '## 下一步', ...nextActions.map((item) => `- ${item}`), ''].join('\n')
  return { artifactType: 'beta-feedback-import', generatedAt, ...(input.source ? { source: input.source } : {}), rowsRead: input.feedback.length, rowsAccepted: records.length, records, themes, redacted: true, warnings, nextActions, markdown }
}

function idFor(productName: string, stage: string, generatedAt: string): string {
  return `${productName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'product'}-${stage}-${generatedAt.slice(0, 10)}`
}

export function buildProductDecisionLog(input: { productName: string; stage: ProductStage; decision: ProductDecision; rationale: string; evidence: string[]; owner?: string; nextReviewDate?: string; source?: string }): ProductDecisionLog {
  const generatedAt = new Date().toISOString()
  const warnings = input.evidence.length === 0 ? ['没有提供决策证据；日志不能替代产品决策门。'] : []
  const nextActions = input.nextReviewDate ? [`在 ${input.nextReviewDate} 重新检查证据和决策。`] : ['补充下一次复盘日期和负责人。']
  const artifactId = idFor(input.productName, input.stage, generatedAt)
  const markdown = ['---', 'schemaVersion: "1.0"', 'artifactType: product-decision-log', `artifactId: ${artifactId}`, `generatedAt: ${generatedAt}`, `productName: ${JSON.stringify(input.productName)}`, `stage: ${input.stage}`, `decision: ${input.decision}`, ...(input.owner ? [`owner: ${JSON.stringify(input.owner)}`] : []), ...(input.source ? [`source: ${JSON.stringify(input.source)}`] : []), '---', `# ${input.productName} 产品决策日志`, '', `- 阶段：${input.stage}`, `- 决策：${input.decision}`, `- 理由：${input.rationale || '待补充'}`, '', '## 证据', ...(input.evidence.length > 0 ? input.evidence.map((item) => `- ${item}`) : ['- 缺失']), '', '## 下一步', ...nextActions.map((item) => `- ${item}`), ''].join('\n')
  return { artifactType: 'product-decision-log', schemaVersion: '1.0', artifactId, generatedAt, productName: input.productName, stage: input.stage, decision: input.decision, rationale: input.rationale, evidence: input.evidence, ...(input.owner ? { owner: input.owner } : {}), ...(input.nextReviewDate ? { nextReviewDate: input.nextReviewDate } : {}), ...(input.source ? { source: input.source } : {}), warnings, nextActions, markdown }
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter(Boolean) : []
}

export function buildChangeImpactReview(input: { productName: string; before: Record<string, unknown>; after: Record<string, unknown> }): ProductChangeImpactReview {
  const areas = ['scope', 'requiredCapabilities', 'implementationConstraints', 'successMetrics', 'commercialContext']
  const impacts = areas.map((area) => {
    const before = list(input.before[area])
    const after = list(input.after[area])
    return { area, before, after, added: after.filter((item) => !before.includes(item)), removed: before.filter((item) => !after.includes(item)) }
  }).filter((item) => item.added.length > 0 || item.removed.length > 0)
  const risks = impacts.flatMap((item) => item.removed.length > 0 ? [`${item.area} 删除了 ${item.removed.length} 项，需要确认对交付和销售承诺的影响。`] : [])
  const changed = impacts.length > 0
  const nextActions = changed ? ['让受影响的 handoff 消费者重新审查，再更新产品销售/增长交接。'] : ['没有发现受控字段变化，继续保持当前交接版本。']
  const generatedAt = new Date().toISOString()
  const markdown = ['---', 'schemaVersion: "1.0"', 'artifactType: product-change-impact-review', `generatedAt: ${generatedAt}`, '---', `# ${input.productName} 变更影响审查`, '', `- 是否变化：${changed ? '是' : '否'}`, ...impacts.map((item) => `- ${item.area}：新增 ${item.added.length}，删除 ${item.removed.length}`), '', '## 风险', ...(risks.length > 0 ? risks.map((item) => `- ${item}`) : ['- 未发现删除型风险']), '', '## 下一步', ...nextActions.map((item) => `- ${item}`), ''].join('\n')
  return { artifactType: 'product-change-impact-review', schemaVersion: '1.0', generatedAt, productName: input.productName, changed, impacts, risks, decision: risks.length > 0 ? 'hold' : 'review', warnings: [], nextActions, markdown }
}
