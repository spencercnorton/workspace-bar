// SPDX-FileCopyrightText: 2026 Spencer Norton
//
// SPDX-License-Identifier: GPL-3.0-or-later

// The parts of Workspace Bar that need no GNOME Shell, so that Node can test
// them: what each button shows, what a rename writes back to the
// workspace-names setting, and the colours of the active workspace.

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

// The active workspace is a pill in the accent colour darkened by 82%. Its
// label is the accent colour lightened towards white in 5% steps, stopping at
// the first step with at least 7:1 contrast against the pill.
export function accentPill({red, green, blue}) {
    const accent = [red, green, blue];
    const background = accent.map(c => Math.round(c * 0.18));
    let foreground = accent;
    for (let step = 0; step <= 20; step++) {
        foreground = accent.map(c => Math.round(c + (255 - c) * step / 20));
        if (contrastRatio(foreground, background) >= 7)
            break;
    }
    return {background, foreground};
}
