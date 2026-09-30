// Runs the real extension.js and workspacesMenu.js against stub GNOME Shell
// modules: enable, clicks, the panel-wide scroll wiring, the sync guard, a
// rename through the menu, accent and setting changes, and disable. It checks
// the bookkeeping, not St rendering; a change is still tried in GNOME Shell.
//   node --test tests/*.test.mjs
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';

// ---- Stub GNOME Shell -------------------------------------------------------

const emitters = new Set();
const problems = [];

// Signals, with GNOME Shell's signal tracker: in connectObject() the last
// argument owns the handlers, and destroying an owning actor drops them.
class Emitter {
    constructor() { this.handlers = []; emitters.add(this); }
    connect(signal, fn) { this.handlers.push({signal, fn, owner: null}); }
    connectObject(...args) {
        const owner = args.pop();
        for (let i = 0; i < args.length; i += 2)
            this.handlers.push({signal: args[i], fn: args[i + 1], owner});
    }
    disconnectObject(owner) { this.handlers = this.handlers.filter(h => h.owner !== owner); }
    emit(signal, ...args) {
        let result;
        for (const h of this.handlers.filter(h => h.signal === signal))
            result = h.fn(this, ...args);
        return result;
    }
}

class Actor extends Emitter {
    constructor(...args) {
        super();
        Object.assign(this, {children: [], parent: null, opacity: 255, style: null, _visible: true});
        this._init(...args);
    }
    _init({style_class: _styleClass, child, ...params} = {}) {
        if (child)
            this.add_child(child);
        Object.assign(this, params);
    }
    // Like Clutter: a visibility change must not start while another one on
    // the same actor is under way, and hiding the key focus moves it away.
    get visible() { return this._visible; }
    set visible(visible) {
        if (this._changing)
            problems.push(`${this.constructor.name} visibility changed while it was changing`);
        this._changing = true;
        this._visible = visible;
        if (!visible && this.contains(stage.key_focus))
            stage.grabFocus(null);
        this._changing = false;
    }
    get child() { return this.children[0] ?? null; }
    set(params) { Object.assign(this, params); }
    add_style_class_name() {}
    add_child(child) { this.children.push(child); child.parent = this; }
    remove_child(child) { this.children = this.children.filter(c => c !== child); child.parent = null; }
    get_children() { return [...this.children]; }
    get_n_children() { return this.children.length; }
    [Symbol.iterator]() { return this.get_children()[Symbol.iterator](); }
    contains(actor) {
        for (let a = actor; a; a = a.parent) {
            if (a === this)
                return true;
        }
        return false;
    }
    destroy_all_children() { this.get_children().forEach(child => child.destroy()); }
    destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        this.emit('destroy');
        this.destroy_all_children();
        this.parent?.remove_child(this);
        emitters.forEach(emitter => emitter.disconnectObject(this));
    }
    show() { this.visible = true; }
    hide() { this.visible = false; }
    ease({onComplete, duration: _d, mode: _m, ...values}) { Object.assign(this, values); onComplete?.(); }
    grab_key_focus() { stage.grabFocus(this); }
    navigate_focus() { return false; }
    get_accessible() { return null; }
}

// How St colours text. An St.Label takes its colour from its parents
// whenever it is drawn. St.Button's own `label` is a bare text that St
// colours only when the button first appears or its style changes, not when
// the text is made: made on a button already on the stage, it stays black.
function inheritedColour(actor) {
    for (let a = actor.parent; a; a = a.parent) {
        const colour = a.style?.match(/(?:^|\s)color: (rgb\([^)]*\))/)?.[1];
        if (colour)
            return colour;
        if (a === panel)
            return 'top bar';
    }
    return null;
}

class BareText extends Actor {
    get colour() { return this.fixedColour ?? inheritedColour(this); }
}

class Label extends Actor {
    get colour() { return inheritedColour(this); }
    _init(params) { this._text = ''; this.bindings = []; super._init(params); }
    get text() { return this._text; }
    set text(text) { this._text = text; this.bindings.forEach(([target, property]) => (target[property] = text)); }
    bind_property(_source, target, property) { this.bindings.push([target, property]); }
}

class Entry extends Actor {
    _init(params) {
        this.clutter_text = Object.assign(new Actor(), {set_selection() {}});
        this.add_child(this.clutter_text);
        this.text = '';
        super._init(params);
    }
}

class Button extends Actor {
    get checked() { return Boolean(this._checked); }
    set checked(checked) {
        if (checked !== this.checked) {
            this._checked = checked;
            this.emit('notify::checked');
        }
    }
    get label() { return this._text?.text; }
    set label(text) {
        if (!this._text) {
            this._text = new BareText();
            this.add_child(this._text);
            if (inheritedColour(this._text))
                this._text.fixedColour = 'black';
        }
        this._text.text = text;
    }
    get style() { return this._style; }
    set style(style) {
        if (style !== this._style && this._text)
            delete this._text.fixedColour;
        this._style = style;
    }
}

class PanelButton extends Actor {
    _init(_alignment, name) {
        super._init({reactive: true, can_focus: true, track_hover: true, accessible_name: name});
        this.accessible_role = 'menu';
        this.menu = null;
        this.container = new Actor();
        this.container.add_child(this);
    }
    setMenu(menu) { this.menu = menu; }
    destroy() { this.menu?.destroy(); super.destroy(); this.container.destroy(); }
}

class PopupMenu {
    constructor(sourceActor) {
        Object.assign(this, {sourceActor, actor: new Actor(), box: new Actor(), isOpen: false});
        this.actor.add_child(this.box);
    }
    addMenuItem(item) { this.box.add_child(item.actor ?? item); }
    open() { this.isOpen = true; }
    close() { this.isOpen = false; }
    toggle() { this.isOpen = !this.isOpen; }
    destroy() { this.actor.destroy(); }
}

class PopupMenuSection {
    constructor() { this.box = this.actor = new Actor(); }
    addMenuItem(item) { this.box.add_child(item); }
}

class PopupBaseMenuItem extends Actor {
    setOrnament(ornament) { this.ornament = ornament; }
}

// Every Settings object of a schema sees every change, as with dconf.
const dconf = new Map();
class Settings extends Emitter {
    static instances = [];
    constructor({schema_id: schema}) { super(); this.schema = schema; Settings.instances.push(this); }
    get(key) { return dconf.get(`${this.schema} ${key}`); }
    set(key, value) {
        dconf.set(`${this.schema} ${key}`, value);
        Settings.instances.filter(s => s.schema === this.schema).forEach(s => s.emit(`changed::${key}`, key));
    }
    get_strv(key) { return [...this.get(key) ?? []]; }
    set_strv(key, value) { this.set(key, [...value]); }
    get_boolean(key) { return Boolean(this.get(key)); }
    set_boolean(key, value) { this.set(key, value); }
}

const window = (options = {}) => ({skip_taskbar: false, is_on_all_workspaces: () => false, ...options});

class Workspace extends Emitter {
    constructor(manager, windows) { super(); Object.assign(this, {manager, windows}); }
    list_windows() { return this.windows; }
    activate(time) {
        this.activatedAt = time;
        this.manager.active = this.manager.workspaces.indexOf(this);
        this.manager.emit('workspace-switched');
    }
}

class WorkspaceManager extends Emitter {
    constructor() { super(); Object.assign(this, {active: 0, workspaces: [], n_workspaces: 0}); }
    get nWorkspaces() { return this.n_workspaces; }
    setWorkspaces(windowsPerWorkspace) {
        this.workspaces = windowsPerWorkspace.map(windows => new Workspace(this, windows));
        this.n_workspaces = this.workspaces.length;
    }
    get_workspace_by_index(index) { return index < this.n_workspaces ? this.workspaces[index] : null; }
    get_active_workspace_index() { return this.active; }
}

class Stage extends Actor {
    get keyFocus() { return this.key_focus; }
    grabFocus(actor) { this.key_focus = actor; this.emit('notify::key-focus'); }
}
const stage = new Stage({key_focus: null});

const themeContext = Object.assign(new Emitter(), {
    accent: {red: 119, green: 100, blue: 216, alpha: 255},
    get_accent_color() { return [this.accent, {red: 255, green: 255, blue: 255, alpha: 255}]; },
});

const manager = new WorkspaceManager();
manager.setWorkspaces([[window()], [window(), window()], [window({skip_taskbar: true})], []]);
const display = new Emitter();
globalThis.global = {stage, display, workspace_manager: manager, workspaceManager: manager, get_current_time: () => 1234};

const panel = new Actor();
panel._leftBox = new Actor();
panel.add_child(panel._leftBox);
panel.statusArea = {activities: new PanelButton(0, 'Activities')};
panel._leftBox.add_child(panel.statusArea.activities.container);
panel.addToStatusArea = (role, indicator, position, box) => {
    assert.equal(box, 'left');
    panel._leftBox.children.splice(position, 0, indicator.container);
    indicator.container.parent = panel._leftBox;
    panel.statusArea[role] = indicator;
    indicator.connect('destroy', () => delete panel.statusArea[role]);
};
const wm = {
    scrolled: [],
    handleWorkspaceScroll(event) { this.scrolled.push(event); return 'scroll handled'; },
};

globalThis.__stubs = {
    Atk: {Role: {PUSH_BUTTON: 'push button', TOOL_BAR: 'tool bar'}},
    Clutter: {
        ActorAlign: {START: 1, END: 2, CENTER: 3},
        AnimationMode: {EASE_OUT_QUAD: 1},
        BUTTON_PRIMARY: 1,
        BUTTON_SECONDARY: 3,
        EVENT_PROPAGATE: false,
        EVENT_STOP: true,
        KEY_e: 101,
    },
    Gio: {Settings},
    GObject: {registerClass: (klass, maybeKlass) => maybeKlass ?? klass, signals: Symbol('signals'), BindingFlags: {DEFAULT: 0}},
    Shell: {Stack: Actor},
    St: {
        BoxLayout: Actor, Button, Entry, Label, ScrollView: Actor,
        ButtonMask: {ONE: 1}, DirectionType: {TAB_FORWARD: 0}, Side: {TOP: 0},
        ThemeContext: {get_for_stage: () => themeContext},
    },
    'ui/main.js': {panel, wm},
    'ui/panelMenu.js': {Button: PanelButton},
    'ui/popupMenu.js': {Ornament: {NONE: 0, CHECK: 2}, PopupBaseMenuItem, PopupMenu, PopupMenuSection},
    'misc/animationUtils.js': {ensureActorVisibleInScrollView: () => {}},
    'extensions/extension.js': {Extension: class { constructor(metadata) { this.uuid = metadata.uuid; } }},
};

// ---- Load the real modules against the stubs --------------------------------

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'workspace-bar-'));
writeFileSync(join(dir, 'package.json'), '{"type": "module"}\n');
for (const [name, exports] of Object.entries(globalThis.__stubs)) {
    const path = name.endsWith('.js') ? join(dir, 'shell', name) : join(dir, 'gi', `${name}.js`);
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, name.endsWith('.js')
        ? `export const {${Object.keys(exports).join(', ')}} = globalThis.__stubs['${name}'];\n`
        : `export default globalThis.__stubs.${name};\n`);
}
for (const file of ['extension.js', 'workspacesMenu.js', 'model.js']) {
    writeFileSync(join(dir, file), readFileSync(join(root, file), 'utf8')
        .replace(/'gi:\/\/(\w+)'/g, "'./gi/$1.js'")
        .replace(/'resource:\/\/\/org\/gnome\/shell\/([\w/.]+)'/g, "'./shell/$1'"));
}
const {default: WorkspaceBarExtension} = await import(pathToFileURL(join(dir, 'extension.js')).href);

// ---- The tests ---------------------------------------------------------------

const uuid = 'workspace-bar@spencercnorton.github.io';
const extension = new WorkspaceBarExtension({uuid});
const wmSettings = new Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
const mutterSettings = new Settings({schema_id: 'org.gnome.mutter'});
const bar = () => panel.statusArea[uuid];
const buttons = () => bar().get_children()[0].get_children();
const menuItems = () => [...bar().menu.box.children[0].children[0]];
const PURPLE_PILL = 'background-color: rgb(21,18,39); color: rgb(173,162,232);';
const names = () => buttons().map(b => b.child.text);
const colours = () => buttons().map(b => b.child.colour);

wmSettings.set_strv('workspace-names', ['Home', 'Code', 'Media']);

test('enable puts one button per workspace first in the top bar', () => {
    extension.enable();

    assert.ok(bar());
    assert.equal(panel._leftBox.children[0], bar().container);
    assert.deepEqual(names(), ['Home', 'Code', 'Media', 'Workspace 4']);
    assert.deepEqual(colours(), ['rgb(173,162,232)', 'top bar', 'top bar', 'top bar']);
    assert.deepEqual(buttons().map(b => b.accessible_name), [
        'Workspace 1: Home, active, occupied',
        'Workspace 2: Code, inactive, occupied',
        'Workspace 3: Media, inactive, empty',
        'Workspace 4: Workspace 4, inactive, empty',
    ]);
    assert.deepEqual(buttons().map(b => b.style), [PURPLE_PILL, null, null, null]);
    // Only skip-taskbar windows count as empty; the active one is never dimmed.
    // The name is dimmed, not the button with its focus ring.
    assert.deepEqual(buttons().map(b => b.child.opacity), [255, 255, 166, 166]);
    assert.deepEqual(buttons().map(b => b.opacity), [255, 255, 255, 255]);
    assert.deepEqual(menuItems().map(item => item.label.text), ['Home', 'Code', 'Media', 'Workspace 4']);
    assert.deepEqual(menuItems().map(item => item.ornament), [2, 0, 0, 0]);
});

test('the container takes no input and is not announced as a menu', () => {
    assert.equal(bar().reactive, false);
    assert.equal(bar().can_focus, false);
    assert.equal(bar().track_hover, false);
    assert.equal(bar().accessible_role, 'tool bar');
});

test('the Activities button is hidden, not its container', () => {
    assert.equal(panel.statusArea.activities.visible, false);
    assert.equal(panel.statusArea.activities.container.visible, true);
});

test('a click switches workspace and the pill follows', () => {
    buttons()[2].emit('clicked');
    assert.equal(manager.active, 2);
    assert.equal(manager.workspaces[2].activatedAt, 1234);
    assert.deepEqual(buttons().map(b => b.style), [null, null, PURPLE_PILL, null]);
    assert.deepEqual(buttons().map(b => b.child.opacity), [255, 255, 255, 166]);
});

test('a secondary click or the menu key opens the menu; a primary click on the gaps does not', () => {
    const box = bar().get_children()[0];
    assert.equal(box.reactive, true);
    assert.equal(box.emit('button-press-event', {get_button: () => 1}), false);
    assert.equal(bar().menu.isOpen, false);
    assert.equal(box.emit('button-press-event', {get_button: () => 3}), true);
    assert.equal(bar().menu.isOpen, true);
    bar().menu.close();
    buttons()[0].emit('popup-menu');
    assert.equal(bar().menu.isOpen, true);
    bar().menu.close();
});

test('scrolling anywhere on the panel goes to GNOME\'s workspace scroll', () => {
    const event = {type: 'scroll'};
    assert.equal(panel.handlers.filter(h => h.signal === 'scroll-event').length, 1);
    assert.equal(panel.emit('scroll-event', event), 'scroll handled');
    assert.deepEqual(wm.scrolled, [event]);
});

test('a sync while a workspace is being removed waits for the rebuild', () => {
    const before = buttons();
    manager.n_workspaces = 3;
    assert.doesNotThrow(() => display.emit('restacked'));
    assert.doesNotThrow(() => manager.emit('workspace-switched'));
    assert.deepEqual(buttons(), before);

    manager.setWorkspaces([[window()], [window()], []]);
    manager.active = 0;
    manager.emit('notify::n-workspaces');
    assert.deepEqual(names(), ['Home', 'Code', 'Media']);
    assert.equal(menuItems().length, 3);
    assert.ok(before.every(b => b.destroyed));
});

test('names keep the top bar colour when the workspace count changes', () => {
    for (const count of [5, 4]) {
        manager.setWorkspaces([[window()], ...Array.from({length: count - 1}, () => [])]);
        manager.emit('notify::n-workspaces');
        assert.deepEqual(colours(), ['rgb(173,162,232)', ...Array(count - 1).fill('top bar')]);
    }
});

test('a rename in the menu writes only that workspace to workspace-names', () => {
    manager.setWorkspaces([[window()], [], [], []]);
    manager.emit('notify::n-workspaces');
    wmSettings.set_strv('workspace-names', ['Home']);

    const item = menuItems()[2];
    item._editButton.checked = true;
    assert.equal(stage.key_focus, item._entry.clutter_text);
    item._entry.text = '  Media ';
    item._entry.clutter_text.emit('activate');

    assert.deepEqual(wmSettings.get_strv('workspace-names'), ['Home', '', 'Media']);
    assert.equal(item.label.text, 'Media');
    assert.equal(item._editButton.checked, false);
    assert.equal(item._entry.visible, false);
    assert.deepEqual(names(), ['Home', 'Workspace 2', 'Media', 'Workspace 4']);
    // Hiding the focused entry, and unchecking the edit button, must not
    // re-enter the end of editing.
    assert.deepEqual(problems, []);
});

test('a menu item switches to its workspace', () => {
    menuItems()[3].emit('activate', {get_time: () => 99});
    assert.equal(manager.active, 3);
    assert.deepEqual(menuItems().map(item => item.ornament), [0, 0, 0, 2]);
});

test('the pill follows an accent colour change', () => {
    themeContext.accent = {red: 48, green: 130, blue: 128, alpha: 255};
    themeContext.emit('changed');
    assert.equal(buttons()[3].style, 'background-color: rgb(9,23,23); color: rgb(131,180,179);');
});

test('with dynamic workspaces the trailing empty workspace gets no button', () => {
    manager.workspaces[0].activate(1);
    mutterSettings.set_boolean('dynamic-workspaces', true);
    assert.deepEqual(buttons().map(b => b.visible), [true, true, true, false]);
    mutterSettings.set_boolean('dynamic-workspaces', false);
    assert.deepEqual(buttons().map(b => b.visible), [true, true, true, true]);
});

test('disable restores Activities and leaves no handler or actor behind', () => {
    const menuActor = bar().menu.actor;
    extension.disable();

    assert.equal(bar(), undefined);
    assert.equal(panel.statusArea.activities.visible, true);
    assert.deepEqual(panel._leftBox.children, [panel.statusArea.activities.container]);
    assert.ok(menuActor.destroyed);
    // Destroyed actors may keep their own handlers; nothing else may keep any.
    for (const emitter of emitters) {
        if (!emitter.destroyed) {
            assert.deepEqual(emitter.handlers.map(h => h.signal), [],
                `handlers left on a ${emitter.constructor.name}`);
        }
    }
    assert.equal(panel.emit('scroll-event', {}), undefined);
    assert.deepEqual(problems, []);
});

test('enable and disable again, with Activities already hidden by someone else', () => {
    panel.statusArea.activities.hide();
    extension.enable();
    assert.equal(buttons().length, 4);
    extension.disable();
    assert.equal(panel.statusArea.activities.visible, false);
    panel.statusArea.activities.show();
});
