<h1 align="center">Workspace Bar</h1>

<p align="center">
  <strong>Your workspaces by name, in the top bar.</strong><br>
  A GNOME Shell extension that puts a named button for every workspace where the Activities button was: click or scroll to switch, right-click to rename.
</p>

<p align="center">
  <a href="https://github.com/spencercnorton/norvi-os"><img alt="Part of NorviOS" src="https://img.shields.io/badge/NorviOS-component-FD8024.svg"></a>
  <a href="https://github.com/spencercnorton/workspace-bar/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/spencercnorton/workspace-bar/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/spencercnorton/workspace-bar/tags"><img alt="Latest release" src="https://img.shields.io/github/v/tag/spencercnorton/workspace-bar?label=release&sort=semver"></a>
  <a href="#install"><img alt="Install for GNOME Shell" src="https://img.shields.io/badge/install-GNOME%20Shell-4a86cf.svg"></a>
  <a href="LICENSE"><img alt="Licence" src="https://img.shields.io/badge/licence-GPL--3.0--or--later-blue.svg"></a>
  <a href="https://buy.stripe.com/8x26oH2U44f65TRe574wM04"><img alt="Donate" src="https://img.shields.io/badge/donate-Stripe-635bff.svg?logo=stripe&logoColor=white"></a>
</p>

GNOME Shell shows your workspaces as dots inside the Activities button. This extension shows them as buttons with their names instead, such as Home, Code and Media, so you can see where you are and go straight to where you want to be. It is part of the [NorviOS](https://github.com/spencercnorton/norvi-os) desktop and supports GNOME Shell 50.

## What it does

**A button for every workspace, by name.** The names come from GNOME's own workspace-names setting; a workspace without a name shows as "Workspace 2". Workspaces with windows on them are bright, empty ones are dimmed.

**Switch with a click or the scroll wheel.** Click a button to go to that workspace. Scroll anywhere on the top bar, not just over the buttons, to move to the next or previous one; only things with a scroll action of their own, such as the volume icon, keep it. The buttons work from the keyboard too.

**Rename from the top bar.** Right-click the bar, or press the Menu key on a focused button, for the list of workspaces; the pencil next to one renames it. The name is written to GNOME's own setting, so anything else that shows workspace names sees it too.

**The active workspace follows your accent colour.** It is a dark pill in the accent colour, with its name lightened until it has at least 7:1 contrast.

**Dynamic workspaces work too.** With GNOME's dynamic workspaces, the empty workspace GNOME keeps at the end gets a button only while you are on it.

The bar takes the place of the Activities button. The overview still opens with the Super key or the hot corner, and disabling the extension brings the Activities button back.

## Install

### GNOME Shell — the release zip

Download `workspace-bar.shell-extension.zip` and `SHA256SUMS.txt` from the [latest release](https://github.com/spencercnorton/workspace-bar/releases/latest), then:

```bash
sha256sum --check --ignore-missing SHA256SUMS.txt
gnome-extensions install --force workspace-bar.shell-extension.zip
```

Log out and back in once so GNOME Shell sees the new extension, then enable it:

```bash
gnome-extensions enable workspace-bar@spencercnorton.github.io
```

### Ubuntu 26.04 — the release package

The same release carries `gnome-shell-extension-workspace-bar_*_all.deb`, which installs the extension for every user: `sudo apt install ./gnome-shell-extension-workspace-bar_*_all.deb`. Then log out and in, and enable it as above.

The extension is not on extensions.gnome.org.

## Where your data lives

| Setting | Purpose |
|---|---|
| dconf `/org/gnome/desktop/wm/preferences/workspace-names` | The workspace names. This is GNOME's own setting: the extension reads it, and a rename writes the one name you changed. |

The extension has no settings of its own and stores nothing else. It reads the accent colour and whether workspaces are dynamic from GNOME.

## Documentation

- [CHANGELOG.md](CHANGELOG.md): one entry per release
- [NOTICE](NOTICE): provenance and licence

## Contributing and support

- Bugs and feature requests: [open an issue](https://github.com/spencercnorton/workspace-bar/issues/new/choose). Questions: [Discussions](https://github.com/spencercnorton/workspace-bar/discussions).
- Security reports: [private vulnerability reporting](https://github.com/spencercnorton/workspace-bar/security/advisories/new). See [SECURITY.md](SECURITY.md). There is no e-mail address; that is deliberate.
- Pull requests are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md) first. Changes are reviewed and merged on GitHub, then shipped in tagged releases.
- If this saves you time, you can [support its development](https://buy.stripe.com/8x26oH2U44f65TRe574wM04).

## Development

```bash
python3 tests/static-check.py       # one version and UUID everywhere, licence notices, JavaScript parses
node --test tests/*.test.mjs        # the labels, renames and accent rule; enable, scroll, rename and disable against stub GNOME Shell
tests/check-gnome50-api.sh          # on Ubuntu 26.04: GNOME Shell 50 has every API the extension uses
scripts/build.sh                    # the release zip and .deb, into dist/
```

The extension builds on GNOME Shell's panel and popup-menu modules, which are not a stable API. Each new GNOME Shell major version needs a check before it is added to `metadata.json`.

## Licence

[GPL-3.0-or-later](LICENSE) © Spencer Norton

The rename menu is adapted from the workspace-indicator extension in [GNOME Shell Extensions](https://gitlab.gnome.org/GNOME/gnome-shell-extensions), licensed GPL-2.0-or-later; see [NOTICE](NOTICE).
