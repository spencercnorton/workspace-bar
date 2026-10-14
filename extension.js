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

import {accentPill, buildWorkspaceModel, workspaceAccessibleName} from './model.js';
import {WorkspacesMenu} from './workspacesMenu.js';

// The names of empty workspaces other than the active one are drawn at 65%
// opacity. Only the name: the focus ring and the hover stay at full strength.
const EMPTY_OPACITY = 166;

// Tuned for 120Hz displays (~23 frames at 120Hz): smooth multi-frame whip-pan
// launch (no single-frame teleport) that streaks across with directional
// speed-stretch and locks crisply into place.
const WORKSPACE_ANIMATION_DURATION = 195;
const WORKSPACE_ANIMATION_MODE = Clutter.AnimationMode.CUBIC_BEZIER;
const WORKSPACE_BEZIER_P1 = new Graphene.Point({x: 0.20, y: 0.72});
const WORKSPACE_BEZIER_P2 = new Graphene.Point({x: 0.20, y: 1.0});

// Stretched speed-blur tuning parameters.
// Keeping WorkspaceGroup and Meta.WindowActor at 100% opacity (255) with zero
// extra Clutter.Clone actors prevents Mutter's _ClutterFlattenEffect from
// redirecting open windows into offscreen FBOs on frame 1 (which caused open
// apps to flicker) and prevents adjacent workspace wallpapers from overlapping.
const WINDOW_SPEED_STRETCH = 0.34;
const WINDOW_PERP_COMPRESS = 0.06;
const WINDOW_VELOCITY_LAG = 110;

function evaluateCubicBezier(p1x, p1y, p2x, p2y, t) {
    if (t <= 0)
        return 0;
    if (t >= 1)
        return 1;

    const cx = 3.0 * p1x;
    const bx = 3.0 * (p2x - p1x) - cx;
    const ax = 1.0 - cx - bx;

    const cy = 3.0 * p1y;
    const by = 3.0 * (p2y - p1y) - cy;
    const ay = 1.0 - cy - by;

    let u = t;
    for (let i = 0; i < 6; i++) {
        const x = ((ax * u + bx) * u + cx) * u - t;
        if (Math.abs(x) < 1e-5)
            break;
        const dx = (3.0 * ax * u + 2.0 * bx) * u + cx;
        if (Math.abs(dx) < 1e-6)
            break;
        u -= x / dx;
    }
    u = Math.min(1, Math.max(0, u));
    return ((ay * u + by) * u + cy) * u;
}

class WorkspaceButton extends St.Button {
    static {
        GObject.registerClass(this);
    }

    constructor() {
        // A label of its own, not St.Button's `label`: St colours that one
        // only when the button's style changes, which leaves a name set on a
        // button already on screen black.
        const label = new St.Label();

        // Separate the pill background actors from the label container inside a
        // BinLayout with x_expand/y_expand so that:
        //   1. At rest, _pillBg fills the exact same box as _labelBin.
        //   2. During a workspace switch, _pillBg and its trailing speed-blur
        //      wake (_pillWake) streak from the previous button's coordinates
        //      into place without moving or distorting the text label.
        const pillStack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
        });

        const pillWake = new St.Widget({
            style_class: 'workspace-bar-pill workspace-bar-pill-bg',
            reactive: false,
            can_focus: false,
            visible: false,
            opacity: 0,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });
        pillWake.set_pivot_point(0.5, 0.5);

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

        pillStack.add_child(pillWake);
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
        this._pillWake = pillWake;
        this._pillBg = pillBg;
        this._labelBin = labelBin;
        this._animTimeline = null;

        this.connect('destroy', () => this.stopPillAnimation());
    }

    stopPillAnimation() {
        if (this._animTimeline) {
            const tl = this._animTimeline;
            this._animTimeline = null;
            tl.stop();
        }
        if (this._pillWake) {
            this._pillWake.visible = false;
            this._pillWake.opacity = 0;
            this._pillWake.translation_x = 0;
            this._pillWake.set_scale(1.0, 1.0);
        }
        if (this._pillBg) {
            this._pillBg.translation_x = 0;
            this._pillBg.translation_y = 0;
            this._pillBg.set_scale(1.0, 1.0);
        }
    }

    sync(state, pillBgStyle, pillFgStyle) {
        this._label.text = state.label;
        this.accessible_name = workspaceAccessibleName(state);
        this.visible = state.visible;

        if (state.active) {
            this._pillBg.style = pillBgStyle;
            this._pillWake.style = pillBgStyle;
            this._labelBin.style = pillFgStyle;
            if (!this._animTimeline) {
                this._pillBg.translation_x = 0;
                this._pillBg.translation_y = 0;
                this._pillBg.set_scale(1.0, 1.0);
                this._pillWake.visible = false;
                this._pillWake.opacity = 0;
            }
        } else {
            this.stopPillAnimation();
            this._pillBg.style = null;
            this._pillWake.style = null;
            this._labelBin.style = null;
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

    animateSpeedStretchFrom(prevBtn) {
        this.stopPillAnimation();
        if (!this.is_mapped() || !prevBtn || !prevBtn.visible || !this.visible)
            return;

        const fromW = prevBtn.child.width;
        const toW = this.child.width;
        if (fromW <= 0 || toW <= 0)
            return;

        const prevCenter = prevBtn.x + prevBtn.child.x + fromW * 0.5;
        const nextCenter = this.x + this.child.x + toW * 0.5;
        const deltaX = prevCenter - nextCenter;
        if (Math.abs(deltaX) < 1)
            return;

        const startScaleX = fromW / toW;
        const maxExtraStretch = Math.min(195, Math.abs(deltaX) * 1.12) / toW;

        this._pillBg.set_pivot_point(0.5, 0.5);
        this._pillBg.translation_x = deltaX;
        this._pillBg.set_scale(startScaleX, 1.0);

        this._pillWake.set_pivot_point(0.5, 0.5);
        this._pillWake.translation_x = deltaX;
        this._pillWake.set_scale(startScaleX, 1.0);
        this._pillWake.opacity = 0;
        this._pillWake.visible = true;

        const timeline = new Clutter.Timeline({
            actor: this,
            duration: WORKSPACE_ANIMATION_DURATION,
        });
        this._animTimeline = timeline;

        timeline.connect('new-frame', tl => {
            const rawT = Math.min(1, Math.max(0, tl.get_progress()));
            const p = evaluateCubicBezier(
                WORKSPACE_BEZIER_P1.x, WORKSPACE_BEZIER_P1.y,
                WORKSPACE_BEZIER_P2.x, WORKSPACE_BEZIER_P2.y,
                rawT
            );
            const invP = 1.0 - p;
            const velocity = Math.pow(Math.max(0, Math.sin(Math.PI * p)), 0.80);

            const baseScaleX = startScaleX + (1.0 - startScaleX) * p;
            const scaleX = baseScaleX + maxExtraStretch * velocity;
            const scaleY = 1.0 - 0.15 * velocity;
            const curTx = deltaX * invP;

            this._pillBg.translation_x = curTx;
            this._pillBg.set_scale(scaleX, scaleY);

            // Trailing motion-blur wake streak behind the flying pill
            const wakeLag = deltaX * Math.pow(invP, 0.60);
            const wakeScaleX = scaleX + (maxExtraStretch * 0.80) * velocity;
            this._pillWake.translation_x = (curTx + wakeLag) * 0.5;
            this._pillWake.set_scale(wakeScaleX, scaleY * 0.90);
            this._pillWake.opacity = Math.round(140 * velocity);
        });

        timeline.connect('completed', () => {
            if (this._animTimeline !== timeline)
                return;
            this.stopPillAnimation();
        });

        timeline.start();
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

        this._activeIndex = -1;

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
        this._activeIndex = -1;
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

        const activeIndex = manager.get_active_workspace_index();
        const prevIndex = this._activeIndex;
        this._activeIndex = activeIndex;

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

        const switched = prevIndex >= 0 && prevIndex !== activeIndex &&
            prevIndex < buttons.length && activeIndex >= 0 && activeIndex < buttons.length;

        buttons.forEach((button, index) =>
            button.sync(model[index], pillBgStyle, pillFgStyle));

        if (switched && this.is_mapped()) {
            const prevBtn = buttons[prevIndex];
            const nextBtn = buttons[activeIndex];
            nextBtn.animateSpeedStretchFrom(prevBtn);
        }
    }
}

function prepareWindowEntries(records) {
    const entries = [];
    const count = records.length;
    for (let i = 0; i < count; i++) {
        const rec = records[i];
        const clone = rec?.clone;
        const windowActor = rec?.windowActor;
        if (!clone || !windowActor)
            continue;

        // Explicitly size the clone from its source actor before setting its
        // center pivot so frame 0 never computes a pivot against an unallocated
        // (0x0) actor box.
        const w = windowActor.width;
        const h = windowActor.height;
        if (w > 0 && h > 0)
            clone.set_size(w, h);

        clone.set_pivot_point(0.5, 0.5);
        const depth = 0.65 + 0.35 * (i / Math.max(1, count - 1));
        entries.push({clone, depth});
    }
    return entries;
}

function applySpeedBlurChoreography(monitorGroup, fromWs, toWs, fromProgress, toProgress) {
    const deltaProgress = toProgress - fromProgress;
    if (Math.abs(deltaProgress) <= 1e-5)
        return;

    const groups = monitorGroup._workspaceGroups;
    if (!Array.isArray(groups))
        return;

    const fromGroup = groups.find(g => g.workspace === fromWs);
    const toGroup = groups.find(g => g.workspace === toWs);
    if (!fromGroup || !toGroup)
        return;

    const fromEntries = prepareWindowEntries(fromGroup._windowRecords ?? []);
    const toEntries = prepareWindowEntries(toGroup._windowRecords ?? []);

    const isVertical = global.workspace_manager.layout_rows === -1;
    const axisSign = deltaProgress >= 0 ? 1 : -1;

    const updateWindowEntries = (entries, velocity) => {
        for (let i = 0; i < entries.length; i++) {
            const {clone, depth} = entries[i];
            const dv = depth * velocity;

            const wStretch = 1.0 + WINDOW_SPEED_STRETCH * dv;
            const wCompress = 1.0 - WINDOW_PERP_COMPRESS * dv;
            const lag = axisSign * WINDOW_VELOCITY_LAG * dv;

            if (isVertical) {
                clone.set_scale(wCompress, wStretch);
                clone.translation_x = 0;
                clone.translation_y = lag;
            } else {
                clone.set_scale(wStretch, wCompress);
                clone.translation_x = lag;
                clone.translation_y = 0;
            }
        }
    };

    const updateFrame = () => {
        const rawP = (monitorGroup.progress - fromProgress) / deltaProgress;
        const p = Math.min(1, Math.max(0, rawP));
        const velocity = Math.pow(Math.max(0, Math.sin(Math.PI * p)), 0.80);

        updateWindowEntries(fromEntries, velocity);
        updateWindowEntries(toEntries, velocity);
    };

    monitorGroup.connect('notify::progress', updateFrame);
}

function installWorkspaceAnimationHook() {
    const controller = Main.wm?._workspaceAnimation;
    if (!controller || controller._origAnimateSwitch)
        return null;

    const origAnimateSwitch = controller.animateSwitch;
    controller._origAnimateSwitch = origAnimateSwitch;

    controller.animateSwitch = function(from, to, direction, onComplete) {
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

            try {
                applySpeedBlurChoreography(
                    monitorGroup, fromWs, toWs, fromProgress, toProgress);
            } catch (err) {
                console.error(`[workspace-bar] applySpeedBlurChoreography error: ${err}`);
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

    return () => {
        if (controller._origAnimateSwitch) {
            controller.animateSwitch = controller._origAnimateSwitch;
            delete controller._origAnimateSwitch;
        }
    };
}

export default class WorkspaceBarExtension extends Extension {
    enable() {
        this._bar = new WorkspaceBar();
        Main.panel.addToStatusArea(this.uuid, this._bar, 0, 'left');

        this._restoreAnimationHook = installWorkspaceAnimationHook();

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
