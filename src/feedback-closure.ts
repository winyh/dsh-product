import { reviewArtifact } from './artifacts.js'
import { validDate } from './artifact-integrity.js'
import { asRecord } from './handoff-receive.js'

export interface FeedbackClosureInput {
  initiativeId: string; action: string; owner: string; dueDate?: string
  status: string; evidence?: string; verificationJson?: string
}
export function closeProductFeedback(value: unknown, input: FeedbackClosureInput) {
  const envelope = asRecord(value)
  const source = asRecord(Object.hasOwn(envelope, 'data') ? envelope.data : value)
  const review = reviewArtifact(source)
  const issues = [...review.issues]
  const warnings = [...review.warnings]
  const sourceType = source.artifactType
  if (Object.hasOwn(envelope, 'data') && envelope.ok !== true) issues.push('来源工具调用失败。')
  if (!['sales-feedback-handoff', 'beta-feedback-import'].includes(String(sourceType))) issues.push('只接收标准销售或 Beta 反馈。')
  if (sourceType === 'sales-feedback-handoff' && (source.handoffFrom !== 'dsh-sales' || source.handoffTo !== 'dsh-product')) issues.push('销售反馈必须由 dsh-sales 发给 dsh-product。')
  if (sourceType === 'sales-feedback-handoff' && (!Array.isArray(source.feedback) || !source.feedback.length)) issues.push('没有实际销售反馈，不能标记处理完成。')
  if (sourceType === 'beta-feedback-import' && (!Array.isArray(source.records) || !source.records.length)) issues.push('没有实际 Beta 反馈，不能标记处理完成。')
  if (source.initiativeId && source.initiativeId !== input.initiativeId.trim()) issues.push('initiativeId 与来源不一致。')
  if (!input.initiativeId.trim() || !input.action.trim() || !input.owner.trim()) issues.push('initiativeId、action 和 owner 不能为空。')
  if (!validDate(input.dueDate)) issues.push('必须提供有效 dueDate，才能追踪反馈动作。')
  if (review.status === 'stale' || ['blocked', 'stale'].includes(String(source.status))) issues.push('过期或阻塞的反馈需要重新核验。')
  if (!['open', 'accepted', 'rejected', 'implemented', 'verified'].includes(input.status)) issues.push('未知反馈状态。')
  const needsEvidence = ['rejected', 'implemented', 'verified'].includes(input.status)
  if (needsEvidence && !input.evidence?.trim()) warnings.push('拒绝、实施和验证都需要可追溯 evidence，不能只修改状态。')
  const verification = input.verificationJson ? asRecord(JSON.parse(input.verificationJson) as unknown) : {}
  const verified = typeof verification.method === 'string' && !!verification.method.trim()
    && typeof verification.source === 'string' && !!verification.source.trim()
    && validDate(verification.observedAt) && Date.parse(verification.observedAt) <= Date.now()
    && validDate(source.generatedAt) && Date.parse(verification.observedAt) >= Date.parse(source.generatedAt)
    && verification.result === 'passed'
  if (input.status === 'verified' && !verified) warnings.push('verified 需要反馈生成后完成的复验：method、source、observedAt、result=passed。')
  const status = issues.length ? 'blocked' : review.status !== 'ready'
    || (needsEvidence && !input.evidence?.trim()) || (input.status === 'verified' && !verified) ? 'partial' : input.status
  const nextActions = status === 'verified'
    ? ['向原反馈方回传此工件及 sourceArtifactId，调用对应 handoff_receive 接收回执，再用后续数据复盘。', '复验通过不代表收入、留存或成交改善；业务效果仍需单独测量。']
    : [...issues, ...warnings, '由 owner 完成动作并提供实施/复验证据，再更新状态。']
  return {
    artifactType: 'product-feedback-closure', generatedAt: new Date().toISOString(), initiativeId: input.initiativeId.trim(),
    handoffFrom: 'dsh-product', handoffTo: sourceType === 'sales-feedback-handoff' ? 'dsh-sales' : 'dsh-growth',
    sourceArtifactId: source.artifactId, sourceContentHash: source.contentHash, sourceArtifactType: sourceType,
    status, action: input.action.trim(), owner: input.owner.trim(), dueDate: input.dueDate,
    evidence: input.evidence?.trim(), verification: Object.keys(verification).length ? verification : undefined,
    verificationBasis: 'user-supplied-evidence', businessImpact: 'not-measured',
    issues, warnings, nextActions,
  }
}
