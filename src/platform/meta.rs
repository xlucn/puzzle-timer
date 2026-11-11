//! App metadata.
//!
//! The version has one home: `Cargo.toml`, read back at compile time. The
//! changelog is embedded too, because the About dialog parses its release
//! notes from it and a packaged binary should not depend on a data file for
//! that.

/// The application id; the desktop file and icon names derive from it.
pub const APP_ID: &str = "io.github.xlucn.PuzzleTimer";

/// The version from `Cargo.toml`, never a literal.
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// The project page from `Cargo.toml`, never a literal.
pub const APP_REPOSITORY: &str = env!("CARGO_PKG_REPOSITORY");

/// Where bugs are filed.
pub const APP_ISSUES: &str = concat!(env!("CARGO_PKG_REPOSITORY"), "/issues");

/// The changelog, embedded at build time.
pub const CHANGELOG: &str = include_str!("../../CHANGELOG.md");

/// Escape the three characters AppStream's GMarkup parser would choke on.
fn escape_html(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Replace `delimiter`-wrapped spans with `open` … `close`, leaving an
/// unmatched delimiter verbatim.
fn replace_pairs(text: &str, delimiter: &str, open: &str, close: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(delimiter) {
        let after = &rest[start + delimiter.len()..];
        let Some(end) = after.find(delimiter) else {
            break;
        };
        out.push_str(&rest[..start]);
        out.push_str(open);
        out.push_str(&after[..end]);
        out.push_str(close);
        rest = &after[end + delimiter.len()..];
    }
    out.push_str(rest);
    out
}

/// Resolve the inline markdown the changelog uses into AppStream markup.
///
/// AdwAboutDialog parses release notes as an AppStream description, not HTML:
/// only `<p>`, `<ul>`/`<ol>` with `<li>`, `<em>` and `<code>` are accepted, and
/// an unknown element aborts the whole dialog with a GMarkup error. So emphasis
/// degrades to `<em>` (there is no bold) and headings become paragraphs.
fn inline(text: &str) -> String {
    let escaped = escape_html(text);
    let emphasised = replace_pairs(&escaped, "**", "<em>", "</em>");
    replace_pairs(&emphasised, "`", "<code>", "</code>")
}

/// The changelog section for the current version, as the `releaseNotes` markup
/// expects. `None` when the file is absent or silent about this version — a
/// build that ships without a changelog is legitimate, not an error.
pub fn release_notes_html() -> Option<String> {
    let marker = format!("## [{APP_VERSION}]");
    let start = CHANGELOG.find(&marker)?;
    let body_start = start + CHANGELOG[start..].find('\n')? + 1;
    let rest = &CHANGELOG[body_start..];
    let body_end = rest
        .find("\n## ")
        .map_or(CHANGELOG.len(), |at| body_start + at);
    let section = &CHANGELOG[body_start..body_end];

    // The changelog is hard-wrapped, so a line that follows a non-blank one
    // continues it rather than starting a new paragraph.
    let mut out: Vec<String> = Vec::new();
    let mut items: Vec<String> = Vec::new();
    let mut paragraph: Option<String> = None;

    fn flush_items(items: &mut Vec<String>, out: &mut Vec<String>) {
        if items.is_empty() {
            return;
        }
        let mut html = String::from("<ul>");
        for item in items.iter() {
            html.push_str("<li>");
            html.push_str(&inline(item));
            html.push_str("</li>");
        }
        html.push_str("</ul>");
        out.push(html);
        items.clear();
    }

    fn flush_paragraph(paragraph: &mut Option<String>, out: &mut Vec<String>) {
        if let Some(text) = paragraph.take() {
            out.push(format!("<p>{}</p>", inline(&text)));
        }
    }

    fn flush(items: &mut Vec<String>, paragraph: &mut Option<String>, out: &mut Vec<String>) {
        flush_items(items, out);
        flush_paragraph(paragraph, out);
    }

    for line in section.lines() {
        let text = line.trim();
        if text.starts_with("### ") {
            // Keep a Changelog's categories (Added / Changed / …) are document
            // scaffolding: the bullets carry the meaning, and Adw has no
            // headings.
            flush(&mut items, &mut paragraph, &mut out);
        } else if let Some(item) = text.strip_prefix("- ") {
            flush_paragraph(&mut paragraph, &mut out);
            items.push(item.to_string());
        } else if text.is_empty() || text.starts_with('[') {
            flush(&mut items, &mut paragraph, &mut out);
        } else if let Some(last) = items.last_mut() {
            last.push(' ');
            last.push_str(text);
        } else {
            paragraph = Some(match paragraph {
                Some(existing) => format!("{existing} {text}"),
                None => text.to_string(),
            });
        }
    }
    flush(&mut items, &mut paragraph, &mut out);
    (!out.is_empty()).then(|| out.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_is_semver() {
        let parts: Vec<&str> = APP_VERSION.split('.').collect();
        assert_eq!(parts.len(), 3, "version must be X.Y.Z: {APP_VERSION}");
        assert!(
            parts.iter().all(|part| part.parse::<u32>().is_ok()),
            "version must be numeric: {APP_VERSION}"
        );
    }

    #[test]
    fn changelog_is_embedded() {
        assert!(CHANGELOG.contains("# Changelog"));
    }

    #[test]
    fn repository_is_a_browsable_https_url() {
        assert!(APP_REPOSITORY.starts_with("https://"), "{APP_REPOSITORY}");
        assert!(!APP_REPOSITORY.ends_with(".git"), "{APP_REPOSITORY}");
        assert_eq!(APP_ISSUES, format!("{APP_REPOSITORY}/issues"));
    }

    /// The current section's bullets, each with its wrapped continuation lines
    /// joined.
    fn bullets() -> Vec<String> {
        let section = release_notes_html().expect("release notes");
        let _ = section;
        let marker = format!("## [{APP_VERSION}]");
        let start = CHANGELOG.find(&marker).expect("section");
        let body = &CHANGELOG[start..];
        let end = body.find("\n## ").unwrap_or(body.len());
        let lines: Vec<&str> = body[..end].lines().collect();
        let mut out = Vec::new();
        let mut index = 0;
        while index < lines.len() {
            if let Some(item) = lines[index].strip_prefix("- ") {
                let mut bullet = item.to_string();
                index += 1;
                while index < lines.len() {
                    let line = lines[index].trim();
                    if line.is_empty() || line.starts_with("- ") || line.starts_with('#') {
                        break;
                    }
                    bullet.push(' ');
                    bullet.push_str(line);
                    index += 1;
                }
                out.push(bullet);
            } else {
                index += 1;
            }
        }
        out
    }

    /// Strip markup (and the inline markdown markers) and collapse whitespace.
    fn plain(text: &str) -> String {
        let mut stripped = String::new();
        let mut in_tag = false;
        for ch in text.chars() {
            match ch {
                '<' => in_tag = true,
                '>' => in_tag = false,
                _ if !in_tag => stripped.push(ch),
                _ => {}
            }
        }
        stripped
            .replace("**", "")
            .replace('`', "")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
    }

    #[test]
    fn keeps_hard_wrapped_changelog_lines_inside_their_own_bullet() {
        let list = bullets();
        let html = release_notes_html().expect("release notes");
        assert!(!list.is_empty());
        let text = plain(&html);
        for bullet in list {
            assert!(
                text.contains(&plain(&bullet)),
                "bullet lost or split: {bullet}"
            );
        }
    }

    #[test]
    fn renders_the_current_section_as_markup_not_raw_markdown() {
        let html = release_notes_html().expect("release notes");
        assert!(html.contains("<ul>"));
        assert!(!html.contains("**"));
        assert!(!html.contains("```"));
    }

    #[test]
    fn emits_only_the_markup_about_dialog_accepts() {
        let html = release_notes_html().expect("release notes");
        let allowed = ["p", "ul", "ol", "li", "em", "code"];
        let mut tag = String::new();
        let mut in_tag = false;
        let mut tags: Vec<String> = Vec::new();
        for ch in html.chars() {
            match ch {
                '<' => {
                    in_tag = true;
                    tag.clear();
                }
                '>' if in_tag => {
                    in_tag = false;
                    let name = tag.trim_start_matches('/').to_string();
                    if !name.is_empty() && !tags.contains(&name) {
                        tags.push(name);
                    }
                }
                _ if in_tag => tag.push(ch),
                _ => {}
            }
        }
        assert!(!tags.is_empty());
        for tag in tags {
            assert!(allowed.contains(&tag.as_str()), "not AppStream: <{tag}>");
        }
    }

    #[test]
    fn escapes_markup_characters_before_emitting_them() {
        assert_eq!(inline("a < b & c"), "a &lt; b &amp; c");
        assert_eq!(
            inline("**bold** and `code`"),
            "<em>bold</em> and <code>code</code>"
        );
        assert_eq!(inline("unmatched ** stays"), "unmatched ** stays");
    }
}
