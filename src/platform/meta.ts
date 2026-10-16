/*
 * meta.ts — app metadata read from package.json and CHANGELOG.md.
 *
 * Node-only: `fs` lives in src/platform/. Paths resolve relative to this
 * module, so one relative path serves both `src/` under tsx and `dist/` after
 * a build. Reading the values here keeps the About dialog, package.json and
 * the changelog from disagreeing.
 */
import fs from 'node:fs'

interface PackageInfo {
  version?: string
  repository?: string | { url?: string }
  bugs?: { url?: string }
}

function readPackage(): PackageInfo {
  try {
    return JSON.parse(
      fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as PackageInfo
  } catch {
    return {}
  }
}

const pkg = readPackage()

/**
 * The app version. A missing or malformed value must not take the About
 * dialog down with it — it reports the anomaly instead of throwing out of an
 * action handler.
 */
export const APP_VERSION =
  pkg.version && /^\d+\.\d+\.\d+$/.test(pkg.version) ? pkg.version : 'unknown'

/** `git+https://host/owner/repo.git#readme` → `https://host/owner/repo`. */
function httpsUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const clean = raw.replace(/^git\+/, '').replace(/#.*$/, '').replace(/\.git$/, '')
  return /^https:\/\//.test(clean) ? clean : null
}

export const APP_REPOSITORY = httpsUrl(
  typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url,
)

export const APP_ISSUES =
  httpsUrl(pkg.bugs?.url) ?? (APP_REPOSITORY === null ? null : `${APP_REPOSITORY}/issues`)

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const inline = (text: string): string =>
  escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')

/**
 * The changelog section for the current version, as the HTML `releaseNotes`
 * expects. Null when the file is absent or silent about this version — a
 * build that ships without CHANGELOG.md is legitimate, not an error.
 */
export function releaseNotesHtml(): string | null {
  let markdown: string
  try {
    markdown = fs.readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8')
  } catch {
    return null
  }
  const section = markdown
    .split(/^## /m)
    .find((part) => part.startsWith(`[${APP_VERSION}]`))
  if (section === undefined) return null

  // The changelog is hard-wrapped, so a line that follows a non-blank one
  // continues it rather than starting a new paragraph.
  const out: string[] = []
  let items: string[] = []
  let paragraph: string | null = null
  const flushItems = (): void => {
    if (items.length > 0) {
      out.push(`<ul>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`)
      items = []
    }
  }
  const flushParagraph = (): void => {
    if (paragraph !== null) {
      out.push(`<p>${inline(paragraph)}</p>`)
      paragraph = null
    }
  }
  const flush = (): void => {
    flushItems()
    flushParagraph()
  }
  for (const line of section.split('\n').slice(1)) {
    const text = line.trim()
    if (text.startsWith('### ')) {
      flush()
      out.push(`<h3>${inline(text.slice(4))}</h3>`)
    } else if (text.startsWith('- ')) {
      flushParagraph()
      items.push(text.slice(2))
    } else if (text === '' || text.startsWith('[')) {
      flush()
    } else if (items.length > 0) {
      items[items.length - 1] += ` ${text}`
    } else {
      paragraph = paragraph === null ? text : `${paragraph} ${text}`
    }
  }
  flush()
  return out.length > 0 ? out.join('\n') : null
}
