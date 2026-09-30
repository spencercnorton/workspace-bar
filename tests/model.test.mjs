// The logic in model.js: labels, the button model, renames and the accent
// pill. No GNOME Shell needed.
//   node --test tests/
import assert from 'node:assert/strict';
import test from 'node:test';

import {
    accentPill,
    buildWorkspaceModel,
    contrastRatio,
    renamedWorkspaceNames,
    workspaceAccessibleName,
    workspaceLabel,
} from '../model.js';

test('names and occupancy produce one button state per workspace', () => {
    const model = buildWorkspaceModel({
        count: 4,
        activeIndex: 1,
        names: ['Home', 'Code', 'Media'],
        occupied: [true, true, false, false],
    });

    assert.deepEqual(model, [
        {index: 0, label: 'Home', active: false, empty: false, visible: true},
        {index: 1, label: 'Code', active: true, empty: false, visible: true},
        {index: 2, label: 'Media', active: false, empty: true, visible: true},
        {index: 3, label: 'Workspace 4', active: false, empty: true, visible: true},
    ]);
});

test('unnamed and blank workspaces fall back to "Workspace N"', () => {
    assert.equal(workspaceLabel([], 0), 'Workspace 1');
    assert.equal(workspaceLabel(['Home', ''], 1), 'Workspace 2');
    assert.equal(workspaceLabel(['  '], 0), 'Workspace 1');
    assert.equal(workspaceLabel([' Home '], 0), 'Home');
});

test('accessible name carries position, selection and occupancy', () => {
    assert.equal(
        workspaceAccessibleName({index: 2, label: 'Media', active: true, empty: false}),
        'Workspace 3: Media, active, occupied');
    assert.equal(
        workspaceAccessibleName({index: 0, label: 'Home', active: false, empty: true}),
        'Workspace 1: Home, inactive, empty');
});

test('invalid model dimensions fail closed', () => {
    assert.throws(() => buildWorkspaceModel({count: -1, activeIndex: 0}), TypeError);
    assert.throws(() => buildWorkspaceModel({count: 2, activeIndex: 0.5}), TypeError);
});

test('with dynamic workspaces the trailing empty workspace is hidden unless active', () => {
    const visible = options => buildWorkspaceModel({count: 3, dynamic: true, ...options})
        .map(state => state.visible);

    assert.deepEqual(visible({activeIndex: 0, occupied: [true, true]}), [true, true, false]);
    assert.deepEqual(visible({activeIndex: 2, occupied: [true, true]}), [true, true, true]);
    // An occupied last workspace is only momentary (GNOME adds a new empty
    // one), but it is never hidden.
    assert.deepEqual(visible({activeIndex: 0, occupied: [true, true, true]}), [true, true, true]);
    // Static workspaces are always all shown.
    assert.deepEqual(
        buildWorkspaceModel({count: 3, activeIndex: 0, dynamic: false}).map(state => state.visible),
        [true, true, true]);
});

test('a rename changes only the edited workspace', () => {
    assert.deepEqual(renamedWorkspaceNames(['Home', 'Code', 'Media'], 1, 'Work'),
        ['Home', 'Work', 'Media']);
    // Unnamed workspaces before it stay unnamed, not "Workspace N".
    assert.deepEqual(renamedWorkspaceNames([], 2, 'Media'), ['', '', 'Media']);
    // Names kept for workspaces that do not exist right now survive.
    assert.deepEqual(renamedWorkspaceNames(['Home', 'Code', 'Media', 'Games', 'Notes'], 0, 'Start'),
        ['Start', 'Code', 'Media', 'Games', 'Notes']);
    // Surrounding space is trimmed.
    assert.deepEqual(renamedWorkspaceNames(['Home'], 0, '  Games '), ['Games']);
});

test('clearing a name leaves the workspace unnamed and drops trailing blanks', () => {
    assert.deepEqual(renamedWorkspaceNames(['Home', 'Code', 'Media'], 2, ''), ['Home', 'Code']);
    assert.deepEqual(renamedWorkspaceNames(['Home', '', 'Media'], 2, '   '), ['Home']);
    assert.deepEqual(renamedWorkspaceNames(['Home', 'Code', 'Media'], 1, ''), ['Home', '', 'Media']);
    assert.deepEqual(renamedWorkspaceNames(['Home'], 0, ''), []);
});

test('contrast ratio matches WCAG reference values', () => {
    assert.equal(contrastRatio([255, 255, 255], [0, 0, 0]), 21);
    assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]), 21);
    assert.equal(contrastRatio([119, 119, 119], [119, 119, 119]), 1);
    assert.ok(Math.abs(contrastRatio([118, 118, 118], [255, 255, 255]) - 4.54) < 0.01);
});

// The accent colours St reports on GNOME Shell 50: upstream GNOME's, and the
// Yaru variants Ubuntu's GNOME Shell uses with a Yaru theme, for a dark and a
// light style. Ten accents each; brown is Ubuntu's addition.
const ACCENTS = {
    gnome: {
        blue: '#3584e4', teal: '#2190a4', green: '#3a944a', yellow: '#c88800', orange: '#ed5b00',
        red: '#e62d42', pink: '#d56199', purple: '#9141ac', slate: '#6f8396', brown: '#b39169',
    },
    'yaru dark': {
        blue: '#0073e5', teal: '#308280', green: '#4b8501', yellow: '#9f6c00', orange: '#d34615',
        red: '#da3450', pink: '#b34cb3', purple: '#7764d8', slate: '#657b69', brown: '#92714a',
    },
    'yaru light': {
        blue: '#0070de', teal: '#2e7e7c', green: '#488001', yellow: '#9a6800', orange: '#cb4314',
        red: '#d82b48', pink: '#ae4aae', purple: '#7360d7', slate: '#627766', brown: '#8c6c47',
    },
};
const rgb = hex => ({
    red: parseInt(hex.slice(1, 3), 16),
    green: parseInt(hex.slice(3, 5), 16),
    blue: parseInt(hex.slice(5, 7), 16),
});

test('the purple accent gives the established pill colours', () => {
    assert.deepEqual(accentPill(rgb(ACCENTS['yaru dark'].purple)),
        {background: [21, 18, 39], foreground: [167, 154, 230]});
    assert.deepEqual(accentPill(rgb(ACCENTS.gnome.purple)),
        {background: [26, 12, 31], foreground: [189, 141, 205]});
});

test('every accent gives a dark pill with at least 7:1 contrast', () => {
    for (const [palette, accents] of Object.entries(ACCENTS)) {
        assert.equal(Object.keys(accents).length, 10, palette);
        for (const [name, hex] of Object.entries(accents)) {
            const accent = rgb(hex);
            const {background, foreground} = accentPill(accent);
            const what = `${palette} ${name}`;
            assert.deepEqual(background,
                [accent.red, accent.green, accent.blue].map(c => Math.round(c * 0.18)), what);
            assert.ok(contrastRatio(foreground, background) >= 7,
                `${what}: ${contrastRatio(foreground, background).toFixed(2)}:1`);
            // The label keeps the accent's hue: lightened, never replaced by white.
            assert.notDeepEqual(foreground, [255, 255, 255], what);
        }
    }
});

test('the label is lightened no further than 7:1 needs', () => {
    for (const accents of Object.values(ACCENTS)) {
        for (const hex of Object.values(accents)) {
            const accent = rgb(hex);
            const {background, foreground} = accentPill(accent);
            const channels = [accent.red, accent.green, accent.blue];
            // Recover the step and check that the previous one fell short.
            const step = [...Array(21).keys()].find(s =>
                channels.every((c, i) => Math.round(c + (255 - c) * s / 20) === foreground[i]));
            assert.ok(step !== undefined);
            if (step > 0) {
                const previous = channels.map(c => Math.round(c + (255 - c) * (step - 1) / 20));
                assert.ok(contrastRatio(previous, background) < 7, hex);
            }
        }
    }
});
