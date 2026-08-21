export type ProductStage = 'handoff' | 'strategy' | 'poc' | 'mvp' | 'beta' | 'pmf' | 'iteration' | 'growth-handoff'
export type ProductArtifactType = 'product-context' | 'product-brief' | 'poc-plan' | 'mvp-plan' | 'prd' | 'beta-plan' | 'pmf-review' | 'release-review' | 'decision-review' | 'growth-handoff'
export type ReadinessStatus = 'ready' | 'partial' | 'missing' | 'blocked' | 'not-applicable'
export type CheckStatus = 'pass' | 'warning' | 'blocker' | 'not-checked'
export type DecisionGateStatus = 'pass' | 'warning' | 'fail' | 'missing'
export type ProductDecision = 'proceed' | 'iterate' | 'hold' | 'abandon' | 'scale'

export type Primitive = string | number | boolean | null
export type Row = Record<string, Primitive | Primitive[] | Record<string, unknown> | undefined>

export interface Frontmatter {
  [key: string]: unknown
}

export interface MarkdownTable {
  headers: string[]
  rows: Array<Record<string, string>>
}

export interface ProductNote {
  path: string
  title: string
  content: string
  frontmatter: Frontmatter
  headings: string[]
  tables: MarkdownTable[]
  internalLinks: string[]
  externalLinks: string[]
  wordCount: number
  artifactType?: ProductArtifactType
}

export interface ProductConfig {
  defaultRoot: string
  reportDir: string
  maxFiles: number
  maxRows: number
  maxFileBytes: number
  maxTextChars: number
  maxResultChars: number
  defaultLanguage: string
  defaultTimezone: string
  maxResearchQueries: number
  maxResearchResults: number
  maxResearchChars: number
  requestTimeoutMs: number
}

export type ProductResearchPurpose = 'product-method' | 'technical-feasibility' | 'competitor' | 'market-context' | 'regulation' | 'pricing-packaging' | 'release-notes' | 'other'
export type ProductSourceType = 'official' | 'research' | 'news' | 'competitor' | 'community' | 'market-data' | 'regulation' | 'other'

export interface ProductResearchSource {
  url: string
  query?: string
  title: string
  snippet: string
  publishedAt?: string
  sourceType: ProductSourceType
  evidenceBoundary: string
  fetchedAt?: string
  statusCode?: number
  headings?: string[]
  excerpt?: string
  contentKind?: string
  truncated?: boolean
}

export interface ProductResearchResult {
  generatedAt: string
  queries: string[]
  purpose: ProductResearchPurpose
  sources: ProductResearchSource[]
  providerContent?: string[]
  searchStatus: 'ready' | 'partial' | 'unavailable'
  warnings: string[]
  assumptions: string[]
  nextActions: string[]
}

export interface ProductSourceScanResult {
  generatedAt: string
  purpose: ProductResearchPurpose
  sources: ProductResearchSource[]
  warnings: string[]
  assumptions: string[]
  nextActions: string[]
}

export interface FileSystemLike {
  resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<unknown>
  contains(parent: unknown, child: unknown): boolean
  stat(target: unknown, signal?: AbortSignal): Promise<{ type: string; size?: number; version: unknown } | undefined>
  readText(target: unknown, signal?: AbortSignal): Promise<string>
  listDir(target: unknown, signal?: AbortSignal): Promise<Array<{
    name: string
    type: string
    target: unknown
    size?: number
  }>>
  writeText(target: unknown, content: string, expected?: unknown, signal?: AbortSignal): Promise<unknown>
}

export interface ProductFileSummary {
  path: string
  extension: string
  size: number
  status: 'supported' | 'skipped' | 'error'
  artifactType?: ProductArtifactType
  reason?: string
}

export interface ProductVaultScan {
  root: string
  generatedAt: string
  files: ProductFileSummary[]
  productNotes: Array<{
    path: string
    title: string
    artifactType: ProductArtifactType
    status: string
    reasons: string[]
  }>
  dataFiles: string[]
  skippedFiles: number
  errors: string[]
  byType: Record<string, number>
  byStatus: Record<string, number>
}

export interface ProductBriefInput {
  productName: string
  productGoal: string
  targetUser: string
  desiredOutcome: string
  valueProposition: string
  successCriteria: string[]
  constraints: string[]
  owner?: string
  stage?: ProductStage
  source?: string
}

export interface ProductBrief extends ProductBriefInput {
  generatedAt: string
  artifactType: 'product-brief'
  nonGoals: string[]
  decision: 'ready-for-poc' | 'needs-strategy-clarification'
  warnings: string[]
  nextActions: string[]
  markdown: string
}

export interface PocRisk {
  id: string
  category: 'technical' | 'workflow' | 'value' | 'operational' | 'compliance'
  statement: string
  impact: 'high' | 'medium' | 'low'
  likelihood: 'high' | 'medium' | 'low'
  test: string
  successCriteria: string
  failureCriteria: string
  owner?: string
}

export interface PocPlan {
  generatedAt: string
  artifactType: 'poc-plan'
  productName: string
  objective: string
  criticalRisks: PocRisk[]
  scope: string[]
  nonGoals: string[]
  method: string
  duration: string
  owner?: string
  decisionRule: string
  warnings: string[]
  nextActions: string[]
  markdown: string
}

export interface MvpPlan {
  generatedAt: string
  artifactType: 'mvp-plan'
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
  warnings: string[]
  nextActions: string[]
  markdown: string
}

export interface ReleaseCheck {
  name: string
  status: CheckStatus
  evidence?: string
  owner?: string
  blocker?: boolean
}

export interface ReleaseReview {
  generatedAt: string
  artifactType: 'release-review'
  productName: string
  version: string
  targetAudience: string
  owner?: string
  launchDate?: string
  status: ReadinessStatus
  checks: ReleaseCheck[]
  blockers: string[]
  warnings: string[]
  decision: 'release' | 'release-with-conditions' | 'hold'
  nextActions: string[]
  markdown: string
}

export interface PmfSignal {
  id: string
  label: string
  status: ReadinessStatus
  field?: string
  sampleSize: number
  observedRate?: number | null
  observedValue?: number | string | null
  evidence: string
  caveat?: string
}

export interface PmfSegment {
  segment: string
  sampleSize: number
  valueRate?: number | null
  retentionRate?: number | null
  paidRate?: number | null
  referralRate?: number | null
  signalCount: number
  status: ReadinessStatus
  notes: string[]
}

export interface PmfReview {
  generatedAt: string
  artifactType: 'pmf-review'
  productName: string
  source: string
  status: ReadinessStatus
  decision: 'continue' | 'iterate' | 'pause' | 'needs-more-evidence'
  evidenceSummary: {
    rows: number
    segments: number
    fieldsDetected: string[]
    convergence: string
  }
  signals: PmfSignal[]
  segments: PmfSegment[]
  warnings: string[]
  assumptions: string[]
  nextActions: string[]
  markdown: string
}

export interface ProductDecisionGate {
  id: string
  label: string
  status: DecisionGateStatus
  evidence?: string
  threshold?: string
  blocking?: boolean
  owner?: string
}

export interface ProductDecisionReview {
  generatedAt: string
  artifactType: 'decision-review'
  productName: string
  stage: ProductStage
  decisionDate?: string
  decision: ProductDecision
  nextStage?: ProductStage
  scaleReady: boolean
  gates: ProductDecisionGate[]
  evidenceSummary: {
    total: number
    pass: number
    warning: number
    fail: number
    missing: number
    blockingFailures: number
  }
  summary: string
  reasons: string[]
  warnings: string[]
  assumptions: string[]
  nextActions: string[]
  markdown: string
}

export interface GrowthHandoff {
  generatedAt: string
  artifactType: 'growth-handoff'
  productName: string
  productOutcome: string
  evidence: string[]
  primaryMetric: string
  guardrails: string[]
  openQuestions: string[]
  recommendedActions: string[]
  owner?: string
  source?: string
  warnings: string[]
  nextActions: string[]
  markdown: string
}

export interface ProductSalesHandoff {
  handoffVersion: '1.0'
  artifactType: 'product-sales-handoff'
  handoffFrom: 'dsh-product'
  handoffTo: 'dsh-sales'
  generatedAt: string
  status: 'ready' | 'partial'
  productDecision: 'proceed' | 'scale'
  productName: string
  targetBuyer: string
  customerProblem: string
  desiredOutcome: string
  valueEvidence: string[]
  proofPoints: string[]
  requiredCapabilities: string[]
  implementationConstraints: string[]
  commercialContext: string[]
  commercialQuestions: string[]
  nextCustomerAction: string
  owner?: string
  source?: string
  warnings: string[]
  nextActions: string[]
  markdown: string
}

export interface ProductOnboardingDimension {
  id: ProductStage
  label: string
  status: ReadinessStatus
  score: number | null
  evidence: string[]
  missing: string[]
  nextAction: string
}

export interface ProductSopStep {
  id: ProductStage
  order: number
  status: ReadinessStatus
  objective: string
  gate: string
  tool: string
  prompt: string
}

export interface ProductOnboardingResult {
  generatedAt: string
  root: string
  overallStatus: 'ready' | 'partial' | 'blocked'
  overallScore: number
  sources: {
    productNotes: number
    dataFiles: string[]
    byType: Record<string, number>
    byStatus: Record<string, number>
  }
  dimensions: ProductOnboardingDimension[]
  sop: {
    currentStep: ProductStage
    steps: ProductSopStep[]
  }
  topActions: string[]
  questions: string[]
  warnings: string[]
}

export interface ProductReviewResult {
  generatedAt: string
  root: string
  onboarding: ProductOnboardingResult
  pmf?: PmfReview
  decisionReview?: ProductDecisionReview
  currentStep: ProductStage
  decision: string
  warnings: string[]
  nextActions: string[]
}
