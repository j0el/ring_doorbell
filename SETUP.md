# Ring Guardian — Setup Guide

## What it does

Connects to your Ring doorbell's **live stream**, discards frames with no
motion, and saves motion events as timestamped MP4 clips.  A PyQt6 GUI lets
you browse, play, and scrub through every saved clip.

No Ring Protect subscription required.

---

## Requirements

| Tool | Version | Install |
|------|---------|---------|
| Python | ≥ 3.10 | https://python.org |
| Node.js | ≥ 18 | https://nodejs.org |
| ffmpeg | any recent | `brew install ffmpeg` / `apt install ffmpeg` |
| Rust (optional, for fast motion detection) | stable | https://rustup.rs |

---

## 1 — Install Python deps

```bash
cd ring_guardian
pip install -r requirements.txt
```

## 2 — Install Node.js deps

```bash
npm install
```

## 3 — Authenticate with Ring (first run only)

```bash
RING_USERNAME=you@example.com RING_PASSWORD=yourpassword python main.py --camera "Front Door"
```

If you have 2FA enabled, also set `RING_OTP=123456`.

A `ring_token.json` file is saved — subsequent runs use it automatically.

## 4 — List your cameras

```bash
python main.py --list
```

## 5 — Run

```bash
python main.py --camera "Front Door"
```

The GUI opens immediately.  Clips appear in the left panel as they are saved.

### Optional flags

| Flag | Default | Description |
|------|---------|-------------|
| `--width` | 1280 | Output frame width |
| `--height` | 720 | Output frame height |
| `--fps` | 15 | Frames per second |
| `--threshold` | 0.005 | Motion sensitivity (fraction of changed pixels) |
| `--pre-roll` | 15 | Frames captured before motion starts |
| `--post-roll` | 3.0 | Seconds of quiet before clip is closed |
| `--gui-only` | — | Browse saved clips without starting capture |

---

## Optional: build the Rust motion detector (faster, lower CPU)

```bash
cd motion_core
cargo build --release
```

The binary is placed at `motion_core/target/release/motion_core`.
Python auto-detects it on the next run.

The Rust back-end uses a lightweight background model with 3×3 morphological
erosion to remove noise.  At 1280×720 it processes ~200 fps on a single core,
well ahead of any real camera feed.

---

## File layout

```
ring_guardian/
├── ring_bridge.js        Node.js: Ring SIP → ffmpeg → raw BGR24 frames on stdout
├── package.json          Node deps
├── ring_capture.py       Reads frames from bridge subprocess
├── motion.py             Motion detection (Rust or OpenCV fallback)
├── recorder.py           Saves clips to clips/YYYY-MM-DD_HH-MM-SS.mp4
├── gui.py                PyQt6 player with scrub bar
├── main.py               Entry point / orchestrator
├── requirements.txt      Python deps
└── motion_core/          Rust crate
    ├── Cargo.toml
    └── src/main.rs
```

Clips and thumbnails are saved under `clips/`.
The clip index lives at `clips/index.json`.
