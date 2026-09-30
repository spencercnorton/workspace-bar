# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**[Report a vulnerability](https://github.com/spencercnorton/workspace-bar/security/advisories/new)**.
Do not open a public issue, and do not include real credentials or personal
paths in the report — a description and a minimal reproduction are enough.

There is no e-mail address for security reports; the advisory form is the
only channel, and it is the one that is monitored. You will get an
acknowledgement within a week. Fixes ship as a tagged release; the advisory
is published once the release is out, and credits you unless you ask
otherwise.

## Supported versions

Only the latest tagged release is supported.

## What the extension does

It runs inside GNOME Shell and draws the workspace buttons in the top bar. It
reads GNOME's workspace settings and the accent colour, and writes one GNOME
setting, the workspace names, when you rename a workspace. It stores nothing
else, opens no network connections, starts no processes and handles no
credentials.
