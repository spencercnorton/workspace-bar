#!/bin/sh
# Checks the installed GNOME Shell 50 for every API the extension uses: the
# introspected classes and methods, the GNOME Shell modules and exports it
# imports, and gnome-extensions accepting the tree. Needs Ubuntu 26.04 with
# gjs, gnome-shell, dpkg-dev and unzip.
#   tests/check-gnome50-api.sh
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
multiarch=$(dpkg-architecture -qDEB_HOST_MULTIARCH)
mutter=/usr/lib/${multiarch}/mutter-18
shell=/usr/lib/gnome-shell

test -f "${mutter}/Clutter-18.typelib"
test -f "${mutter}/Meta-18.typelib"
test -f "${shell}/St-18.typelib"
test -f "${shell}/Shell-18.typelib"

# The JavaScript below is gjs input, not shell.
# shellcheck disable=SC2016
GI_TYPELIB_PATH="${mutter}:${shell}" LD_LIBRARY_PATH="${shell}:${mutter}" gjs -c '
imports.gi.versions.Clutter = "18";
imports.gi.versions.Meta = "18";
imports.gi.versions.Shell = "18";
imports.gi.versions.St = "18";
const {Atk, Clutter, GObject, Meta, Shell, St} = imports.gi;
const need = (ok, what) => {
    if (!ok)
        throw new Error(`GNOME Shell 50 API is missing: ${what}`);
};
for (const role of ["PUSH_BUTTON", "TOOL_BAR"])
    need(Atk.Role[role] !== undefined, `Atk.Role.${role}`);
const buttonProperties = new Set(St.Button.list_properties().map(p => p.name));
for (const name of ["accessible-name", "accessible-role", "can-focus", "track-hover",
    "label", "icon-name", "toggle-mode", "checked", "button-mask", "reactive", "style", "opacity"])
    need(buttonProperties.has(name), `St.Button:${name}`);
need(typeof St.ThemeContext.prototype.get_accent_color === "function", "St.ThemeContext.get_accent_color");
need(GObject.signal_lookup("changed", St.ThemeContext) !== 0, "St.ThemeContext::changed");
need(GObject.signal_lookup("popup-menu", St.Widget) !== 0, "St.Widget::popup-menu");
need(GObject.signal_lookup("clicked", St.Button) !== 0, "St.Button::clicked");
need(GObject.signal_lookup("scroll-event", Clutter.Actor) !== 0, "Clutter.Actor::scroll-event");
need(GObject.signal_lookup("button-press-event", Clutter.Actor) !== 0, "Clutter.Actor::button-press-event");
for (const name of ["activate", "list_windows"])
    need(typeof Meta.Workspace.prototype[name] === "function", `Meta.Workspace.${name}`);
need(GObject.signal_lookup("window-added", Meta.Workspace) !== 0, "Meta.Workspace::window-added");
need(typeof Meta.Window.prototype.is_on_all_workspaces === "function", "Meta.Window.is_on_all_workspaces");
need(typeof Shell.Stack === "function" && typeof St.Entry === "function" &&
    typeof St.ScrollView === "function", "Shell.Stack, St.Entry and St.ScrollView");
print("GNOME Shell 50 introspection contract is present");
'

# The GNOME Shell modules the extension imports, from GNOME Shell's own
# resources, and the exports and methods it relies on in each.
resources=${shell}/libshell-18.so
need() {
    if ! gresource extract "${resources}" "/org/gnome/shell/$1" | grep -F "$2" >/dev/null; then
        echo "GNOME Shell 50 is missing $1: $2" >&2
        exit 1
    fi
}
need extensions/extension.js 'export class Extension '
need ui/main.js 'export let panel'
need ui/main.js 'export let wm'
need ui/panel.js 'addToStatusArea(role, indicator, position, box) {'
need ui/panelMenu.js 'export const Button '
need ui/panelMenu.js 'setMenu(menu) {'
need ui/popupMenu.js 'export const PopupBaseMenuItem '
need ui/popupMenu.js 'export class PopupMenu '
need ui/popupMenu.js 'export class PopupMenuSection '
need ui/popupMenu.js 'export const Ornament '
need ui/windowManager.js 'handleWorkspaceScroll(event) {'
need misc/animationUtils.js 'export function ensureActorVisibleInScrollView('
echo "GNOME Shell 50 modules export what the extension imports"

pack=$(mktemp -d)
trap 'rm -rf "${pack}"' EXIT
gnome-extensions pack --force --out-dir "${pack}" \
    --extra-source=model.js --extra-source=workspacesMenu.js \
    --extra-source=LICENSE --extra-source=NOTICE "${root}"
unzip -t "${pack}/workspace-bar@spencercnorton.github.io.shell-extension.zip" >/dev/null
echo "gnome-extensions pack accepts the tree"
