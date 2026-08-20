import type { ProductReviewResult } from './types.js'

export function renderProductReport(review: ProductReviewResult): { title: string; reportMarkdown: string; warnings: string[]; nextActions: string[] } {
  const onboarding = review.onboarding
  const dimensions = onboarding.dimensions.map((dimension) => `| ${dimension.label} | ${dimension.status} | ${dimension.evidence.join('<br>') || '暂无'} | ${dimension.nextAction} |`).join('\n')
  const pmf = review.pmf
    ? [
      '## PMF 证据',
      `- 状态：${review.pmf.status}`,
      `- 决策：${review.pmf.decision}`,
      `- 样本量：${review.pmf.evidenceSummary.rows}`,
      `- 证据收敛：${review.pmf.evidenceSummary.convergence}`,
      '',
      ...review.pmf.signals.map((signal) => `- ${signal.label}（${signal.status}）：${signal.evidence}`),
      '',
    ].join('\n')
    : '## PMF 证据\n\n本次没有接入 PMF 数据集。\n'
  const decision = review.decisionReview
    ? [
      '## 产品决策',
      `- 阶段：${review.decisionReview.stage}`,
      `- 决策：${review.decisionReview.decision}`,
      `- 结论：${review.decisionReview.summary}`,
      '',
      ...review.decisionReview.reasons.map((reason) => `- ${reason}`),
      '',
    ].join('\n')
    : '## 产品决策\n\n本次没有接入独立的产品决策复盘。\n'
  const reportMarkdown = [
    `# 产品落地复盘：${review.root}`,
    '',
    `- 当前步骤：${review.currentStep}`,
    `- 总体状态：${onboarding.overallStatus}`,
    `- 准备度：${onboarding.overallScore}%`,
    `- 决策：${review.decision}`,
    '',
    decision,
    '## 流程准备度',
    '',
    '| 阶段 | 状态 | 当前证据 | 下一步 |',
    '| --- | --- | --- | --- |',
    dimensions || '| 暂无 | missing | 暂无 | 先建立产品上下文 |',
    '',
    pmf,
    '## 主要警告',
    review.warnings.length > 0 ? review.warnings.map((warning) => `- ${warning}`).join('\n') : '- 暂无',
    '',
    '## 下一步',
    review.nextActions.length > 0 ? review.nextActions.map((action) => `- ${action}`).join('\n') : '- 暂无',
    '',
  ].join('\n')
  return { title: `产品落地复盘：${review.root}`, reportMarkdown, warnings: review.warnings, nextActions: review.nextActions }
}
