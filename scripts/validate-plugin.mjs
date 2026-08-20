import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const manifestPath = resolve(root, '.codex-plugin/plugin.json')
const packagePath = resolve(root, 'package.json')

if (!existsSync(manifestPath)) throw new Error('Missing .codex-plugin/plugin.json')
if (!existsSync(packagePath)) throw new Error('Missing package.json')

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
if (manifest.name !== pkg.name) throw new Error(`Manifest name (${manifest.name}) must equal package name (${pkg.name})`)
if (!manifest.name || !manifest.interface?.displayName || !manifest.description) throw new Error('Manifest requires name, interface.displayName and description')
if (pkg.main !== 'lib/index.mjs') throw new Error('package.main must point to lib/index.mjs')
if (pkg.types !== 'lib/index.d.mts') throw new Error('package.types must point to lib/index.d.mts')
if (!existsSync(resolve(root, 'cordis.patch.yml'))) throw new Error('Missing cordis.patch.yml')
if (!existsSync(resolve(root, 'lib/index.mjs'))) throw new Error('Missing built lib/index.mjs; run pnpm run build')

console.log(`plugin manifest ok: ${manifest.name} (${manifest.interface.displayName})`)
