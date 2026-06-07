"""
camera_control.py
HTTP control client for a thingino-firmware camera (pan / tilt / toggles).

thingino exposes camera control through its web UI's CGI scripts, which call
the on-device `motors` binary for pan/tilt and various scripts for toggles
(IR-cut / night mode, IR LEDs, etc.). The exact CGI paths differ between
firmware builds, so every endpoint here is a template string loaded from
config.json -> "control" rather than hard-coded. See config.example.json.

How to find your camera's exact requests (30 seconds):
  1. Open the thingino web UI in a browser.
  2. Press F12 -> Network tab.
  3. Click a PTZ arrow (and the IR/night-mode toggle).
  4. Click the request that appears; copy its URL + method.
  5. Paste the path/params into config.json (replacing {dir} etc. as needed).

Auth: thingino uses HTTP Basic auth with the camera's system credentials
(default user "root"). Credentials come from config.json, never hard-coded.

A directional move is modeled as a "pulse": send the move command, wait
`pulse_seconds`, then send the stop command. Cameras that move only while a
button is held need this; cameras that step a fixed amount per request can set
pulse_seconds to 0 and leave the stop endpoint blank.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Optional

import requests
from requests.auth import HTTPBasicAuth

logger = logging.getLogger(__name__)


# Recognized movement directions (kept as plain strings for config templating)
DIRECTIONS = ("left", "right", "up", "down", "stop")


@dataclass
class ControlConfig:
    """
    Loaded from config.json -> "control". All endpoint values are templates
    appended to base_url.

    Two move styles are supported:

    1. Direction style — move_path contains "{dir}", substituted with
       left/right/up/down. Best for cameras with named-direction CGIs.

    2. Offset style (thingino json-motor.cgi) — move_path contains "{x}" and
       "{y}", substituted with signed step offsets. Each press is a discrete
       step that stops on its own, so no stop command is needed.
       Example:
         move_path: "/x/json-motor.cgi?d=g&x={x}&y={y}"
         step:      20         # pixels/units per press
       Directions become:
         left  -> x=-step, y=0      right -> x=+step, y=0
         up    -> x=0, y=+step      down  -> x=0, y=-step

    IR / night-mode toggles are single fire-and-forget GET requests.
    """
    base_url: str = ""
    username: str = "root"
    password: str = ""
    method: str = "GET"
    move_path: str = ""
    stop_path: str = ""
    ir_on_path: str = ""
    ir_off_path: str = ""
    # Optional JSON bodies for IR toggles. If set, the IR request is sent as a
    # POST with this JSON body (thingino json-imp.cgi style) instead of a bare
    # GET. Leave empty for GET-style toggle endpoints.
    ir_on_body: Optional[dict] = None
    ir_off_body: Optional[dict] = None
    ir_method: str = ""            # override method for IR calls; "" = auto
    step: int = 20                 # offset-style: units moved per press
    invert_x: bool = False         # flip if left/right are reversed on your camera
    invert_y: bool = False         # flip if up/down are reversed on your camera
    pulse_seconds: float = 0.0     # >0 only for continuous (hold-to-move) cameras
    timeout: float = 4.0
    verify_tls: bool = False

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.move_path)

    @property
    def offset_style(self) -> bool:
        """True if move_path uses {x}/{y} offsets rather than {dir}."""
        return "{x}" in self.move_path or "{y}" in self.move_path


class CameraControl:
    """
    Thin HTTP client that fires control requests at the camera. Network calls
    run on a background thread so the GUI never blocks; results are reported
    via an optional status_callback(str).
    """

    def __init__(self, cfg: ControlConfig, status_callback=None):
        self.cfg = cfg
        self._status_cb = status_callback
        self._session = requests.Session()
        if cfg.username:
            self._session.auth = HTTPBasicAuth(cfg.username, cfg.password)
        self._lock = threading.Lock()
        self._stop_timer: Optional[threading.Timer] = None

    # ------------------------------------------------------------------
    # Public API (called from the GUI)
    # ------------------------------------------------------------------
    def move(self, direction: str):
        """Pulse a directional move: fire move, then auto-stop after pulse_seconds."""
        if direction not in DIRECTIONS:
            logger.warning("Unknown direction: %s", direction)
            return
        if not self.cfg.configured:
            self._status("Camera control not configured — see config.json")
            return
        threading.Thread(target=self._do_move, args=(direction,), daemon=True).start()

    def stop(self):
        """Send the stop command immediately (e.g. on button release)."""
        if not self.cfg.stop_path:
            return
        threading.Thread(target=self._do_stop, daemon=True).start()

    def set_ir(self, on: bool):
        """Toggle IR / night mode on or off."""
        path = self.cfg.ir_on_path if on else self.cfg.ir_off_path
        body = self.cfg.ir_on_body if on else self.cfg.ir_off_body
        if not path:
            self._status("IR/night-mode endpoint not configured")
            return
        # If a JSON body is configured, POST it; otherwise use the IR method
        # override, falling back to the global method.
        method = self.cfg.ir_method or ("POST" if body else self.cfg.method)
        label = f"IR {'on' if on else 'off'}"
        threading.Thread(target=self._fire, args=(path, label),
                         kwargs={"method": method, "json_body": body},
                         daemon=True).start()

    def fire_custom(self, path: str, label: str = "command"):
        """Fire an arbitrary configured endpoint (for extra toggles)."""
        if not path:
            return
        threading.Thread(target=self._fire, args=(path, label), daemon=True).start()

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------
    def _do_move(self, direction: str):
        with self._lock:
            # Cancel any pending auto-stop from a previous move
            if self._stop_timer is not None:
                self._stop_timer.cancel()
                self._stop_timer = None

            if self.cfg.offset_style:
                # Map direction -> signed (x, y) step offsets.
                step = self.cfg.step
                sx = -1 if self.cfg.invert_x else 1
                sy = -1 if self.cfg.invert_y else 1
                dx, dy = {
                    "left":  (-step * sx, 0),
                    "right": (+step * sx, 0),
                    "up":    (0, +step * sy),
                    "down":  (0, -step * sy),
                    "stop":  (0, 0),
                }.get(direction, (0, 0))
                path = (self.cfg.move_path
                        .replace("{x}", str(dx))
                        .replace("{y}", str(dy)))
            else:
                path = self.cfg.move_path.replace("{dir}", direction)

            self._fire(path, f"move {direction}")

            # Schedule auto-stop only for continuous (hold-to-move) cameras.
            # Offset-style cameras step-and-stop on their own.
            if self.cfg.pulse_seconds > 0 and self.cfg.stop_path:
                self._stop_timer = threading.Timer(self.cfg.pulse_seconds, self._do_stop)
                self._stop_timer.daemon = True
                self._stop_timer.start()

    def _do_stop(self):
        self._fire(self.cfg.stop_path, "stop")

    def _fire(self, path: str, label: str, method: Optional[str] = None,
              json_body: Optional[dict] = None):
        url = self.cfg.base_url.rstrip("/") + "/" + path.lstrip("/")
        verb = (method or self.cfg.method).upper()
        try:
            resp = self._session.request(
                verb, url,
                json=json_body,            # requests sets Content-Type: application/json
                timeout=self.cfg.timeout, verify=self.cfg.verify_tls,
            )
            if resp.ok:
                logger.debug("%s -> %s %s (%d)", label, verb, url, resp.status_code)
                self._status(f"{label} ✓")
            else:
                logger.warning("%s -> %s %s returned HTTP %d",
                               label, verb, url, resp.status_code)
                self._status(f"{label} failed (HTTP {resp.status_code})")
        except requests.RequestException as exc:
            logger.warning("%s request failed: %s", label, exc)
            self._status(f"{label} failed (no response)")

    def _status(self, msg: str):
        if self._status_cb:
            try:
                self._status_cb(msg)
            except Exception:
                pass
