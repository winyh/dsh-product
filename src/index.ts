import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-fs'
import * as webFetchHttp from '@deepseek-ai/dsh-web-fetch-http'
import type {} from '@deepseek-ai/dsh-web'
import { registerProductTools } from './tools.js'
import type { FileSystemLike, ProductConfig } from './types.js'
import type { ProductWebLike } from './web.js'

export const name = 'dsh-product'
export const inject = ['tools', 'fs', 'web']

export type Config = ProductConfig

export const Config: Schema<ProductConfig> = Schema.object({
  defaultRoot: Schema.string().default('.'),
  reportDir: Schema.string().default('.dsh-product/reports'),
  maxFiles: Schema.number().step(1).min(1).max(5_000).default(500),
  maxRows: Schema.number().step(1).min(1).max(500_000).default(100_000),
  maxFileBytes: Schema.number().step(1).min(1_024).max(10_485_760).default(1_048_576),
  maxTextChars: Schema.number().step(1).min(1_000).max(1_000_000).default(180_000),
  maxResultChars: Schema.number().step(1).min(1_000).max(200_000).default(50_000),
  defaultLanguage: Schema.string().default('zh-CN'),
  defaultTimezone: Schema.string().default('Asia/Shanghai'),
  maxResearchQueries: Schema.number().step(1).min(1).max(10).default(5),
  maxResearchResults: Schema.number().step(1).min(1).max(20).default(5),
  maxResearchChars: Schema.number().step(1).min(1_000).max(100_000).default(30_000),
  requestTimeoutMs: Schema.number().step(1).min(1_000).max(120_000).default(30_000),
})

export function apply(ctx: Context, config: ProductConfig): void {
  const fs = (ctx as unknown as { fs: FileSystemLike }).fs
  if (!ctx.registry.has(webFetchHttp)) {
    void ctx.plugin(webFetchHttp, {
      // Keep the shared provider defaults identical across dsh-idea, dsh-product and dsh-geo.
      // Each plugin applies its own tighter research/result limits after fetching.
      maxBodyChars: 100_000,
      maxResponseBytes: 5_000_000,
      timeoutMs: 30_000,
      maxRedirects: 5,
    })
  }
  const web = (ctx as unknown as { web: ProductWebLike }).web
  registerProductTools(ctx, config, fs, web)
  console.log(`[${name}] registered product-delivery tools with web research for ${config.defaultRoot}`)
}
