# Smoke test for hummod_mcp_server.py over stdio.
# Prereqs: pip install mcp; a compiled NativeBridge.exe and an engine folder
# (see docs/MCP.md). Point the server at them via the HUMMOD_* environment
# variables before running, e.g. (PowerShell):
#   $env:HUMMOD_ENGINE_DIR="C:\path\to\engine"
#   $env:HUMMOD_BRIDGE="C:\path\to\NativeBridge.exe"
#   python mcp\test_client.py
import asyncio
import os
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

SERVER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hummod_mcp_server.py")


async def main():
    # use the same interpreter that runs this test, not a bare "python"
    # (resolves to the Microsoft Store stub on some Windows setups);
    # forward the full environment - stdio_client defaults to a minimal one
    # that would drop HUMMOD_* variables
    params = StdioServerParameters(command=sys.executable, args=[SERVER],
                                   env=dict(os.environ))
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as s:
            await s.initialize()
            tools = await s.list_tools()
            print("TOOLS:", [t.name for t in tools.tools])

            async def call(name, args=None):
                res = await s.call_tool(name, args or {})
                texts = [c.text for c in res.content if getattr(c, "text", None)]
                return " | ".join(texts) if texts else "(no text)"

            st = await call("hummod_status")
            print("[status]", st)
            if '"running": false' in st or '"running":false' in st:
                print("[start]", await call("hummod_start"))

            print("[navigate]", await call("hummod_navigate", {"panel_path": "Diagnosis/Chart"}))
            print("[snapshot]", await call("hummod_snapshot", {"name": "mcp_smoke", "vars": ["System.X", "BloodVol.Vol"]}))
            print("[bad panel]", await call("hummod_navigate", {"panel_path": "Trauma/NoSuchPanel"}))
            print("[submenu hint]", await call("hummod_navigate", {"panel_path": "Trauma"}))
            print("[dismiss]", await call("hummod_dismiss_modal"))
            print("SMOKE_OK")


asyncio.run(main())
