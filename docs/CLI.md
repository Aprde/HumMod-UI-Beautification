# Native bridge CLI

`native/NativeBridge.cs` compiles to a standalone console program that drives a
dedicated engine copy with window messages only - no engine source, no memory
access, no reverse engineering. `app/server.mjs` calls the same binary; it is
also usable directly from scripts, schedulers and coding agents.

## Build

Requires the .NET Framework 4.x compiler present on every Windows 10/11 install:

```
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /out:NativeBridge.exe ^
  /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll native\NativeBridge.cs
```

(`System.Web.Extensions` for the JSON serializer, `System.Windows.Forms` for
`FolderBrowserDialog`.)

## Commands

Run `NativeBridge.exe describe` for the machine-readable list (no engine
required). Set `HUMMOD_ENGINE_DIR` to the folder holding the private engine
copy; without it the bridge expects to live next to an `engine\` folder.

| Command | Effect |
| --- | --- |
| `status` | `{running, pid}` of the dedicated engine |
| `start` | Start the engine copy hidden |
| `describe` | JSON: command list, completion criterion, caveats |
| `inspect` | Full menu tree (labels + command ids) and current page controls as JSON |
| `audit <jobs.json>` | Visit pages and count native controls per page |
| `navigate <pageId>` | Switch the visible model page (menu command id) |
| `command <menuId>` | Post a top-level menu command (e.g. `7` = Restart) |
| `run <goMenuId>` | Post a Go-menu duration and wait until Stop is grayed |
| `text <hwnd> <value>` | Set an Edit control |
| `click <hwnd>` / `show` / `hide` / `close` | Button press, window visibility |
| `edit <ordinal> <expected> <value>` | Set the ordinal-th Edit and click its apply button |
| `radio/action/check <ordinal> <expected>` | Click a radio / `!` / checkbox button |
| `slider <ordinal> <pos> <expected>` | Move a ScrollBar |
| `snapshot <file>` | Export the solution (File > Save Solution, dialog automated) |
| `save-state <file>` / `load-solution <file>` | ICS save / SOL load, dialog automated |
| `dismiss-modal` | Close visible native dialogs blocking the engine |

Ordnals are per page and sorted by control id; take them from `inspect`.

## Completion criterion

A simulation finishes when the engine grays its **Stop** menu item. `run` polls
that state. The Stop item is located by its command id (6, identical on the
1.6.1 standalone and the 3.0.4 salt engine) rather than by a fixed menu
position, so the check survives menu-layout differences between engines.

## Engine 3.0.4 notes (validated)

- Menus, page ids and standard controls (Edit/Button/ScrollBar/status bar) are
  addressable as documented above. 3.0.4 menu command ids: File 1-5, Go 12-30
  (durations 12-26, "To Next Hour" 27, "To Next Day" 28, "To Next Week" 29,
  "To Next 30 Days" 30), Stop 6, Restart 7. Example panel: Trauma/Hemorrhage =
  page id 741, 8 radio buttons (Switch Off/On, Type, intrathorax switches),
  3 sliders, no Edit controls.
- **Sliders**: thumb moves but the model value may not commit on this engine
  (thumb-position and end-scroll messages are accepted and ignored). For
  initial conditions prefer editing the model XML `<parm>` defaults in the
  private copy (the XML is GPL-2.0) and restarting.
- **Modals**: the Tech window is application-modal on this build; `dismiss-modal`
  clears it (WM_CLOSE, WM_COMMAND IDCANCEL, then BM_CLICK on IDOK/IDCANCEL).
- **Verify actions by state, not pixels**: export with `snapshot` and parse
  `<var><name>/<val>` entries; the engine contains 10,346 variables, e.g.
  `Hemorrhage.Switch` or `BloodVol.Vol`. Note the engine embeds random noise
  terms, so repeated runs agree exactly at restart but diverge within their own
  noise band afterwards - compare runs accordingly.
