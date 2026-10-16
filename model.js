// SPDX-FileCopyrightText: 2026 Spencer Norton
//
// SPDX-License-Identifier: GPL-3.0-or-later

// The parts of Workspace Bar that need no GNOME Shell, so that Node can test
// them: what each button shows, what a rename writes back to the
// workspace-names setting, the colours of the active workspace, and where
// the moving pill sits part-way through a workspace switch.

export function workspaceLabel(names, index) {
    return names[index]?.trim() || `Workspace ${index + 1}`;
}

export function buildWorkspaceModel({
    count,
    activeIndex,
    names = [],
    occupied = [],
    dynamic = false,
}) {
    if (!Number.isInteger(count) || count < 0)
        throw new TypeError('workspace count must be a non-negative integer');
    if (!Number.isInteger(activeIndex))
        throw new TypeError('active workspace index must be an integer');

    return Array.from({length: count}, (_, index) => {
        const active = index === activeIndex;
        const empty = !occupied[index];
        return {
            index,
            label: workspaceLabel(names, index),
            active,
            empty,
            // With dynamic workspaces GNOME keeps one empty workspace at the
            // end. It gets a button only while it is the active one.
            visible: !(dynamic && index === count - 1 && empty && !active),
        };
    });
}

export function workspaceAccessibleName({index, label, active, empty}) {
    const selection = active ? 'active' : 'inactive';
    const occupancy = empty ? 'empty' : 'occupied';
    return `Workspace ${index + 1}: ${label}, ${selection}, ${occupancy}`;
}

// The workspace-names list after workspace `index` is renamed to `name`.
// Every other entry is kept, including names for workspaces that do not exist
// right now. An empty name leaves the workspace unnamed, and trailing unnamed
// entries are dropped.
export function renamedWorkspaceNames(names, index, name) {
    const result = [...names];
    while (result.length <= index)
        result.push('');
    result[index] = name.trim();
    while (result.length > 0 && result.at(-1) === '')
        result.pop();
    return result;
}

function luminance(rgb) {
    const [r, g, b] = rgb.map(value => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG 2 contrast ratio of two [r, g, b] colours.
export function contrastRatio(a, b) {
    const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (lighter + 0.05) / (darker + 0.05);
}

// Antialiased text never quite reaches its colour: even the middle of a
// stroke can be the label colour blended 95% into the pill.
const STROKE_COVERAGE = 0.95;

// The label colour as it is drawn where a stroke covers `coverage` of a pixel.
export function drawnColour(foreground, background, coverage = STROKE_COVERAGE) {
    return foreground.map((c, i) => background[i] + (c - background[i]) * coverage);
}

// The active workspace is a pill in the accent colour darkened by 82%. Its
// label is the accent colour lightened towards white in 5% steps, stopping at
// the first step at which the label as drawn has at least 7:1 contrast
// against the pill.
export function accentPill({red, green, blue}) {
    const accent = [red, green, blue];
    const background = accent.map(c => Math.round(c * 0.18));
    let foreground = accent;
    for (let step = 0; step <= 20; step++) {
        foreground = accent.map(c => Math.round(c + (255 - c) * step / 20));
        if (contrastRatio(drawnColour(foreground, background), background) >= 7)
            break;
    }
    return {background, foreground};
}

// The [r, g, b] colour part-way from `a` to `b`, for crossfading a label
// between the top bar's colour and the active pill's foreground as the pill
// passes over it.
export function mixColour(a, b, t) {
    const f = Math.min(1, Math.max(0, t));
    return a.map((c, i) => Math.round(c + (b[i] - c) * f));
}

// Where the pill sits at a fractional workspace index: on a button's rect at
// whole indices, straight between the neighbouring rects in between — its
// width included, so it arrives already the next name's size. `rects` are
// the buttons' {x, width} in one shared coordinate space, in workspace
// order. Returns null when there are no buttons.
export function pillRectAt(rects, fraction) {
    if (!rects.length)
        return null;
    const f = Math.min(rects.length - 1, Math.max(0, fraction));
    const lower = Math.floor(f);
    const upper = Math.ceil(f);
    const t = f - lower;
    const a = rects[lower];
    const b = rects[upper];
    return {
        x: a.x + (b.x - a.x) * t,
        width: a.width + (b.width - a.width) * t,
    };
}

// GNOME lays the switching workspaces out in `indices` order and reports
// progress in that laid-out space (0 at the first group, 1 at the second…).
// Turn it back into a fractional workspace index the bar can follow. This
// mirrors the transform GNOME binds to its own workspaces adjustment.
export function fractionalWorkspaceIndex(indices, progress) {
    if (!indices.length)
        return 0;
    const p = Math.min(indices.length - 1, Math.max(0, progress));
    const lower = Math.floor(p);
    const upper = Math.ceil(p);
    return indices[lower] + (indices[upper] - indices[lower]) * (p - lower);
}
