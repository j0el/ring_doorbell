"""
motion.py
Motion detection pipeline.

Two back-ends (chosen automatically):
  1. Rust  — spawns motion_core/target/release/motion_core for high-speed
             frame differencing via stdin/stdout binary protocol.
  2. Python — falls back to OpenCV MOG2 background subtraction if the Rust
             binary has not been built.

Consumes Frame objects from an input queue, classifies each frame, and emits
complete Clip objects (motion events) into an output queue for the recorder.
"""

from __future__ import annotations

import collections
import json
import logging
import os
import queue
import struct
import subprocess
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Deque, List, Optional

import cv2
import numpy as np

from rtsp_capture import Frame

logger = logging.getLogger(__name__)

RUST_BINARY = Path(__file__).parent / "motion_core" / "target" / "release" / "motion_core"


# ---------------------------------------------------------------------------
# Shared result types
# ---------------------------------------------------------------------------

@dataclass
class MotionFrame:
    frame: Frame
    has_motion: bool
    motion_score: float        # 0.0 – 1.0
    mask: Optional[np.ndarray] = None   # foreground mask (H×W uint8), OpenCV only


@dataclass
class Clip:
    frames: List[MotionFrame] = field(default_factory=list)
    started_at: datetime = field(default_factory=datetime.now)
    ended_at: Optional[datetime] = None

    @property
    def duration_seconds(self) -> float:
        end = self.ended_at or datetime.now()
        return (end - self.started_at).total_seconds()


# ---------------------------------------------------------------------------
# Back-end A: Rust motion_core subprocess
# ---------------------------------------------------------------------------

class _RustDetector:
    """Wraps the motion_core Rust binary via stdin/stdout."""

    def __init__(self, width: int, height: int, threshold: float, history: int,
                 min_blob_fraction: float = 0.01):
        self.width  = width
        self.height = height
        self._frame_bytes = width * height * 3
        self._proc: Optional[subprocess.Popen] = None
        self._init_json = json.dumps({
            "cmd": "init",
            "width": width,
            "height": height,
            "threshold": threshold,
            "history": history,
            "min_blob_fraction": min_blob_fraction,
        })

    def start(self):
        self._proc = subprocess.Popen(
            [str(RUST_BINARY)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            bufsize=0,
        )
        # Send init command
        init_line = (self._init_json + "\n").encode()
        self._proc.stdin.write(init_line)
        self._proc.stdin.flush()
        logger.info("Rust motion_core started (pid=%d)", self._proc.pid)

    def process(self, frame: Frame) -> MotionFrame:
        bgr = frame.image.tobytes()  # contiguous BGR24
        # 8-byte header: frame_idx (u32 LE) + reserved (u32 LE)
        header = struct.pack("<II", 0, 0)
        self._proc.stdin.write(header + bgr)
        self._proc.stdin.flush()

        line = self._proc.stdout.readline().decode().strip()
        data = json.loads(line)
        return MotionFrame(
            frame=frame,
            has_motion=data["has_motion"],
            motion_score=data["score"],
        )

    def stop(self):
        if self._proc:
            try:
                self._proc.stdin.close()
                self._proc.wait(timeout=3)
            except Exception:
                self._proc.kill()

    def reset(self):
        self.stop()
        self.start()


# ---------------------------------------------------------------------------
# Back-end B: pure Python / OpenCV MOG2
# ---------------------------------------------------------------------------

class _OpenCVDetector:
    def __init__(self, threshold: float, history: int, min_blob_fraction: float = 0.005):
        self.threshold = threshold
        # Minimum contiguous blob area as a fraction of total frame pixels.
        # Reflections and light flickers produce many small scattered blobs;
        # real objects (people, cars) produce at least one large blob.
        self._min_blob_fraction = min_blob_fraction
        self._bg = cv2.createBackgroundSubtractorMOG2(
            history=history, varThreshold=36.0, detectShadows=False
        )
        self._kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

    def process(self, frame: Frame) -> MotionFrame:
        gray    = cv2.cvtColor(frame.image, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (5, 5), 0)
        mask    = self._bg.apply(blurred)
        mask    = cv2.morphologyEx(mask, cv2.MORPH_OPEN,   self._kernel)
        mask    = cv2.morphologyEx(mask, cv2.MORPH_DILATE, self._kernel)

        score = float(np.count_nonzero(mask)) / mask.size

        # Require at least one contiguous blob to exceed min_blob_fraction.
        # This rejects scattered pixel noise (reflections, compression artefacts)
        # while accepting solid moving objects.
        has_motion = False
        if score >= self.threshold:
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if contours:
                min_pixels = self._min_blob_fraction * mask.size
                largest = max(cv2.contourArea(c) for c in contours)
                has_motion = largest >= min_pixels

        return MotionFrame(frame=frame, has_motion=has_motion,
                           motion_score=score, mask=mask)

    def reset(self):
        self._bg = cv2.createBackgroundSubtractorMOG2(
            history=self._bg.getHistory(),
            varThreshold=self._bg.getVarThreshold(),
            detectShadows=False,
        )


# ---------------------------------------------------------------------------
# Pipeline thread
# ---------------------------------------------------------------------------

class MotionPipelineThread(threading.Thread):
    """
    Reads Frame objects from `in_queue`.
    Emits complete Clip objects into `clip_queue` when a motion event ends.
    Uses Rust back-end if the binary is present, otherwise OpenCV.
    """

    def __init__(
        self,
        in_queue: "queue.Queue[Frame]",
        clip_queue: "queue.Queue[Clip]",
        width: int = 1280,
        height: int = 720,
        motion_threshold: float = 0.005,
        min_blob_fraction: float = 0.005,
        min_motion_frames: int = 3,
        history: int = 50,
        pre_roll: int = 15,
        post_roll_seconds: float = 3.0,
        live_queue: "Optional[queue.Queue[Frame]]" = None,
    ):
        super().__init__(daemon=True, name="MotionPipeline")
        self.in_queue          = in_queue
        self.clip_queue        = clip_queue
        self.live_queue        = live_queue   # optional tap for live display
        self.motion_threshold  = motion_threshold
        self.min_motion_frames = min_motion_frames
        self.pre_roll          = pre_roll
        self.post_roll_seconds = post_roll_seconds
        self.running           = False

        # Choose back-end
        if RUST_BINARY.exists():
            logger.info("Using Rust motion_core back-end.")
            self._detector: _RustDetector | _OpenCVDetector = _RustDetector(
                width, height, motion_threshold, history, min_blob_fraction
            )
            self._use_rust = True
        else:
            logger.info(
                "Rust binary not found at %s — using OpenCV MOG2.\n"
                "  Build with: cd motion_core && cargo build --release",
                RUST_BINARY,
            )
            self._detector = _OpenCVDetector(motion_threshold, history, min_blob_fraction)
            self._use_rust = False

        self._pre_buffer: Deque[MotionFrame] = collections.deque(maxlen=pre_roll)
        self._candidate_frames: List[MotionFrame] = []  # held until min_motion_frames reached
        self._active_clip: Optional[Clip] = None
        self._last_motion_mono: Optional[float] = None

    # ------------------------------------------------------------------
    def run(self):
        self.running = True
        if self._use_rust:
            self._detector.start()   # type: ignore[union-attr]

        logger.info("Motion pipeline started.")

        while self.running:
            try:
                raw = self.in_queue.get(timeout=1.0)
            except queue.Empty:
                self._maybe_close_clip()
                continue

            try:
                mf = self._detector.process(raw)
            except Exception as exc:
                logger.warning("Detector error: %s — resetting.", exc)
                self._detector.reset()
                if self._use_rust:
                    self._detector.start()  # type: ignore[union-attr]
                continue

            # Tap frame to live display queue (drop if full — never block pipeline)
            if self.live_queue is not None:
                try:
                    self.live_queue.put_nowait(raw)
                except queue.Full:
                    pass

            if mf.has_motion:
                self._on_motion(mf)
            else:
                self._on_quiet(mf)
                self._maybe_close_clip()

        if self._active_clip:
            self._finalise_clip()

        if self._use_rust:
            self._detector.stop()  # type: ignore[union-attr]

        logger.info("Motion pipeline stopped.")

    def stop(self):
        self.running = False

    # ------------------------------------------------------------------
    def _on_motion(self, mf: MotionFrame):
        self._last_motion_mono = time.monotonic()
        if self._active_clip is not None:
            # Already in a confirmed clip — just append.
            self._active_clip.frames.append(mf)
        else:
            # Accumulate candidates until we've seen min_motion_frames in a row.
            self._candidate_frames.append(mf)
            if len(self._candidate_frames) >= self.min_motion_frames:
                self._active_clip = Clip(started_at=self._candidate_frames[0].frame.timestamp)
                for buffered in self._pre_buffer:
                    self._active_clip.frames.append(buffered)
                self._pre_buffer.clear()
                for cf in self._candidate_frames:
                    self._active_clip.frames.append(cf)
                self._candidate_frames.clear()
                logger.debug("Clip started after %d consecutive motion frames", self.min_motion_frames)

    def _on_quiet(self, mf: MotionFrame):
        if self._candidate_frames:
            # Not enough consecutive frames — treat candidates as pre-roll and discard.
            for cf in self._candidate_frames:
                self._pre_buffer.append(cf)
            self._candidate_frames.clear()
        if self._active_clip is not None:
            self._active_clip.frames.append(mf)
        else:
            self._pre_buffer.append(mf)

    def _maybe_close_clip(self):
        if self._active_clip is None or self._last_motion_mono is None:
            return
        if time.monotonic() - self._last_motion_mono >= self.post_roll_seconds:
            self._finalise_clip()

    def _finalise_clip(self):
        if self._active_clip is None:
            return
        self._active_clip.ended_at = datetime.now()
        logger.info(
            "Clip finalised: %d frames, %.1fs",
            len(self._active_clip.frames),
            self._active_clip.duration_seconds,
        )
        try:
            self.clip_queue.put_nowait(self._active_clip)
        except queue.Full:
            logger.warning("Clip queue full — dropping clip.")
        self._active_clip       = None
        self._last_motion_mono  = None
        self._candidate_frames.clear()
