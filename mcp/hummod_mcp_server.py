# HumMod MCP server
# Exposes the engine operations of native/NativeBridge.exe as MCP tools, so
# agent frameworks (ZCode, Claude, ...) can drive HumMod experiments
# conversationally: navigate panels, press controls, run simulations, export
# SOL results and read variables - all via window messages to a dedicated
# engine copy. No engine source is required or touched.
#
# Requires Python 3.10+ and the `mcp` package (pip install mcp).
# Configuration (all optional, see docs/MCP.md):
#   HUMMOD_ENGINE_DIR  folder holding the private engine copy (default ./engine)
#   HUMMOD_BRIDGE      path to NativeBridge.exe (default ../native/NativeBridge.exe)
#   HUMMOD_OUTDIR      where snapshot exports are written (default ./mcp-exports)
import json
import os
import re
import subprocess
import time
from datetime import datetime

from mcp.server.mcpserver import MCPServer

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE_DIR = os.environ.get("HUMMOD_ENGINE_DIR", os.path.join(os.getcwd(), "engine"))
BRIDGE = os.environ.get("HUMMOD_BRIDGE", os.path.join(_ROOT, "native", "NativeBridge.exe"))
OUTDIR = os.environ.get("HUMMOD_OUTDIR", os.path.join(os.getcwd(), "mcp-exports"))

GO_TIMEOUTS = {  # generous wall-clock caps by Go menu label
    "1 sec": 30, "5 sec": 30, "10 sec": 30,
    "1 min": 60, "5 min": 60, "10 min": 90, "30 min": 120,
    "1 hour": 180, "6 hours": 240, "12 hours": 300,
    "1 day": 360, "1 week": 420, "30 days": 600, "60 days": 700, "90 days": 900,
    "to next hour": 180, "to next day": 360, "to next week": 420, "to next 30 days": 600,
}

server = MCPServer("hummod")

import functools


def safe(fn):
    """Return {'ok': false, 'error': ...} instead of raising, so agents get one-line errors."""
    @functools.wraps(fn)
    def w(*a, **k):
        try:
            return fn(*a, **k)
        except Exception as e:
            return json.dumps({"ok": False, "error": str(e)})
    return w


def _bridge(args, timeout=60):
    env = dict(os.environ)
    env["HUMMOD_ENGINE_DIR"] = ENGINE_DIR
    p = subprocess.run([BRIDGE] + [str(a) for a in args], capture_output=True,
                       text=True, timeout=timeout, env=env)
    out = (p.stdout or "").strip()
    err = (p.stderr or "").strip()
    if p.returncode != 0:
        raise RuntimeError(err or ("bridge exit " + str(p.returncode)))
    return out


def _inspect():
    return json.loads(_bridge(["inspect"], timeout=60))


def _menu_find(nodes, label):
    for n in nodes:
        if (n.get("label") or "").strip().lower() == label.strip().lower():
            return n
    return None


def _resolve_path(nodes, path):
    """Resolve 'Trauma/Hemorrhage' or 'Go/10 Min' against the menu tree."""
    cur = nodes
    node = None
    for seg in [s.strip() for s in path.split("/") if s.strip()]:
        node = _menu_find(cur, seg)
        if node is None:
            raise RuntimeError("menu path not found: '" + seg + "' in " + path)
        cur = node.get("children", [])
    return node


def _stop_enabled():
    j = _inspect()
    stop = _menu_find(j["menu"], "Stop")
    return bool(stop and stop.get("enabled"))


def _wait_done(seconds):
    deadline = time.time() + seconds
    time.sleep(0.4)
    while time.time() < deadline:
        if not _stop_enabled():
            return
        time.sleep(0.3)
    raise RuntimeError("simulation did not finish within " + str(seconds) + "s")


def _navigate(panel_path):
    j = _inspect()
    node = _resolve_path(j["menu"], panel_path)
    mid = node.get("id")
    if not mid or int(mid) == 4294967295:
        kids = [c.get("label") for c in node.get("children", [])]
        raise RuntimeError("'" + panel_path + "' is a submenu; pick one of: " + ", ".join(map(str, kids)))
    _bridge(["navigate", int(mid)])
    return int(mid)


def _parse_sol(path, names=None):
    text = open(path, "r", errors="replace").read()
    out = {}
    for m in re.finditer(r"<var>\s*<name>\s*(.*?)\s*</name>(.*?)</var>", text, re.S):
        n = m.group(1)
        if names is not None and n.lower() not in names:
            continue
        vals = re.findall(r"<val>\s*([-\d.eE+]+)\s*</val>", m.group(2))
        if vals:
            out[n] = float(vals[-1])
    return out


# ---- modal dismissal via Win32 (ctypes), independent of the bridge binary ----
def _dismiss_modals():
    import ctypes
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    found = []
    EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    pid_target = None
    # tasklist writes in the ANSI code page (GBK on zh-CN systems); decoding as
    # UTF-8 raises there and leaves stdout as None, so decode explicitly.
    p = subprocess.run(["tasklist", "/FI", "IMAGENAME eq HumMod.EXE", "/FO", "CSV"],
                       capture_output=True, text=True, encoding="mbcs", errors="replace")
    for line in p.stdout.splitlines():
        parts = line.split('","')
        if len(parts) > 1 and parts[0].startswith('"HumMod'):
            pid_target = int(parts[1])
    if not pid_target:
        return "NO_PROCESS"
    buf = ctypes.create_unicode_buffer(256)

    def on_child(h, _):
        cid = user32.GetDlgCtrlID(h)
        if cid in (1, 2):
            user32.PostMessageW(h, 0xF5, 0, 0)  # BM_CLICK OK/Cancel
        return True

    def on_window(h, _):
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(h, ctypes.byref(pid))
        if pid.value == pid_target and user32.IsWindowVisible(h):
            user32.GetClassNameW(h, buf, 256)
            if buf.value == "#32770":
                user32.PostMessageW(h, 0x10, 0, 0)   # WM_CLOSE
                user32.PostMessageW(h, 0x111, 2, 0)  # WM_COMMAND IDCANCEL
                user32.EnumChildWindows(h, EnumWindowsProc(on_child), 0)
                found.append(hex(h))
        return True

    user32.EnumWindows(EnumWindowsProc(on_window), 0)
    return {"dismissed": found} if found else "NO_DIALOG"


@server.tool()
@safe
def hummod_status() -> str:
    """Check whether the HumMod engine is running. Returns {running, pid, engine_dir}."""
    try:
        out = _bridge(["status"], timeout=20)
        j = json.loads(out)
        j["engine_dir"] = ENGINE_DIR
        return json.dumps(j)
    except Exception as e:
        return json.dumps({"running": False, "error": str(e), "engine_dir": ENGINE_DIR})


@server.tool()
@safe
def hummod_start() -> str:
    """Start the HumMod engine (hidden window) if not running. Returns the new pid."""
    return _bridge(["start"], timeout=60) or "already running"


@server.tool()
@safe
def hummod_restart() -> str:
    """Reset the model to its initial state (menu Restart). Waits until settled."""
    _bridge(["command", 7])
    _wait_done(60)
    return json.dumps({"ok": True, "action": "restart"})


@server.tool()
@safe
def hummod_inspect(max_chars: int = 20000) -> str:
    """Dump the engine's full menu tree (with command IDs) and the current page's controls as JSON. Use it to find panel paths, control ordinals and menu command ids."""
    txt = json.dumps(_inspect())
    return txt[:max_chars]


@server.tool()
@safe
def hummod_navigate(panel_path: str) -> str:
    """Switch the engine to a panel page, e.g. 'Trauma/Hemorrhage' or 'Diagnosis/Chart'. Path segments are menu labels, case-insensitive."""
    mid = _navigate(panel_path)
    return json.dumps({"ok": True, "navigated": panel_path, "menu_id": mid})


@server.tool()
@safe
def hummod_menu_command(item_path: str) -> str:
    """Press a top-level menu item or submenu entry by path, e.g. 'Restart', 'Go/10 Min', 'To Next Hour'. Note: File/Save-Solution opens a native dialog - use hummod_snapshot instead."""
    j = _inspect()
    node = _resolve_path(j["menu"], item_path)
    mid = node.get("id")
    if not mid or int(mid) == 4294967295:
        raise RuntimeError("'" + item_path + "' has no command id (submenu separator or popup)")
    _bridge(["command", int(mid)])
    return json.dumps({"ok": True, "pressed": item_path, "menu_id": int(mid)})


@server.tool()
@safe
def hummod_go(duration_label: str) -> str:
    """Run the simulation for a duration (Go menu): '1 Sec','5 Sec','10 Sec','1 Min','5 Min','10 Min','30 Min','1 Hour','6 Hours','12 Hours','1 Day','1 Week','30 Days','60 Days','90 Days','To Next Hour','To Next Day','To Next Week','To Next 30 Days'. Waits for completion and returns wall time."""
    j = _inspect()
    node = _resolve_path(j["menu"], "Go/" + duration_label)
    mid = int(node["id"])
    t0 = time.time()
    _bridge(["command", mid])
    _wait_done(GO_TIMEOUTS.get(duration_label.strip().lower(), 600))
    return json.dumps({"ok": True, "ran": duration_label, "wall_seconds": round(time.time() - t0, 1)})


@server.tool()
@safe
def hummod_radio(panel_path: str, ordinal: int, expected: int) -> str:
    """Click a radio-style button on a panel page. First navigate/inspect the page to get ordinals (radios sorted by control ID). expected = total radio count on that page (guardrail)."""
    _navigate(panel_path)
    _bridge(["radio", ordinal, expected])
    return json.dumps({"ok": True, "panel": panel_path, "radio_ordinal": ordinal})


@server.tool()
@safe
def hummod_slider(panel_path: str, ordinal: int, pos: int, expected: int) -> str:
    """Move a slider (ScrollBar) on a panel page. NOTE: on engine 3.0.4 the slider thumb moves but the model value may not commit; prefer setting initial conditions via model XML parms instead."""
    _navigate(panel_path)
    _bridge(["slider", ordinal, pos, expected])
    return json.dumps({"ok": True, "panel": panel_path, "slider_ordinal": ordinal, "pos": pos})


@server.tool()
@safe
def hummod_edit(panel_path: str, ordinal: int, value: str, expected: int) -> str:
    """Set an Edit (text) control on a panel page and click its apply button. Ords per page from hummod_inspect; expected = total edit count (guardrail)."""
    _navigate(panel_path)
    _bridge(["edit", ordinal, expected, value])
    return json.dumps({"ok": True, "panel": panel_path, "edit_ordinal": ordinal, "value": value})


@server.tool()
@safe
def hummod_snapshot(name: str, vars: list[str] | None = None) -> str:
    """Export the engine state as a .SOL file (File/Save Solution automated) into the MCP output dir. Optionally parse selected variable names (e.g. ['BloodVol.Vol','SANode-Rate.Rate']). Returns file path, sim time System.X and requested values."""
    os.makedirs(OUTDIR, exist_ok=True)
    safe_name = re.sub(r"[^A-Za-z0-9_.-]", "_", name)
    path = os.path.join(OUTDIR, safe_name)
    if not path.lower().endswith(".sol"):
        path += ".SOL"
    if os.path.exists(path):
        path = os.path.join(OUTDIR, safe_name + "_" + datetime.now().strftime("%H%M%S") + ".SOL")
    _bridge(["snapshot", path], timeout=120)
    want = {v.lower() for v in (vars or ["System.X"])}
    vals = _parse_sol(path, want)
    return json.dumps({"ok": True, "path": path, "values": vals})


@server.tool()
@safe
def hummod_get_vars(sol_path: str, names: list[str]) -> str:
    """Read the CURRENT (last history sample) value of variables from a .SOL file exported by hummod_snapshot. Names use the model's dotted paths, e.g. 'BloodVol.Vol'. Returns {values, missing}."""
    want = {n.lower() for n in names}
    vals = _parse_sol(sol_path, want)
    missing = [n for n in names if n.lower() not in vals]
    return json.dumps({"values": vals, "missing": missing})


@server.tool()
@safe
def hummod_dismiss_modal() -> str:
    """Close any open native modal dialog (#32770) of the engine (e.g. the Tech window) that would block automation."""
    return json.dumps({"result": _dismiss_modals()})


if __name__ == "__main__":
    server.run(transport="stdio")
