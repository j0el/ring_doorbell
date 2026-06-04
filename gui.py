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
import shutil
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np
from PyQt6.QtCore import (
    QSize, Qt, QTimer, pyqtSignal, pyqtSlot
)
from PyQt6.QtGui import (
    QColor, QFont, QIcon, QImage, QPainter, QPixmap
)
from PyQt6.QtWidgets import (
    QApplication, QCheckBox, QFrame, QHBoxLayout, QLabel, QListWidget,
    QListWidgetItem, QMainWindow, QPushButton, QSizePolicy,
    QSlider, QSplitter, QStatusBar, QVBoxLayout, QWidget,
)

from recorder import ClipMeta, load_clip_index, CLIPS_DIR

logger = logging.getLogger(__name__)

THUMBNAIL_SIZE = QSize(160, 90)
PLAYBACK_TIMER_MS = 33   # ~30 fps display rate
TRASH_DIR = CLIPS_DIR / ".trash"


# ---------------------------------------------------------------------------
# Undo state
# ---------------------------------------------------------------------------

@dataclass
class _DeletedBatch:
    """Holds one batch of deleted clips so they can be restored."""
    # (meta, path_in_trash_for_mp4, path_in_trash_for_thumb)
    items: List[Tuple[ClipMeta, Path, Path]] = field(default_factory=list)
    # index entries that were removed, for re-insertion
    index_entries: List[dict] = field(default_factory=list)


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
    """Left-panel list of motion clips with thumbnails. Supports multi-select."""

    def __init__(self):
        super().__init__()
        self.setIconSize(THUMBNAIL_SIZE)
        self.setSpacing(4)
        self.setSelectionMode(QListWidget.SelectionMode.ExtendedSelection)
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

    def __init__(self, meta_queue: "queue.Queue[ClipMeta]",
                 live_queue: "Optional[queue.Queue]" = None,
                 on_shutdown=None):
        super().__init__()
        self._meta_queue = meta_queue
        self._live_queue = live_queue
        self._frames: List[np.ndarray] = []
        self._scores: List[Optional[float]] = []
        self._current_idx = 0
        self._playing = False
        self._cap: Optional[cv2.VideoCapture] = None
        self._current_meta: Optional[ClipMeta] = None
        self._undo_batch: Optional[_DeletedBatch] = None   # last deleted batch
        self._live_active = False
        self._on_shutdown = on_shutdown  # optional callable — stops pipeline threads

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

        # Timer: pull frames for live display
        self._live_timer = QTimer(self)
        self._live_timer.setInterval(PLAYBACK_TIMER_MS)
        self._live_timer.timeout.connect(self._on_live_tick)

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
        self.clip_list.itemSelectionChanged.connect(self._on_selection_changed)
        lv.addWidget(self.clip_list)

        # Action buttons row below the list
        btn_row = QHBoxLayout()
        btn_row.setSpacing(4)

        self.btn_undo = QPushButton("↩ Undo")
        self.btn_undo.setEnabled(False)
        self.btn_undo.setToolTip("Restore last deleted clips")
        self.btn_undo.setStyleSheet(
            "QPushButton { color: #aaa; padding: 6px; }"
            "QPushButton:disabled { color: #444; }"
        )
        self.btn_undo.clicked.connect(self._undo_delete)

        self.btn_delete = QPushButton("🗑 Delete")
        self.btn_delete.setEnabled(False)
        self.btn_delete.setStyleSheet(
            "QPushButton { color: #ff6b6b; padding: 6px; }"
            "QPushButton:disabled { color: #555; }"
        )
        self.btn_delete.clicked.connect(self._delete_selected_clips)

        btn_row.addWidget(self.btn_undo)
        btn_row.addWidget(self.btn_delete)
        lv.addLayout(btn_row)

        left.setMinimumWidth(220)
        left.setMaximumWidth(340)

        # Right: video + controls
        right = QWidget()
        rv = QVBoxLayout(right)
        rv.setContentsMargins(4, 4, 4, 4)
        rv.setSpacing(4)

        # Top control bar: live checkbox + shutdown button side by side
        top_bar = QHBoxLayout()
        top_bar.setContentsMargins(0, 0, 0, 0)
        top_bar.setSpacing(8)

        self.chk_live = QCheckBox("  Show Live Video")
        self.chk_live.setStyleSheet(
            "QCheckBox {"
            "  color: #ddd;"
            "  padding: 4px 10px;"
            "  border: 1px solid white;"
            "  border-radius: 4px;"
            "}"
            "QCheckBox::indicator { width: 14px; height: 14px; }"
        )
        self.chk_live.setVisible(self._live_queue is not None)
        self.chk_live.setChecked(self._live_queue is not None)
        self.chk_live.toggled.connect(self._on_live_toggled)

        btn_shutdown = QPushButton("⏻  Shutdown")
        btn_shutdown.setStyleSheet(
            "QPushButton {"
            "  color: #ff9944;"
            "  padding: 4px 12px;"
            "  border: 1px solid #ff9944;"
            "  border-radius: 4px;"
            "}"
            "QPushButton:hover { color: #ffbb66; border-color: #ffbb66; }"
        )
        btn_shutdown.clicked.connect(self._shutdown)

        top_bar.addWidget(self.chk_live)
        top_bar.addWidget(btn_shutdown)
        top_bar.addStretch()
        rv.addLayout(top_bar)

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
        while True:
            try:
                meta = self._meta_queue.get_nowait()
                self.clip_list.add_clip(meta)
                self.status.showMessage(
                    f"New clip saved: {Path(meta.path).name}  "
                    f"({meta.duration_seconds:.1f}s)"
                )
            except queue.Empty:
                break

    # ------------------------------------------------------------------
    @pyqtSlot()
    def _on_selection_changed(self):
        n = len(self.clip_list.selectedItems())
        if n == 0:
            self.btn_delete.setEnabled(False)
            self.btn_delete.setText("🗑 Delete")
        elif n == 1:
            self.btn_delete.setEnabled(True)
            self.btn_delete.setText("🗑 Delete")
        else:
            self.btn_delete.setEnabled(True)
            self.btn_delete.setText(f"🗑 Delete {n}")

    def _on_clip_selected(self, current: Optional[QListWidgetItem], _prev):
        if current is None:
            return
        meta: ClipMeta = current.data(Qt.ItemDataRole.UserRole)
        self._load_clip(meta)

    # ------------------------------------------------------------------
    @pyqtSlot()
    def _delete_selected_clips(self):
        selected = self.clip_list.selectedItems()
        if not selected:
            return

        TRASH_DIR.mkdir(parents=True, exist_ok=True)
        batch = _DeletedBatch()

        from recorder import _load_index, _save_index
        from dataclasses import asdict
        all_entries = _load_index()
        deleted_paths = set()

        for item in selected:
            meta: ClipMeta = item.data(Qt.ItemDataRole.UserRole)
            deleted_paths.add(meta.path)

            # Move MP4 and thumbnail to trash (keeps them for undo)
            trash_mp4   = self._move_to_trash(meta.path)
            trash_thumb = self._move_to_trash(meta.thumbnail_path)
            batch.items.append((meta, trash_mp4, trash_thumb))

            # Remove from list widget
            self.clip_list.takeItem(self.clip_list.row(item))

            # Clear player if this clip was loaded
            if self._current_meta and self._current_meta.path == meta.path:
                self._playing = False
                self._play_timer.stop()
                self._frames = []
                self._current_meta = None
                self.video._show_placeholder()
                self.controls.set_frame_range(0)

        # Save removed index entries for undo, then update index
        batch.index_entries = [e for e in all_entries if e.get("path") in deleted_paths]
        new_entries = [e for e in all_entries if e.get("path") not in deleted_paths]
        _save_index(new_entries)

        self._undo_batch = batch
        self.btn_undo.setEnabled(True)

        n = len(selected)
        self.status.showMessage(
            f"Deleted {n} clip{'s' if n > 1 else ''} — click ↩ Undo to restore"
        )

    @staticmethod
    def _move_to_trash(fpath: str) -> Path:
        """Move a file into TRASH_DIR. Returns the trash path (may be original if missing)."""
        src = Path(fpath)
        if not src.exists():
            return src
        dst = TRASH_DIR / src.name
        # Avoid collisions in trash
        if dst.exists():
            dst = TRASH_DIR / f"{src.stem}__{src.stat().st_mtime_ns}{src.suffix}"
        try:
            shutil.move(str(src), dst)
        except Exception as exc:
            logger.warning("Could not move %s to trash: %s", src, exc)
            return src
        return dst

    @pyqtSlot()
    def _undo_delete(self):
        batch = self._undo_batch
        if not batch:
            return

        from recorder import _load_index, _save_index
        restored_metas: List[ClipMeta] = []

        for meta, trash_mp4, trash_thumb in batch.items:
            # Restore MP4
            self._restore_from_trash(trash_mp4, meta.path)
            # Restore thumbnail
            self._restore_from_trash(trash_thumb, meta.thumbnail_path)
            restored_metas.append(meta)

        # Re-insert into index (merge back and re-sort by started_at descending)
        existing = _load_index()
        existing_paths = {e.get("path") for e in existing}
        from dataclasses import asdict
        for entry in batch.index_entries:
            if entry.get("path") not in existing_paths:
                existing.append(entry)
        existing.sort(key=lambda e: e.get("started_at", ""), reverse=True)
        _save_index(existing)

        # Reload the full list so order is correct
        self._load_existing_clips()

        self._undo_batch = None
        self.btn_undo.setEnabled(False)
        n = len(restored_metas)
        self.status.showMessage(f"Restored {n} clip{'s' if n > 1 else ''}")

    @staticmethod
    def _restore_from_trash(trash_path: Path, original_path: str):
        dst = Path(original_path)
        if not trash_path.exists() or trash_path == dst:
            return
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(trash_path), dst)
        except Exception as exc:
            logger.warning("Could not restore %s: %s", trash_path, exc)

    # ------------------------------------------------------------------
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
    @pyqtSlot(bool)
    def _on_live_toggled(self, checked: bool):
        self._live_active = checked
        if checked:
            # Stop clip playback and clear the display before going live
            self._playing = False
            self._play_timer.stop()
            self.controls.set_playing(False)
            self._frames = []
            self._current_meta = None
            self.clip_list.clearSelection()
            self._live_timer.start()
        else:
            self._live_timer.stop()
            self.video._show_placeholder()

    @pyqtSlot()
    def _on_live_tick(self):
        if self._live_queue is None:
            return
        frame = None
        # Drain queue, keep only the most recent frame
        while True:
            try:
                frame = self._live_queue.get_nowait()
            except queue.Empty:
                break
        if frame is not None:
            self.video.display_frame(frame.image)

    # ------------------------------------------------------------------
    @pyqtSlot()
    def _shutdown(self):
        self.status.showMessage("Shutting down…")
        QApplication.processEvents()
        if self._on_shutdown:
            self._on_shutdown()
        self.close()

    def set_status(self, msg: str):
        self.status.showMessage(msg)

    def closeEvent(self, event):
        self._play_timer.stop()
        self._poll_timer.stop()
        self._live_timer.stop()
        super().closeEvent(event)
