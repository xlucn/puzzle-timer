/*
 * meta.ts — app metadata read from package.json (AGENTS.md M13: "One
 * version, one place").
 *
 * Node-only (AGENTS.md rule 2): `fs` lives in src/platform/. The About
 * dialog's version comes from here — a literal in main.ts would drift from
 * package.json the moment either is bumped, which is the bug this file
 * prevents.
 *
 * The path is resolved relative to this module (`import.meta.url`), so it
 * works both under tsx (src/platform/meta.ts) and compiled (dist/platform/
 * meta.js): both are one directory below the package root.
 */
import fs from 'node:fs'

/** The contents of package.json this file cares about. */
interface PackageInfo {
  version?: string
}

function readVersion(): string {
  try {
    const raw = fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
    const pkg = JSON.parse(raw) as PackageInfo
    // A missing/garbled version must not crash the About dialog: report the
    // anomaly instead of throwing into an action handler.
    if (pkg.version && /^\d+\.\d+\.\d+/.test(pkg.version)) return pkg.version
  } catch {
    // fall through
  }
  return 'unknown'
}

/** The app version, read from package.json at startup. */
export const APP_VERSION = readVersion()
