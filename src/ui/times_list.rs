//! The sidebar's solve list.
//!
//! `Gtk.ColumnView`, not `Gtk.ListBox` (invariant: a session can hold thousands
//! of solves, and ColumnView only builds the rows on screen).
//!
//! The model is a `Gtk.StringList` of solve *ids*, newest first; cells read
//! their precomputed text in `bind`, so rows key on stable identity and a
//! delete (and its undo) can never point at the wrong solve. Every change
//! rebuilds the id list in one `splice()` — one code path for add/delete/
//! restore. A session switch re-points the rows and rebuilds wholesale (ids are
//! only unique within one session).

use std::rc::Rc;

use gtk4 as gtk;
use gtk4::prelude::*;
use libadwaita as adw;

use crate::core::i18n::{MessageKey, Param, t, t0};
use crate::core::session::Solve;
use crate::core::stats::{StatKind, effective_times, window_at_each};
use crate::core::time::{format_average, format_solve};

/// One solve as the row paints it: everything the columns and the tooltips
/// need, computed once per rebuild instead of once per bind.
struct Row {
    id: u64,
    number: usize,
    time: String,
    ao5: String,
    ao12: String,
    solve: Solve,
}

#[derive(Default)]
struct Rows {
    /// Newest first — the order of the model.
    entries: Vec<Row>,
}

fn average_text(value: f64) -> String {
    if value.is_nan() {
        "—".to_string()
    } else {
        format_average(value)
    }
}

impl Rows {
    fn rebuild(&mut self, solves: &[Solve]) {
        let times = effective_times(solves);
        let ao5 = window_at_each(&times, StatKind::Ao5);
        let ao12 = window_at_each(&times, StatKind::Ao12);
        self.entries = solves
            .iter()
            .enumerate()
            .rev()
            .map(|(index, solve)| Row {
                id: solve.id,
                number: index + 1,
                time: format_solve(solve.time_ms, solve.penalty),
                ao5: average_text(ao5[index]),
                ao12: average_text(ao12[index]),
                solve: solve.clone(),
            })
            .collect();
    }

    fn at(&self, position: usize) -> Option<&Row> {
        self.entries.get(position)
    }
}

fn column(
    title: &str,
    rows: &Rc<std::cell::RefCell<Rows>>,
    classes: &'static [&'static str],
    text: fn(&Row) -> String,
) -> gtk::ColumnViewColumn {
    let factory = gtk::SignalListItemFactory::new();

    factory.connect_setup(move |_, object| {
        let Some(cell) = object.downcast_ref::<gtk::ColumnViewCell>() else {
            return;
        };
        cell.set_child(Some(
            &gtk::Label::builder().xalign(0.0).hexpand(true).build(),
        ));
    });

    let bind_rows = Rc::clone(rows);
    factory.connect_bind(move |_, object| {
        let Some(cell) = object.downcast_ref::<gtk::ColumnViewCell>() else {
            return;
        };
        let Some(label) = cell
            .child()
            .and_then(|child| child.downcast::<gtk::Label>().ok())
        else {
            return;
        };
        let position = cell.position();
        if position == gtk::INVALID_LIST_POSITION {
            return;
        }
        let rows = bind_rows.borrow();
        let Some(row) = rows.at(position as usize) else {
            return;
        };
        label.set_label(&text(row));
        label.set_css_classes(classes);
    });

    factory.connect_teardown(move |_, object| {
        if let Some(cell) = object.downcast_ref::<gtk::ColumnViewCell>() {
            cell.set_child(gtk::Widget::NONE);
        }
    });

    let view_column = gtk::ColumnViewColumn::new(Some(title), Some(factory));
    view_column.set_resizable(false);
    view_column
}

pub struct TimesList {
    pub widget: adw::ToolbarView,
    /// Header controls, owned by the sidebar builder but packed here.
    model: gtk::StringList,
    selection: gtk::MultiSelection,
    rows: Rc<std::cell::RefCell<Rows>>,
    action_bar: gtk::ActionBar,
    footer_row: gtk::Box,
    footer_info: gtk::Label,
    edit_button: gtk::Button,
    scroller: gtk::ScrolledWindow,
    empty: adw::StatusPage,
}

impl TimesList {
    pub fn new(
        session_control: &impl IsA<gtk::Widget>,
        new_control: &impl IsA<gtk::Widget>,
        manager_control: &impl IsA<gtk::Widget>,
        on_delete: impl Fn(Vec<Solve>) + 'static,
        on_edit: impl Fn(Vec<Solve>) + 'static,
    ) -> Rc<Self> {
        let rows: Rc<std::cell::RefCell<Rows>> = Rc::default();
        let on_delete: Rc<dyn Fn(Vec<Solve>)> = Rc::new(on_delete);
        let on_edit: Rc<dyn Fn(Vec<Solve>)> = Rc::new(on_edit);

        let model = gtk::StringList::new(&[]);
        let selection = gtk::MultiSelection::new(Some(model.clone()));
        let view = gtk::ColumnView::new(Some(selection.clone()));
        view.set_show_row_separators(true);

        let number_column = column("#", &rows, &["caption", "dim-label", "numeric"], |row| {
            row.number.to_string()
        });
        let time_column = column("time", &rows, &["numeric"], |row| row.time.clone());
        time_column.set_title(Some(&t0(MessageKey::ListTime)));
        let ao5_column = column("ao5", &rows, &["dim-label", "numeric"], |row| {
            row.ao5.clone()
        });
        let ao12_column = column("ao12", &rows, &["dim-label", "numeric"], |row| {
            row.ao12.clone()
        });
        for expand in [&time_column, &ao5_column, &ao12_column] {
            expand.set_expand(true);
        }
        view.append_column(&number_column);
        view.append_column(&time_column);
        view.append_column(&ao5_column);
        view.append_column(&ao12_column);

        let scroller = gtk::ScrolledWindow::builder()
            .child(&view)
            .hexpand(true)
            .vexpand(true)
            .hscrollbar_policy(gtk::PolicyType::Never)
            .build();

        let empty = adw::StatusPage::builder()
            .icon_name("view-list-symbolic")
            .title(t0(MessageKey::ListEmptyTitle))
            .description(t0(MessageKey::ListEmptyBody))
            .vexpand(true)
            .build();

        // Both live in the body and take turns being visible: a `Gtk.Stack`
        // would measure them together and make the empty page's height part of
        // the list's minimum.
        empty.set_visible(true);
        scroller.set_visible(false);
        let body = gtk::Box::new(gtk::Orientation::Vertical, 0);
        body.append(&scroller);
        body.append(&empty);

        // ---- selection footer: the actions available on the selected row ------
        // `Gtk.ActionBar`'s `revealed` collapses it to nothing, so the bar
        // costs list height only while a row is selected. Two buttons, not a
        // battery — grading lives in the one edit dialog behind Edit. Edit goes
        // insensitive over a multi-selection rather than hiding: one record,
        // one dialog, and the row must not shift under the pointer.
        let footer_info = gtk::Label::builder()
            .xalign(0.0)
            .hexpand(true)
            .css_classes(["dim-label"])
            // Context, not data: shrink it with an ellipsis rather than
            // squeeze the buttons when the sidebar is narrow.
            .ellipsize(gtk::pango::EllipsizeMode::End)
            .build();
        let edit_button = gtk::Button::builder()
            .tooltip_text(t0(MessageKey::ListEditTooltip))
            .build();
        edit_button.set_child(Some(
            &adw::ButtonContent::builder()
                .icon_name("document-edit-symbolic")
                .label(t0(MessageKey::ListEdit))
                .build(),
        ));
        let delete_button = gtk::Button::builder()
            // Icon-only: the trash is unambiguous, and the label's width is
            // what lets the info label show `#12 · 3.35+` in full.
            .icon_name("user-trash-symbolic")
            .tooltip_text(t0(MessageKey::ListDeleteTooltip))
            .build();

        let footer_row = gtk::Box::builder()
            .orientation(gtk::Orientation::Horizontal)
            .spacing(6)
            .hexpand(true)
            .build();
        footer_row.append(&footer_info);
        footer_row.append(&edit_button);
        footer_row.append(&delete_button);

        let action_bar = gtk::ActionBar::builder().revealed(false).build();
        action_bar.set_center_widget(Some(&footer_row));

        let header = adw::HeaderBar::builder().show_title(true).build();
        header.pack_start(new_control);
        header.set_title_widget(Some(session_control));
        header.pack_end(manager_control);

        // The `sidebar` class moves to this root: libadwaita's own pane rules
        // match descendants, so the header stays flat and the list keeps them.
        let widget = adw::ToolbarView::builder().css_classes(["sidebar"]).build();
        widget.add_top_bar(&header);
        widget.add_bottom_bar(&action_bar);
        widget.set_content(Some(&body));

        let list = Rc::new(Self {
            widget,
            model,
            selection,
            rows,
            action_bar,
            footer_row,
            footer_info,
            edit_button: edit_button.clone(),
            scroller,
            empty,
        });

        // ---- selection → footer ----------------------------------------------
        {
            let list = Rc::clone(&list);
            let selection = list.selection.clone();
            selection.connect_selection_changed(move |_, _, _| list.sync_footer());
        }

        // ---- footer buttons ---------------------------------------------------
        {
            let list = Rc::clone(&list);
            let on_delete = Rc::clone(&on_delete);
            delete_button.connect_clicked(move |_| {
                let solves = list.selected_solves();
                if !solves.is_empty() {
                    on_delete(solves);
                }
            });
        }
        {
            let list = Rc::clone(&list);
            let on_edit = Rc::clone(&on_edit);
            edit_button.connect_clicked(move |_| {
                let solves = list.selected_solves();
                if solves.len() == 1 {
                    on_edit(solves);
                }
            });
        }
        // A double-click (or Enter) on a row edits that solve — the same
        // dialog as the footer's Edit button.
        {
            let list = Rc::clone(&list);
            let on_edit = Rc::clone(&on_edit);
            view.connect_activate(move |_, position| {
                let solves: Vec<Solve> = list
                    .rows
                    .borrow()
                    .at(position as usize)
                    .map(|row| vec![row.solve.clone()])
                    .unwrap_or_default();
                if solves.len() == 1 {
                    on_edit(solves);
                }
            });
        }

        list
    }

    /// Replace the rows with `solves` (oldest first).
    pub fn rebuild(&self, solves: &[Solve]) {
        self.rows.borrow_mut().rebuild(solves);

        let ids: Vec<String> = self
            .rows
            .borrow()
            .entries
            .iter()
            .map(|row| row.id.to_string())
            .collect();
        let refs: Vec<&str> = ids.iter().map(String::as_str).collect();
        self.model.splice(0, self.model.n_items(), &refs);

        let has_rows = !refs.is_empty();
        self.scroller.set_visible(has_rows);
        self.empty.set_visible(!has_rows);
        self.sync_footer();
    }

    /// The solves behind the selected rows, oldest first, so the caller can
    /// delete them in one undoable batch.
    pub fn selected_solves(&self) -> Vec<Solve> {
        let selected = self.selection.selection();
        let rows = self.rows.borrow();
        let mut solves: Vec<Solve> = rows
            .entries
            .iter()
            .enumerate()
            .filter(|(position, _)| selected.contains(*position as u32))
            .map(|(_, row)| row.solve.clone())
            .collect();
        solves.sort_by_key(|solve| solve.id);
        solves
    }

    /// Reflect the current selection in the footer toolbar.
    fn sync_footer(&self) {
        let solves = self.selected_solves();
        let has_selection = !solves.is_empty();
        self.action_bar.set_revealed(has_selection);
        // While collapsed the bar's buttons must not take keyboard focus.
        self.footer_row.set_sensitive(has_selection);
        // One edit dialog, one record; a child's sensitivity only ever
        // restricts its parents', so set it after the row's flag.
        self.edit_button.set_sensitive(solves.len() == 1);
        if !has_selection {
            return;
        }
        let text = if let [solve] = solves.as_slice() {
            let number = self
                .rows
                .borrow()
                .entries
                .iter()
                .find(|row| row.id == solve.id)
                .map_or(0, |row| row.number);
            format!(
                "#{number}  ·  {}",
                crate::core::time::format_solve(solve.time_ms, solve.penalty)
            )
        } else {
            t(
                MessageKey::ListSelected,
                &[("count", Param::Number(solves.len() as f64))],
            )
        };
        self.footer_info.set_label(&text);
    }
}
