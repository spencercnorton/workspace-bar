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
import Graphene from 'gi://Graphene';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {
    accentPill,
    buildWorkspaceModel,
    fractionalWorkspaceIndex,
    mixColour,
    pillRectAt,
    workspaceAccessibleName,
} from './model.js';
import {WorkspacesMenu} from './workspacesMenu.js';

// The names of empty workspaces other than the active one are drawn at 65%
// opacity. Only the name: the focus ring and the hover stay at full strength.
const EMPTY_OPACITY = 166;

// A workspace switch is one rigid slide of the whole desktop, so the next
// workspace reads as already open beside this one rather than conjured up.
// 360 ms gives the eye time to follow the travel — about 43 frames at
// 120 Hz — and this gentle ease-out starts slower than stock GNOME's, so
// the first frame is a small step rather than a jump, then settles without
// a snap. Nothing stretches or lags: windows, wallpaper and the top-bar
// pill all follow this one progress (see WorkspaceBar's pill flight).
const WORKSPACE_ANIMATION_DURATION = 360;
const WORKSPACE_ANIMATION_MODE = Clutter.AnimationMode.CUBIC_BEZIER;
const WORKSPACE_BEZIER_P1 = new Graphene.Point({x: 0.25, y: 0.90});
const WORKSPACE_BEZIER_P2 = new Graphene.Point({x: 0.25, y: 1.0});

class WorkspaceButton extends St.Button {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        // A label of its own, not St.Button's `label`: St colours that one
        // only when the button's style changes, which leaves a name set on a
        // button already on screen black.
        const label = new St.Label();

        // Separate the pill background from the label container inside a
        // BinLayout with x_expand/y_expand so that:
        //   1. At rest, _pillBg fills the exact same box as _labelBin.
        //   2. During a workspace switch, the bar's pill flight moves one
        //      button's _pillBg between the buttons' boxes, following the
        //      desktop's progress, without moving or distorting any label.
        const pillStack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
        });

        const pillBg = new St.Widget({
            style_class: 'workspace-bar-pill workspace-bar-pill-bg',
            reactive: false,
            can_focus: false,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });
        pillBg.set_pivot_point(0.5, 0.5);

        const labelBin = new St.Bin({
            style_class: 'workspace-bar-pill',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
            child: label,
        });

        pillStack.add_child(pillBg);
        pillStack.add_child(labelBin);

        super({
            style_class: 'workspace-bar-button',
            accessible_role: Atk.Role.PUSH_BUTTON,
            can_focus: true,
            track_hover: true,
            child: pillStack,
        });

        this._label = label;
        this._pillBg = pillBg;
        this._labelBin = labelBin;
    }

    // This button's pill box in the bar's shared coordinates (the button's
    // allocation plus the stack's within it), for the bar's pill flight.
    pillAllocation() {
        const stack = this.child;
        return {x: this.x + stack.x, width: stack.width};
    }

    // Draw this button's pill background at `rect` (shared coordinates) by
    // translating and widening it from its own box: the pill itself moves,
    // at exactly its drawn size, so it neither stretches nor squashes.
    showPillAt(rect, pillBgStyle) {
        const own = this.pillAllocation();
        if (!(own.width > 0) || !(rect.width > 0))
            return;
        this._pillBg.style = pillBgStyle;
        this._pillBg.set_pivot_point(0.5, 0.5);
        this._pillBg.translation_x =
            (rect.x + rect.width * 0.5) - (own.x + own.width * 0.5);
        this._pillBg.translation_y = 0;
        this._pillBg.set_scale(rect.width / own.width, 1.0);
    }

    clearPillTransform() {
        this._pillBg.translation_x = 0;
        this._pillBg.translation_y = 0;
        this._pillBg.set_scale(1.0, 1.0);
    }

    hidePill() {
        if (this._pillBg.style !== null)
            this._pillBg.style = null;
        this.clearPillTransform();
    }

    // The flight fades label colours through here, one style per frame.
    setLabelColour(style) {
        this._labelBin.style = style;
    }

    // The label's colour as the theme draws it, for the flight to fade
    // from. Null when the theme cannot say (no node, no colour), in which
    // case the flight falls back to switching colours at the halfway button.
    readLabelColour() {
        try {
            const colour = this._label.get_theme_node().get_foreground_color();
            return [Math.round(colour.red), Math.round(colour.green), Math.round(colour.blue)];
        } catch (_) {
            return null;
        }
    }

    sync(state, pillBgStyle, pillFgStyle, inFlight = false) {
        this._label.text = state.label;
        this.accessible_name = workspaceAccessibleName(state);
        this.visible = state.visible;

        // While a pill flight runs it owns the pill and label colours, frame
        // by frame from the desktop's progress; it settles through a final
        // sync with the flight over. Everything else still updates.
        if (!inFlight) {
            this.clearPillTransform();
            if (state.active) {
                this._pillBg.style = pillBgStyle;
                this._labelBin.style = pillFgStyle;
            } else {
                this._pillBg.style = null;
                this._labelBin.style = null;
            }
        }

        const targetOpacity = state.empty && !state.active ? EMPTY_OPACITY : 255;
        if (this._label.opacity !== targetOpacity) {
            if (this.is_mapped()) {
                this._label.ease({
                    opacity: targetOpacity,
                    duration: WORKSPACE_ANIMATION_DURATION,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                });
            } else {
                this._label.opacity = targetOpacity;
            }
        }
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

        // The pill flight: while a switch runs, the desktop's progress drives
        // the pill between buttons (see setPillFraction). Null at rest.
        this._pillFlight = null;
        this.connect('destroy', () => (this._pillFlight = null));

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
        // The flight's button boxes are about to stop existing.
        this._pillFlight = null;
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

        // A flight whose switch is gone (finished another way, or the
        // controller torn down mid-switch) must not own the pill forever.
        if (this._pillFlight && !Main.wm?._workspaceAnimation?._switchData)
            this._pillFlight = null;

        const activeIndex = manager.get_active_workspace_index();

        const model = buildWorkspaceModel({
            count: buttons.length,
            activeIndex,
            names: this._wmSettings.get_strv('workspace-names'),
            occupied: buttons.map((_, index) => manager.get_workspace_by_index(index)
                .list_windows()
                .some(window => !window.skip_taskbar && !window.is_on_all_workspaces())),
            dynamic: this._mutterSettings.get_boolean('dynamic-workspaces'),
        });

        const [accent] = St.ThemeContext.get_for_stage(global.stage).get_accent_color();
        const {background, foreground} = accentPill(accent);
        const pillBgStyle = `background-color: rgb(${background});`;
        const pillFgStyle = `color: rgb(${foreground});`;

        const inFlight = this._pillFlight !== null;
        buttons.forEach((button, index) =>
            button.sync(model[index], pillBgStyle, pillFgStyle, inFlight));
    }

    // Begin following a switch: remember each button's box and the colours
    // to fade between. False when there is nothing allocated to follow —
    // the pill then simply lands with the next sync.
    _beginPillFlight() {
        const buttons = this._box.get_children();
        if (!buttons.length || !this.is_mapped())
            return false;

        // A button with no allocation — the hidden trailing workspace with
        // dynamic workspaces — borrows its nearest allocated neighbour's
        // size and sits just past it, so one unallocated box cannot stop
        // the pill gliding between the rest.
        const allocated = buttons.map(button => button.pillAllocation());
        const firstAllocated = allocated.find(rect => rect.width > 0);
        if (!firstAllocated)
            return false;
        let previous = null;
        const rects = allocated.map(rect => {
            if (rect.width > 0 && Number.isFinite(rect.x))
                previous = rect;
            else if (previous)
                return {x: previous.x + previous.width, width: previous.width};
            else
                return {x: firstAllocated.x, width: firstAllocated.width};
            return rect;
        });

        const [accent] = St.ThemeContext.get_for_stage(global.stage).get_accent_color();
        const {background, foreground} = accentPill(accent);
        const activeIndex = global.workspace_manager.get_active_workspace_index();
        const inactiveButton = buttons.find((_, index) => index !== activeIndex);

        this._pillFlight = {
            rects,
            background,
            foreground,
            inactive: inactiveButton?.readLabelColour() ?? null,
        };
        return true;
    }

    // Put the pill at a fractional workspace index, as reported by the
    // desktop's own progress. The nearest button carries the pill at the
    // interpolated rect; each label takes the colour for its closeness to
    // the fraction, so highlight fades from one name into the next instead
    // of flipping. Called with a new fraction mid-flight, it simply
    // continues from wherever the pill was last drawn — a switch can be
    // interrupted, reversed or retargeted without a jump.
    setPillFraction(fraction) {
        if (!Number.isFinite(fraction))
            return;
        if (!this._pillFlight && !this._beginPillFlight())
            return;

        const flight = this._pillFlight;
        const buttons = this._box.get_children();
        if (buttons.length !== flight.rects.length) {
            this.endPillFlight();
            return;
        }

        const rect = pillRectAt(flight.rects, fraction);
        const carrier = Math.min(buttons.length - 1,
            Math.max(0, Math.round(fraction)));
        const pillBgStyle = `background-color: rgb(${flight.background});`;

        buttons.forEach((button, index) => {
            if (index === carrier)
                button.showPillAt(rect, pillBgStyle);
            else
                button.hidePill();

            if (flight.inactive) {
                const closeness = Math.min(1,
                    Math.max(0, 1 - Math.abs(fraction - index)));
                button.setLabelColour(closeness <= 0
                    ? null
                    : `color: rgb(${mixColour(flight.inactive, flight.foreground, closeness)});`);
            } else {
                button.setLabelColour(index === carrier
                    ? `color: rgb(${flight.foreground});`
                    : null);
            }
        });
    }

    // The switch is over, settled or cancelled: hand the pill and label
    // colours back to a plain sync on the workspace that is active now.
    endPillFlight() {
        if (!this._pillFlight)
            return;
        this._pillFlight = null;
        this._sync();
    }
}

// Follow one monitor's switch progress with the pill. The connection
// belongs to the monitor group, which GNOME destroys when the switch
// finishes, so nothing outlives the animation.
function attachPillToMonitorGroup(bar, monitorGroup, workspaceIndices) {
    if (!monitorGroup || monitorGroup._workspaceBarPill)
        return;
    monitorGroup._workspaceBarPill = true;
    monitorGroup.connect('notify::progress', group =>
        bar.setPillFraction(
            fractionalWorkspaceIndex(workspaceIndices, group.progress)));
    bar.setPillFraction(
        fractionalWorkspaceIndex(workspaceIndices, monitorGroup.progress));
}

// GNOME's workspace animation, retimed, with the bar's pill riding the
// same progress. Three methods are wrapped, each restored on disable:
//
//   animateSwitch         — keyboard, click and wheel switches: stock
//                           GNOME with this bar's duration and curve, and
//                           the pill attached to the primary monitor.
//   _switchWorkspaceBegin — touchpad gestures: after GNOME prepares the
//                           switch, attach the pill so it tracks the
//                           fingers and the settle alike. The settle keeps
//                           GNOME's own tracker timing; because the pill
//                           follows progress either way, the two stay in
//                           step without retiming the gesture.
//   _finishWorkspaceSwitch — every ending, settled or cancelled, hands
//                           the pill back to a plain sync.
function installWorkspaceAnimationHook(bar) {
    const controller = Main.wm?._workspaceAnimation;
    if (!controller || controller._workspaceBarOrig ||
        typeof controller.animateSwitch !== 'function')
        return null;

    const orig = {
        animateSwitch: controller.animateSwitch,
        switchBegin: controller._switchWorkspaceBegin,
        finishSwitch: controller._finishWorkspaceSwitch,
    };
    controller._workspaceBarOrig = orig;

    controller.animateSwitch = function (from, to, direction, onComplete) {
        this._swipeTracker.enabled = false;

        let workspaceIndices = [];

        switch (direction) {
        case Meta.MotionDirection.UP:
        case Meta.MotionDirection.LEFT:
        case Meta.MotionDirection.UP_LEFT:
        case Meta.MotionDirection.UP_RIGHT:
            workspaceIndices = [to, from];
            break;

        case Meta.MotionDirection.DOWN:
        case Meta.MotionDirection.RIGHT:
        case Meta.MotionDirection.DOWN_LEFT:
        case Meta.MotionDirection.DOWN_RIGHT:
            workspaceIndices = [from, to];
            break;
        }

        if (Clutter.get_default_text_direction() === Clutter.TextDirection.RTL &&
            direction !== Meta.MotionDirection.UP &&
            direction !== Meta.MotionDirection.DOWN)
            workspaceIndices.reverse();

        this._prepareWorkspaceSwitch(workspaceIndices);
        if (!this._switchData) {
            this._swipeTracker.enabled = true;
            onComplete();
            return;
        }
        this._switchData.inProgress = true;

        const fromWs = global.workspace_manager.get_workspace_by_index(from);
        const toWs = global.workspace_manager.get_workspace_by_index(to);

        const primaryGroup = this._switchData.monitors.find(
            m => m.index === Main.layoutManager.primaryIndex) ?? this._switchData.monitors[0];

        for (const monitorGroup of this._switchData.monitors) {
            const fromProgress = monitorGroup.getWorkspaceProgress(fromWs);
            const toProgress = monitorGroup.getWorkspaceProgress(toWs);
            monitorGroup.progress = fromProgress;

            if (monitorGroup === primaryGroup) {
                try {
                    attachPillToMonitorGroup(bar, monitorGroup, workspaceIndices);
                } catch (err) {
                    console.error(`[workspace-bar] pill attach error: ${err}`);
                }
            }

            const params = {
                duration: WORKSPACE_ANIMATION_DURATION,
                mode: WORKSPACE_ANIMATION_MODE,
            };

            if (monitorGroup === primaryGroup) {
                params.onComplete = () => {
                    try {
                        if (this._switchData)
                            this._finishWorkspaceSwitch(this._switchData);
                    } catch (e) {
                        console.error(`[workspace-bar] finishWorkspaceSwitch error: ${e}`);
                    }
                    try {
                        onComplete();
                    } catch (e) {
                        console.error(`[workspace-bar] onComplete error: ${e}`);
                    }
                    this._swipeTracker.enabled = true;
                };
            }

            monitorGroup.ease_property('progress', toProgress, params);
            const transition = monitorGroup.get_transition('progress');
            transition?.set_cubic_bezier_progress(
                WORKSPACE_BEZIER_P1,
                WORKSPACE_BEZIER_P2,
            );
        }
    };

    if (typeof orig.switchBegin === 'function') {
        controller._switchWorkspaceBegin = function (...args) {
            const result = orig.switchBegin.apply(this, args);
            try {
                const baseGroup = this._switchData?.baseMonitorGroup;
                const indices = (baseGroup?._workspaceGroups ?? [])
                    .map(group => group.workspace.index());
                if (baseGroup && indices.length)
                    attachPillToMonitorGroup(bar, baseGroup, indices);
            } catch (err) {
                console.error(`[workspace-bar] gesture pill attach error: ${err}`);
            }
            return result;
        };
    }

    if (typeof orig.finishSwitch === 'function') {
        controller._finishWorkspaceSwitch = function (...args) {
            const result = orig.finishSwitch.apply(this, args);
            try {
                bar.endPillFlight();
            } catch (err) {
                console.error(`[workspace-bar] pill settle error: ${err}`);
            }
            return result;
        };
    }

    return () => {
        if (!controller._workspaceBarOrig)
            return;
        controller.animateSwitch = orig.animateSwitch;
        if (typeof orig.switchBegin === 'function')
            controller._switchWorkspaceBegin = orig.switchBegin;
        if (typeof orig.finishSwitch === 'function')
            controller._finishWorkspaceSwitch = orig.finishSwitch;
        delete controller._workspaceBarOrig;
    };
}

export default class WorkspaceBarExtension extends Extension {
    enable() {
        this._bar = new WorkspaceBar();
        Main.panel.addToStatusArea(this.uuid, this._bar, 0, 'left');

        this._restoreAnimationHook = installWorkspaceAnimationHook(this._bar);

        // The bar takes the place of the Activities button. Hide the button
        // itself, not its container: the panel shows every container again
        // on each session-mode change, such as unlocking the screen.
        this._activities = Main.panel.statusArea.activities;
        this._activitiesWasVisible = this._activities?.visible;
        this._activities?.hide();
    }

    disable() {
        this._restoreAnimationHook?.();
        this._restoreAnimationHook = null;

        if (this._activitiesWasVisible)
            this._activities.show();
        this._activities = null;

        this._bar.destroy();
        this._bar = null;
    }
}
