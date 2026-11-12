//! The scramble type picker: csTimer's catalogue, searchable.
//!
//! The 206 type names stay English (they are proper nouns in the cubing
//! community); the 44 category names and the four higher classes are
//! translated, so the menu reads in the user's language.

use std::rc::Rc;

use gtk4 as gtk;
use gtk4::prelude::*;
use libadwaita as adw;
use libadwaita::prelude::*;

use crate::core::i18n::{MessageKey, t_group, t_section, t0};
use crate::core::scramble_types::scramble_sections;

/// Open the picker on `parent`; `on_pick` receives the chosen type id.
pub fn open(parent: &impl IsA<gtk::Widget>, current: &str, on_pick: impl Fn(&str) + 'static) {
    let dialog = adw::Dialog::builder()
        .title(t0(MessageKey::ScrambleChooseType))
        .content_width(420)
        .content_height(560)
        .build();

    let search = gtk::SearchEntry::builder()
        .placeholder_text(t0(MessageKey::ScrambleChooseType))
        .margin_top(6)
        .margin_bottom(6)
        .margin_start(6)
        .margin_end(6)
        .build();

    let list = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::None)
        .css_classes(["boxed-list"])
        .margin_top(6)
        .margin_bottom(6)
        .margin_start(6)
        .margin_end(6)
        .build();

    // Every row that can be filtered: its searchable text and the widget.
    let mut rows: Vec<(String, gtk::Widget)> = Vec::new();

    for section in scramble_sections() {
        let heading = gtk::Label::builder()
            .label(t_section(section.name))
            .xalign(0.0)
            .margin_top(12)
            .margin_start(6)
            .css_classes(["heading"])
            .build();
        list.append(&heading);
        rows.push((String::new(), heading.upcast_ref::<gtk::Widget>().clone()));

        for group in section.groups {
            let group_heading = gtk::Label::builder()
                .label(t_group(group.name))
                .xalign(0.0)
                .margin_top(6)
                .margin_start(6)
                .css_classes(["caption", "dim-label"])
                .build();
            list.append(&group_heading);
            rows.push((
                String::new(),
                group_heading.upcast_ref::<gtk::Widget>().clone(),
            ));

            for choice in group.choices {
                let row = gtk::ListBoxRow::new();
                let label = gtk::Label::builder()
                    .label(choice.label)
                    .xalign(0.0)
                    .margin_top(6)
                    .margin_bottom(6)
                    .margin_start(6)
                    .margin_end(6)
                    .build();
                row.set_child(Some(&label));
                if choice.id == current {
                    row.add_css_class("accent");
                }
                row.set_widget_name(choice.id);
                list.append(&row);
                rows.push((
                    format!("{} {} {}", choice.label, choice.id, group.name).to_lowercase(),
                    row.upcast_ref::<gtk::Widget>().clone(),
                ));
            }
        }
    }

    let scroller = gtk::ScrolledWindow::builder()
        .child(&list)
        .hscrollbar_policy(gtk::PolicyType::Never)
        .vexpand(true)
        .build();

    let header = adw::HeaderBar::new();
    let close = gtk::Button::with_label(&t0(MessageKey::CommonCancel));
    header.pack_start(&close);

    let content = gtk::Box::new(gtk::Orientation::Vertical, 0);
    content.append(&search);
    content.append(&scroller);

    let toolbar = adw::ToolbarView::new();
    toolbar.add_top_bar(&header);
    toolbar.set_content(Some(&content));
    dialog.set_child(Some(&toolbar));

    {
        let dialog = dialog.clone();
        close.connect_clicked(move |_| {
            dialog.close();
        });
    }

    // Filter while typing. A group heading stays while any of its rows matches.
    {
        let rows = Rc::new(rows);
        search.connect_search_changed(move |search| {
            let needle = search.text().to_lowercase();
            for (text, widget) in rows.iter() {
                // Headings only make sense over the unfiltered menu; while a
                // search is running the matching types are their own list.
                if text.is_empty() {
                    widget.set_visible(needle.is_empty());
                } else {
                    widget.set_visible(needle.is_empty() || text.contains(&needle));
                }
            }
        });
    }

    let on_pick = Rc::new(on_pick);
    {
        let dialog = dialog.clone();
        list.connect_row_activated(move |_, row| {
            let id = row.widget_name();
            if !id.is_empty() {
                on_pick(id.as_str());
                dialog.close();
            }
        });
    }

    dialog.present(Some(parent));
    search.grab_focus();
}
