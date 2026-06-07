"""
main.py — guardian entry point (RTSP edition)

Usage:
  python main.py                 # start capture + GUI using config.json
  python main.py --check         # test the RTSP connection then exit
  python main.py --gui-only      # open GUI to browse saved clips (no capture)
  python main.py --width 1920 --height 1080 --fps 20

Camera URL is read from config.json ("rtsp_url") or the CAM_RTSP_URL env var.
Copy config.example.json to config.json and fill in your camera's RTSP link
(generate it in eWeLink: Device Settings -> More Settings -> RTSP -> Create RTSP Link).
"""

from __future__ import annotations

import argparse
import logging
import queue
import signal
import sys
from pathlib import Path
from typing import Optional

# ---------------------------------------------------------------------------
# Logging setup (before other imports so bridge logs look nice)
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(name)-20s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("main")

# ---------------------------------------------------------------------------
# Imports (after logging)
# ---------------------------------------------------------------------------
from PyQt6.QtWidgets import QApplication

from rtsp_capture import RTSPCaptureThread, probe_stream
from motion import MotionPipelineThread
from recorder import RecorderThread
from gui import MainWindow
from config import load_rtsp_url, load_camera_name, load_control_dict
from camera_control import CameraControl, ControlConfig


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Guardian — live RTSP motion-capture viewer",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--url",      metavar="RTSP_URL",
                   help="RTSP URL (overrides config.json / CAM_RTSP_URL)")
    p.add_argument("--check",    action="store_true",
                   help="Test the RTSP connection and exit")
    p.add_argument("--gui-only", action="store_true", help="Browse saved clips, no capture")
    p.add_argument("--width",    type=int, default=1280)
    p.add_argument("--height",   type=int, default=720)
    p.add_argument("--fps",      type=int, default=15)
    p.add_argument("--threshold", type=float, default=0.005,
                   help="Motion pixel-change fraction (0–1)")
    p.add_argument("--min-blob", type=float, default=0.01,
                   help="Minimum contiguous blob size as fraction of frame (0–1). "
                        "Filters reflections/small flickers.")
    p.add_argument("--min-frames", type=int, default=5,
                   help="Consecutive motion frames required before recording starts. "
                        "Filters single-frame flickers.")
    p.add_argument("--pre-roll",  type=int, default=15,
                   help="Frames to save before first motion frame")
    p.add_argument("--post-roll", type=float, default=3.0,
                   help="Seconds of quiet after motion before clip is closed")
    p.add_argument("--output-fps", type=float, default=15.0,
                   help="FPS written to output MP4")
    return p.parse_args()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    args = parse_args()

    # Resolve the RTSP URL: --url flag > config.json / env var
    rtsp_url = args.url or load_rtsp_url()
    camera_name = load_camera_name()

    # --check mode: probe the stream and exit (no GUI). Doesn't need the URL
    # to be in config if passed via --url.
    if args.check:
        if not rtsp_url:
            logger.error("No RTSP URL set. Use --url, or copy config.example.json "
                         "to config.json and fill in rtsp_url.")
            sys.exit(1)
        logger.info("Probing RTSP stream…")
        size = probe_stream(rtsp_url)
        if size:
            print(f"OK — stream is reachable. Native resolution: {size[0]}x{size[1]}")
            sys.exit(0)
        else:
            print("FAILED — could not open the stream. Check the URL, that the "
                  "camera is on the same network, and that RTSP is enabled in eWeLink.")
            sys.exit(1)

    # QApplication is needed for the GUI; create it once here regardless of mode.
    app = QApplication.instance() or QApplication(sys.argv)
    app.setStyle("Fusion")
    _apply_dark_palette(app)

    # GUI-only mode: just show the player, no capture
    if args.gui_only:
        _run_gui(meta_queue=queue.Queue())
        return

    # Normal capture mode — we need a URL
    if not rtsp_url:
        logger.error("No RTSP URL set. Use --url, or copy config.example.json "
                     "to config.json and fill in rtsp_url.")
        sys.exit(1)

    # Pipeline queues
    frame_queue = queue.Queue(maxsize=60)
    clip_queue  = queue.Queue(maxsize=20)
    meta_queue  = queue.Queue(maxsize=100)
    live_queue  = queue.Queue(maxsize=4)    # small — GUI only needs latest frame

    # Threads
    capture_thread = RTSPCaptureThread(
        rtsp_url=rtsp_url,
        out_queue=frame_queue,
        camera_name=camera_name,
        width=args.width,
        height=args.height,
        fps=args.fps,
    )
    motion_thread = MotionPipelineThread(
        in_queue=frame_queue,
        clip_queue=clip_queue,
        width=args.width,
        height=args.height,
        motion_threshold=args.threshold,
        min_blob_fraction=args.min_blob,
        min_motion_frames=args.min_frames,
        pre_roll=args.pre_roll,
        post_roll_seconds=args.post_roll,
        live_queue=live_queue,
    )
    recorder_thread = RecorderThread(
        clip_queue=clip_queue,
        meta_queue=meta_queue,
        output_fps=args.output_fps,
    )

    # Graceful shutdown — used by both Ctrl-C and the GUI shutdown button
    def _stop_threads():
        logger.info("Shutting down…")
        capture_thread.stop()
        motion_thread.stop()
        recorder_thread.stop()

    def _shutdown(sig, frame):
        _stop_threads()

    signal.signal(signal.SIGINT,  _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    # Start pipeline threads
    capture_thread.start()
    motion_thread.start()
    recorder_thread.start()

    logger.info(
        "Pipeline started — camera: %s  |  %dx%d @ %dfps  |  "
        "threshold: %.4f  |  Ctrl-C to stop",
        camera_name, args.width, args.height, args.fps, args.threshold,
    )

    # Build the camera-control client from config.json -> "control" (if present).
    # status_callback lets control results show up in the GUI status bar.
    control_status = {"fn": None}   # late-bound to the window after it exists
    def _control_status(msg: str):
        if control_status["fn"]:
            control_status["fn"](msg)
    camera_control = _build_camera_control(_control_status)

    # Launch GUI (blocks until window is closed)
    win = MainWindow(meta_queue=meta_queue, live_queue=live_queue,
                     on_shutdown=_stop_threads, camera_control=camera_control)
    control_status["fn"] = win.set_status
    win.set_status(f"Live capture  •  {camera_name}")
    win.show()
    app.exec()

    # GUI closed — stop everything
    logger.info("GUI closed, stopping threads…")
    capture_thread.stop()
    motion_thread.stop()
    recorder_thread.stop()
    capture_thread.join(timeout=5)
    motion_thread.join(timeout=5)
    recorder_thread.join(timeout=5)
    logger.info("Done.")


def _run_gui(meta_queue: queue.Queue, camera_name: str = "",
             live_queue: "Optional[queue.Queue]" = None,
             on_shutdown=None):
    # QApplication is already created in main(); just get the instance.
    app = QApplication.instance() or QApplication(sys.argv)

    win = MainWindow(meta_queue=meta_queue, live_queue=live_queue,
                     on_shutdown=on_shutdown)
    if camera_name:
        win.set_status(f"Live capture  •  {camera_name}")
    win.show()

    app.exec()


def _build_camera_control(status_callback=None):
    """
    Construct a CameraControl from config.json -> "control".
    Returns None if no usable control block is configured.
    """
    raw = load_control_dict()
    if not raw:
        return None
    # Map the JSON keys onto ControlConfig fields, ignoring any extras
    # (e.g. the "_comment" helper key in config.example.json).
    valid = {f for f in ControlConfig.__dataclass_fields__}
    cfg = ControlConfig(**{k: v for k, v in raw.items() if k in valid})
    if not cfg.configured:
        logger.info("Control block present but incomplete — PTZ controls hidden.")
        return None
    logger.info("Camera control enabled: %s", cfg.base_url)
    return CameraControl(cfg, status_callback=status_callback)


def _apply_dark_palette(app: QApplication):
    """Apply a dark theme via QPalette."""
    from PyQt6.QtGui import QPalette, QColor
    from PyQt6.QtCore import Qt

    palette = QPalette()
    dark   = QColor(30, 30, 30)
    mid    = QColor(50, 50, 50)
    light  = QColor(200, 200, 200)
    accent = QColor(42, 82, 152)
    white  = QColor(230, 230, 230)

    palette.setColor(QPalette.ColorRole.Window,          dark)
    palette.setColor(QPalette.ColorRole.WindowText,      white)
    palette.setColor(QPalette.ColorRole.Base,            QColor(18, 18, 18))
    palette.setColor(QPalette.ColorRole.AlternateBase,   mid)
    palette.setColor(QPalette.ColorRole.ToolTipBase,     white)
    palette.setColor(QPalette.ColorRole.ToolTipText,     white)
    palette.setColor(QPalette.ColorRole.Text,            white)
    palette.setColor(QPalette.ColorRole.Button,          mid)
    palette.setColor(QPalette.ColorRole.ButtonText,      white)
    palette.setColor(QPalette.ColorRole.BrightText,      QColor(255, 80, 80))
    palette.setColor(QPalette.ColorRole.Highlight,       accent)
    palette.setColor(QPalette.ColorRole.HighlightedText, QColor(255, 255, 255))
    palette.setColor(QPalette.ColorRole.Link,            QColor(80, 150, 255))
    app.setPalette(palette)


if __name__ == "__main__":
    main()
