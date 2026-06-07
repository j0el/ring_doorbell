"""
config.py
Loads the RTSP camera URL from config.json (preferred) or the CAM_RTSP_URL
environment variable. Keeps credentials out of source code and out of git.

config.json is git-ignored. Copy config.example.json to config.json and fill
in your camera's RTSP URL (generate it in the eWeLink app:
  Device Settings -> More Settings -> RTSP -> Create RTSP Link).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

CONFIG_FILE = Path(__file__).parent / "config.json"


def load_rtsp_url() -> Optional[str]:
    """
    Resolve the RTSP URL, in priority order:
      1. CAM_RTSP_URL environment variable
      2. "rtsp_url" key in config.json
    Returns None if neither is set.
    """
    env_url = os.environ.get("CAM_RTSP_URL")
    if env_url:
        return env_url.strip()

    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text())
            url = data.get("rtsp_url", "").strip()
            return url or None
        except Exception:
            return None

    return None


def load_camera_name(default: str = "CAM-B1P") -> str:
    """Optional friendly name from config.json, used in clip metadata + status bar."""
    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text())
            return data.get("camera_name", default) or default
        except Exception:
            pass
    return default


def load_control_dict() -> dict:
    """
    Return the raw "control" block from config.json (or {} if absent).
    main.py converts this into a ControlConfig. Kept as a plain dict here so
    config.py has no dependency on camera_control.py.
    """
    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text())
            ctrl = data.get("control")
            return ctrl if isinstance(ctrl, dict) else {}
        except Exception:
            pass
    return {}
