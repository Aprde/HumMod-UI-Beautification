# HumMod UI Beautification

A cleaner interface for HumMod, with easier parameter browsing, simulation controls, and experiment management. All calculations are performed by the original HumMod engine.

Currently supports **Windows 10/11 (64-bit)** and **HumMod Clemmer Salt 3.0.4**.

## Install

1. Have a complete HumMod installation ready.
2. Download the `windows-x64.zip` package from [Releases](https://github.com/Aprde/HumMod-UI-Beautification/releases/latest) and extract it fully.
3. Open **HumMod Studio.exe**, select the original folder containing `HumMod.EXE`, and click **Detect & configure**.

No Node.js or development tools are required. If prompted, install [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/).

## Use

- **New experiment**: name your experiment and choose where to save it.
- **Run model**: select a duration and run the simulation. Each run is saved automatically.
- **Experiments**: browse records, export SOL results, or open another experiment.
- **Save experiment / Ctrl+S**: save manually. The last experiment opens automatically at startup.
- **Reconnect engine**: if the engine stops, restore the last saved state and verify it before continuing.
- **Settings → Save & quit**: save and exit. Closing only the window keeps the experiment running in the background.

Experiments stay in the folder you choose. Copy the entire folder to back one up. Reopening a long experiment may take time. Some specialized plots and settings open in the original HumMod window.

**For older sessions, interrupted runs, or experiments changed through the original window, keep the engine running to continue the simulation. After it closes, saved results remain available for viewing and export.**

![Interface preview](docs/preview.png)

## Scripting and agents

The native bridge is a standalone console program (`native/NativeBridge.cs`) that drives the engine with window messages - scripts, schedulers and coding agents can use the same commands as the interface (navigate panels, press controls, run, export SOL). See [docs/CLI.md](docs/CLI.md).

## Compatibility and adaptation

Version 3.0.4 was chosen as a stable baseline with flexible parameter controls. This release supports only **HumMod Clemmer Salt 3.0.4**; other HumMod versions, including QCP, have not been adapted or validated.

To use another version, download the source and ask an AI coding assistant to help adapt the interface. Closely related versions may need only modest changes, but the required work depends on their interfaces and file formats. Verify the simulation results before using an adapted build.

macOS is a larger task: both the current desktop integration and the supported HumMod engine depend on Windows. Porting the interface alone would not make the engine run on a Mac.

## Source

The interface and bridge code are available under the [MIT license](LICENSE). This unofficial project does not include the HumMod engine or model files; their original licenses still apply.

For build instructions, experiment recovery, and adaptation details, see [Development](docs/DEVELOPMENT.md).
