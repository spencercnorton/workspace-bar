# Changelog

All notable changes to Workspace Bar are documented here.

## 1.0.3 — 2026-10-16

- Workspace switching is one rigid 360 ms slide with a gentle ease-out, replacing the 195 ms whip-pan and its per-window speed-stretch: windows and wallpaper now travel together, undistorted, so the next workspace reads as already open beside the current one.
- The active pill rides the desktop's own switch progress — on keyboard, click, wheel and touchpad gesture switches alike — gliding between the buttons and fading each name's colour as it passes, instead of streaking on its own timing after the switch. Interrupted or cancelled switches carry it back from where it is.

## 1.0.2 — 2026-10-14

- Switching workspaces animates the active top-bar pill and a trailing wake streak across from the previous button into the new one with directional speed-stretch, while keeping workspace names stationary and crisp.
- Desktop workspace transitions use a 195 ms whip-pan cubic-bezier curve with per-window directional speed-stretch, perpendicular compression, and depth-scaled velocity lag without triggering offscreen flatten FBOs or wallpaper overlap.

## 1.0.1 — 2026-10-05

- The active workspace's pill is as tall as its name, so the top bar shows above and below it, instead of filling the whole height of the top bar. Clicking anywhere in the top bar's height still switches workspace.
- Workspace names are bold. At the regular weight of Ubuntu's top bar they were thin and hard to read over a translucent top bar.
- The pill's corners are 4 px, down from 8 px, to suit its height.

## 1.0.0 — 2026-09-30

The first public release.

- A named button for every workspace in the top bar, in place of the Activities button. Workspaces with windows on them are bright and empty ones dimmed; a workspace without a name shows as "Workspace N".
- Click a button to switch workspace, or scroll anywhere on the top bar.
- Right-click the bar, or press the Menu key on a button, to rename a workspace. The name goes to GNOME's workspace-names setting, and only the workspace you renamed changes.
- The active workspace follows the accent colour, and its name keeps at least 7:1 contrast as drawn.
- With dynamic workspaces, the empty workspace at the end has a button only while it is the active one.
- The UUID is `workspace-bar@spencercnorton.github.io`.
