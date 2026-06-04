"""
gui.py
PyQt6 desktop GUI for ring_guardian.

Layout:
  ┌──────────────────────────────────────────────────────────────┐
  │  ┌──────────────┐  ┌──────────────────────────────────────┐ │
  │  │  Clip list   │  │          Video player                │ │
  │  │  (thumbnail  │  │                                      │ │
  │  │   + meta)    │  │                                      │ │
  │  │              │  ├──────────────────────────────────────┤ │
  │  │              │  │  [◀◀] [▶/⏸] [▶▶]  scrub ──────── │ │
  │  │              │  │  00:00 / 00:12    motion: 0.042     │ │
  │  └──────────────┘  └──────────────────────────────────────┘ │
  │  Status bar: "Live • capturing"                              │
  └──────────────────────────────────────────────────────────────┘

Video playback uses a QTimer to step through frames extracted from the
MP4 with OpenCV — no platform media codec required.
"""

from __future__ import annotations

import logging
import queue
from datetime import datetime
from pathlib import Path
from typing import List, Optional

import cv2
import numpy as np
from PyQt6.QtCore import (
    QSize, Qt, QTimer, pyqtSignal, pyqtSlot
)
from PyQt6.QtGui import (
    QColor, QFont, QIcon, QImage, QPainter, QPixmap
)
from PyQt6.QtWidgets import (
    QApplication, QFrame, QHBoxLayout, QLabel, QListWidget,
    QListWidgetItem, QMainWindow, QPushButton, QSizePolicy,
    QSlider, QSplitter, QStatusBar, QVBoxLayout, QWidget,
)

from recorder import ClipMeta, load_clip_index

logger = logging.getLogger(__name__)

THUMBNAIL_SIZE = QSize(160, 90)
PLAYBACK_TIMER_MS = 33   # ~30 fps display rate


# ---------------------------------------------------------------------------
# VideoPlayer widget
# ---------------------------------------------------------------------------

class VideoDisplay(QLabel):
    """Simple QLabel that displays video frames and scales them to fit."""

    def __init__(self):
        super().__init__()
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setMinimumSize(640, 360)
        self.setSizePolicy(
            QSizePolicy.Policy.Expanding,
            QSizePolicy.Policy.Expanding,
        )
        self.setStyleSheet("background: #111;")
        self._show_placeholder()

    def _show_placeholder(self):
        self.setText("Select a clip to play")
        self.setStyleSheet("background: #111; color: #555; font-size: 16px;")

    def display_frame(self, bgr: np.ndarray):
        self.setText("")
        self.setStyleSheet("background: #111;")
        h, w = bgr.shape[:2]
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        qimg = QImage(rgb.data, w, h, w * 3, QImage.Format.Format_RGB888).copy()
        pix = QPixmap.fromImage(qimg).scaled(
            self.size(),
            Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation,
        )
        self.setPixmap(pix)


class PlayerControls(QWidget):
    """Scrub bar + play/pause/step buttons + info label."""

    play_pause_clicked  = pyqtSignal()
    step_back_clicked   = pyqtSignal()
    step_fwd_clicked    = pyqtSignal()
    scrub_changed       = pyqtSignal(int)   # frame index

    def __init__(self):
        super().__init__()
        self._build_ui()

    def _build_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(4, 4, 4, 4)
        layout.setSpacing(4)

        # Scrub bar
        self.scrub = QSlider(Qt.Orientation.Horizontal)
        self.scrub.setMinimum(0)
        self.scrub.setMaximum(0)
        self.scrub.setTracking(True)
        self.scrub.sliderMoved.connect(self.scrub_changed)
        layout.addWidget(self.scrub)

        # Buttons + info row
        row = QHBoxLayout()

        self.btn_back  = QPushButton("◀◀")
        self.btn_play  = QPushButton("▶")
        self.btn_fwd   = QPushButton("▶▶")
        self.lbl_time  = QLabel("00:00 / 00:00")
        self.lbl_score = QLabel("motion: —")

        for btn in (self.btn_back, self.btn_play, self.btn_fwd):
            btn.setFixedWidth(42)

        self.btn_back.clicked.connect(self.step_back_clicked)
        self.btn_play.clicked.connect(self.play_pause_clicked)
        self.btn_fwd.clicked.connect(self.step_fwd_clicked)

        row.addWidget(self.btn_back)
        row.addWidget(self.btn_play)
        row.addWidget(self.btn_fwd)
        row.addSpacing(12)
        row.addWidget(self.lbl_time)
        row.addStretch()
        row.addWidget(self.lbl_score)
        layout.addLayout(row)

    def set_frame_range(self, total: int):
        self.scrub.setMaximum(max(0, total - 1))

    def set_position(self, idx: int, total: int, elapsed_s: float,
                     duration_s: float, score: Optional[float]):
        self.scrub.blockSignals(True)
        self.scrub.setValue(idx)
        self.scrub.blockSignals(False)
        e = _fmt_time(elapsed_s)
        d = _fmt_time(duration_s)
        self.lbl_time.setText(f"{e} / {d}")
        if score is not None:
            self.lbl_score.setText(f"motion: {score:.4f}")
        else:
            self.lbl_score.setText("motion: —")

    def set_playing(self, playing: bool):
        self.btn_play.setText("⏸" if playing else "▶")


def _fmt_time(seconds: float) -> str:
    s = int(seconds)
    return f"{s // 60:02d}:{s % 60:02d}"


# ---------------------------------------------------------------------------
# Clip list
# ---------------------------------------------------------------------------

class ClipListWidget(QListWidget):
    """Left-panel list of motion clips with thumbnails."""

    def __init__(self):
        super().__init__()
        self.setIconSize(THUMBNAIL_SIZE)
        self.setSpacing(4)
        self.setStyleSheet("""
            QListWidget { background: #1a1a1a; border: none; }
            QListWidget::item { padding: 4px; color: #ddd; }
            QListWidget::item:selected { background: #2a5298; }
        """)

    def populate(self, clips: List[ClipMeta]):
        self.clear()
        for meta in clips:
            item = QListWidgetItem()
            item.setData(Qt.ItemDataRole.UserRole, meta)

            # Thumbnail
            thumb_path = Path(meta.thumbnail_path)
            if thumb_path.exists():
                pix = QPixmap(str(thumb_path)).scaled(
                    THUMBNAIL_SIZE,
                    Qt.AspectRatioMode.KeepAspectRatio,
                    Qt.TransformationMode.SmoothTransformation,
                )
                item.setIcon(QIcon(pix))

            # Label
            try:
                dt = datetime.fromisoformat(meta.started_at)
                ts = dt.strftime("%Y-%m-%d  %H:%M:%S")
            except Exception:
                ts = meta.started_at
            item.setText(f"{ts}\n{meta.duration_seconds:.1f}s  •  {meta.frame_count} frames")
            self.addItem(item)

    def add_clip(self, meta: ClipMeta):
        """Prepend a newly saved clip."""
        current = [
            self.item(i).data(Qt.ItemDataRole.UserRole)
            for i in range(self.count())
        ]
        self.populate([meta] + current)


# ---------------------------------------------------------------------------
# Main window
# ---------------------------------------------------------------------------

class MainWindow(QMainWindow):
    """
    Main application window.

    Parameters
    ----------
    meta_queue : queue.Queue[ClipMeta]
        The recorder drops ClipMeta objects here; the GUI polls it with a
        QTimer and adds new clips to the list.
    """

    def __init__(self, meta_queue: "queue.Queue[ClipMeta]"):
        super().__init__()
        self._meta_queue = meta_queue
        self._frames: List[np.ndarray] = []
        self._scores: List[Optional[float]] = []
        self._current_idx = 0
        self._playing = False
        self._cap: Optional[cv2.VideoCapture] = None
        self._current_meta: Optional[ClipMeta] = None

        self.setWindowTitle("Ring Guardian")
        self.resize(1200, 700)
        self._build_ui()
        self._load_existing_clips()

        # Timer: advance playback
        self._play_timer = QTimer(self)
        self._play_timer.setInterval(PLAYBACK_TIMER_MS)
        self._play_timer.timeout.connect(self._on_play_tick)

        # Timer: poll for new clips from recorder
        self._poll_timer = QTimer(self)
        self._poll_timer.setInterval(500)
        self._poll_timer.timeout.connect(self._poll_new_clips)
        self._poll_timer.start()

    # ------------------------------------------------------------------
    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root = QHBoxLayout(central)
        root.setContentsMargins(0, 0, 0, 0)

        splitter = QSplitter(Qt.Orientation.Horizontal)

        # Left: clip list
        left = QWidget()
        lv = QVBoxLayout(left)
        lv.setContentsMargins(4, 4, 4, 4)
        lbl = QLabel("Motion Clips")
        lbl.setFont(QFont("", 11, QFont.Weight.Bold))
        lbl.setStyleSheet("color: #ccc; padding: 4px;")
        lv.addWidget(lbl)
        self.clip_list = ClipListWidget()
        self.clip_list.currentItemChanged.connect(self._on_clip_selected)
        lv.addWidget(self.clip_list)
        left.setMinimumWidth(220)
        left.setMaximumWidth(340)

        # Right: video + controls
        right = QWidget()
        rv = QVBoxLayout(right)
        rv.setContentsMargins(4, 4, 4, 4)
        self.video = VideoDisplay()
        self.controls = PlayerControls()
        self.controls.play_pause_clicked.connect(self._toggle_play)
        self.controls.step_back_clicked.connect(self._step_back)
        self.controls.step_fwd_clicked.connect(self._step_fwd)
        self.controls.scrub_changed.connect(self._on_scrub)
        rv.addWidget(self.video, stretch=1)
        rv.addWidget(self.controls)

        splitter.addWidget(left)
        splitter.addWidget(right)
        splitter.setStretchFactor(1, 1)
        root.addWidget(splitter)

        # Status bar
        self.status = QStatusBar()
        self.setStatusBar(self.status)
        self.status.showMessage("Ready")

    # ------------------------------------------------------------------
    def _load_existing_clips(self):
        clips = load_clip_index()
        if clips:
            self.clip_list.populate(clips)
            self.status.showMessage(f"Loaded {len(clips)} saved clips.")

    @pyqtSlot()
    def _poll_new_clips(self):
        updated = False
        while True:
            try:
                meta = self._meta_queue.get_nowait()
                self.clip_list.add_clip(meta)
                self.status.showMessage(
                    f"New clip saved: {Path(meta.path).name}  "
                    f"({meta.duration_seconds:.1f}s)"
                )
                updated = True
            except queue.Empty:
                break

    # ------------------------------------------------------------------
    def _on_clip_selected(self, current: Optional[QListWidgetItem], _prev):
        if current is None:
            return
        meta: ClipMeta = current.data(Qt.ItemDataRole.UserRole)
        self._load_clip(meta)

    def _load_clip(self, meta: ClipMeta):
        self._playing = False
        self._play_timer.stop()
        self.controls.set_playing(False)

        mp4 = Path(meta.path)
        if not mp4.exists():
            self.status.showMessage(f"File not found: {mp4}")
            return

        # Load all frames into memory for smooth scrubbing
        self.status.showMessage(f"Loading {mp4.name}…")
        QApplication.processEvents()

        cap = cv2.VideoCapture(str(mp4))
        frames = []
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            frames.append(frame)
        cap.release()

        if not frames:
            self.status.showMessage("Could not read clip frames.")
            return

        self._frames  = frames
        self._scores  = [None] * len(frames)  # scores not stored per-frame in MP4
        self._current_meta = meta
        self._current_idx  = 0

        self.controls.set_frame_range(len(frames))
        self._show_frame(0)
        self.status.showMessage(
            f"{mp4.name}  •  {len(frames)} frames  •  {meta.duration_seconds:.1f}s"
        )

    def _show_frame(self, idx: int):
        if not self._frames:
            return
        idx = max(0, min(idx, len(self._frames) - 1))
        self._current_idx = idx
        self.video.display_frame(self._frames[idx])

        fps = len(self._frames) / max(self._current_meta.duration_seconds, 0.001) \
            if self._current_meta else 15.0
        elapsed  = idx / fps
        duration = self._current_meta.duration_seconds if self._current_meta else 0.0
        self.controls.set_position(idx, len(self._frames), elapsed, duration,
                                   self._scores[idx])

    # ------------------------------------------------------------------
    @pyqtSlot()
    def _toggle_play(self):
        if not self._frames:
            return
        self._playing = not self._playing
        self.controls.set_playing(self._playing)
        if self._playing:
            # Restart from beginning if at last frame
            if self._current_idx >= len(self._frames) - 1:
                self._current_idx = 0
            self._play_timer.start()
        else:
            self._play_timer.stop()

    @pyqtSlot()
    def _on_play_tick(self):
        next_idx = self._current_idx + 1
        if next_idx >= len(self._frames):
            self._playing = False
            self._play_timer.stop()
            self.controls.set_playing(False)
            return
        self._show_frame(next_idx)

    @pyqtSlot()
    def _step_back(self):
        self._playing = False
        self._play_timer.stop()
        self.controls.set_playing(False)
        self._show_frame(self._current_idx - 1)

    @pyqtSlot()
    def _step_fwd(self):
        self._playing = False
        self._play_timer.stop()
        self.controls.set_playing(False)
        self._show_frame(self._current_idx + 1)

    @pyqtSlot(int)
    def _on_scrub(self, value: int):
        self._playing = False
        self._play_timer.stop()
        self.controls.set_playing(False)
        self._show_frame(value)

    # ------------------------------------------------------------------
    def set_status(self, msg: str):
        self.status.showMessage(msg)

    def closeEvent(self, event):
        self._play_timer.stop()
        self._poll_timer.stop()
        super().closeEvent(event)
