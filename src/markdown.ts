import type { Frontmatter, MarkdownTable, ProductArtifactType, ProductNote } from './types.js'

function scalar(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1)
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try { return JSON.parse(trimmed) as unknown } catch { return trimmed }
  }
  return trimmed
}

function parseFrontmatter(content: string): { frontmatter: Frontmatter; body: string } {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return { frontmatter: {}, body: content }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (end < 0) return { frontmatter: {}, body: content }
  const frontmatter: Frontmatter = {}
  let activeArrayKey: string | null = null
  for (const line of lines.slice(1, end)) {
    const item = line.match(/^\s*-\s+(.+)$/)
    if (item && activeArrayKey) {
      const current = frontmatter[activeArrayKey]
      if (Array.isArray(current)) current.push(scalar(item[1] ?? ''))
      continue
    }
    const match = line.match(/^\s*([^:#]+):\s*(.*)$/)
    if (!match) continue
    const key = (match[1] ?? '').trim()
    const value = (match[2] ?? '').trim()
    if (!value) {
      frontmatter[key] = []
      activeArrayKey = key
    } else {
      frontmatter[key] = scalar(value)
      activeArrayKey = null
    }
  }
  return { frontmatter, body: lines.slice(end + 1).join('\n') }
}

function splitTableLine(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim())
}

function parseTables(body: string): MarkdownTable[] {
  const lines = body.split(/\r?\n/)
  const tables: MarkdownTable[] = []
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index]?.includes('|') || !lines[index + 1]?.includes('|')) continue
    const headers = splitTableLine(lines[index] ?? '')
    const separator = splitTableLine(lines[index + 1] ?? '')
    if (headers.length === 0 || separator.length !== headers.length || !separator.every((cell) => /^:?-{3,}:?$/.test(cell))) continue
    const rows: Array<Record<string, string>> = []
    let rowIndex = index + 2
    while (rowIndex < lines.length && lines[rowIndex]?.includes('|')) {
      const values = splitTableLine(lines[rowIndex] ?? '')
      if (values.length !== headers.length) break
      rows.push(Object.fromEntries(headers.map((header, cellIndex) => [header, values[cellIndex] ?? ''])))
      rowIndex += 1
    }
    tables.push({ headers, rows })
    index = rowIndex - 1
  }
  return tables
}

function titleFrom(body: string, path: string, frontmatter: Frontmatter): string {
  if (typeof frontmatter.title === 'string' && frontmatter.title.trim()) return frontmatter.title.trim()
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim()
  if (heading) return heading
  const filename = path.split(/[\\/]/).pop() ?? path
  return filename.replace(/\.[^.]+$/, '')
}

function artifactTypeFrom(frontmatter: Frontmatter, content: string): ProductArtifactType | undefined {
  const explicit = String(frontmatter.type ?? '').toLowerCase()
  const values: Array<[ProductArtifactType, RegExp]> = [
    ['product-context', /product[- ]context|产品上下文/i],
    ['product-brief', /product[- ]brief|产品 brief|产品简报/i],
    ['poc-plan', /poc|概念验证|可行性验证/i],
    ['mvp-plan', /mvp|最小可行产品/i],
    ['prd', /prd|product requirements|产品需求文档/i],
    ['beta-plan', /beta|试点|内测/i],
    ['pmf-review', /pmf|product[- ]market fit|产品市场匹配/i],
    ['release-review', /release|上线|发布检查/i],
    ['decision-review', /decision[- ]review|decision gate|continue[- ]or[- ]kill|产品决策门|决策门/i],
    ['growth-handoff', /growth handoff|增长交接/i],
  ]
  for (const [type, pattern] of values) if (explicit === type || pattern.test(explicit) || pattern.test(content)) return type
  return undefined
}

export function parseNote(path: string, content: string): ProductNote {
  const { frontmatter, body } = parseFrontmatter(content)
  const headings = Array.from(body.matchAll(/^#{1,6}\s+(.+)$/gm)).map((match) => match[1]?.trim() ?? '').filter(Boolean)
  const internalLinks = Array.from(body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)).map((match) => match[1]?.trim() ?? '').filter(Boolean)
  const externalLinks = [...new Set(Array.from(content.matchAll(/https?:\/\/[^\s)\]>]+/g)).map((match) => match[0]?.replace(/[.,;!?]+$/, '') ?? '').filter(Boolean))]
  return {
    path,
    title: titleFrom(body, path, frontmatter),
    content,
    frontmatter,
    headings,
    tables: parseTables(body),
    internalLinks,
    externalLinks,
    wordCount: body.trim() ? body.trim().split(/\s+/u).length : 0,
    artifactType: artifactTypeFrom(frontmatter, `${String(frontmatter.type ?? '')}\n${body}`),
  }
}

export function listValue(value: string | undefined): string[] {
  if (!value?.trim()) return []
  const trimmed = value.trim()
  if (trimmed.startsWith('[')) {
    const parsed: unknown = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) throw new Error('Expected a JSON array or newline-separated list.')
    return parsed.map((item) => String(item).trim()).filter(Boolean)
  }
  return trimmed.split(/\r?\n|\s*;\s*|\s*\|\s*/).map((item) => item.replace(/^[-*]\s+/, '').trim()).filter(Boolean)
}

export function markdownList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- 暂无'
}

export function replacementDiff(before: string, after: string): { beforeLines: number; afterLines: number; changedLines: number; preview: string[] } {
  const beforeLines = before.split(/\r?\n/)
  const afterLines = after.split(/\r?\n/)
  const preview: string[] = []
  let changedLines = 0
  const length = Math.max(beforeLines.length, afterLines.length)
  for (let index = 0; index < length; index += 1) {
    const left = beforeLines[index]
    const right = afterLines[index]
    if (left === right) continue
    changedLines += 1
    if (preview.length < 20) {
      if (left !== undefined) preview.push(`- ${left}`)
      if (right !== undefined) preview.push(`+ ${right}`)
    }
  }
  return { beforeLines: beforeLines.length, afterLines: afterLines.length, changedLines, preview }
}
