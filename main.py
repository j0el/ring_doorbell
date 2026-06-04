"""
main.py — ring_guardian entry point

Usage:
  python main.py --camera "Front Door"
  python main.py --camera "Front Door" --width 1920 --height 1080 --fps 20
  python main.py --list          # list available cameras then exit
  python main.py --gui-only      # open GUI to browse saved clips (no capture)

Environment variables for first-run auth (saved to ring_token.json after):
  RING_USERNAME=you@example.com
  RING_PASSWORD=yourpassword
  RING_OTP=123456            (only if 2FA is enabled)
"""

from __future__ import annotations

import argparse
import logging
import queue
import signal
import sys
from pathlib import Path

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

from ring_capture import RingCaptureThread, list_cameras
from motion import MotionPipelineThread
from recorder import RecorderThread
from gui import MainWindow


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Ring Guardian — live motion-capture viewer",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("--camera",   metavar="NAME",  help="Camera name to stream")
    p.add_argument("--list",     action="store_true", help="List cameras and exit")
    p.add_argument("--gui-only", action="store_true", help="Browse saved clips, no capture")
    p.add_argument("--width",    type=int, default=1280)
    p.add_argument("--height",   type=int, default=720)
    p.add_argument("--fps",      type=int, default=15)
    p.add_argument("--threshold", type=float, default=0.005,
                   help="Motion pixel-change fraction (0–1)")
    p.add_argument("--pre-roll",  type=int, default=15,
                   help="Frames to save before first motion frame")
    p.add_argument("--post-roll", type=float, default=3.0,
                   help="Seconds of quiet after motion before clip is closed")
    p.add_argument("--output-fps", type=float, default=15.0,
                   help="FPS written to output MP4")
    p.add_argument("--node",     default="node",
                   help="Path to node binary (default: 'node' in PATH)")
    return p.parse_args()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    args = parse_args()

    # --list mode
    if args.list:
        logger.info("Querying available cameras…")
        names = list_cameras(node_bin=args.node)
        if names:
            print("Available cameras:")
            for n in names:
                print(f"  • {n}")
        else:
            print("No cameras found (or bridge failed — check Node.js / ring_token.json).")
        return

    # GUI-only mode: just show the player
    if args.gui_only:
        _run_gui(meta_queue=queue.Queue())
        return

    # Normal capture mode
    if not args.camera:
        logger.error("--camera NAME is required (or use --list to see camera names).")
        sys.exit(1)

    # Pipeline queues
    frame_queue = queue.Queue(maxsize=60)
    clip_queue  = queue.Queue(maxsize=20)
    meta_queue  = queue.Queue(maxsize=100)

    # Threads
    capture_thread = RingCaptureThread(
        camera_name=args.camera,
        out_queue=frame_queue,
        width=args.width,
        height=args.height,
        fps=args.fps,
        node_bin=args.node,
    )
    motion_thread = MotionPipelineThread(
        in_queue=frame_queue,
        clip_queue=clip_queue,
        width=args.width,
        height=args.height,
        motion_threshold=args.threshold,
        pre_roll=args.pre_roll,
        post_roll_seconds=args.post_roll,
    )
    recorder_thread = RecorderThread(
        clip_queue=clip_queue,
        meta_queue=meta_queue,
        output_fps=args.output_fps,
    )

    # Graceful shutdown on Ctrl-C
    def _shutdown(sig, frame):
        logger.info("Shutting down…")
        capture_thread.stop()
        motion_thread.stop()
        recorder_thread.stop()

    signal.signal(signal.SIGINT,  _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    # Start pipeline threads
    capture_thread.start()
    motion_thread.start()
    recorder_thread.start()

    logger.info(
        "Pipeline started — camera: %s  |  %dx%d @ %dfps  |  "
        "threshold: %.4f  |  Ctrl-C to stop",
        args.camera, args.width, args.height, args.fps, args.threshold,
    )

    # Launch GUI (blocks until window is closed)
    _run_gui(meta_queue=meta_queue, camera_name=args.camera)

    # GUI closed — stop everything
    logger.info("GUI closed, stopping threads…")
    capture_thread.stop()
    motion_thread.stop()
    recorder_thread.stop()
    capture_thread.join(timeout=5)
    motion_thread.join(timeout=5)
    recorder_thread.join(timeout=5)
    logger.info("Done.")


def _run_gui(meta_queue: queue.Queue, camera_name: str = ""):
    app = QApplication.instance() or QApplication(sys.argv)
    app.setStyle("Fusion")
    _apply_dark_palette(app)

    win = MainWindow(meta_queue=meta_queue)
    if camera_name:
        win.set_status(f"Live capture  •  {camera_name}")
    win.show()

    app.exec()


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
