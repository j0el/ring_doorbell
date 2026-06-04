"""
ring_auth.py
In-app Ring authentication dialog.

Spawns ring_bridge.js in --auth mode, handles the email/password → optional
2FA flow, and saves the refresh token to ring_token.json.

Usage:
    from ring_auth import run_auth_dialog
    if not run_auth_dialog(node_bin="node"):
        sys.exit("Authentication cancelled.")
"""

from __future__ import annotations

import logging
import subprocess
import threading
from pathlib import Path

from PyQt6.QtCore import Qt, QThread, pyqtSignal, pyqtSlot
from PyQt6.QtGui import QFont
from PyQt6.QtWidgets import (
    QApplication, QDialog, QHBoxLayout, QLabel, QLineEdit,
    QPushButton, QSizePolicy, QVBoxLayout, QWidget,
)

logger = logging.getLogger(__name__)

BRIDGE_SCRIPT = Path(__file__).parent / "ring_bridge.js"


# ---------------------------------------------------------------------------
# Worker thread — runs the bridge subprocess and parses its stderr
# ---------------------------------------------------------------------------

class _AuthWorker(QThread):
    """
    Signals emitted on the Qt main thread:
        need_2fa(prompt: str)   — bridge is waiting for a 2FA code on stdin
        auth_ok()               — authentication succeeded, token saved
        auth_error(msg: str)    — authentication failed
    """
    need_2fa   = pyqtSignal(str)
    auth_ok    = pyqtSignal()
    auth_error = pyqtSignal(str)

    def __init__(self, email: str, password: str, node_bin: str = "node"):
        super().__init__()
        self._email    = email
        self._password = password
        self._node_bin = node_bin
        self._proc: subprocess.Popen | None = None

    def send_2fa(self, code: str):
        """Called from the GUI thread after the user enters their 2FA code."""
        if self._proc and self._proc.stdin:
            try:
                self._proc.stdin.write((code.strip() + "\n").encode())
                self._proc.stdin.flush()
            except Exception as exc:
                logger.warning("Could not send 2FA code: %s", exc)

    def stop(self):
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()

    def run(self):
        cmd = [
            self._node_bin,
            str(BRIDGE_SCRIPT),
            "--auth",
            "--email",    self._email,
            "--password", self._password,
        ]
        try:
            self._proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stderr=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
            )
        except FileNotFoundError:
            self.auth_error.emit("node not found — is Node.js installed?")
            return

        assert self._proc.stderr is not None
        for raw in self._proc.stderr:
            line = raw.decode("utf-8", errors="replace").rstrip()
            logger.debug("[auth] %s", line)

            if line.startswith("RING_AUTH_OK"):
                self.auth_ok.emit()
                return
            elif line.startswith("RING_NEED_2FA:"):
                prompt = line.split(":", 1)[1].strip()
                self.need_2fa.emit(prompt)
                # Keep reading — next RING_AUTH_OK or RING_AUTH_ERROR will follow
            elif line.startswith("RING_AUTH_ERROR:"):
                msg = line.split(":", 1)[1].strip()
                self.auth_error.emit(msg)
                return

        # Process ended without a recognised terminal message
        rc = self._proc.wait()
        if rc != 0:
            self.auth_error.emit(f"Bridge exited with code {rc}.")


# ---------------------------------------------------------------------------
# Dialog
# ---------------------------------------------------------------------------

class RingAuthDialog(QDialog):
    """
    Modal dialog that walks the user through Ring authentication.
    Accepted (QDialog.DialogCode.Accepted) when a token is successfully saved.
    """

    def __init__(self, node_bin: str = "node", parent=None):
        super().__init__(parent)
        self._node_bin = node_bin
        self._worker: _AuthWorker | None = None

        self.setWindowTitle("Sign in to Ring")
        self.setMinimumWidth(400)
        self.setModal(True)
        self._build_ui()

    # ------------------------------------------------------------------
    def _build_ui(self):
        layout = QVBoxLayout(self)
        layout.setSpacing(12)
        layout.setContentsMargins(24, 24, 24, 24)

        # Title
        title = QLabel("Sign in to Ring")
        title.setFont(QFont("", 16, QFont.Weight.Bold))
        title.setStyleSheet("color: #eee;")
        layout.addWidget(title)

        subtitle = QLabel(
            "Your credentials are sent directly to Ring's servers.\n"
            "Ring Guardian never stores your password."
        )
        subtitle.setStyleSheet("color: #888; font-size: 11px;")
        subtitle.setWordWrap(True)
        layout.addWidget(subtitle)

        layout.addSpacing(4)

        # Email
        layout.addWidget(self._label("Email"))
        self.fld_email = QLineEdit()
        self.fld_email.setPlaceholderText("you@example.com")
        self._style_field(self.fld_email)
        layout.addWidget(self.fld_email)

        # Password
        layout.addWidget(self._label("Password"))
        self.fld_password = QLineEdit()
        self.fld_password.setPlaceholderText("••••••••")
        self.fld_password.setEchoMode(QLineEdit.EchoMode.Password)
        self._style_field(self.fld_password)
        layout.addWidget(self.fld_password)

        # 2FA section (hidden until needed)
        self._2fa_label = self._label("2FA code")
        self._2fa_label.hide()
        layout.addWidget(self._2fa_label)

        self.fld_2fa = QLineEdit()
        self.fld_2fa.setPlaceholderText("6-digit code")
        self.fld_2fa.setMaxLength(8)
        self._style_field(self.fld_2fa)
        self.fld_2fa.hide()
        layout.addWidget(self.fld_2fa)

        # Status label
        self.lbl_status = QLabel("")
        self.lbl_status.setStyleSheet("color: #ff6b6b; font-size: 12px;")
        self.lbl_status.setWordWrap(True)
        self.lbl_status.hide()
        layout.addWidget(self.lbl_status)

        layout.addSpacing(4)

        # Buttons
        btn_row = QHBoxLayout()
        self.btn_cancel = QPushButton("Cancel")
        self.btn_cancel.setStyleSheet("color: #aaa; padding: 6px 16px;")
        self.btn_cancel.clicked.connect(self.reject)

        self.btn_signin = QPushButton("Sign In")
        self.btn_signin.setDefault(True)
        self.btn_signin.setStyleSheet(
            "QPushButton { background: #2a5298; color: white; padding: 6px 20px; "
            "border-radius: 4px; font-weight: bold; }"
            "QPushButton:hover { background: #3a63b0; }"
            "QPushButton:disabled { background: #333; color: #666; }"
        )
        self.btn_signin.clicked.connect(self._on_sign_in)

        btn_row.addStretch()
        btn_row.addWidget(self.btn_cancel)
        btn_row.addWidget(self.btn_signin)
        layout.addLayout(btn_row)

        self.fld_email.returnPressed.connect(self.fld_password.setFocus)
        self.fld_password.returnPressed.connect(self._on_sign_in)
        self.fld_2fa.returnPressed.connect(self._on_submit_2fa)

    @staticmethod
    def _label(text: str) -> QLabel:
        lbl = QLabel(text)
        lbl.setStyleSheet("color: #bbb; font-size: 12px;")
        return lbl

    @staticmethod
    def _style_field(field: QLineEdit):
        field.setStyleSheet(
            "QLineEdit { background: #222; color: #eee; border: 1px solid #555; "
            "border-radius: 4px; padding: 6px 8px; font-size: 13px; }"
            "QLineEdit:focus { border-color: #4a82d8; }"
        )

    # ------------------------------------------------------------------
    @pyqtSlot()
    def _on_sign_in(self):
        email    = self.fld_email.text().strip()
        password = self.fld_password.text()

        if not email or not password:
            self._show_status("Please enter your email and password.")
            return

        self._set_busy(True)
        self._hide_2fa()
        self._hide_status()

        self._worker = _AuthWorker(email, password, self._node_bin)
        self._worker.need_2fa.connect(self._on_need_2fa)
        self._worker.auth_ok.connect(self._on_auth_ok)
        self._worker.auth_error.connect(self._on_auth_error)
        self._worker.start()

    @pyqtSlot()
    def _on_submit_2fa(self):
        code = self.fld_2fa.text().strip()
        if not code:
            self._show_status("Please enter the 2FA code.")
            return
        if self._worker:
            self._set_busy(True)
            self._hide_status()
            self._worker.send_2fa(code)

    @pyqtSlot(str)
    def _on_need_2fa(self, prompt: str):
        self._set_busy(False)
        self._show_2fa(prompt)

    @pyqtSlot()
    def _on_auth_ok(self):
        self._set_busy(False)
        self.accept()

    @pyqtSlot(str)
    def _on_auth_error(self, msg: str):
        self._set_busy(False)
        self._show_status(msg)

    # ------------------------------------------------------------------
    def _set_busy(self, busy: bool):
        self.btn_signin.setEnabled(not busy)
        self.btn_cancel.setEnabled(not busy)
        self.fld_email.setEnabled(not busy)
        self.fld_password.setEnabled(not busy)
        self.fld_2fa.setEnabled(not busy)
        self.btn_signin.setText("Signing in…" if busy else "Sign In")

    def _show_2fa(self, prompt: str):
        self._2fa_label.setText(f"2FA code  —  {prompt}")
        self._2fa_label.show()
        self.fld_2fa.clear()
        self.fld_2fa.show()
        self.fld_2fa.setFocus()
        self.btn_signin.setText("Verify")
        self.btn_signin.clicked.disconnect()
        self.btn_signin.clicked.connect(self._on_submit_2fa)
        self.adjustSize()

    def _hide_2fa(self):
        self._2fa_label.hide()
        self.fld_2fa.hide()

    def _show_status(self, msg: str):
        self.lbl_status.setText(msg)
        self.lbl_status.show()

    def _hide_status(self):
        self.lbl_status.hide()

    def closeEvent(self, event):
        if self._worker:
            self._worker.stop()
        super().closeEvent(event)


# ---------------------------------------------------------------------------
# Convenience entry point
# ---------------------------------------------------------------------------

def run_auth_dialog(node_bin: str = "node") -> bool:
    """
    Show the auth dialog in the current QApplication.
    Returns True if the user successfully authenticated, False if cancelled.
    Must be called from the Qt main thread with a QApplication already running.
    """
    dlg = RingAuthDialog(node_bin=node_bin)
    return dlg.exec() == QDialog.DialogCode.Accepted
