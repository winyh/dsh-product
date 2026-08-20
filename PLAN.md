# dsh-product plan

## Current scope

- Product onboarding from validated opportunity handoff through growth handoff.
- Product brief, POC plan, MVP plan and PRD generation.
- Beta/release readiness checks with explicit blockers and evidence.
- Explicit decision gates for proceed, iterate, hold, abandon and scale.
- PMF review across value perception, usage, retention, paid/renewed and referral signals.
- Segment-level evidence summaries without returning raw customer rows.
- Public internet research for product methods, technical feasibility, competitors, market context, regulations, pricing and release notes, with source lineage and evidence boundaries.
- Explicit public URL scans for first-party product sources with bounded snapshots.
- Product review, Markdown report rendering and guarded Markdown writeback.

## Deliberate boundaries

- No demand discovery, pain-point scraping, idea generation or user-interview research; use `dsh-idea`. Web research here is product evidence, not an opportunity radar.
- No growth channel execution, acquisition campaigns, CRM changes or sales outreach; use `dsh-growth`, `dsh-sales` and connected systems.
- No code generation, design-file editing, issue creation or release deployment.
- No universal PMF score or benchmark claim. Thresholds are heuristics and must remain visible.

## Next iterations

1. Add optional adapters for GitHub/Figma/project-management exports while keeping source lineage explicit across web and local evidence.
2. Add a structured beta feedback importer that de-identifies raw feedback before analysis.
3. Add a versioned product decision log and explicit change-impact review.
4. Add a product-to-sales handoff artifact for B2B deal readiness without becoming a CRM.
