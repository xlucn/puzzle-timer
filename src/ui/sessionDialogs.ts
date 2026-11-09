/*
 * sessionDialogs.ts — the session name and delete dialogs.
 *
 * The session menu and the session manager both need the same name
 * validation, wording and guarded delete; this module keeps one copy so the
 * two entry points cannot drift. The library is the only judge of what a
 * name may be — the dialog's sensitivity and message both read
 * `library.nameError()`.
 */
import Adw from 'gi:Adw-1'
import Gtk from 'gi:Gtk-4.0'

import { t } from '../core/i18n.js'
import {
  MAX_NAME_LENGTH,
  type NameError,
  type SessionLibrary,
} from '../core/sessionLibrary.js'

type Window = InstanceType<typeof Adw.ApplicationWindow>

export interface SessionDialogsOptions {
  /** The session list the dialogs read and mutate. */
  library: SessionLibrary
  /** Toplevel the dialogs are presented on. */
  window: Window
  /** Solve count, for the delete confirmation (may load the session). */
  getSolveCount: (id: string) => number
}

export function createSessionDialogs(options: SessionDialogsOptions) {
  const { library, window } = options

  const messageFor = (error: NameError): string => {
    switch (error) {
      case 'empty':
        return t('session.error.name')
      case 'long':
        return t('session.error.long', { count: MAX_NAME_LENGTH })
      case 'duplicate':
        return t('session.error.taken')
    }
  }

  const promptForName = (settings: {
    heading: string
    acceptLabel: string
    /** Shown under the entry until it is replaced by a validation message. */
    body: string
    initial: string
    /** The session whose name may be kept as-is (rename), or null (new). */
    exceptId: string | null
    onSubmit: (name: string) => void
  }) => {
    const entry = new Gtk.Entry({
      text: settings.initial,
      placeholderText: t('session.name'),
      // Enter submits: activates the dialog's default response instead of
      // needing a trip to the buttons.
      activatesDefault: true,
      maxLength: MAX_NAME_LENGTH,
    })

    const dialog = new Adw.AlertDialog({
      heading: settings.heading,
      extraChild: entry,
    })
    dialog.addResponse('cancel', t('common.cancel'))
    dialog.addResponse('accept', settings.acceptLabel)
    dialog.setResponseAppearance('accept', Adw.ResponseAppearance.SUGGESTED)
    dialog.setDefaultResponse('accept')
    dialog.setCloseResponse('cancel')

    const sync = () => {
      const error = library.nameError(entry.getText(), settings.exceptId)
      dialog.setResponseEnabled('accept', error === null)
      dialog.body = error === null ? settings.body : messageFor(error)
    }
    entry.on('changed', sync)
    sync()

    dialog.on('response', (response) => {
      if (response === 'accept') settings.onSubmit(entry.getText())
    })
    dialog.present(window)
    // AdwAlertDialog's default response button claims focus on map, so the
    // caret would land on the accept button instead of in the entry. Take
    // focus back after GTK's own focus pass (map + a timer beat present()),
    // with the current name selected so typing replaces it.
    const claim = () => {
      entry.grabFocus()
      if (settings.initial.length > 0) entry.selectRegion(0, -1)
    }
    dialog.on('map', () => setTimeout(claim, 0))
    setTimeout(claim, 0)
  }

  return {
    /** Ask for a name and create (and switch to) the session. */
    promptNew: () => {
      promptForName({
        heading: t('session.new'),
        acceptLabel: t('common.create'),
        body: t('session.new.description'),
        initial: '',
        exceptId: null,
        onSubmit: (name) => library.create(name),
      })
    },

    /** Rename `id`; the id (and so the file) stays the same. */
    promptRename: (id: string) => {
      const session = library.find(id)
      if (session === undefined) return
      promptForName({
        heading: t('session.rename'),
        acceptLabel: t('common.rename'),
        body: '',
        initial: session.name,
        exceptId: session.id,
        onSubmit: (name) => library.rename(session.id, name),
      })
    },

    /** Confirm before deleting `id`; the last session cannot be removed. */
    confirmDelete: (id: string) => {
      const session = library.find(id)
      if (session === undefined) return
      const count = options.getSolveCount(id)
      const dialog = new Adw.AlertDialog({
        heading: t('session.delete.title', { name: session.name }),
        body:
          count === 0
            ? t('session.delete.empty')
            : t('session.delete.body', { count }),
      })
      dialog.addResponse('cancel', t('common.cancel'))
      dialog.addResponse('delete', t('common.delete'))
      dialog.setResponseAppearance('delete', Adw.ResponseAppearance.DESTRUCTIVE)
      // Escape and Enter land on Cancel: deleting a session is guarded, never
      // the default.
      dialog.setDefaultResponse('cancel')
      dialog.setCloseResponse('cancel')
      dialog.on('response', (response) => {
        if (response === 'delete') library.remove(session.id)
      })
      dialog.present(window)
    },
  }
}
