import type { WebFetchResult, WebSearchResult } from '@deepseek-ai/dsh-web'
import type { ProductConfig, ProductResearchPurpose, ProductResearchResult, ProductResearchSource, ProductSourceScanResult, ProductSourceType } from './types.js'

export interface ProductWebLike {
  search(request: { query: string; maxResults?: number }, signal?: AbortSignal): Promise<WebSearchResult>
  fetch(request: { url: string }, signal?: AbortSignal): Promise<WebFetchResult>
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
}

function cleanText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
}

function metaContent(html: string, name: string): string {
  const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i')
  const reversePattern = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["']${name}["'][^>]*>`, 'i')
  return cleanText(pattern.exec(html)?.[1] ?? reversePattern.exec(html)?.[1] ?? '')
}

function htmlSnapshot(html: string, maxChars: number): { title: string; description: string; headings: string[]; excerpt: string } {
  const title = cleanText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '')
  const description = metaContent(html, 'description')
  const headings = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((match) => cleanText(match[1] ?? ''))
    .filter(Boolean)
    .slice(0, 20)
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  return { title, description, headings, excerpt: cleanText(body).slice(0, maxChars) }
}

function isPublicUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function sourceType(url: string, purpose: ProductResearchPurpose): ProductSourceType {
  const host = new URL(url).hostname.toLowerCase()
  if (purpose === 'regulation') return 'regulation'
  if (purpose === 'competitor' || purpose === 'pricing-packaging') return host.includes('g2') || host.includes('capterra') ? 'market-data' : 'competitor'
  if (purpose === 'market-context') return host.includes('statista') || host.includes('gartner') || host.includes('forrester') ? 'market-data' : 'news'
  if (host.includes('github') || host.includes('reddit') || host.includes('news.ycombinator') || host.includes('forum')) return 'community'
  if (host.includes('arxiv') || host.includes('researchgate') || host.includes('scholar.google')) return 'research'
  if (host.includes('gov') || host.includes('iso.org') || host.includes('standards')) return 'regulation'
  if (host.includes('news') || host.includes('techcrunch') || host.includes('theverge')) return 'news'
  if (host.includes('g2') || host.includes('capterra') || host.includes('appsumo')) return 'market-data'
  return 'official'
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value)
    url.hash = ''
    return url.toString()
  } catch {
    return value.trim()
  }
}

function sourceFromSearch(source: { url: string; title?: string; snippet?: string; publishedAt?: string }, query: string, purpose: ProductResearchPurpose): ProductResearchSource {
  const url = normalizeUrl(source.url)
  return {
    url,
    query,
    title: source.title?.trim() || new URL(url).hostname,
    snippet: source.snippet?.trim() || '搜索提供方未返回摘要；需要打开原文核验。',
    publishedAt: source.publishedAt,
    sourceType: sourceType(url, purpose),
    evidenceBoundary: '搜索结果标题/摘要只能支持定性线索；关键事实、数字和时间点必须打开原文核验。',
  }
}

export async function searchProductSources(
  web: ProductWebLike,
  queries: string[],
  purpose: ProductResearchPurpose,
  config: ProductConfig,
  signal?: AbortSignal,
): Promise<ProductResearchResult> {
  const requestedQueries = [...new Set(queries.map((query) => query.trim()).filter(Boolean))]
  const selectedQueries = requestedQueries.slice(0, config.maxResearchQueries)
  const warnings: string[] = []
  const sources: ProductResearchSource[] = []
  const providerContent: string[] = []
  for (const query of selectedQueries) {
    try {
      const result = await web.search({ query, maxResults: config.maxResearchResults }, signal)
      sources.push(...result.sources.map((source) => sourceFromSearch(source, query, purpose)))
      if (result.content?.trim()) providerContent.push(result.content.trim().slice(0, config.maxResearchChars))
      if (result.truncated) warnings.push(`Search results for '${query}' were truncated to ${config.maxResearchResults}.`)
    } catch (error) {
      warnings.push(`Could not search '${query}': ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (requestedQueries.length > config.maxResearchQueries) warnings.push(`Only the first ${config.maxResearchQueries} research queries were executed.`)
  const uniqueSources = [...new Map(sources.map((source) => [source.url, source])).values()]
  const searchStatus = uniqueSources.length === 0 ? 'unavailable' : warnings.length > 0 ? 'partial' : 'ready'
  return {
    generatedAt: new Date().toISOString(),
    queries: selectedQueries,
    purpose,
    sources: uniqueSources,
    providerContent: providerContent.length > 0 ? providerContent : undefined,
    searchStatus,
    warnings,
    assumptions: [
      '本次查询只使用公开 HTTP(S) 资讯；未将 defaultRoot 下的本地文件自动发送给网络提供方。',
      '搜索摘要是线索，不是已经核验的事实；产品决策必须保留原文 URL、发布时间和证据边界。',
    ],
    nextActions: uniqueSources.length > 0
      ? ['打开官方、一手或原始研究来源，核验关键事实、发布日期、适用范围和限制。', '将核验后的证据挂到 Product Brief、POC 风险或决策门，而不是直接把搜索热度当作需求证据。']
      : ['检查 Web 搜索提供方是否已配置；如果资讯不可访问，明确标记为缺证据，不要用猜测替代。'],
  }
}

export async function scanProductSources(
  web: ProductWebLike,
  urls: string[],
  purpose: ProductResearchPurpose,
  config: ProductConfig,
  signal?: AbortSignal,
): Promise<ProductSourceScanResult> {
  const requestedUrls = [...new Set(urls.map((url) => url.trim()).filter(Boolean))]
  const selectedUrls = requestedUrls.slice(0, config.maxResearchQueries * config.maxResearchResults)
  const warnings: string[] = []
  const sources: ProductResearchSource[] = []
  for (const value of selectedUrls) {
    if (!isPublicUrl(value)) {
      warnings.push(`Skipped invalid public URL '${value}'; only HTTP(S) URLs are supported.`)
      continue
    }
    const url = normalizeUrl(value)
    try {
      const result = await web.fetch({ url }, signal)
      const extracted = result.body.kind === 'html'
        ? htmlSnapshot(result.body.content, config.maxResearchChars)
        : { title: '', description: '', headings: [], excerpt: cleanText(result.body.content).slice(0, config.maxResearchChars) }
      const statusWarning = result.statusCode >= 400 ? [`HTTP status ${result.statusCode}`] : []
      warnings.push(...statusWarning.map((warning) => `${url}: ${warning}`))
      sources.push({
        url,
        title: extracted.title || new URL(url).hostname,
        snippet: extracted.description || extracted.excerpt.slice(0, 500),
        sourceType: sourceType(url, purpose),
        evidenceBoundary: '公开 URL 的有限快照；页面可能动态渲染、需要登录或因长度限制而不完整，关键事实仍需人工核验。',
        fetchedAt: new Date().toISOString(),
        statusCode: result.statusCode,
        headings: extracted.headings,
        excerpt: extracted.excerpt,
        contentKind: result.body.kind,
        truncated: result.truncated || result.body.content.length > config.maxResearchChars,
      })
    } catch (error) {
      warnings.push(`Could not fetch '${url}': ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (requestedUrls.length > selectedUrls.length) warnings.push(`Only the first ${selectedUrls.length} public URLs were scanned.`)
  return {
    generatedAt: new Date().toISOString(),
    purpose,
    sources,
    warnings,
    assumptions: [
      '只读取用户明确提供的公开 HTTP(S) URL；不会携带 Cookie、登录态或本地项目文件。',
      '页面快照已做长度限制；动态页面、登录页和被阻断页面可能无法代表完整内容。',
    ],
    nextActions: sources.length > 0
      ? ['核验页面发布时间、作者/机构、原始数据和适用范围，再将证据绑定到产品阶段 gate。']
      : ['检查 URL 是否公开可访问；无法访问的来源应保留为缺口，不要假设其内容。'],
  }
}
