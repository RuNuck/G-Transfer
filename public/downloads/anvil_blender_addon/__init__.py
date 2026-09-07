"""
Anvil: Game Asset MCP — Blender 4.2+ add-on.

A small TCP server on 127.0.0.1 (port 9876 by default) that runs Python sent by the
Anvil local MCP server (anvil-mcp-server.mjs) on Blender's main thread, so Claude Code
can build assets in the open file.

Protocol: one connection per request, newline-delimited JSON both ways. A request is
{"type": "execute", "id": ..., "code": ..., "token": ...} or {"type": "ping"}. While a
script runs the server sends blank lines every few seconds as keepalives, then one JSON
line: {"status": "ok"|"error", "result": ..., "output": <captured print output>}.

Security: nothing listens until you press Connect (or enable "Start on launch" in the
add-on preferences). Requests must carry the token from ~/.anvil/token, which Connect
creates; the local MCP server reads that file automatically.

Install: Edit → Preferences → Add-ons → Install from Disk → anvil_blender_addon.zip →
enable "Anvil: Game Asset MCP". Then View3D → N-panel → Anvil → Connect. Remove any older
single-file anvil_blender_addon.py from the add-ons folder first, or it shadows this package.

The package also carries the two stages the generated scripts use when it is installed:
`kit` builds each prototype from parametric parts (see kit/AUTHORING.md) and `surfacing`
covers the result with procedural material recipes baked to textures.
"""

bl_info = {
    "name": "Anvil: Game Asset MCP",
    "author": "Anvil",
    "version": (2, 9, 0),
    "blender": (4, 2, 0),
    "location": "View3D > N-panel > Anvil",
    "description": "Token-protected TCP bridge so Claude Code can forge game assets in Blender.",
    "category": "Interface",
}

import io
import json
import os
import secrets
import socket
import threading
import time
import traceback
import uuid
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import bpy

HOST = "127.0.0.1"
DEFAULT_PORT = 9876
TOKEN_PATH = Path.home() / ".anvil" / "token"
MAX_REQUEST_BYTES = 8 * 1024 * 1024
READ_TIMEOUT = 10.0  # seconds to receive the request line
KEEPALIVE_SECONDS = 5.0  # blank line to the client while a job runs
DEFAULT_JOB_TIMEOUT = 600.0  # seconds a script may run before the client is told to stop waiting
MAX_HANDLERS = 8


class Job:
    __slots__ = ("id", "code", "done", "result", "cancelled")

    def __init__(self, code):
        self.id = str(uuid.uuid4())
        self.code = code
        self.done = threading.Event()
        self.result = None
        self.cancelled = False


class AnvilState:
    def __init__(self):
        self.running = False
        self.sock = None
        self.thread = None
        self.status = "Idle"
        self.lock = threading.Lock()
        self.queue = []
        self.token = None
        self.dirty = False
        self.handlers = threading.BoundedSemaphore(MAX_HANDLERS)
        self.job_timeout = DEFAULT_JOB_TIMEOUT
        self.port = DEFAULT_PORT


STATE = AnvilState()


# --- preferences (defaults apply when the module is used outside the add-on system) ---------


def _prefs():
    try:
        return bpy.context.preferences.addons[__name__].preferences
    except Exception:
        return None


def _port():
    prefs = _prefs()
    return int(prefs.port) if prefs is not None else DEFAULT_PORT


def _require_token():
    prefs = _prefs()
    return bool(prefs.require_token) if prefs is not None else True


def _job_timeout():
    raw = os.environ.get("ANVIL_JOB_TIMEOUT")
    if raw:
        try:
            return max(1.0, float(raw))
        except ValueError:
            pass
    prefs = _prefs()
    return float(prefs.job_timeout) if prefs is not None else DEFAULT_JOB_TIMEOUT


def load_or_create_token():
    """The shared secret both sides read from ~/.anvil/token (created on first Connect)."""
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    if TOKEN_PATH.exists():
        token = TOKEN_PATH.read_text(encoding="utf-8").strip()
        if token:
            return token
    token = secrets.token_urlsafe(24)
    TOKEN_PATH.write_text(token, encoding="utf-8")
    try:
        os.chmod(TOKEN_PATH, 0o600)
    except OSError:
        pass
    return token


# --- networking (worker threads never touch bpy) ------------------------------------------------


def _recv_request(conn):
    """One newline-terminated JSON object, decoded once the whole line has arrived."""
    conn.settimeout(READ_TIMEOUT)
    buf = bytearray()
    while b"\n" not in buf:
        chunk = conn.recv(65536)
        if not chunk:
            break
        buf += chunk
        if len(buf) > MAX_REQUEST_BYTES:
            raise ValueError("request larger than %d bytes" % MAX_REQUEST_BYTES)
    line = bytes(buf).split(b"\n", 1)[0].strip()
    if not line:
        return None
    return json.loads(line.decode("utf-8"))


def _send(conn, payload):
    conn.sendall((json.dumps(payload) + "\n").encode("utf-8"))


def _handle(conn):
    with STATE.handlers:
        job = None
        try:
            payload = _recv_request(conn)
            if not isinstance(payload, dict):
                _send(conn, {"status": "error", "result": "expected one JSON object per line"})
                return
            kind = payload.get("type", "execute")
            authorized = (not _require_token()) or (STATE.token is not None and payload.get("token") == STATE.token)
            if kind == "ping":
                _send(conn, {
                    "status": "ok",
                    "result": "pong",
                    "auth": "ok" if authorized else "required",
                    "version": ".".join(str(v) for v in bl_info["version"]),
                    "token_path": str(TOKEN_PATH),
                })
                return
            if not authorized:
                _send(conn, {
                    "status": "error",
                    "result": "unauthorized: send the token from %s (created when you press Connect in Blender), "
                    "for example via the ANVIL_BLENDER_TOKEN environment variable" % TOKEN_PATH,
                })
                return
            if kind != "execute":
                _send(conn, {"status": "error", "result": "unknown request type %r" % kind})
                return
            code = payload.get("code")
            if not isinstance(code, str) or not code.strip():
                _send(conn, {"status": "error", "result": "code must be a non-empty string of Python"})
                return
            job = Job(code)
            with STATE.lock:
                STATE.queue.append(job)
            started = time.monotonic()
            deadline = started + STATE.job_timeout
            last_keepalive = started
            while not job.done.wait(0.5):
                now = time.monotonic()
                if now > deadline:
                    with STATE.lock:
                        job.cancelled = True
                        if job in STATE.queue:
                            STATE.queue.remove(job)
                    _send(conn, {
                        "status": "error",
                        "result": "timeout: the script did not finish within %d s; it may still be running in Blender"
                        % int(STATE.job_timeout),
                    })
                    return
                if now - last_keepalive >= KEEPALIVE_SECONDS:
                    last_keepalive = now
                    try:
                        conn.sendall(b"\n")  # keepalive: the client resets its idle timer on any bytes
                    except OSError:
                        with STATE.lock:
                            job.cancelled = True
                        return
            _send(conn, job.result)
        except (socket.timeout, TimeoutError):
            _try_send(conn, {"status": "error", "result": "no complete request line within %d s" % int(READ_TIMEOUT)})
        except Exception as exc:
            _try_send(conn, {"status": "error", "result": "%s: %s" % (type(exc).__name__, exc)})
        finally:
            try:
                conn.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            conn.close()


def _try_send(conn, payload):
    try:
        _send(conn, payload)
    except OSError:
        pass


def _accept():
    sock = STATE.sock
    while STATE.running and sock is not None:
        try:
            conn, _ = sock.accept()
            threading.Thread(target=_handle, args=(conn,), daemon=True).start()
        except socket.timeout:
            continue
        except OSError as exc:
            if STATE.running:
                STATE.status = "Error: %s" % exc
                STATE.running = False
                STATE.dirty = True
            break


# --- main-thread execution (a persistent timer drains the queue every 50 ms) ------------------


def _redraw():
    try:
        for window in bpy.context.window_manager.windows:
            for area in window.screen.areas:
                if area.type == "VIEW_3D":
                    area.tag_redraw()
    except Exception:
        pass


def _drain():
    with STATE.lock:
        jobs = list(STATE.queue)
        STATE.queue.clear()
    for job in jobs:
        if job.cancelled:
            continue
        output = io.StringIO()
        namespace = {"__name__": "__main__", "__file__": "<anvil>", "bpy": bpy, "result": None}
        try:
            with redirect_stdout(output), redirect_stderr(output):
                exec(compile(job.code, "<anvil>", "exec"), namespace, namespace)
            value = namespace.get("result")
            job.result = {"status": "ok", "result": "" if value is None else str(value), "output": output.getvalue()}
        except BaseException:  # SystemExit / KeyboardInterrupt from a script must never take Blender down
            job.result = {"status": "error", "result": traceback.format_exc(), "output": output.getvalue()}
        job.done.set()
    if STATE.dirty:
        STATE.dirty = False
        _redraw()
    return 0.05 if STATE.running else None


# --- lifecycle -------------------------------------------------------------------------------------


def start_server():
    """Bind, start accepting, and start the main-thread drain timer. Returns True when listening."""
    if STATE.running:
        return True
    port = _port()
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)  # Windows: no silent double bind
    else:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind((HOST, port))
        sock.listen(8)
    except OSError as exc:
        sock.close()
        STATE.status = "Port %d unavailable: %s" % (port, exc)
        STATE.dirty = True
        return False
    sock.settimeout(0.5)
    STATE.token = load_or_create_token()
    STATE.job_timeout = _job_timeout()
    STATE.port = port
    STATE.sock = sock
    STATE.running = True
    STATE.status = "Listening on %s:%d" % (HOST, port)
    STATE.thread = threading.Thread(target=_accept, daemon=True)
    STATE.thread.start()
    if not bpy.app.timers.is_registered(_drain):
        bpy.app.timers.register(_drain, persistent=True)
    return True


def stop_server():
    STATE.running = False
    sock = STATE.sock
    STATE.sock = None
    if sock is not None:
        try:
            sock.close()
        except OSError:
            pass
    if STATE.thread is not None:
        STATE.thread.join(timeout=1.0)
        STATE.thread = None
    with STATE.lock:
        for job in STATE.queue:
            job.result = {"status": "error", "result": "server stopped before the script ran", "output": ""}
            job.done.set()
        STATE.queue.clear()
    STATE.status = "Idle"


# --- UI ------------------------------------------------------------------------------------------------


class AnvilPreferences(bpy.types.AddonPreferences):
    bl_idname = __name__

    port: bpy.props.IntProperty(name="Port", default=DEFAULT_PORT, min=1024, max=65535)
    auto_start: bpy.props.BoolProperty(
        name="Start on launch",
        default=False,
        description="Listen as soon as Blender starts. Any local program holding the token can then run Python in Blender.",
    )
    require_token: bpy.props.BoolProperty(
        name="Require token",
        default=True,
        description="Reject requests that do not carry the token from ~/.anvil/token (recommended).",
    )
    job_timeout: bpy.props.FloatProperty(
        name="Script timeout (s)",
        default=DEFAULT_JOB_TIMEOUT,
        min=1.0,
        max=86400.0,
        description="How long a client waits for one script before it is told to stop waiting.",
    )

    def draw(self, context):
        layout = self.layout
        layout.prop(self, "port")
        layout.prop(self, "require_token")
        layout.prop(self, "job_timeout")
        layout.prop(self, "auto_start")
        layout.label(text="Token file: %s" % TOKEN_PATH)


class ANVIL_OT_connect(bpy.types.Operator):
    bl_idname = "anvil.connect"
    bl_label = "Connect"
    bl_description = "Start listening for the Anvil local MCP server (creates ~/.anvil/token if missing)"

    def execute(self, context):
        if start_server():
            self.report({"INFO"}, STATE.status)
        else:
            self.report({"ERROR"}, STATE.status)
        return {"FINISHED"}


class ANVIL_OT_disconnect(bpy.types.Operator):
    bl_idname = "anvil.disconnect"
    bl_label = "Disconnect"

    def execute(self, context):
        stop_server()
        return {"FINISHED"}


class ANVIL_OT_copy_token(bpy.types.Operator):
    bl_idname = "anvil.copy_token"
    bl_label = "Copy token"
    bl_description = "Copy the token to the clipboard (for ANVIL_BLENDER_TOKEN)"

    def execute(self, context):
        context.window_manager.clipboard = load_or_create_token()
        self.report({"INFO"}, "Token copied")
        return {"FINISHED"}


class ANVIL_PT_panel(bpy.types.Panel):
    bl_label = "Anvil"
    bl_idname = "ANVIL_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Anvil"

    def draw(self, context):
        layout = self.layout
        layout.label(text=STATE.status, icon="CHECKMARK" if STATE.running else "RADIOBUT_OFF")
        row = layout.row(align=True)
        row.operator("anvil.connect", icon="PLAY")
        row.operator("anvil.disconnect", icon="PAUSE")
        layout.operator("anvil.copy_token", icon="COPYDOWN")
        layout.label(text="Token: ~/.anvil/token")
        layout.label(text="Claude Code → anvil-blender → this port")


CLASSES = (AnvilPreferences, ANVIL_OT_connect, ANVIL_OT_disconnect, ANVIL_OT_copy_token, ANVIL_PT_panel)


def _auto_start():
    start_server()
    return None


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    prefs = _prefs()
    if prefs is not None and prefs.auto_start:
        bpy.app.timers.register(_auto_start, first_interval=0.8)


def unregister():
    stop_server()
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    register()
