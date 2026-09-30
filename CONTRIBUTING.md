# Contributing to Workspace Bar

Thanks for your interest. This is a small project with one maintainer, so the
process is deliberately light.

## How changes land

GitHub is the development home. Branch from `main` and open a pull request
into `main`. The checks must pass before merge. Changes ship in tagged
releases.

Use a GitHub noreply address for commit authorship if you prefer to keep your
personal address private. Public history is public data.

## Working on the code

```bash
python3 tests/static-check.py       # what CI runs
node --test tests/*.test.mjs
tests/check-gnome50-api.sh          # needs Ubuntu 26.04 with GNOME Shell 50
scripts/build.sh                    # build the release zip and .deb
```

- Test a change in a real GNOME Shell session, and say which version in the
  pull request. The tests run the extension against stub GNOME Shell modules:
  they check the bookkeeping, not what appears on screen. Every GNOME Shell
  major version is checked before it is added to `metadata.json`.
- Keep a change to one concern.
- Commits carry a `Signed-off-by:` line (`git commit -s`, the Developer
  Certificate of Origin). There is no CLA.
- No secrets, hostnames, personal data or personal paths in the diff; the
  privacy check rejects them.

## Out of scope

- Settings or preferences. The extension has none of its own, and the
  workspace names are GNOME's setting.
- Anything beyond showing, switching and naming workspaces, such as
  reordering them.

## Pull request checklist

- [ ] `python3 tests/static-check.py` and `node --test tests/*.test.mjs` pass
- [ ] Tested in GNOME Shell (say which version)
- [ ] Commits are signed off
- [ ] `CHANGELOG.md` updated under `## Unreleased` if behaviour changed
