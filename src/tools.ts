import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { readDataset } from './data.js'
import { parseNote, replacementDiff } from './markdown.js'
import { buildProductOnboarding } from './onboarding.js'
import { buildBetaFeedbackImport, buildChangeImpactReview, buildProductDecisionLog } from './feedback.js'
import {
  arrayInput,
  buildProductDecisionReview,
  buildGrowthHandoff,
  buildProductSalesHandoff,
  buildMvpPlan,
  buildPrd,
  buildProductBrief,
  buildPocPlan,
  buildReleaseReview,
  mvpFromJson,
  parseEnvelope,
  releaseChecksFromJson,
  reviewPmfRows,
} from './product.js'
import { resultEnvelope, jsonValue, renderResult, resultSchema, type ResultLineage } from './output.js'
import { renderProductReport } from './reports.js'
import { readProductNote, scanProductVault } from './vault.js'
import { scanProductSources, searchProductSources } from './web.js'
import type { DecisionGateStatus, FileSystemLike, PocRisk, ProductConfig, ProductDecision, ProductDecisionGate, ProductDecisionReview, ProductResearchPurpose, ProductReviewResult, ProductStage, ReleaseCheck } from './types.js'
import type { ProductWebLike } from './web.js'

function productOutput(maxChars: number) {
  return { schema: resultSchema, render: (_args: unknown, value: unknown) => renderResult(value, maxChars) }
}

function wrapResult(value: unknown, options: { lineage?: ResultLineage[]; assumptions?: string[]; nextActions?: string[] } = {}) {
  const warnings = typeof value === 'object' && value !== null && 'warnings' in value && Array.isArray(value.warnings)
    ? value.warnings.filter((warning): warning is string => typeof warning === 'string')
    : []
  return resultEnvelope({ data: jsonValue(value), warnings, assumptions: options.assumptions, lineage: options.lineage, nextActions: options.nextActions })
}

function parseObject(value: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try { parsed = JSON.parse(value) as unknown } catch (error) { throw new Error(`${label} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`) }
  const data = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && 'data' in parsed ? (parsed as { data: unknown }).data : parsed
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error(`${label} must be a JSON object`)
  return data as Record<string, unknown>
}

async function ensureInsideRoot(fs: FileSystemLike, config: ProductConfig, path: string, signal?: AbortSignal): Promise<void> {
  const root = await fs.resolve(config.defaultRoot, { signal })
  const target = await fs.resolve(path, { signal })
  if (!fs.contains(root, target)) throw new Error(`Path is outside configured defaultRoot: ${path}`)
}

function validStage(value: string | undefined): 'strategy' | 'handoff' {
  if (!value || value === 'strategy') return 'strategy'
  if (value === 'handoff') return 'handoff'
  throw new Error(`stage must be strategy or handoff; received '${value}'`)
}

function pocRisksFromJson(value: string): PocRisk[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) throw new Error('risks must be a JSON array.')
  return parsed.map((item, index) => {
    if (typeof item !== 'object' || item === null) throw new Error(`risks[${index}] must be an object.`)
    const record = item as Record<string, unknown>
    const category = String(record.category ?? 'value') as PocRisk['category']
    const impact = String(record.impact ?? 'high') as PocRisk['impact']
    const likelihood = String(record.likelihood ?? 'medium') as PocRisk['likelihood']
    if (!['technical', 'workflow', 'value', 'operational', 'compliance'].includes(category)) throw new Error(`risks[${index}].category is invalid.`)
    if (!['high', 'medium', 'low'].includes(impact) || !['high', 'medium', 'low'].includes(likelihood)) throw new Error(`risks[${index}] impact/likelihood is invalid.`)
    return {
      id: String(record.id ?? `R${index + 1}`),
      category,
      statement: String(record.statement ?? record.risk ?? ''),
      impact,
      likelihood,
      test: String(record.test ?? ''),
      successCriteria: String(record.successCriteria ?? record.success ?? ''),
      failureCriteria: String(record.failureCriteria ?? record.failure ?? ''),
      owner: record.owner ? String(record.owner) : undefined,
    }
  })
}

function releaseChecks(value: string): ReleaseCheck[] {
  return releaseChecksFromJson(value)
}

function decisionGates(value: string): ProductDecisionGate[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) throw new Error('gates must be a JSON array.')
  return parsed.map((item, index) => {
    if (typeof item !== 'object' || item === null) throw new Error(`gates[${index}] must be an object.`)
    const record = item as Record<string, unknown>
    const status = String(record.status ?? 'missing') as DecisionGateStatus
    if (!['pass', 'warning', 'fail', 'missing'].includes(status)) throw new Error(`gates[${index}].status is invalid.`)
    const label = String(record.label ?? record.name ?? '').trim()
    if (!label) throw new Error(`gates[${index}].label is required.`)
    return {
      id: String(record.id ?? `G${index + 1}`),
      label,
      status,
      evidence: record.evidence === undefined || record.evidence === null ? undefined : String(record.evidence),
      threshold: record.threshold === undefined || record.threshold === null ? undefined : String(record.threshold),
      blocking: record.blocking === true,
      owner: record.owner === undefined || record.owner === null ? undefined : String(record.owner),
    }
  })
}

function productStage(value: string | undefined): ProductStage {
  const stage = value?.trim() || 'strategy'
  const allowed: ProductStage[] = ['handoff', 'strategy', 'poc', 'mvp', 'beta', 'pmf', 'iteration', 'growth-handoff']
  if (!allowed.includes(stage as ProductStage)) throw new Error(`stage must be one of: ${allowed.join(', ')}; received '${stage}'`)
  return stage as ProductStage
}

function researchPurpose(value: string | undefined): ProductResearchPurpose {
  const purpose = value?.trim() || 'other'
  const allowed: ProductResearchPurpose[] = ['product-method', 'technical-feasibility', 'competitor', 'market-context', 'regulation', 'pricing-packaging', 'release-notes', 'other']
  if (!allowed.includes(purpose as ProductResearchPurpose)) throw new Error(`purpose must be one of: ${allowed.join(', ')}; received '${purpose}'`)
  return purpose as ProductResearchPurpose
}

function reviewFromJson(value: string): ProductReviewResult {
  const data = parseEnvelope(value)
  if (!('onboarding' in data) || !('currentStep' in data)) throw new Error('reviewJson must contain a product_review result.')
  return data as unknown as ProductReviewResult
}

function decisionReviewFromJson(value: string): ProductDecisionReview {
  const data = parseEnvelope(value)
  if (data.artifactType !== 'decision-review' || typeof data.productName !== 'string' || typeof data.decision !== 'string') throw new Error('decisionJson must contain a product_decision_review result.')
  return data as unknown as ProductDecisionReview
}

export function registerProductTools(ctx: Context, config: ProductConfig, fs: FileSystemLike, web: ProductWebLike): void {
  ctx.tools.register(defineTool({
    name: 'product_beta_feedback_import',
    description: 'Import user-approved Beta feedback, redact common contact identifiers before analysis, and group only the redacted text into themes. It never returns raw customer rows to an external provider.',
    parameters: {
      feedbackJson: { type: 'string', required: true, description: 'JSON array or object with a feedback array. Each item needs text, feedback, comment or content.' },
      source: { type: 'string', description: 'Source path or feedback export label.' },
    },
    output: productOutput(config.maxResultChars),
    async execute(args) {
      let parsed: unknown
      try { parsed = JSON.parse(args.feedbackJson) as unknown } catch (error) { throw new Error(`feedbackJson must be valid JSON: ${error instanceof Error ? error.message : String(error)}`) }
      const data = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && 'data' in parsed ? (parsed as { data: unknown }).data : parsed
      const feedback = Array.isArray(data) ? data : typeof data === 'object' && data !== null && 'feedback' in data ? (data as { feedback: unknown }).feedback : undefined
      if (!Array.isArray(feedback)) throw new Error('feedbackJson must be an array or an object with a feedback array.')
      const result = buildBetaFeedbackImport({ feedback, source: args.source })
      return wrapResult(result, { lineage: args.source ? [{ source: args.source }] : [], nextActions: result.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'product_decision_log',
    description: 'Create a versioned product decision log with an artifact id, evidence, owner and next review date. It records a decision; it does not approve release or investment by itself.',
    parameters: {
      productName: { type: 'string', required: true },
      stage: { type: 'string', required: true, enum: ['handoff', 'strategy', 'poc', 'mvp', 'beta', 'pmf', 'iteration', 'growth-handoff'] },
      decision: { type: 'string', required: true, enum: ['proceed', 'iterate', 'hold', 'abandon', 'scale'] },
      rationale: { type: 'string', required: true },
      evidence: { type: 'string', description: 'JSON array or newline-separated evidence.' },
      owner: { type: 'string' },
      nextReviewDate: { type: 'string' },
      source: { type: 'string' },
    },
    output: productOutput(config.maxResultChars),
    async execute(args) {
      const result = buildProductDecisionLog({ productName: args.productName, stage: productStage(args.stage), decision: args.decision as ProductDecision, rationale: args.rationale, evidence: arrayInput(args.evidence, 'evidence'), owner: args.owner, nextReviewDate: args.nextReviewDate, source: args.source })
      return wrapResult(result, { lineage: args.source ? [{ source: args.source }] : [], nextActions: result.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'product_change_impact_review',
    description: 'Compare two product handoff or scope objects and expose added/removed capabilities, constraints, metrics and commercial context before consumers rely on stale evidence.',
    parameters: {
      productName: { type: 'string', required: true },
      beforeJson: { type: 'string', required: true },
      afterJson: { type: 'string', required: true },
    },
    output: productOutput(config.maxResultChars),
    async execute(args) {
      const result = buildChangeImpactReview({ productName: args.productName, before: parseObject(args.beforeJson, 'beforeJson'), after: parseObject(args.afterJson, 'afterJson') })
      return wrapResult(result, { nextActions: result.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'product_research',
    description: 'Query current public internet information for product methods, technical feasibility, competitors, market context, regulations, pricing or release notes. Returns bounded sources and evidence boundaries; it does not perform demand discovery or treat search popularity as demand proof.',
    parameters: {
      queries: { type: 'string', required: true, description: 'JSON array or newline-separated research questions.' },
      purpose: { type: 'string', description: 'product-method, technical-feasibility, competitor, market-context, regulation, pricing-packaging, release-notes or other.' },
      maxResults: { type: 'number', description: 'Maximum sources per query; bounded by configuration.' },
    },
    output: productOutput(config.maxResultChars),
    async execute(args, exec) {
      if (!web) throw new Error('No web provider is available; configure a web search provider and retry.')
      const result = await searchProductSources(web, arrayInput(args.queries, 'queries'), researchPurpose(args.purpose), { ...config, maxResearchResults: Math.min(config.maxResearchResults, Math.max(1, Math.floor(args.maxResults ?? config.maxResearchResults))) }, exec.signal)
      return wrapResult(result, {
        lineage: result.sources.map((source) => ({ source: source.url })),
        assumptions: result.assumptions,
        nextActions: result.nextActions,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'product_source_scan',
    description: 'Fetch explicitly supplied public HTTP(S) product sources such as official documentation, release notes, standards or competitor pricing pages. It does not use cookies, login sessions or local files.',
    parameters: {
      urls: { type: 'string', required: true, description: 'JSON array or newline-separated public HTTP(S) URLs.' },
      purpose: { type: 'string', description: 'product-method, technical-feasibility, competitor, market-context, regulation, pricing-packaging, release-notes or other.' },
    },
    output: productOutput(config.maxResultChars),
    async execute(args, exec) {
      if (!web) throw new Error('No web provider is available; configure a web fetch provider and retry.')
      const result = await scanProductSources(web, arrayInput(args.urls, 'urls'), researchPurpose(args.purpose), config, exec.signal)
      return wrapResult(result, {
        lineage: result.sources.map((source) => ({ source: source.url })),
        assumptions: result.assumptions,
        nextActions: result.nextActions,
      })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'product_onboarding',
    description: 'Run a read-only product-delivery readiness check across local product notes and evidence files. It starts after opportunity handoff and does not perform demand discovery.',
    parameters: {
      root: { type: 'string', description: 'Optional directory under defaultRoot.' },
    },
    output: productOutput(config.maxResultChars),
    async execute(args, exec) {
      const root = args.root?.trim() || config.defaultRoot
      await ensureInsideRoot(fs, config, root, exec.signal)
      const scan = await scanProductVault(fs, root, config, exec.signal)
      const result = buildProductOnboarding({ root, scan })
      return wrapResult(result, { lineage: [{ source: root }], nextActions: result.topActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'product_audit_note',
    description: 'Audit one Markdown product artifact for stage, metadata, evidence lineage and delivery-gate completeness. Reads only.',
    parameters: {
      path: { type: 'string', required: true, description: 'Markdown product artifact under defaultRoot.' },
    },
    output: productOutput(config.maxResultChars),
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      const note = await readProductNote(fs, args.path, config, exec.signal)
      const missing: string[] = []
      if (!note.artifactType) missing.push('artifact type')
      if (!note.frontmatter.status) missing.push('status')
      if (!note.frontmatter.owner) missing.push('owner')
      if (!note.frontmatter.updated) missing.push('updated date')
      if (!note.frontmatter.source && note.externalLinks.length === 0) missing.push('source or lineage')
      const result = {
        path: note.path,
        title: note.title,
        artifactType: note.artifactType ?? 'unknown',
        status: missing.length === 0 ? 'ready' : missing.length <= 2 ? 'partial' : 'missing',
        headings: note.headings,
        wordCount: note.wordCount,
        missing,
        warnings: missing.length > 0 ? [`Missing product artifact fields: ${missing.join(', ')}`] : [],
        nextActions: missing.length > 0 ? ['补齐缺失字段，再进入对应产品阶段的 gate。'] : ['复核内容中的事实、假设、阈值和决策日期。'],
      }
      return wrapResult(result, { lineage: [{ source: args.path }], nextActions: result.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'product_brief',
    description: 'Turn an already-confirmed opportunity handoff into a product brief with outcome, value proposition, success criteria and explicit non-goals. Does not discover demand.',
    parameters: {
      productName: { type: 'string', required: true, description: 'Product or product slice name.' },
      productGoal: { type: 'string', required: true, description: 'Product outcome to create or improve.' },
      targetUser: { type: 'string', required: true, description: 'Target user or buyer supplied by the opportunity handoff.' },
      desiredOutcome: { type: 'string', required: true, description: 'Observable user or business outcome.' },
      valueProposition: { type: 'string', required: true, description: 'Current product value hypothesis.' },
      successCriteria: { type: 'string', required: true, description: 'JSON array or newline-separated product success criteria.' },
      constraints: { type: 'string', description: 'JSON array or newline-separated constraints.' },
      owner: { type: 'string', description: 'Product owner.' },
      stage: { type: 'string', description: 'handoff or strategy; defaults to strategy.' },
      source: { type: 'string', description: 'Opportunity handoff or source note path.' },
    },
    output: productOutput(config.maxResultChars),
    async execute(args) {
      const brief = buildProductBrief({
        productName: args.productName,
        productGoal: args.productGoal,
        targetUser: args.targetUser,
        desiredOutcome: args.desiredOutcome,
        valueProposition: args.valueProposition,
        successCriteria: arrayInput(args.successCriteria, 'successCriteria'),
        constraints: arrayInput(args.constraints, 'constraints'),
        owner: args.owner,
        stage: validStage(args.stage),
        source: args.source,
      })
      return wrapResult(brief, { lineage: args.source ? [{ source: args.source }] : [], nextActions: brief.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'product_poc_plan',
    description: 'Create a focused POC plan that tests the highest-risk technical, workflow, value, operational or compliance assumption with explicit thresholds.',
    parameters: {
      productName: { type: 'string', required: true, description: 'Product or slice name.' },
      objective: { type: 'string', required: true, description: 'What the POC must prove or disprove.' },
      risks: { type: 'string', required: true, description: 'JSON array of risks with id/category/statement/impact/likelihood/test/successCriteria/failureCriteria.' },
      scope: { type: 'string', description: 'JSON array or newline-separated POC scope.' },
      nonGoals: { type: 'string', description: 'JSON array or newline-separated non-goals.' },
      method: { type: 'string', required: true, description: 'POC method, such as technical spike, concierge workflow or prototype test.' },
      duration: { type: 'string', required: true, description: 'Expected POC duration.' },
      owner: { type: 'string', description: 'POC owner.' },
      decisionRule: { type: 'string', required: true, description: 'Continue, revise or stop rule.' },
    },
    output: productOutput(config.maxResultChars),
    async execute(args) {
      const plan = buildPocPlan({
        productName: args.productName,
        objective: args.objective,
        criticalRisks: pocRisksFromJson(args.risks),
        scope: arrayInput(args.scope, 'scope'),
        nonGoals: arrayInput(args.nonGoals, 'nonGoals'),
        method: args.method,
        duration: args.duration,
        owner: args.owner,
        decisionRule: args.decisionRule,
      })
      return wrapResult(plan, { nextActions: plan.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'product_mvp_plan',
    description: 'Define the smallest observable and deliverable MVP after POC, including in-scope, out-of-scope, flow, acceptance criteria, instrumentation and success metrics.',
    parameters: {
      productName: { type: 'string', required: true, description: 'Product or slice name.' },
      targetUser: { type: 'string', required: true, description: 'Target user for this MVP.' },
      coreOutcome: { type: 'string', required: true, description: 'The single core outcome the MVP must deliver.' },
      inScope: { type: 'string', required: true, description: 'JSON array or newline-separated MVP scope.' },
      outOfScope: { type: 'string', required: true, description: 'JSON array or newline-separated non-goals.' },
      userFlow: { type: 'string', required: true, description: 'JSON array or newline-separated flow steps.' },
      acceptanceCriteria: { type: 'string', required: true, description: 'JSON array or newline-separated acceptance criteria.' },
      successMetrics: { type: 'string', required: true, description: 'JSON array or newline-separated success metrics.' },
      instrumentation: { type: 'string', description: 'JSON array or newline-separated events/fields to instrument.' },
      dependencies: { type: 'string', description: 'JSON array or newline-separated dependencies.' },
      risks: { type: 'string', description: 'JSON array or newline-separated delivery risks.' },
      owner: { type: 'string', description: 'Product owner.' },
      duration: { type: 'string', required: true, description: 'Expected delivery or beta preparation duration.' },
      decisionRule: { type: 'string', required: true, description: 'Decision rule after MVP/Beta evidence.' },
    },
    output: productOutput(config.maxResultChars),
    async execute(args) {
      const plan = buildMvpPlan({
        productName: args.productName,
        targetUser: args.targetUser,
        coreOutcome: args.coreOutcome,
        inScope: arrayInput(args.inScope, 'inScope'),
        outOfScope: arrayInput(args.outOfScope, 'outOfScope'),
        userFlow: arrayInput(args.userFlow, 'userFlow'),
        acceptanceCriteria: arrayInput(args.acceptanceCriteria, 'acceptanceCriteria'),
        successMetrics: arrayInput(args.successMetrics, 'successMetrics'),
        instrumentation: arrayInput(args.instrumentation, 'instrumentation'),
        dependencies: arrayInput(args.dependencies, 'dependencies'),
        risks: arrayInput(args.risks, 'risks'),
        owner: args.owner,
        duration: args.duration,
        decisionRule: args.decisionRule,
      })
      return wrapResult(plan, { nextActions: plan.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'product_prd',
    description: 'Render a reviewable PRD Markdown document from a product_mvp_plan result. It does not create code or design files.',
    parameters: {
      mvpJson: { type: 'string', required: true, description: 'JSON returned by product_mvp_plan or its data object.' },
    },
    output: productOutput(config.maxResultChars),
    async execute(args) {
      const prd = buildPrd(mvpFromJson(args.mvpJson))
      return wrapResult(prd, { nextActions: prd.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'product_release_check',
    description: 'Evaluate Beta/release readiness from explicit checks, evidence, owners and blockers. Returns release, conditional release or hold.',
    parameters: {
      productName: { type: 'string', required: true, description: 'Product name.' },
      version: { type: 'string', required: true, description: 'Version or release candidate.' },
      targetAudience: { type: 'string', required: true, description: 'Beta or launch audience.' },
      checks: { type: 'string', required: true, description: 'JSON array of {name,status,evidence,owner,blocker}; status is pass, warning, blocker or not-checked.' },
      owner: { type: 'string', description: 'Release owner.' },
      launchDate: { type: 'string', description: 'Planned launch date.' },
    },
    output: productOutput(config.maxResultChars),
    async execute(args) {
      const review = buildReleaseReview({ productName: args.productName, version: args.version, targetAudience: args.targetAudience, checks: releaseChecks(args.checks), owner: args.owner, launchDate: args.launchDate })
      return wrapResult(review, { nextActions: review.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'product_pmf_review',
    description: 'Review PMF evidence from a local CSV, JSON or JSONL dataset. Separates value, usage, retention, commercial and referral signals by segment; never reduces PMF to a single score.',
    parameters: {
      sourcePath: { type: 'string', required: true, description: 'PMF, usage, retention or customer evidence dataset under defaultRoot.' },
      productName: { type: 'string', required: true, description: 'Product name.' },
      segmentField: { type: 'string', description: 'Segment/cohort field.' },
      valueField: { type: 'string', description: 'Very disappointed, would miss or value signal field.' },
      retentionField: { type: 'string', description: 'Retained or retention rate field.' },
      paidField: { type: 'string', description: 'Paid, renewed, converted or deal field.' },
      referralField: { type: 'string', description: 'Referred or recommendation field.' },
      usageField: { type: 'string', description: 'Usage frequency, active days or sessions field.' },
      minSample: { type: 'number', description: 'Reference minimum sample size; not an industry benchmark.' },
    },
    output: productOutput(config.maxResultChars),
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.sourcePath, exec.signal)
      const dataset = await readDataset(fs, config, args.sourcePath, exec.signal)
      const review = reviewPmfRows({ productName: args.productName, source: args.sourcePath, rows: dataset.rows, segmentField: args.segmentField, valueField: args.valueField, retentionField: args.retentionField, paidField: args.paidField, referralField: args.referralField, usageField: args.usageField, minSample: args.minSample })
      review.warnings.push(...dataset.warnings)
      return wrapResult(review, { lineage: [{ source: args.sourcePath, fields: review.evidenceSummary.fieldsDetected }], assumptions: review.assumptions, nextActions: review.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'product_decision_review',
    description: 'Evaluate whether a product should move forward, iterate, hold, abandon the current direction or scale investment. Uses explicit decision gates and does not infer a stop decision from missing evidence.',
    parameters: {
      productName: { type: 'string', required: true, description: 'Product or product slice name.' },
      stage: { type: 'string', required: true, description: 'Current stage: handoff, strategy, poc, mvp, beta, pmf, iteration or growth-handoff.' },
      gates: { type: 'string', required: true, description: 'JSON array of {id,label,status,evidence,threshold,blocking,owner}; status is pass, warning, fail or missing.' },
      decisionDate: { type: 'string', description: 'Date on which this decision is made or should be revisited.' },
      scaleReady: { type: 'boolean', description: 'Set true only when all gates pass and the evidence supports expanding investment.' },
    },
    output: productOutput(config.maxResultChars),
    async execute(args) {
      const review = buildProductDecisionReview({ productName: args.productName, stage: productStage(args.stage), gates: decisionGates(args.gates), decisionDate: args.decisionDate, scaleReady: args.scaleReady })
      return wrapResult(review, { nextActions: review.nextActions, assumptions: review.assumptions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'product_sales_handoff',
    description: 'Create a versioned product-to-sales handoff only after a proceed or scale product decision. Carries buyer problem, value evidence, proof points, delivery boundaries and commercial dependencies to dsh-sales; it does not set price or make a sales commitment.',
    parameters: {
      productName: { type: 'string', required: true, description: 'Product name.' },
      productDecision: { type: 'string', required: true, enum: ['proceed', 'scale'], description: 'Decision gate that permits a sales handoff.' },
      targetBuyer: { type: 'string', required: true, description: 'Target buyer or economic buyer.' },
      customerProblem: { type: 'string', required: true, description: 'Customer problem supported by product evidence.' },
      desiredOutcome: { type: 'string', required: true, description: 'Observable customer outcome.' },
      valueEvidence: { type: 'string', required: true, description: 'JSON array or newline-separated value evidence.' },
      proofPoints: { type: 'string', required: true, description: 'JSON array or newline-separated proof points, customer statements or observed results.' },
      requiredCapabilities: { type: 'string', description: 'JSON array or newline-separated capabilities the sales promise must include.' },
      implementationConstraints: { type: 'string', description: 'JSON array or newline-separated delivery, integration, compliance or timeline constraints.' },
      commercialContext: { type: 'string', description: 'JSON array or newline-separated approved commercial context, usually from dsh-business.' },
      commercialQuestions: { type: 'string', description: 'JSON array or newline-separated commercial questions still requiring dsh-business or customer confirmation.' },
      nextCustomerAction: { type: 'string', required: true, description: 'One observable next customer action with owner/date if known.' },
      owner: { type: 'string', description: 'Handoff owner.' },
      source: { type: 'string', description: 'Source product decision or PMF artifact path.' },
    },
    output: productOutput(config.maxResultChars),
    async execute(args) {
      const handoff = buildProductSalesHandoff({
        productName: args.productName,
        productDecision: args.productDecision as 'proceed' | 'scale',
        targetBuyer: args.targetBuyer,
        customerProblem: args.customerProblem,
        desiredOutcome: args.desiredOutcome,
        valueEvidence: arrayInput(args.valueEvidence, 'valueEvidence'),
        proofPoints: arrayInput(args.proofPoints, 'proofPoints'),
        requiredCapabilities: arrayInput(args.requiredCapabilities, 'requiredCapabilities'),
        implementationConstraints: arrayInput(args.implementationConstraints, 'implementationConstraints'),
        commercialContext: arrayInput(args.commercialContext, 'commercialContext'),
        commercialQuestions: arrayInput(args.commercialQuestions, 'commercialQuestions'),
        nextCustomerAction: args.nextCustomerAction,
        owner: args.owner,
        source: args.source,
      })
      return wrapResult(handoff, { lineage: args.source ? [{ source: args.source }] : [], nextActions: handoff.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'product_growth_handoff',
    description: 'Create a product-to-growth handoff with product outcome, evidence, primary metric, guardrails and open questions for dsh-growth. It does not perform acquisition or sales execution.',
    parameters: {
      productName: { type: 'string', required: true, description: 'Product name.' },
      productOutcome: { type: 'string', required: true, description: 'Product result that is ready to be measured for growth.' },
      evidence: { type: 'string', description: 'JSON array or newline-separated product evidence.' },
      primaryMetric: { type: 'string', required: true, description: 'Primary growth metric.' },
      guardrails: { type: 'string', description: 'JSON array or newline-separated guardrail metrics.' },
      openQuestions: { type: 'string', description: 'JSON array or newline-separated unresolved questions.' },
      recommendedActions: { type: 'string', description: 'JSON array or newline-separated recommended next actions.' },
      pmfJson: { type: 'string', description: 'Optional product_pmf_review result; its evidence and decision are included as context.' },
      owner: { type: 'string', description: 'Handoff owner.' },
      source: { type: 'string', description: 'Source artifact path.' },
    },
    output: productOutput(config.maxResultChars),
    async execute(args) {
      const pmf = args.pmfJson ? parseEnvelope(args.pmfJson) : undefined
      const pmfEvidence = pmf && Array.isArray(pmf.signals) ? pmf.signals.map((signal) => typeof signal === 'object' && signal !== null && 'evidence' in signal ? String(signal.evidence) : '').filter(Boolean) : []
      const handoff = buildGrowthHandoff({
        productName: args.productName,
        productOutcome: args.productOutcome,
        evidence: [...arrayInput(args.evidence, 'evidence'), ...pmfEvidence],
        primaryMetric: args.primaryMetric,
        guardrails: arrayInput(args.guardrails, 'guardrails'),
        openQuestions: arrayInput(args.openQuestions, 'openQuestions'),
        recommendedActions: arrayInput(args.recommendedActions, 'recommendedActions'),
        owner: args.owner,
        source: args.source,
      })
      return wrapResult(handoff, { lineage: args.source ? [{ source: args.source }] : [], nextActions: handoff.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'product_review',
    description: 'Run the full local product-delivery review from handoff through growth handoff, optionally attaching a PMF evidence dataset.',
    parameters: {
      root: { type: 'string', description: 'Optional directory under defaultRoot.' },
      pmfPath: { type: 'string', description: 'Optional local PMF/usage/retention dataset.' },
      productName: { type: 'string', description: 'Product name when pmfPath is supplied.' },
      segmentField: { type: 'string' },
      valueField: { type: 'string' },
      retentionField: { type: 'string' },
      paidField: { type: 'string' },
      referralField: { type: 'string' },
      usageField: { type: 'string' },
      minSample: { type: 'number' },
      decisionJson: { type: 'string', description: 'Optional JSON returned by product_decision_review; its decision and evidence are included in the full review.' },
    },
    output: productOutput(config.maxResultChars),
    async execute(args, exec) {
      const root = args.root?.trim() || config.defaultRoot
      await ensureInsideRoot(fs, config, root, exec.signal)
      const scan = await scanProductVault(fs, root, config, exec.signal)
      const onboarding = buildProductOnboarding({ root, scan })
      let pmf
      const decisionReview = args.decisionJson ? decisionReviewFromJson(args.decisionJson) : undefined
      const lineage: ResultLineage[] = [{ source: root }]
      if (args.pmfPath?.trim()) {
        await ensureInsideRoot(fs, config, args.pmfPath, exec.signal)
        const dataset = await readDataset(fs, config, args.pmfPath, exec.signal)
        pmf = reviewPmfRows({ productName: args.productName?.trim() || '未命名产品', source: args.pmfPath, rows: dataset.rows, segmentField: args.segmentField, valueField: args.valueField, retentionField: args.retentionField, paidField: args.paidField, referralField: args.referralField, usageField: args.usageField, minSample: args.minSample })
        pmf.warnings.push(...dataset.warnings)
        lineage.push({ source: args.pmfPath, fields: pmf.evidenceSummary.fieldsDetected })
      }
      const review: ProductReviewResult = {
        generatedAt: new Date().toISOString(),
        root,
        onboarding,
        pmf,
        decisionReview,
        currentStep: decisionReview?.stage ?? (pmf?.status === 'ready' ? 'growth-handoff' : onboarding.sop.currentStep),
        decision: decisionReview?.decision ?? (pmf ? pmf.decision : onboarding.overallStatus === 'ready' ? '进入 PMF 证据复盘或增长交接。' : '先完成当前阶段 gate.'),
        warnings: [...onboarding.warnings, ...(pmf?.warnings ?? []), ...(decisionReview?.warnings ?? [])],
        nextActions: decisionReview?.nextActions ?? pmf?.nextActions ?? onboarding.topActions,
      }
      return wrapResult(review, { lineage, assumptions: [...(pmf?.assumptions ?? []), ...(decisionReview?.assumptions ?? [])], nextActions: review.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'product_report',
    description: 'Render a product_review result into a shareable Markdown report. Reads the supplied JSON only and does not write files.',
    parameters: {
      reviewJson: { type: 'string', required: true, description: 'JSON returned by product_review.' },
    },
    output: productOutput(config.maxResultChars),
    async execute(args) {
      const report = renderProductReport(reviewFromJson(args.reviewJson))
      return wrapResult(report, { nextActions: report.nextActions })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'product_apply',
    description: 'Preview or apply a complete Markdown replacement under defaultRoot using a stale-version guard. Set confirm=true only after explicit approval.',
    parameters: {
      path: { type: 'string', required: true, description: 'Markdown product artifact to update.' },
      content: { type: 'string', required: true, description: 'Complete replacement Markdown content.' },
      confirm: { type: 'boolean', required: true, description: 'false previews only; true applies the guarded write.' },
    },
    output: productOutput(config.maxResultChars),
    async execute(args, exec) {
      await ensureInsideRoot(fs, config, args.path, exec.signal)
      if (args.content.length > config.maxTextChars) throw new Error(`Replacement exceeds maxTextChars (${config.maxTextChars})`)
      const target = await fs.resolve(args.path, { signal: exec.signal })
      const info = await fs.stat(target, exec.signal)
      if (!info || info.type !== 'file') throw new Error(`File not found: ${args.path}`)
      const current = await fs.readText(target, exec.signal)
      if (!args.confirm) {
        ctx.emit('product/report-previewed', { path: args.path, sourceCount: 1 })
        return wrapResult({ status: 'preview-only', path: args.path, changed: args.content !== current, applied: false, title: parseNote(args.path, args.content).title, diff: replacementDiff(current, args.content) }, { nextActions: ['审阅 diff；明确确认后再以 confirm=true 写回。'] })
      }
      await fs.writeText(target, args.content, { kind: 'replaceIfVersion', version: info.version }, exec.signal)
      ctx.emit('product/report-applied', { path: args.path })
      return wrapResult({ status: 'applied', path: args.path, changed: args.content !== current, applied: true, guarded: true }, { lineage: [{ source: args.path }] })
    },
  }))

  ctx.logger.info(`[dsh-product] registered product-delivery tools for ${config.defaultRoot}`)
}
