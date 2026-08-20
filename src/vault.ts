import { parseNote } from './markdown.js'
import type { FileSystemLike, ProductArtifactType, ProductConfig, ProductNote, ProductVaultScan } from './types.js'

const supported = new Set(['.md', '.markdown', '.csv', '.json', '.jsonl', '.ndjson'])

function extension(path: string): string {
  return path.match(/\.[^.\\/]+$/)?.[0]?.toLowerCase() ?? ''
}

function childPath(parent: string, name: string): string {
  return `${parent.replace(/[\\/]+$/, '')}\\${name}`
}

function isProductNote(note: ProductNote): boolean {
  if (note.artifactType) return true
  return /product|产品|POC|MVP|PMF|PRD|beta|试点|roadmap|路线图|上线|发布/i.test(note.content)
}

function typeFromNote(note: ProductNote): ProductArtifactType {
  return note.artifactType ?? 'product-context'
}

function noteReasons(note: ProductNote): string[] {
  const reasons: string[] = []
  if (!note.frontmatter.type) reasons.push('missing type')
  if (!note.frontmatter.status) reasons.push('missing status')
  if (!note.frontmatter.updated) reasons.push('missing updated date')
  if (!note.frontmatter.owner) reasons.push('missing owner')
  if (note.externalLinks.length === 0 && !note.frontmatter.source) reasons.push('missing source or lineage')
  return reasons.length > 0 ? reasons : ['healthy']
}

export async function readProductNote(fs: FileSystemLike, path: string, config: ProductConfig, signal?: AbortSignal): Promise<ProductNote> {
  const target = await fs.resolve(path, { signal })
  const info = await fs.stat(target, signal)
  if (!info || info.type !== 'file') throw new Error(`Markdown file not found: ${path}`)
  if ((info.size ?? 0) > config.maxFileBytes) throw new Error(`File exceeds maxFileBytes (${config.maxFileBytes})`)
  const content = await fs.readText(target, signal)
  if (content.length > config.maxTextChars) throw new Error(`File exceeds maxTextChars (${config.maxTextChars})`)
  return parseNote(path, content)
}

export async function scanProductVault(fs: FileSystemLike, root: string, config: ProductConfig, signal?: AbortSignal): Promise<ProductVaultScan> {
  const files: ProductVaultScan['files'] = []
  const productNotes: ProductVaultScan['productNotes'] = []
  const dataFiles: string[] = []
  const errors: string[] = []
  let skippedFiles = 0
  const walk = async (currentPath: string, currentTarget: unknown): Promise<void> => {
    if (files.length >= config.maxFiles) return
    let entries: Awaited<ReturnType<FileSystemLike['listDir']>>
    try { entries = await fs.listDir(currentTarget, signal) } catch (error) {
      errors.push(`${currentPath}: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    for (const entry of entries) {
      if (files.length >= config.maxFiles) break
      const path = childPath(currentPath, entry.name)
      if (entry.type === 'directory') {
        if (entry.name.startsWith('.')) continue
        await walk(path, entry.target)
        continue
      }
      const ext = extension(entry.name)
      if (!supported.has(ext)) { skippedFiles += 1; continue }
      if ((entry.size ?? 0) > config.maxFileBytes) {
        files.push({ path, extension: ext, size: entry.size ?? 0, status: 'skipped', reason: `exceeds maxFileBytes (${config.maxFileBytes})` })
        continue
      }
      if (ext !== '.md' && ext !== '.markdown') {
        files.push({ path, extension: ext, size: entry.size ?? 0, status: 'supported' })
        if (/pmf|retention|usage|survey|beta|product|event|metric/i.test(path)) dataFiles.push(path)
        continue
      }
      try {
        const content = await fs.readText(entry.target, signal)
        if (content.length > config.maxTextChars) {
          files.push({ path, extension: ext, size: entry.size ?? 0, status: 'skipped', reason: `exceeds maxTextChars (${config.maxTextChars})` })
          continue
        }
        const note = parseNote(path, content)
        if (!isProductNote(note)) continue
        const artifactType = typeFromNote(note)
        const reasons = noteReasons(note)
        files.push({ path, extension: ext, size: entry.size ?? 0, status: 'supported', artifactType })
        productNotes.push({ path, title: note.title, artifactType, status: String(note.frontmatter.status ?? 'unstated'), reasons })
      } catch (error) {
        files.push({ path, extension: ext, size: entry.size ?? 0, status: 'error', reason: error instanceof Error ? error.message : String(error) })
        errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  const target = await fs.resolve(root, { signal })
  await walk(root, target)
  const byType: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  for (const note of productNotes) {
    byType[note.artifactType] = (byType[note.artifactType] ?? 0) + 1
    byStatus[note.status] = (byStatus[note.status] ?? 0) + 1
  }
  return { root, generatedAt: new Date().toISOString(), files, productNotes, dataFiles, skippedFiles, errors, byType, byStatus }
}
