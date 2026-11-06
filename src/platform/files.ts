/*
 * files.ts — reading and writing the file a user picked in a Gtk.FileDialog.
 *
 * Node-only by design (AGENTS.md rule 2): `fs` stays out of src/ui/ and
 * src/core/. The dialog itself lives in main.ts — it is a widget — and hands
 * this module an absolute path.
 *
 * Async, not sync: an export can hold thousands of solves, and the window
 * should not stop painting while it is written. Errors are left to reject;
 * the caller turns them into one translated toast and logs the detail.
 */
import { readFile, writeFile } from 'node:fs/promises'

/** Read a UTF-8 text file. */
export async function readTextFile(file: string): Promise<string> {
  return await readFile(file, 'utf8')
}

/** Replace a UTF-8 text file (the dialog already asked about overwriting). */
export async function writeTextFile(file: string, text: string): Promise<void> {
  await writeFile(file, text, 'utf8')
}
