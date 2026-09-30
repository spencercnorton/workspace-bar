// SPDX-FileCopyrightText: 2011 Erick Pérez Castellanos <erick.red@gmail.com>
// SPDX-FileCopyrightText: 2011 Giovanni Campagna <gcampagna@src.gnome.org>
// SPDX-FileCopyrightText: 2017 Florian Müllner <fmuellner@gnome.org>
// SPDX-FileCopyrightText: 2026 Spencer Norton
//
// SPDX-License-Identifier: GPL-2.0-or-later AND GPL-3.0-or-later

// The rename menu. EditableMenuItem and WorkspacesMenu are adapted from the
// workspace-indicator extension in GNOME Shell Extensions. Changes: plain
// strings instead of gettext; no Settings item and no active-name signal; an
// accessible name on the edit button; labels read from the workspace-names
// setting; a rename that writes only the workspace that was edited
// (model.js); the settings handler disconnected along with the menu; and
// editing that stops only while it is under way.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {ensureActorVisibleInScrollView} from 'resource:///org/gnome/shell/misc/animationUtils.js';

import {renamedWorkspaceNames, workspaceLabel} from './model.js';

class EditableMenuItem extends PopupMenu.PopupBaseMenuItem {
    static [GObject.signals] = {
        'edited': {},
    };

    static {
        GObject.registerClass(this);
    }

    constructor() {
        super({
            style_class: 'editable-menu-item',
        });
        this.get_accessible()?.set_description('Press e to edit');
        this._editing = false;

        const stack = new Shell.Stack({
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        });
        this.add_child(stack);

        this.label = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
        });
        stack.add_child(this.label);
        this.label_actor = this.label;

        this._entry = new St.Entry({
            opacity: 0,
            visible: false,
        });
        stack.add_child(this._entry);

        this.label.bind_property('text',
            this._entry, 'text',
            GObject.BindingFlags.DEFAULT);

        this._entry.clutter_text.connect('activate',
            () => this._stopEditing());

        this._editButton = new St.Button({
            style_class: 'icon-button flat',
            icon_name: 'document-edit-symbolic',
            accessible_name: 'Rename',
            button_mask: St.ButtonMask.ONE,
            toggle_mode: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._editButton);

        this._editButton.connect('notify::checked', () => {
            if (this._editButton.checked) {
                this._editButton.icon_name = 'ornament-check-symbolic';
                this._startEditing();
            } else {
                this._editButton.icon_name = 'document-edit-symbolic';
                this._stopEditing();
            }
        });
        this.connect('key-release-event', (o, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_e)
                return Clutter.EVENT_PROPAGATE;

            if (this._editButton.checked)
                return Clutter.EVENT_PROPAGATE;

            this._editButton.checked = true;
            return Clutter.EVENT_STOP;
        });

        global.stage.connectObject('notify::key-focus', () => {
            const {keyFocus} = global.stage;
            if (!keyFocus || !this.contains(keyFocus))
                this._stopEditing();
        }, this);
    }

    _switchActor(from, to) {
        to.visible = from.visible = true;
        to.ease({
            opacity: 255,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        from.ease({
            opacity: 0,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                from.visible = false;
            },
        });
    }

    _startEditing() {
        this._editing = true;
        this._switchActor(this.label, this._entry);

        this._entry.clutter_text.set_selection(0, -1);
        this._entry.clutter_text.grab_key_focus();
    }

    _stopEditing() {
        // Only while editing: unchecking the edit button and hiding the
        // focused entry both call back into here, and without animations
        // that happens while the entry is still being hidden.
        if (!this._editing)
            return;
        this._editing = false;

        if (this.label.text !== this._entry.text) {
            this.label.text = this._entry.text;
            this.emit('edited');
        }

        if (this._editButton.checked)
            this._editButton.checked = false;

        this._switchActor(this._entry, this.label);
        this.navigate_focus(this, St.DirectionType.TAB_FORWARD, false);
    }
}

export class WorkspacesMenu extends PopupMenu.PopupMenu {
    constructor(sourceActor) {
        super(sourceActor, 0.5, St.Side.TOP);

        this.actor.add_style_class_name('workspace-bar-menu');

        this._workspacesSection = new PopupMenu.PopupMenuSection();

        // make the section scrollable to avoid growing indefinitely
        const scrollView = new St.ScrollView({
            style_class: 'vfade',
            child: this._workspacesSection.box,
        });
        scrollView._delegate = this._workspacesSection;
        this._workspacesSection.actor = scrollView;

        this.addMenuItem(this._workspacesSection);

        this._desktopSettings =
            new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
        this._desktopSettings.connectObject('changed::workspace-names',
            () => this._updateWorkspaceLabels(), this.actor);

        const {workspaceManager} = global;
        workspaceManager.connectObject(
            'notify::n-workspaces', () => this._updateWorkspaceItems(),
            'workspace-switched', () => this._updateActiveIndicator(),
            this.actor);
        this._updateWorkspaceItems();
    }

    _updateWorkspaceItems() {
        const {workspaceManager} = global;
        const {nWorkspaces} = workspaceManager;

        const section = this._workspacesSection.box;
        while (section.get_n_children() < nWorkspaces) {
            const item = new EditableMenuItem();
            item.connect('activate', (o, event) => {
                const index = [...section].indexOf(item);
                const workspace = workspaceManager.get_workspace_by_index(index);
                workspace?.activate(event.get_time());
            });
            item.connect('edited', () => {
                const index = [...section].indexOf(item);
                const names = this._desktopSettings.get_strv('workspace-names');
                this._desktopSettings.set_strv('workspace-names',
                    renamedWorkspaceNames(names, index, item.label.text));
            });
            item.connect('notify::active', () => {
                const view = this._workspacesSection.actor;
                if (item.active)
                    ensureActorVisibleInScrollView(view, item);
            });
            this._workspacesSection.addMenuItem(item);
        }

        [...section].splice(nWorkspaces).forEach(item => item.destroy());

        this._updateWorkspaceLabels();
        this._updateActiveIndicator();
    }

    _updateWorkspaceLabels() {
        const names = this._desktopSettings.get_strv('workspace-names');
        const items = [...this._workspacesSection.box];
        items.forEach(
            (item, i) => (item.label.text = workspaceLabel(names, i)));
    }

    _updateActiveIndicator() {
        const {workspaceManager} = global;
        const active = workspaceManager.get_active_workspace_index();

        const items = [...this._workspacesSection.box];
        items.forEach((item, i) => {
            item.setOrnament(i === active
                ? PopupMenu.Ornament.CHECK
                : PopupMenu.Ornament.NONE);
        });
    }
}
