# Development

## Build on Windows

Run `powershell -ExecutionPolicy Bypass -File build.ps1` from the repository root. The script downloads checksum-pinned Node.js and WebView2 SDK archives from their official sources, compiles the C# bridge and desktop window, and creates a ZIP under `dist/`. Windows with .NET Framework 4.7.2 or later is required. The user's machine also needs the WebView2 Runtime; it does not need a Node installation.

The desktop window embeds the existing HTML interface using WebView2. All icon sizes are included in the EXE and ICO; small and large window icons are selected for the current monitor DPI. The SVG remains the source artwork. Small sizes omit the globe's thin grid lines.

## Source layout

| Path | Purpose |
| --- | --- |
| `app/app.js`, `style.css`, `index.html` | Interface and plots |
| `app/catalog.mjs` | Parse original display definitions and menu hierarchy |
| `app/server.mjs` | Local service, engine operations and verification |
| `app/projects.mjs` | Experiment manifests, checksums and checkpoints |
| `native/NativeBridge.cs` | Original engine window/control access |
| `native/Desktop.cs` | Windows launcher, WebView2 and DPI-aware icons |
| `build.ps1` | Reproducible dependency versions and release assembly |

## Local files

The desktop launcher stores configuration, private engine copies and browser state under `%LOCALAPPDATA%\HumMod UI Beautification`. New experiment folders default to the user's Documents folder; users can choose another location. Original HumMod files are copied before use and remain unchanged.

Each experiment has an `experiment.hummod` JSON manifest and a `checkpoints` directory of original SOL exports. Completed runs and parameter changes are written to the journal; manifests are replaced atomically. Checkpoint hashes detect changed files. The service listens only on loopback and requires a per-session token for API calls.

## Restoring an experiment

SOL loading alone is not treated as a resumable engine checkpoint. In the tested model, loading restored the displayed values, but subsequent computation differed from uninterrupted execution. Saving ICS also reset the native clock.

Recorded experiments instead start an independent engine, replay the validated parameter changes and run commands, and compare every exported value and history sample with the checkpoint. A mismatch disables continuation. Restoring a long experiment can therefore take time.

Existing live sessions, interrupted runs and operations performed in native windows do not have a complete journal. They can continue while their original process remains alive; after it exits, saved results open for viewing and export only.

## Adapting another engine

The supported HumMod.EXE SHA-256 is `4243e8721f77a5fabf3128fac5ac139588b20a8285d35d2021c6852d596803cb`. Model EXE/DES/ICS files are fingerprinted separately for experiment compatibility. A different build is rejected by default.

For another version, update the installation validator, native menu/control mappings, display parser and result parser as needed. Verify field names, allowed parameter values, menus and units against that engine. Compare uninterrupted runs with saved/replayed runs before enabling continuation. A matching version label alone is insufficient.

## Current coverage

The supported model exposes 730 loaded pages, 164 menu branches and 750 leaf entries. The 20 leaf entries without included definitions remain visible and are identified as unavailable. Function curves and dynamic maps on 204 pages still use the original renderer; native file/solver dialogs remain available. This is not a custom redraw of every native dialog.

Validation covered all 914 menu/page nodes and the native control counts of 730 pages. A salt-intake scenario was checked across all 10,346 values and all history samples after replay and further continuation, including restarting the service and engine. This is evidence for the tested scenarios, not exhaustive validation of every intervention.

For an isolated desktop startup check, set `HUMMOD_UI_PORT` and `HUMMOD_DESKTOP_DATA_DIR` to test-only values and launch `HumMod Studio.exe --smoke-test`. It writes a UI screenshot, icon status and a small startup report to the selected test directory. The application window closes after the check; the local service is left running.

Run `node scripts/check.mjs` to check result parsing, experiment files, checkpoint checksums and icon sizes without an installed engine. Full simulation checks require the supported local HumMod installation.
