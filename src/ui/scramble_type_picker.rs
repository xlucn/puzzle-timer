//! The scramble type chooser: one dialog, two doors.
//!
//! The dialog is the only place a type is *chosen*, and an
//! `Adw.NavigationSplitView` used the way the widget is meant to be used:
//! two `Adw.NavigationPage`s — the category sidebar and the types — each with
//! its own toolbar and header. Collapsed, the split view supplies its own back
//! button and the sidebar becomes a boxed-lists page, so neither is built here.
//!
//! The type list holds only the browsed category's rows and is refilled by one
//! render path keyed on the browsed group: 206 rows rebuilt per category is
//! cheaper than a filter that crosses every row on each keystroke, and there is
//! no search entry — the two-level browse covers the catalogue.
//!
//! The 206 type names stay English (they are proper nouns in the cubing
//! community); the 44 category names and the four higher classes are
//! translated, so the menu reads in the user's language.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use gtk4 as gtk;
use gtk4::prelude::*;
use libadwaita as adw;
use libadwaita::prelude::*;

use crate::core::i18n::{MessageKey, t_group, t_section, t0};
use crate::core::layout::BREAKPOINTS;
use crate::core::scramble_types::{ScrambleGroup, scramble_groups, scramble_sections};

/// The group a type belongs to.
fn group_index(groups: &[ScrambleGroup], id: &str) -> Option<usize> {
    groups
        .iter()
        .position(|group| group.choices.iter().any(|choice| choice.id == id))
}

/// Open the picker on `parent`, showing `current`'s category; `on_pick`
/// receives the chosen type id. Picking the type already in force announces
/// nothing, exactly like the session switch that may have set it.
pub fn open(parent: &impl IsA<gtk::Widget>, current: &str, on_pick: impl Fn(&str) + 'static) {
    let dialog = adw::Dialog::builder()
        .title(t0(MessageKey::ScrambleChooseType))
        // A default size, not a managed one: the dialog clamps itself to the
        // parent and the breakpoint below collapses the split when the
        // allocated width is too narrow.
        .content_width(720)
        .content_height(480)
        // A dialog with a breakpoint has no implicit minimum size; without
        // this the one-column sheet could collapse to nothing.
        .width_request(300)
        .height_request(240)
        .build();

    let groups = Rc::new(scramble_groups());

    // ---- categories (sidebar) ----------------------------------------------
    // Adw.Sidebar owns the whole look (both modes scroll internally), so no
    // scroller or CSS class of ours. One section per csTimer higher class:
    // titles and separators are the widget's own. Item indices are flat across
    // sections, so the browsed group index is also the sidebar item index.
    let sidebar = adw::Sidebar::new();
    for section in scramble_sections() {
        let sidebar_section = adw::SidebarSection::new();
        sidebar_section.set_title(Some(&t_section(section.name)));
        for group in &section.groups {
            sidebar_section.append(adw::SidebarItem::new(&t_group(group.name)));
        }
        sidebar.append(sidebar_section);
    }

    // ---- types (content) ---------------------------------------------------
    let type_list = gtk::ListBox::builder()
        .selection_mode(gtk::SelectionMode::Single)
        .activate_on_single_click(true)
        .css_classes(["boxed-list"])
        // The card frame floats inside the content pane: boxed-list draws it,
        // and these margins give it breathing room on every side.
        .margin_top(12)
        .margin_bottom(12)
        .margin_start(12)
        .margin_end(12)
        .build();

    let type_scroller = gtk::ScrolledWindow::builder()
        .child(&type_list)
        .hexpand(true)
        .vexpand(true)
        .hscrollbar_policy(gtk::PolicyType::Never)
        .min_content_width(180)
        .min_content_height(180)
        .build();

    // ---- pages / split view ------------------------------------------------
    let sidebar_header = adw::HeaderBar::builder()
        .show_back_button(false)
        .show_start_title_buttons(false)
        .show_end_title_buttons(false)
        .build();
    let sidebar_toolbar = adw::ToolbarView::new();
    sidebar_toolbar.add_top_bar(&sidebar_header);
    sidebar_toolbar.set_content(Some(&sidebar));

    let content_header = adw::HeaderBar::new();
    let content_toolbar = adw::ToolbarView::new();
    content_toolbar.add_top_bar(&content_header);
    content_toolbar.set_content(Some(&type_scroller));

    let category_page =
        adw::NavigationPage::new(&sidebar_toolbar, &t0(MessageKey::ScrambleCategory));
    let type_page = adw::NavigationPage::new(&content_toolbar, &t0(MessageKey::ScrambleChooseType));

    let split = adw::NavigationSplitView::builder()
        .sidebar(&category_page)
        .content(&type_page)
        .sidebar_position(gtk::PackType::Start)
        .sidebar_width_fraction(0.4)
        .min_sidebar_width(220.0)
        .max_sidebar_width(320.0)
        .sidebar_width_unit(adw::LengthUnit::Px)
        .show_content(true)
        .hexpand(true)
        .vexpand(true)
        .build();

    // The documented Adw.Sidebar pattern: the sidebar pane is a sidebar while
    // expanded and a boxed-lists page once collapsed.
    let collapse = adw::Breakpoint::new(adw::BreakpointCondition::new_length(
        adw::BreakpointConditionLengthType::MaxWidth,
        BREAKPOINTS.selector_row_max,
        adw::LengthUnit::Px,
    ));
    {
        let split = split.clone();
        let sidebar = sidebar.clone();
        collapse.connect_apply(move |_| {
            split.set_collapsed(true);
            sidebar.set_mode(adw::SidebarMode::Page);
        });
    }
    {
        let split = split.clone();
        let sidebar = sidebar.clone();
        collapse.connect_unapply(move |_| {
            split.set_collapsed(false);
            sidebar.set_mode(adw::SidebarMode::Sidebar);
        });
    }
    dialog.add_breakpoint(collapse);

    // ---- state and rendering ----------------------------------------------
    // The browsed category may differ from the live type. An id this catalogue
    // does not have (a hand-edited session index) browses the first category.
    let browse = Rc::new(Cell::new(group_index(&groups, current).unwrap_or(0)));
    let current_id = Rc::new(RefCell::new(current.to_string()));

    let render: Rc<dyn Fn()> = {
        let groups = Rc::clone(&groups);
        let browse = Rc::clone(&browse);
        let current_id = Rc::clone(&current_id);
        let type_list = type_list.clone();
        let type_page = type_page.clone();
        Rc::new(move || {
            // Advance from the top on every removal: removing the same wrapper
            // twice warns "non-child" and would never terminate.
            while let Some(row) = type_list.row_at_index(0) {
                type_list.remove(&row);
            }

            let group = &groups[browse.get()];
            type_page.set_title(&t_group(group.name));

            let mut first: Option<gtk::ListBoxRow> = None;
            let mut live: Option<gtk::ListBoxRow> = None;
            for choice in &group.choices {
                // Just the type name: the category is the selected row on the
                // left and the content page's title, so repeating it is noise.
                let row = adw::ActionRow::builder()
                    .title(choice.label)
                    .activatable(true)
                    .build();
                row.set_use_markup(false);
                row.set_widget_name(choice.id);
                if choice.id == *current_id.borrow() {
                    row.add_suffix(
                        &gtk::Image::builder()
                            .icon_name("object-select-symbolic")
                            .valign(gtk::Align::Center)
                            .build(),
                    );
                    live = Some(row.clone().upcast());
                }
                type_list.append(&row);
                if first.is_none() {
                    first = Some(row.upcast());
                }
            }
            // The live type is preselected; a category without it falls back to
            // the first row, so the list never opens unselected.
            match live.or(first) {
                Some(row) => type_list.select_row(Some(&row)),
                None => type_list.unselect_all(),
            }
        })
    };

    // ---- activation --------------------------------------------------------
    {
        // No check mark to move: the dialog closes here, and the next open
        // rebuilds the rows and stamps the mark from the live id.
        let dialog = dialog.clone();
        let current_id = Rc::clone(&current_id);
        let on_pick = Rc::new(on_pick);
        type_list.connect_row_activated(move |_, row| {
            let id = row.widget_name().to_string();
            if id.is_empty() {
                return;
            }
            let changed = id != *current_id.borrow();
            *current_id.borrow_mut() = id.clone();
            if changed {
                on_pick(&id);
            }
            dialog.close();
        });
    }

    // Documented Adw.Sidebar pattern: activation shows the content pane.
    {
        let split = split.clone();
        let browse = Rc::clone(&browse);
        let render = Rc::clone(&render);
        sidebar.connect_activated(move |_, index| {
            if index == u32::MAX {
                return;
            }
            let index = index as usize;
            // notify::selected fired first in the two-pane layout; the guard
            // makes the second call a no-op.
            if browse.get() != index {
                browse.set(index);
                render();
            }
            // No grab_focus: GTK reassigns focus when the sidebar hides, and a
            // programmatic grab paints a focus ring without keyboard intent.
            split.set_show_content(true);
        });
    }
    {
        // Arrow-browsing in the two-pane layout updates the right pane live;
        // collapsed, selection is only a cursor and activation commits.
        let split = split.clone();
        let browse = Rc::clone(&browse);
        let render = Rc::clone(&render);
        sidebar.connect_notify_local(Some("selected"), move |sidebar, _| {
            if split.is_collapsed() {
                return;
            }
            let selected = sidebar.selected();
            if selected == u32::MAX || selected as usize == browse.get() {
                return;
            }
            browse.set(selected as usize);
            render();
        });
    }

    render();
    // Sidebar items are appended in group order, so the group index is the item
    // index; the guard above makes this assignment render-free.
    sidebar.set_selected(browse.get() as u32);

    dialog.set_child(Some(&split));
    dialog.present(Some(parent));
}
