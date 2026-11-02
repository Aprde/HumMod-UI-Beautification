# MCP server (for coding agents)

`mcp/hummod_mcp_server.py` wraps the native bridge in an
[Model Context Protocol](https://modelcontextprotocol.io) server, so agent
frameworks (ZCode, Claude, any MCP client) can drive HumMod experiments
conversationally - no GUI clicking required.

```
agent <-> MCP (stdio) <-> hummod_mcp_server.py <-> NativeBridge.exe <-> engine (window messages)
```

The server only issues commands the bridge already supports; see
[CLI.md](CLI.md) for the layer below. Modal-dialog dismissal is implemented
in the server itself via Win32 calls.

## Prerequisites

1. Python 3.10+ with the MCP SDK: `pip install mcp`
2. The bridge compiled to `native/NativeBridge.exe` (one line, no toolchain
   beyond the in-box .NET Framework compiler):

   ```
   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /out:native\NativeBridge.exe ^
     /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll native\NativeBridge.cs
   ```

3. A folder with the HumMod engine (`HumMod.EXE`, model XML, ...). Point the
   server at it with `HUMMOD_ENGINE_DIR`.

## Configuration

| Variable | Meaning | Default |
| --- | --- | --- |
| `HUMMOD_ENGINE_DIR` | Private engine copy folder | `./engine` |
| `HUMMOD_BRIDGE` | Path to `NativeBridge.exe` | `native/NativeBridge.exe` |
| `HUMMOD_OUTDIR` | Where SOL exports are written | `./mcp-exports` |

## Registration

ZCode (`~/.zcode/cli/config.json`):

```json
{
  "mcp": {
    "servers": {
      "hummod": {
        "command": "python",
        "args": ["<path-to-repo>\\mcp\\hummod_mcp_server.py"],
        "env": { "HUMMOD_ENGINE_DIR": "C:\\HumMod", "HUMMOD_OUTDIR": "C:\\hummod-exports" }
      }
    }
  }
}
```

Any other MCP client uses the standard `mcpServers` shape with the same
`command` / `args` / `env` fields.

## Tools

| Tool | Purpose |
| --- | --- |
| `hummod_status` / `hummod_start` | Engine running? / start hidden |
| `hummod_restart` | Reset the model, wait until settled |
| `hummod_inspect` | Full menu tree (command ids) + current page controls |
| `hummod_navigate` | Go to a panel by path: `"Trauma/Hemorrhage"` |
| `hummod_menu_command` | Press a menu entry by path: `"Go/10 Min"` |
| `hummod_go` | Run a duration and wait for completion (Stop grayed) |
| `hummod_radio` / `hummod_edit` / `hummod_slider` | Page controls (ordinals from `inspect`) |
| `hummod_snapshot` | Export SOL, optionally parse named variables |
| `hummod_get_vars` | Read variables from a SOL file |
| `hummod_dismiss_modal` | Close engine modal dialogs blocking automation |

Errors come back as one-line JSON (`{"ok": false, "error": ...}`); unknown
panel paths list the available siblings so an agent can self-correct.

## Example: hemorrhage experiment

```
hummod_restart()
hummod_navigate("Trauma/Hemorrhage")
hummod_radio("Trauma/Hemorrhage", ordinal=1, expected=8)   # Switch On
hummod_go("10 Min")
hummod_radio("Trauma/Hemorrhage", ordinal=0, expected=8)   # Switch Off
hummod_go("To Next Hour"); hummod_go("To Next Day"); hummod_go("To Next 30 Days")
hummod_snapshot("end", vars=["BloodVol.Vol", "PlasmaVol.Vol", "BloodVol.Hct(%)"])
```

## Agent know-how

- **Verify by state, not pixels**: values live in SOL exports (`hummod_snapshot`
  / `hummod_get_vars`), not on screen. ~10,346 variables; e.g. `BloodVol.Vol`,
  `SANode-Rate.Rate` (heart rate), `ReninPool.[PRA]`, `BladderSodium.Change`
  (urinary Na excretion), `MineralocorticoidReceptor.[Aldo(nG/dL)-Plasma]`.
- **Run-to-run noise**: the engine embeds random terms; repeated runs agree
  exactly at restart but diverge within a small band afterwards (observed
  <= 2.75 % on noise-sensitive rates during a 1000 mL hemorrhage protocol).
  Compare runs against that band, not for bit-equality.
- **Slider caveat (3.0.4)**: the thumb moves but the model value may not
  commit; set initial conditions by editing model XML `<parm>` defaults in
  the engine copy (GPL-2.0) and restarting.
- **EPO is not computed on 3.0.4** (known engine limitation) - erythropoiesis
  indicators stay at their initial values.

## Smoke test

With an engine folder and bridge in place:

```
python mcp\test_client.py
```

expects `TOOLS: [...]` followed by `SMOKE_OK`.
