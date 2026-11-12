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

use crate::core::i18n::{MessageKey, t0};
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
    pub widget: gtk::Box,
    /// Header controls, owned by the sidebar builder but packed here.
    model: gtk::StringList,
    selection: gtk::MultiSelection,
    rows: Rc<std::cell::RefCell<Rows>>,
    action_bar: gtk::ActionBar,
    stack: gtk::Stack,
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

        let stack = gtk::Stack::new();
        stack.add_named(&scroller, Some("list"));
        stack.add_named(&empty, Some("empty"));
        stack.set_visible_child_name("empty");

        // ---- selection footer -------------------------------------------------
        let delete_button = gtk::Button::builder()
            .label(t0(MessageKey::CommonDelete))
            .tooltip_text(t0(MessageKey::ListDeleteTooltip))
            .build();
        let edit_button = gtk::Button::builder()
            .label(t0(MessageKey::ListEdit))
            .tooltip_text(t0(MessageKey::ListEditTooltip))
            .build();
        delete_button.add_css_class("destructive-action");

        let action_bar = gtk::ActionBar::new();
        action_bar.pack_start(&edit_button);
        action_bar.pack_end(&delete_button);

        let header = adw::HeaderBar::builder().show_title(false).build();
        header.pack_start(new_control);
        header.set_title_widget(Some(session_control));
        header.pack_end(manager_control);

        let toolbar = adw::ToolbarView::new();
        toolbar.add_top_bar(&header);
        toolbar.add_bottom_bar(&action_bar);
        toolbar.set_content(Some(&stack));

        let widget = gtk::Box::new(gtk::Orientation::Vertical, 0);
        widget.append(&toolbar);

        let list = Rc::new(Self {
            widget,
            model,
            selection,
            rows,
            action_bar,
            stack,
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
        self.stack
            .set_visible_child_name(if has_rows { "list" } else { "empty" });
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

    fn sync_footer(&self) {
        let selected = self.selection.selection();
        self.action_bar.set_revealed(!selected.is_empty());
    }
}
