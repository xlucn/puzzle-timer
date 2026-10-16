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

/** The section's first bullet with its wrapped continuation lines joined. */
function firstBullet(section: string): string {
  const lines = section.split('\n')
  const start = lines.findIndex((line) => line.startsWith('- '))
  if (start < 0) return ''
  let bullet = lines[start].slice(2)
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (line === '' || line.startsWith('- ') || line.startsWith('#')) break
    bullet += ` ${line}`
  }
  return bullet
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
    const bullet = firstBullet(currentSection())
    const html = releaseNotesHtml()
    // The bug this guards: a wrapped line became its own <p>, so the words of
    // one bullet ended up split across paragraphs and out of order.
    expect(bullet.length).toBeGreaterThan(60)
    expect(html).not.toBeNull()
    expect(plain(html ?? '')).toContain(plainMarkdown(bullet))
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
