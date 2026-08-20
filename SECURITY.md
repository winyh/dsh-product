# Security

`dsh-product` combines local product context with explicit public web research. It reads files under the configured root and does not upload the product workspace by default.

- Paths outside `defaultRoot` are rejected.
- File writes require preview plus explicit confirmation.
- Writes use a version guard to avoid overwriting concurrent edits.
- PMF reviews return aggregates and evidence summaries, not raw customer rows.
- Web search and source scans use only public HTTP(S) URLs; local files, cookies, login sessions and credentials are not sent automatically.
- Search snippets and bounded page snapshots are evidence leads with explicit limits; they must be verified against the original source before a product decision.
- Missing evidence remains missing; it is never silently converted to zero or a pass.
- External system actions such as code changes, design edits, CRM updates, campaigns and sales outreach are outside this plugin.

Do not place passwords, tokens, cookies, private contact details or payment data in product artifacts or PMF datasets.
