//! gettext: the catalog directory, the language, and the lookup.
//!
//! The msgids are the English text in `src/locales/en.rs`, so nothing is
//! extracted from the source tree: `po/*.po` translate those strings, `msgfmt`
//! compiles them, and this module hands [`core::i18n`](crate::core::i18n) the
//! lookup that falls back to the msgid when a catalog does not carry it.
//!
//! `LANGUAGE` is GNU gettext's own override and outranks `LC_MESSAGES` for
//! messages only, which is what makes the in-app preference possible without
//! editing the user's environment. `system` leaves it alone and the session
//! decides; an explicit choice pins one of the catalogs we ship.

use std::ffi::{CStr, CString, c_char};
use std::sync::OnceLock;

use crate::core::i18n::{Language, Translator};

/// The text domain: the name of the `.mo` file.
const DOMAIN: &str = "puzzle-timer";

/// Where the compiled catalogs are.
///
/// `build.rs` compiles every `po/*.po` into `OUT_DIR/locale`, which is what
/// `cargo run` reads. A Meson build passes the installed catalog directory, so
/// the binary it installs finds `$prefix/share/puzzle-timer/locale` instead.
fn locale_dir() -> &'static str {
    option_env!("PUZZLE_TIMER_LOCALEDIR").unwrap_or(concat!(env!("OUT_DIR"), "/locale"))
}

// glibc keeps the pointers it is given, not copies, so these have to outlive
// the call that installs them.
fn domain() -> &'static CString {
    static DOMAIN_C: OnceLock<CString> = OnceLock::new();
    DOMAIN_C.get_or_init(|| CString::new(DOMAIN).expect("the domain has no NUL"))
}

fn directory() -> &'static CString {
    static DIRECTORY: OnceLock<CString> = OnceLock::new();
    DIRECTORY.get_or_init(|| CString::new(locale_dir()).expect("the locale path has no NUL"))
}

unsafe extern "C" {
    // libintl, from libc on a glibc system. glib wraps the lookup
    // (`g_dgettext`), but neither it nor libc exposes the binding calls.
    fn bindtextdomain(domain: *const c_char, dirname: *const c_char) -> *mut c_char;
    fn bind_textdomain_codeset(domain: *const c_char, codeset: *const c_char) -> *mut c_char;
}

/// Pick the language and install the catalog lookup.
pub fn init(language: Language) {
    // Adopt the environment's locale: it is what GLib's date formatter reads,
    // and it is what gettext consults around `LANGUAGE`.
    unsafe {
        libc::setlocale(libc::LC_ALL, c"".as_ptr());
        bindtextdomain(domain().as_ptr(), directory().as_ptr());
        // The catalogs are UTF-8. Without pinning the output codeset, gettext
        // would convert to the user's charset, which a Rust `String` cannot
        // hold.
        bind_textdomain_codeset(domain().as_ptr(), c"UTF-8".as_ptr());
    }

    if let Some(locale) = language.gettext_locale() {
        // Safe: the strings are ours and no other thread reads the
        // environment while the window is being assembled.
        unsafe {
            glib::setenv("LANGUAGE", locale, true).ok();
        }

        // glibc ignores LANGUAGE while LC_MESSAGES is the C locale, which is
        // what a session with LANG=C hands us. The preference is an explicit
        // instruction, so ask for the locale itself; when the system has not
        // generated it, the untranslated msgids are the honest answer.
        if locale != "en" && is_c_locale() {
            for name in [format!("{locale}.UTF-8"), locale.to_string()] {
                let Ok(name) = CString::new(name) else {
                    continue;
                };
                if !unsafe { libc::setlocale(libc::LC_MESSAGES, name.as_ptr()) }.is_null() {
                    break;
                }
            }
        }
    }

    crate::core::i18n::install(Translator {
        text: translate,
        plural: translate_plural,
    });
}

/// Whether `LC_MESSAGES` is a C locale, which is the one case where gettext
/// refuses `LANGUAGE`.
fn is_c_locale() -> bool {
    let name = unsafe { libc::setlocale(libc::LC_MESSAGES, std::ptr::null()) };
    if name.is_null() {
        return true;
    }
    let name = unsafe { CStr::from_ptr(name) }.to_string_lossy();
    name == "C" || name == "POSIX" || name.starts_with("C.")
}

fn translate(msgid: &str) -> String {
    glib::dgettext(Some(DOMAIN), msgid).to_string()
}

fn translate_plural(one: &str, other: &str, count: u64) -> String {
    glib::dngettext(Some(DOMAIN), one, other, count as libc::c_ulong).to_string()
}
