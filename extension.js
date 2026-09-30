// SPDX-FileCopyrightText: 2011 Erick Pérez Castellanos <erick.red@gmail.com>
// SPDX-FileCopyrightText: 2011 Giovanni Campagna <gcampagna@src.gnome.org>
// SPDX-FileCopyrightText: 2017 Florian Müllner <fmuellner@gnome.org>
// SPDX-FileCopyrightText: 2026 Spencer Norton
//
// SPDX-License-Identifier: GPL-2.0-or-later AND GPL-3.0-or-later

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {accentPill, buildWorkspaceModel, workspaceAccessibleName} from './model.js';
import {WorkspacesMenu} from './workspacesMenu.js';

// Empty workspaces other than the active one are drawn at 65% opacity.
const EMPTY_OPACITY = 166;

class WorkspaceButton extends St.Button {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super({
            style_class: 'workspace-bar-button',
            accessible_role: Atk.Role.PUSH_BUTTON,
            can_focus: true,
            track_hover: true,
        });
    }

    sync(state, pillStyle) {
        this.label = state.label;
        this.accessible_name = workspaceAccessibleName(state);
        this.visible = state.visible;
        this.style = state.active ? pillStyle : null;
        this.opacity = state.empty && !state.active ? EMPTY_OPACITY : 255;
    }
}

class WorkspaceBar extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        super(0.5, 'Workspace Bar', true);

        // Clicks, hover and keyboard focus belong to the workspace buttons.
        // Keeping this container non-reactive also keeps PanelMenu.Button's
        // primary-click menu gesture from taking their clicks: the menu opens
        // on a secondary click, or the menu key on a focused button.
        this.set({
            reactive: false,
            can_focus: false,
            track_hover: false,
            accessible_role: Atk.Role.TOOL_BAR,
        });
        this.add_style_class_name('workspace-bar');
        this.setMenu(new WorkspacesMenu(this));

        this._box = new St.BoxLayout({reactive: true});
        this._box.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_SECONDARY)
                return Clutter.EVENT_PROPAGATE;
            this.menu.toggle();
            return Clutter.EVENT_STOP;
        });
        this.add_child(this._box);

        this._wmSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
        this._mutterSettings = new Gio.Settings({schema_id: 'org.gnome.mutter'});
        this._wmSettings.connectObject(
            'changed::workspace-names', () => this._sync(), this);
        this._mutterSettings.connectObject(
            'changed::dynamic-workspaces', () => this._sync(), this);
        global.workspace_manager.connectObject(
            'notify::n-workspaces', () => this._rebuild(),
            'workspace-switched', () => this._sync(),
            this);
        global.display.connectObject('restacked', () => this._sync(), this);
        St.ThemeContext.get_for_stage(global.stage).connectObject(
            'changed', () => this._sync(), this);

        // Scrolling anywhere on the top bar switches workspace.
        Main.panel.connectObject('scroll-event',
            (_actor, event) => Main.wm.handleWorkspaceScroll(event), this);

        this._rebuild();
    }

    _rebuild() {
        this._box.destroy_all_children();

        const manager = global.workspace_manager;
        for (let index = 0; index < manager.n_workspaces; index++) {
            const button = new WorkspaceButton();
            button.connect('clicked', () => manager.get_workspace_by_index(index)
                ?.activate(global.get_current_time()));
            button.connect('popup-menu', () => this.menu.open());
            manager.get_workspace_by_index(index).connectObject(
                'window-added', () => this._sync(),
                'window-removed', () => this._sync(),
                button);
            this._box.add_child(button);
        }
        this._sync();
    }

    _sync() {
        const manager = global.workspace_manager;
        const buttons = this._box.get_children();
        // Part-way through adding or removing a workspace the counts differ;
        // the rebuild on notify::n-workspaces follows.
        if (buttons.length !== manager.n_workspaces)
            return;

        const model = buildWorkspaceModel({
            count: buttons.length,
            activeIndex: manager.get_active_workspace_index(),
            names: this._wmSettings.get_strv('workspace-names'),
            occupied: buttons.map((_, index) => manager.get_workspace_by_index(index)
                .list_windows()
                .some(window => !window.skip_taskbar && !window.is_on_all_workspaces())),
            dynamic: this._mutterSettings.get_boolean('dynamic-workspaces'),
        });

        const [accent] = St.ThemeContext.get_for_stage(global.stage).get_accent_color();
        const {background, foreground} = accentPill(accent);
        const pillStyle = `background-color: rgb(${background}); color: rgb(${foreground});`;

        buttons.forEach((button, index) => button.sync(model[index], pillStyle));
    }
}

export default class WorkspaceBarExtension extends Extension {
    enable() {
        this._bar = new WorkspaceBar();
        Main.panel.addToStatusArea(this.uuid, this._bar, 0, 'left');

        // The bar takes the place of the Activities button. Hide the button
        // itself, not its container: the panel shows every container again
        // on each session-mode change, such as unlocking the screen.
        this._activities = Main.panel.statusArea.activities;
        this._activitiesWasVisible = this._activities?.visible;
        this._activities?.hide();
    }

    disable() {
        if (this._activitiesWasVisible)
            this._activities.show();
        this._activities = null;

        this._bar.destroy();
        this._bar = null;
    }
}
