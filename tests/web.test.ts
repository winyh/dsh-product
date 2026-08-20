import { describe, expect, it } from 'vitest'
import { scanProductSources, searchProductSources, type ProductWebLike } from '../src/web.js'
import type { ProductConfig } from '../src/types.js'

const config: ProductConfig = {
  defaultRoot: 'D:\\ObsidianData',
  reportDir: '.dsh-product/reports',
  maxFiles: 500,
  maxRows: 100_000,
  maxFileBytes: 1_048_576,
  maxTextChars: 180_000,
  maxResultChars: 50_000,
  defaultLanguage: 'zh-CN',
  defaultTimezone: 'Asia/Shanghai',
  maxResearchQueries: 2,
  maxResearchResults: 2,
  maxResearchChars: 1_000,
  requestTimeoutMs: 30_000,
}

describe('product web research', () => {
  it('keeps citeable search sources and declares their evidence boundary', async () => {
    const web: ProductWebLike = {
      async search() {
        return {
          content: 'provider context',
          truncated: false,
          sources: [{ url: 'https://example.com/release#latest', title: 'Release notes', snippet: 'New capability', publishedAt: '2026-08-01' }],
        }
      },
      async fetch() {
        throw new Error('not used')
      },
    }
    const result = await searchProductSources(web, ['最新发布', '最新发布'], 'release-notes', config)
    expect(result.queries).toEqual(['最新发布'])
    expect(result.sources[0]?.url).toBe('https://example.com/release')
    expect(result.sources[0]?.publishedAt).toBe('2026-08-01')
    expect(result.sources[0]?.evidenceBoundary).toContain('原文核验')
    expect(result.assumptions.some((item) => item.includes('未将 defaultRoot'))).toBe(true)
  })

  it('scans only public URLs and bounds the returned page snapshot', async () => {
    const web: ProductWebLike = {
      async search() {
        throw new Error('not used')
      },
      async fetch(request) {
        expect(request.url).toBe('https://example.com/docs')
        return {
          url: request.url,
          statusCode: 200,
          truncated: false,
          body: { kind: 'html', content: '<html><head><title>Docs</title></head><body><h1>Product</h1>useful details</body></html>' },
        }
      },
    }
    const result = await scanProductSources(web, ['file:///private', 'https://example.com/docs'], 'technical-feasibility', config)
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0]?.title).toBe('Docs')
    expect(result.sources[0]?.headings).toEqual(['Product'])
    expect(result.warnings.some((warning) => warning.includes('only HTTP(S)'))).toBe(true)
    expect(result.assumptions.some((item) => item.includes('Cookie'))).toBe(true)
  })
})
