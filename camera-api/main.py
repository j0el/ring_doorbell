"""
main.py — camera-api

FastAPI service that sits behind nginx/Authelia (later) and does two jobs:
  1. Proxies pan/IR control to thingino cameras (so the browser never talks to
     the camera directly — solves both CORS and the IP-allowlist problem, since
     THIS process's IP is what you add to webui.auth_bypass_ips).
  2. Serves the static dual-view UI and tells it where each camera's HLS stream
     lives on MediaMTX.

Video itself does NOT flow through here — MediaMTX serves HLS/WebRTC. This
service only handles control + serving the page.

HLS URL composition:
  Each camera's "hls" in config.json is a PATH (e.g. "/balcony/index.m3u8").
  The MEDIAMTX_BASE env var is prefixed to it:
    - Local dev:  MEDIAMTX_BASE=http://localhost:8888  -> full localhost URL
    - Behind nginx: MEDIAMTX_BASE=  (empty) and nginx proxies /hls/* and the
      page rewrites paths to /hls/<cam>/index.m3u8 (see note in config).
  Default base is http://localhost:8888 so it Just Works locally.

Endpoints:
  GET  /api/health                 -> liveness + which cameras are configured
  GET  /api/cameras                -> [{id, name, hls, controllable}]
  POST /api/{cam}/move  {dir}      -> pan; dir in left/right/up/down/stop
  POST /api/{cam}/ir    {on: bool} -> IR / night mode on|off
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Dict

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from control import CameraControl, ControlConfig, ControlError, DIRECTIONS

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger("camera-api")

CONFIG_FILE = Path(os.environ.get("CAMERA_API_CONFIG",
                                  Path(__file__).parent / "config.json"))
STATIC_DIR = Path(__file__).parent / "static"

# Prefix for HLS URLs. Local dev points straight at MediaMTX's HLS port.
# Behind nginx, set this to "" (empty) and have nginx proxy /hls/.
MEDIAMTX_BASE = os.environ.get("MEDIAMTX_BASE", "http://localhost:8888")


class CameraEntry:
    """One configured camera: display info + (optional) control client."""
    def __init__(self, cam_id: str, raw: dict):
        self.id = cam_id
        self.name = raw.get("name", cam_id)
        # config stores a path; prefix the MediaMTX base to get a full URL.
        self.hls = MEDIAMTX_BASE.rstrip("/") + raw.get("hls", "")
        ctrl_raw = raw.get("control") or {}
        # Filter to known ControlConfig fields so stray keys (e.g. _comment)
        # don't blow up the dataclass constructor.
        allowed = ControlConfig.__dataclass_fields__.keys()
        cfg = ControlConfig(**{k: v for k, v in ctrl_raw.items() if k in allowed})
        self.control = CameraControl(cfg) if cfg.configured else None

    @property
    def controllable(self) -> bool:
        return self.control is not None

    def public(self) -> dict:
        return {"id": self.id, "name": self.name,
                "hls": self.hls, "controllable": self.controllable}


def load_cameras() -> Dict[str, CameraEntry]:
    if not CONFIG_FILE.exists():
        logger.warning("config file %s not found; no cameras loaded", CONFIG_FILE)
        return {}
    data = json.loads(CONFIG_FILE.read_text())
    cams = data.get("cameras", {})
    return {cid: CameraEntry(cid, raw) for cid, raw in cams.items()}


CAMERAS = load_cameras()
logger.info("loaded %d camera(s): %s | MEDIAMTX_BASE=%r",
            len(CAMERAS), ", ".join(CAMERAS) or "none", MEDIAMTX_BASE)

app = FastAPI(title="camera-api", docs_url="/api/docs", openapi_url="/api/openapi.json")


# ----------------------------------------------------------------------
# Request models
# ----------------------------------------------------------------------
class MoveBody(BaseModel):
    dir: str


class IRBody(BaseModel):
    on: bool


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------
def _get_cam(cam: str) -> CameraEntry:
    entry = CAMERAS.get(cam)
    if entry is None:
        raise HTTPException(404, f"unknown camera: {cam}")
    return entry


def _require_control(cam: str) -> CameraControl:
    entry = _get_cam(cam)
    if entry.control is None:
        raise HTTPException(400, f"camera '{cam}' has no control configured")
    return entry.control


# ----------------------------------------------------------------------
# API
# ----------------------------------------------------------------------
@app.get("/api/health")
def health():
    return {"status": "ok", "cameras": list(CAMERAS.keys())}


@app.get("/api/cameras")
def list_cameras():
    return [c.public() for c in CAMERAS.values()]


@app.post("/api/{cam}/move")
def move(cam: str, body: MoveBody):
    if body.dir not in DIRECTIONS:
        raise HTTPException(422, f"dir must be one of {DIRECTIONS}")
    control = _require_control(cam)
    try:
        return {"result": control.move(body.dir)}
    except ControlError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/api/{cam}/ir")
def ir(cam: str, body: IRBody):
    control = _require_control(cam)
    try:
        return {"result": control.set_ir(body.on)}
    except ControlError as exc:
        raise HTTPException(502, str(exc)) from exc


# ----------------------------------------------------------------------
# Static UI (mounted last so /api/* wins)
# ----------------------------------------------------------------------
@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")


if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
