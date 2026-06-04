"""
ring_capture.py
Spawns ring_bridge.js as a subprocess and reads live raw BGR24 frames from
its stdout, emitting Frame objects into an output queue.

Frame protocol from bridge:
  1. ASCII header line:  "RING_STREAM <width> <height> <fps>\\n"
  2. Repeated raw frames: exactly width * height * 3 bytes each (BGR24)
"""

from __future__ import annotations

import logging
import queue
import subprocess
import threading
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

BRIDGE_SCRIPT = Path(__file__).parent / "ring_bridge.js"


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

class RingCaptureThread(threading.Thread):
    """
    Spawns `node ring_bridge.js <camera_name>` and reads raw BGR24 frames
    from its stdout.  Each frame is wrapped in a Frame and pushed to
    `out_queue`.  Stop gracefully with `.stop()`.
    """

    def __init__(
        self,
        camera_name: str,
        out_queue: "queue.Queue[Frame]",
        width: int = 1280,
        height: int = 720,
        fps: int = 15,
        node_bin: str = "node",
    ):
        super().__init__(daemon=True, name="RingCapture")
        self.camera_name = camera_name
        self.out_queue = out_queue
        self.width = width
        self.height = height
        self.fps = fps
        self.node_bin = node_bin
        self.running = False
        self._proc: Optional[subprocess.Popen] = None

    # ------------------------------------------------------------------
    def run(self):
        self.running = True
        logger.info("Capture thread starting bridge for camera: %s", self.camera_name)

        cmd = [
            self.node_bin,
            str(BRIDGE_SCRIPT),
            self.camera_name,
            "--width",  str(self.width),
            "--height", str(self.height),
            "--fps",    str(self.fps),
        ]

        try:
            self._proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,   # bridge logs go here
                bufsize=0,                # unbuffered — critical for low latency
            )
        except FileNotFoundError:
            logger.error(
                "Could not start Node.js bridge. Is 'node' installed and ring_bridge.js present?\n"
                "  Run: npm install  (in the ring_guardian directory)"
            )
            return

        # Start a thread to mirror bridge stderr to our logger
        threading.Thread(
            target=self._drain_stderr,
            args=(self._proc.stderr,),
            daemon=True,
        ).start()

        # Read and parse the header line
        header = self._read_line(self._proc.stdout)
        if header is None or not header.startswith("RING_STREAM"):
            logger.error("Unexpected bridge header: %r", header)
            self._proc.terminate()
            return

        parts = header.split()
        if len(parts) >= 4:
            self.width  = int(parts[1])
            self.height = int(parts[2])
            self.fps    = int(parts[3])

        frame_bytes = self.width * self.height * 3
        logger.info(
            "Stream started: %dx%d @ %dfps (%d bytes/frame)",
            self.width, self.height, self.fps, frame_bytes,
        )

        # Main frame-reading loop
        while self.running:
            raw = self._read_exact(self._proc.stdout, frame_bytes)
            if raw is None:
                logger.warning("Bridge stdout closed — stream ended.")
                break

            arr = np.frombuffer(raw, dtype=np.uint8).reshape(
                (self.height, self.width, 3)
            )
            # Copy so the numpy array owns its memory (frombuffer returns read-only view)
            frame = Frame(
                image=arr.copy(),
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
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._proc.kill()

    def _enqueue(self, frame: Frame):
        try:
            self.out_queue.put_nowait(frame)
        except queue.Full:
            # Drop oldest to keep queue current
            try:
                self.out_queue.get_nowait()
            except queue.Empty:
                pass
            self.out_queue.put_nowait(frame)

    @staticmethod
    def _read_exact(stream, n: int) -> Optional[bytes]:
        """Read exactly n bytes from stream, or return None on EOF."""
        buf = bytearray()
        while len(buf) < n:
            chunk = stream.read(n - len(buf))
            if not chunk:
                return None
            buf.extend(chunk)
        return bytes(buf)

    @staticmethod
    def _read_line(stream) -> Optional[str]:
        """Read an ASCII line (up to \\n) from a binary stream."""
        buf = bytearray()
        while True:
            byte = stream.read(1)
            if not byte:
                return None
            if byte == b"\n":
                return buf.decode("ascii", errors="replace").strip()
            buf.extend(byte)

    @staticmethod
    def _drain_stderr(stderr_stream):
        """Forward bridge stderr lines to Python logging."""
        bridge_logger = logging.getLogger("ring_bridge")
        try:
            for raw_line in stderr_stream:
                line = raw_line.decode("utf-8", errors="replace").rstrip()
                bridge_logger.info(line)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Helper: list cameras (runs bridge in --list mode)
# ---------------------------------------------------------------------------

def list_cameras(node_bin: str = "node") -> list[str]:
    """Return camera names by running `node ring_bridge.js --list`."""
    try:
        result = subprocess.run(
            [node_bin, str(BRIDGE_SCRIPT), "--list"],
            capture_output=True, text=True, timeout=30,
        )
        names = []
        for line in result.stderr.splitlines():
            line = line.strip()
            if line.startswith("•"):
                names.append(line.lstrip("• ").strip())
        return names
    except Exception as exc:
        logger.warning("list_cameras failed: %s", exc)
        return []
