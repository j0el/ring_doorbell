"""
control.py — HTTP control client for thingino-firmware cameras.

Ported from the desktop app's camera_control.py. The desktop version ran every
request on a background thread and used a threading.Timer to auto-stop
"hold-to-move" cameras. Under FastAPI/uvicorn that machinery is unnecessary:
the event loop handles concurrency, and the thingino offset-style motor
(json-motor.cgi with signed x/y steps) stops on its own after each step. So
this version is a straight synchronous client; FastAPI runs it in a threadpool.

The ControlConfig dataclass and the direction->offset / IR-body mapping are
unchanged from the desktop app, so behaviour against the camera is identical.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import requests
from requests.auth import HTTPBasicAuth

logger = logging.getLogger("camera-api.control")

DIRECTIONS = ("left", "right", "up", "down", "stop")


@dataclass
class ControlConfig:
    """One camera's control block (from config.json -> cameras[name].control)."""
    base_url: str = ""
    username: str = "root"
    password: str = ""
    method: str = "GET"
    move_path: str = ""
    stop_path: str = ""
    ir_on_path: str = ""
    ir_off_path: str = ""
    ir_on_body: Optional[dict] = None
    ir_off_body: Optional[dict] = None
    ir_method: str = ""
    step: int = 20
    invert_x: bool = False
    invert_y: bool = False
    pulse_seconds: float = 0.0   # retained for config compat; unused server-side
    timeout: float = 4.0
    verify_tls: bool = False

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.move_path)

    @property
    def offset_style(self) -> bool:
        return "{x}" in self.move_path or "{y}" in self.move_path


class ControlError(Exception):
    """Raised when a camera control request fails; mapped to HTTP 502 upstream."""


class CameraControl:
    """Synchronous HTTP control client for a single camera."""

    def __init__(self, cfg: ControlConfig):
        self.cfg = cfg
        self._session = requests.Session()
        if cfg.username:
            self._session.auth = HTTPBasicAuth(cfg.username, cfg.password)

    # ------------------------------------------------------------------
    def move(self, direction: str) -> str:
        if direction not in DIRECTIONS:
            raise ControlError(f"unknown direction: {direction}")
        if not self.cfg.configured:
            raise ControlError("camera control not configured")

        if self.cfg.offset_style:
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

        return self._fire(path, f"move {direction}")

    def set_ir(self, on: bool) -> str:
        path = self.cfg.ir_on_path if on else self.cfg.ir_off_path
        body = self.cfg.ir_on_body if on else self.cfg.ir_off_body
        if not path:
            raise ControlError("IR/night-mode endpoint not configured")
        method = self.cfg.ir_method or ("POST" if body else self.cfg.method)
        return self._fire(path, f"IR {'on' if on else 'off'}",
                          method=method, json_body=body)

    # ------------------------------------------------------------------
    def _fire(self, path: str, label: str, method: Optional[str] = None,
              json_body: Optional[dict] = None) -> str:
        url = self.cfg.base_url.rstrip("/") + "/" + path.lstrip("/")
        verb = (method or self.cfg.method).upper()
        try:
            resp = self._session.request(
                verb, url, json=json_body,
                timeout=self.cfg.timeout, verify=self.cfg.verify_tls,
            )
        except requests.RequestException as exc:
            logger.warning("%s request failed: %s", label, exc)
            raise ControlError(f"{label}: no response from camera") from exc

        if not resp.ok:
            logger.warning("%s -> HTTP %d", label, resp.status_code)
            raise ControlError(f"{label}: camera returned HTTP {resp.status_code}")
        logger.debug("%s -> %s %s (%d)", label, verb, url, resp.status_code)
        return f"{label} ok"
