/*
 * meta.ts is read from the real package.json and CHANGELOG.md, so these
 * tests assert against those files rather than fixtures — the point is that
 * the app cannot disagree with them.
 */
import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

import { APP_ISSUES, APP_REPOSITORY, APP_VERSION, releaseNotesHtml } from './meta.js'

const read = (file: string): string =>
  fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')

/**
 * Strip markup and collapse whitespace, so text compares as a reader sees it.
 * Stripping a tag leaves a space, so `result <em>x</em>, y` would otherwise
 * normalise to `result x , y` and fail against the source markdown.
 */
const plain = (text: string): string =>
  text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

/** The same inline markdown the converter resolves, removed for comparison. */
const plainMarkdown = (text: string): string =>
  plain(text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1'))

function currentSection(): string {
  return read('CHANGELOG.md')
    .split(/^## /m)
    .find((part) => part.startsWith(`[${APP_VERSION}]`)) ?? ''
}

/** The section's bullets, each with its wrapped continuation lines joined. */
function bullets(section: string): string[] {
  const lines = section.split('\n')
  const out: string[] = []
  for (let start = 0; start < lines.length; start += 1) {
    if (!lines[start].startsWith('- ')) continue
    let bullet = lines[start].slice(2)
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i].trim()
      if (line === '' || line.startsWith('- ') || line.startsWith('#')) break
      bullet += ` ${line}`
    }
    out.push(bullet)
  }
  return out
}

describe('meta', () => {
  it('reports exactly the version package.json declares', () => {
    expect(APP_VERSION).toBe((JSON.parse(read('package.json')) as { version: string }).version)
    expect(APP_VERSION).not.toBe('unknown')
  })

  it('normalises the repository to a browsable https URL', () => {
    expect(APP_REPOSITORY).toMatch(/^https:\/\/[^/]+\/.+/)
    expect(APP_REPOSITORY).not.toMatch(/^git\+|\.git$|#/)
    expect(APP_ISSUES).toBe(`${APP_REPOSITORY}/issues`)
  })

  it('keeps hard-wrapped changelog lines inside their own bullet', () => {
    // The bug this guards: a wrapped line became its own <p>, so the words of
    // one bullet ended up split across paragraphs and out of order. Walking
    // every bullet covers the wrapped ones — the ones that break — and no
    // longer depends on the first of them being long enough to wrap.
    const list = bullets(currentSection())
    const html = releaseNotesHtml()
    expect(list.length).toBeGreaterThan(0)
    expect(html).not.toBeNull()
    const text = plain(html ?? '')
    for (const bullet of list) {
      expect(text, `bullet lost or split: ${bullet}`).toContain(plainMarkdown(bullet))
    }
  })

  it('renders the current section as markup, not raw markdown', () => {
    const html = releaseNotesHtml() ?? ''
    expect(html).toContain('<ul>')
    expect(html).not.toContain('**')
    expect(html).not.toMatch(/(^|\s)```/)
  })

  it('emits only the markup AdwAboutDialog accepts', () => {
    // Adw parses release notes as AppStream description markup, not HTML:
    // an unlisted element aborts the dialog with a GMarkup error instead of
    // being rendered or ignored.
    const allowed = new Set(['p', 'ul', 'ol', 'li', 'em', 'code'])
    const tags = [...(releaseNotesHtml() ?? '').matchAll(/<\/?([a-z0-9]+)>/g)].map(
      (match) => match[1],
    )
    expect(tags.length).toBeGreaterThan(0)
    expect([...new Set(tags)].filter((tag) => !allowed.has(tag))).toEqual([])
  })
})
