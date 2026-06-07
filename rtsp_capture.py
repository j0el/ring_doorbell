"""
rtsp_capture.py
Reads live frames from an RTSP camera (e.g. SONOFF CAM-B1P) using OpenCV's
FFmpeg backend, emitting Frame objects into an output queue.

This is the RTSP replacement for the old Ring/Node.js bridge. It exposes the
same Frame dataclass and the same thread API (RingCaptureThread -> RTSPCaptureThread)
so the rest of the pipeline (motion.py, recorder.py, gui.py) is unchanged.

RTSP transport is forced to TCP, which is far more reliable than the default
UDP for cameras streaming over WiFi — UDP drops cause torn/greyed frames.
"""

from __future__ import annotations

import logging
import os
import queue
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

import cv2
import numpy as np

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Frame dataclass  (imported by motion.py and recorder.py)
# ---------------------------------------------------------------------------

@dataclass
class Frame:
    image: np.ndarray          # BGR, H×W×3, uint8
    timestamp: datetime = field(default_factory=datetime.now)
    camera_name: str = ""


# ---------------------------------------------------------------------------
# Capture thread
# ---------------------------------------------------------------------------

class RTSPCaptureThread(threading.Thread):
    """
    Opens an RTSP stream with OpenCV and reads frames in a loop, wrapping each
    in a Frame and pushing it to `out_queue`. Reconnects automatically if the
    stream drops. Stop gracefully with `.stop()`.

    Drop-in replacement for the old RingCaptureThread: same out_queue / width /
    height / fps / camera_name parameters so main.py wiring barely changes.
    """

    def __init__(
        self,
        rtsp_url: str,
        out_queue: "queue.Queue[Frame]",
        camera_name: str = "Camera",
        width: int = 1280,
        height: int = 720,
        fps: int = 15,
        reconnect_delay: float = 3.0,
    ):
        super().__init__(daemon=True, name="RTSPCapture")
        self.rtsp_url = rtsp_url
        self.out_queue = out_queue
        self.camera_name = camera_name
        self.width = width
        self.height = height
        self.fps = fps
        self.reconnect_delay = reconnect_delay
        self.running = False
        self._cap: Optional[cv2.VideoCapture] = None

    # ------------------------------------------------------------------
    def _open(self) -> Optional[cv2.VideoCapture]:
        # Force TCP transport + a sane timeout. Must be set before VideoCapture
        # is constructed; OpenCV reads this env var when the FFmpeg backend opens.
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
            "rtsp_transport;tcp|stimeout;5000000"   # 5s connect/read timeout (us)
        )
        cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            logger.warning("Could not open RTSP stream — will retry.")
            cap.release()
            return None

        # Keep OpenCV's internal buffer tiny so we always read the freshest frame
        # rather than a backlog (reduces latency, avoids lag build-up).
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass

        # Report the stream's native resolution; we still resize to the
        # requested width/height below so downstream sizes are predictable.
        nat_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))  or self.width
        nat_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or self.height
        logger.info(
            "RTSP stream opened: native %dx%d -> serving %dx%d @ ~%dfps",
            nat_w, nat_h, self.width, self.height, self.fps,
        )
        return cap

    # ------------------------------------------------------------------
    def run(self):
        self.running = True
        logger.info("Capture thread starting RTSP reader for: %s", self.camera_name)

        while self.running:
            if self._cap is None:
                self._cap = self._open()
                if self._cap is None:
                    time.sleep(self.reconnect_delay)
                    continue

            ok, raw = self._cap.read()
            if not ok or raw is None:
                logger.warning("Frame read failed — reconnecting in %.1fs.",
                               self.reconnect_delay)
                self._cap.release()
                self._cap = None
                time.sleep(self.reconnect_delay)
                continue

            # Resize to the configured working resolution if needed. Keeping a
            # fixed size downstream means the Rust/OpenCV detectors and the
            # recorder don't have to handle resolution changes mid-stream.
            if raw.shape[1] != self.width or raw.shape[0] != self.height:
                raw = cv2.resize(raw, (self.width, self.height),
                                 interpolation=cv2.INTER_AREA)

            frame = Frame(
                image=raw,                       # cap.read() returns an owned array
                timestamp=datetime.now(),
                camera_name=self.camera_name,
            )
            self._enqueue(frame)

        self._cleanup()
        logger.info("Capture thread stopped.")

    def stop(self):
        self.running = False
        self._cleanup()

    # ------------------------------------------------------------------
    def _cleanup(self):
        if self._cap is not None:
            try:
                self._cap.release()
            except Exception:
                pass
            self._cap = None

    def _enqueue(self, frame: Frame):
        try:
            self.out_queue.put_nowait(frame)
        except queue.Full:
            # Drop oldest to keep the queue current (live, not buffered history)
            try:
                self.out_queue.get_nowait()
            except queue.Empty:
                pass
            try:
                self.out_queue.put_nowait(frame)
            except queue.Full:
                pass


# ---------------------------------------------------------------------------
# Helper: probe the stream once (used by --check)
# ---------------------------------------------------------------------------

def probe_stream(rtsp_url: str, timeout: float = 10.0) -> Optional[tuple[int, int]]:
    """
    Try to open the RTSP URL and grab a single frame.
    Returns (width, height) on success, or None on failure.
    """
    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
        "rtsp_transport;tcp|stimeout;5000000"
    )
    cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
    try:
        if not cap.isOpened():
            return None
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            ok, frame = cap.read()
            if ok and frame is not None:
                return (frame.shape[1], frame.shape[0])
        return None
    finally:
        cap.release()
