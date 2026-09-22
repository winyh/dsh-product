import type { HandoffRoute } from './handoff-receive.js'

// Locally owned contract; no shared runtime package or cross-repository import.
export const handoffRoutes: Record<string, HandoffRoute> = {
  "opportunity-handoff": {
    "from": "dsh-idea",
    "nextTool": "product_brief",
    "purpose": "将机会和最危险假设映射到产品 Brief 与最小验证，不自动承诺交付。",
    "text": [
      "source",
      "targetUser",
      "problem",
      "riskiestAssumption"
    ],
    "lists": [
      "evidence"
    ],
    "mode": "direct"
  },
  "commercial-handoff": {
    "from": "dsh-business",
    "nextTool": "product_decision_review",
    "purpose": "将成本、利润和审批边界作为产品约束，不自行批准报价。",
    "text": [
      "source",
      "productName",
      "currency"
    ],
    "lists": [
      "offers",
      "requiredApprovals"
    ],
    "mode": "direct"
  },
  "sales-feedback-handoff": {
    "from": "dsh-sales",
    "nextTool": "product_feedback_close",
    "purpose": "把销售反馈绑定到产品动作和复验，保留原反馈 ID。",
    "text": [
      "source"
    ],
    "lists": [
      "feedback"
    ],
    "mode": "direct"
  }
}
