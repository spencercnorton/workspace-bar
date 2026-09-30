#!/usr/bin/env python3
"""Release invariants that need no GNOME Shell: one version and the public
UUID everywhere, GNOME Shell 50 only, no settings or install-time side effects
of its own, the licence notices, and JavaScript that parses as ES modules."""
import hashlib, json, pathlib, re, shutil, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
UUID = "workspace-bar@spencercnorton.github.io"
PACKAGE = "gnome-shell-extension-workspace-bar"
SOURCES = ["extension.js", "model.js", "workspacesMenu.js"]
PAYLOAD = SOURCES + ["metadata.json", "stylesheet.css"]
GPL3_SHA256 = "3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986"
# The notices of GNOME's workspace-indicator, kept in the files adapted from it.
GNOME_NOTICES = {
    "extension.js": ["2011 Erick Pérez Castellanos <erick.red@gmail.com>",
                     "2011 Giovanni Campagna <gcampagna@src.gnome.org>",
                     "2017 Florian Müllner <fmuellner@gnome.org>"],
    "stylesheet.css": ["2011 Erick Pérez Castellanos <erick.red@gmail.com>",
                       "2019 Florian Müllner <fmuellner@gnome.org>"],
}
GNOME_NOTICES["workspacesMenu.js"] = GNOME_NOTICES["extension.js"]
meta = json.loads((ROOT / "metadata.json").read_text())
failures = []

def check(ok, message):
    if not ok:
        failures.append(message)

def read(name):
    return (ROOT / name).read_text()

check(meta["uuid"] == UUID, f"metadata uuid is {meta['uuid']}, not {UUID}")
check(meta.get("url") == "https://github.com/spencercnorton/workspace-bar", "url is not the public repository")
check(meta["shell-version"] == ["50"], "shell-version must be GNOME Shell 50 alone")
check(isinstance(meta.get("version"), int), "version is not an integer")
check(re.fullmatch(r"\d+\.\d+\.\d+", meta.get("version-name", "")), "version-name is not X.Y.Z")
version = meta.get("version-name", "")
check(f"## {version} — " in read("CHANGELOG.md"), f"CHANGELOG.md has no entry for {version}")
check(read("debian/changelog").startswith(f"{PACKAGE} ({version}) "), f"debian/changelog does not start at {version}")
install = read("debian/install").split()
check(install[-1:] == [f"usr/share/gnome-shell/extensions/{UUID}"], f"debian/install installs outside {UUID}")
check(sorted(install[:-1]) == sorted(PAYLOAD), f"debian/install does not install exactly {PAYLOAD}")
control = read("debian/control")
check(f"gnome-extensions enable {UUID}" in control, "debian/control names another UUID")
check("gnome-shell (>= 50~)" in control and "gnome-shell (<< 51~)" in control, "debian/control must depend on GNOME Shell 50 alone")
build = read("scripts/build.sh")
for name in PAYLOAD + ["LICENSE", "NOTICE"]:
    check(name in build, f"scripts/build.sh does not package {name}")

# No settings, preferences, processes or maintainer scripts of its own; the
# workspace names live in GNOME's own setting.
code = "\n".join(read(name) for name in SOURCES)
check("settings-schema" not in meta and "gettext-domain" not in meta, "metadata declares a schema or a gettext domain")
check(not (ROOT / "prefs.js").exists() and not (ROOT / "schemas").exists(), "the extension has no preferences and no schema")
check("getSettings(" not in code and "ExtensionPreferences" not in code, "the extension reads no settings schema of its own")
check("spawn" not in code.lower() and "Soup" not in code, "the extension starts no process and opens no connection")
for script in ("preinst", "postinst", "prerm", "postrm"):
    check(not (ROOT / "debian" / script).exists(), f"debian/{script} must not exist")

check(hashlib.sha256((ROOT / "LICENSE").read_bytes()).hexdigest() == GPL3_SHA256, "LICENSE is not the canonical GPL-3.0 text")
for name in SOURCES + ["stylesheet.css"]:
    text = read(name)
    check("SPDX-FileCopyrightText: 2026 Spencer Norton\n" in text, f"{name} has no copyright line")
    if name in GNOME_NOTICES:
        check(all(f"SPDX-FileCopyrightText: {line}" in text for line in GNOME_NOTICES[name]), f"{name} lost GNOME's copyright notices")
        check("SPDX-License-Identifier: GPL-2.0-or-later AND GPL-3.0-or-later" in text, f"{name} lost GNOME's licence notice")
    else:
        check("SPDX-License-Identifier: GPL-3.0-or-later" in text, f"{name} has no licence line")
copyright_file = read("debian/copyright")
check("Files: extension.js stylesheet.css workspacesMenu.js\n" in copyright_file, "debian/copyright does not cover the adapted files")
for holder in ("Erick Pérez Castellanos <erick.red@gmail.com>", "Giovanni Campagna <gcampagna@src.gnome.org>", "Florian Müllner <fmuellner@gnome.org>"):
    check(holder in copyright_file, f"debian/copyright lost {holder.split(' <')[0]}")
check("https://gitlab.gnome.org/GNOME/gnome-shell-extensions" in read("NOTICE"), "NOTICE does not credit GNOME's workspace-indicator")

if shutil.which("node"):
    with tempfile.TemporaryDirectory() as tmp:
        for name in SOURCES:
            module = pathlib.Path(tmp, name.replace(".js", ".mjs"))
            module.write_text(read(name))
            result = subprocess.run(["node", "--check", str(module)], capture_output=True, text=True)
            check(result.returncode == 0, f"{name} does not parse: " + result.stderr.strip())
elif "--allow-missing-node" not in sys.argv:
    failures.append("node is not installed, so the JavaScript was not parsed")

for failure in failures:
    print("FAIL -", failure)
print(f"static check: {len(failures)} failure(s)")
sys.exit(1 if failures else 0)
