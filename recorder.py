"""
recorder.py
Consumes Clip objects and writes each to a timestamped MP4 file.

Each frame gets a burned-in timestamp overlay.
Clip filenames:  clips/YYYY-MM-DD_HH-MM-SS.mp4
A companion JSON index (clips/index.json) is maintained so the GUI
can display metadata without re-scanning files.
"""

from __future__ import annotations

import json
import logging
import queue
import threading
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import cv2
import numpy as np

from motion import Clip

logger = logging.getLogger(__name__)

CLIPS_DIR = Path("clips")
INDEX_FILE = CLIPS_DIR / "index.json"
FOURCC = cv2.VideoWriter_fourcc(*"mp4v")   # H.264 requires openh264; mp4v is universal


# ---------------------------------------------------------------------------
# Clip metadata (also persisted in index.json)
# ---------------------------------------------------------------------------

@dataclass
class ClipMeta:
    path: str                   # relative path, e.g. "clips/2024-01-15_09-32-11.mp4"
    started_at: str             # ISO-8601
    ended_at: str
    duration_seconds: float
    frame_count: int
    camera_name: str
    thumbnail_path: str         # path to first motion frame JPEG


# ---------------------------------------------------------------------------
# Index helpers
# ---------------------------------------------------------------------------

def _load_index() -> List[dict]:
    if INDEX_FILE.exists():
        try:
            return json.loads(INDEX_FILE.read_text())
        except Exception:
            pass
    return []


def _save_index(entries: List[dict]) -> None:
    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    INDEX_FILE.write_text(json.dumps(entries, indent=2))


def load_clip_index() -> List[ClipMeta]:
    """Load all saved clip metadata."""
    raw = _load_index()
    result = []
    for entry in raw:
        try:
            result.append(ClipMeta(**entry))
        except Exception:
            pass
    return result


# ---------------------------------------------------------------------------
# Frame annotation
# ---------------------------------------------------------------------------

def _annotate_frame(img: np.ndarray, ts: datetime, score: float) -> np.ndarray:
    """Burn timestamp + motion score into a copy of the frame."""
    out = img.copy()
    h, w = out.shape[:2]

    # Semi-transparent dark banner at bottom
    banner_h = max(28, h // 20)
    overlay = out.copy()
    cv2.rectangle(overlay, (0, h - banner_h), (w, h), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.55, out, 0.45, 0, out)

    ts_str = ts.strftime("%Y-%m-%d  %H:%M:%S.%f")[:-3]
    score_str = f"motion:{score:.3f}"
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = max(0.4, banner_h / 50)
    thickness = 1
    color = (200, 230, 255)

    cv2.putText(out, ts_str, (8, h - 8), font, font_scale, color, thickness, cv2.LINE_AA)
    tw, _ = cv2.getTextSize(score_str, font, font_scale, thickness)[0], None
    cv2.putText(
        out, score_str,
        (w - cv2.getTextSize(score_str, font, font_scale, thickness)[0][0] - 8, h - 8),
        font, font_scale, (100, 255, 150), thickness, cv2.LINE_AA,
    )
    return out


# ---------------------------------------------------------------------------
# Writer
# ---------------------------------------------------------------------------

def write_clip(clip: Clip, output_fps: float = 10.0) -> Optional[ClipMeta]:
    """
    Write a Clip to disk as an MP4.
    Returns ClipMeta on success, None on failure.
    """
    if not clip.frames:
        logger.warning("Empty clip — skipping.")
        return None

    CLIPS_DIR.mkdir(parents=True, exist_ok=True)

    ts_str = clip.started_at.strftime("%Y-%m-%d_%H-%M-%S")
    mp4_path = CLIPS_DIR / f"{ts_str}.mp4"
    thumb_path = CLIPS_DIR / f"{ts_str}_thumb.jpg"

    # Determine frame size from first frame
    first_img = clip.frames[0].frame.image
    h, w = first_img.shape[:2]

    writer = cv2.VideoWriter(str(mp4_path), FOURCC, output_fps, (w, h))
    if not writer.isOpened():
        logger.error("Could not open VideoWriter for %s", mp4_path)
        return None

    thumb_saved = False
    for mf in clip.frames:
        annotated = _annotate_frame(mf.frame.image, mf.frame.timestamp, mf.motion_score)
        writer.write(annotated)

        # Save thumbnail from first motion frame
        if not thumb_saved and mf.has_motion:
            cv2.imwrite(str(thumb_path), annotated)
            thumb_saved = True

    writer.release()

    # Fall back thumbnail if no motion frame had has_motion True
    if not thumb_saved:
        cv2.imwrite(str(thumb_path), _annotate_frame(
            first_img, clip.frames[0].frame.timestamp, 0.0
        ))

    camera_name = clip.frames[0].frame.camera_name if clip.frames else ""
    meta = ClipMeta(
        path=str(mp4_path),
        started_at=clip.started_at.isoformat(),
        ended_at=(clip.ended_at or datetime.now()).isoformat(),
        duration_seconds=clip.duration_seconds,
        frame_count=len(clip.frames),
        camera_name=camera_name,
        thumbnail_path=str(thumb_path),
    )

    # Append to index
    entries = _load_index()
    entries.insert(0, asdict(meta))   # newest first
    _save_index(entries)

    logger.info("Saved clip: %s  (%d frames)", mp4_path, len(clip.frames))
    return meta


# ---------------------------------------------------------------------------
# Recorder thread
# ---------------------------------------------------------------------------

class RecorderThread(threading.Thread):
    """
    Reads Clip objects from `clip_queue` and writes them to MP4.
    Emits ClipMeta objects to `meta_queue` (for the GUI to pick up).
    """

    def __init__(
        self,
        clip_queue: queue.Queue,
        meta_queue: queue.Queue,
        output_fps: float = 10.0,
    ):
        super().__init__(daemon=True, name="Recorder")
        self.clip_queue = clip_queue
        self.meta_queue = meta_queue
        self.output_fps = output_fps
        self.running = False

    def run(self):
        self.running = True
        logger.info("Recorder thread started.")
        while self.running:
            try:
                clip = self.clip_queue.get(timeout=1.0)
            except queue.Empty:
                continue
            meta = write_clip(clip, self.output_fps)
            if meta:
                try:
                    self.meta_queue.put_nowait(meta)
                except queue.Full:
                    pass
        logger.info("Recorder thread stopped.")

    def stop(self):
        self.running = False
