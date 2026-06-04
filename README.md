# Ring Guardian

Connects to your Ring doorbell's live stream, detects motion, and saves motion events as timestamped MP4 clips. A PyQt6 GUI lets you browse, play, scrub, and delete clips — including a live camera view.

No Ring Protect subscription required.

---

## Requirements

| Tool | Min version | Install |
|------|-------------|---------|
| Python | 3.13 | https://python.org or `brew install python` |
| uv | any | `brew install uv` or `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Node.js | 18 | https://nodejs.org or `brew install node` |
| ffmpeg | any recent | `brew install ffmpeg` |
| Rust | stable (optional) | https://rustup.rs — only needed for the faster motion backend |

---

## Installation

```bash
git clone https://github.com/j0el/ring_doorbell.git
cd ring_doorbell

# Node.js bridge dependencies
npm install

# Python dependencies (uv creates the venv automatically)
uv sync
```

---

## Authentication

Ring uses OAuth refresh tokens. You generate one once; Ring Guardian saves and auto-renews it in `ring_token.json`.

### First-time setup

```bash
npx ring-auth-cli
```

Follow the prompts — enter your Ring email, password, and 2FA code if prompted. The CLI prints a refresh token:

```
Refresh Token: eyJy...
```

Save it to `ring_token.json` in the project directory:

```bash
echo '{"refreshToken": "eyJy...your token here..."}' > ring_token.json
```

> **Important:** `ring_token.json` is in `.gitignore` and should never be committed. It contains credentials that grant full access to your Ring account.

### Token renewal

Ring tokens expire after roughly 60 days of inactivity, or immediately if Ring detects suspicious use. If you see:

```
[bridge] No refresh token found.
```
or an authentication error on startup, regenerate:

```bash
npx ring-auth-cli
# Then save the new token:
echo '{"refreshToken": "eyJy...new token..."}' > ring_token.json
```

Ring Guardian also auto-renews the token during a session and writes the updated value to `ring_token.json` automatically.

---

## Usage

### List your cameras

```bash
uv run python main.py --list
```

### Start capture + GUI

```bash
uv run python main.py --camera "Front Door"
```

### Browse saved clips without capturing

```bash
uv run python main.py --gui-only
```

---

## GUI features

| Feature | How |
|---------|-----|
| Play / pause clip | Click ▶ or click the clip |
| Scrub | Drag the timeline slider |
| Step frame | ◀◀ / ▶▶ buttons |
| Select multiple clips | Shift+click or Cmd+click |
| Delete selected | Click 🗑 Delete (no confirmation) |
| Undo last delete | Click ↩ Undo — files go to `clips/.trash/` and are fully restored on undo |
| Live camera feed | Check **Show Live Video** (visible only during active capture) |
| Shutdown | Click **⏻ Shutdown** to stop all capture threads and close |

---

## CLI flags

```
uv run python main.py --camera "Front Door" [options]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--width` | 1280 | Capture frame width |
| `--height` | 720 | Capture frame height |
| `--fps` | 15 | Frames per second |
| `--threshold` | 0.005 | Total motion pixel fraction to trigger detection (0–1) |
| `--min-blob` | 0.005 | Minimum contiguous moving region as fraction of frame — filters reflections and small flickers |
| `--min-frames` | 3 | Consecutive motion frames required before a clip starts — filters single-frame flashes |
| `--pre-roll` | 15 | Frames captured before motion starts |
| `--post-roll` | 3.0 | Seconds of quiet before a clip is closed |
| `--output-fps` | 15.0 | FPS written to saved MP4 |
| `--node` | `node` | Path to the `node` binary if not in PATH |

### Tuning motion sensitivity

Too many false positives (reflections, passing headlights, shadows):

```bash
uv run python main.py --camera "Front Door" --min-blob 0.01 --min-frames 5
```

Missing real events:

```bash
uv run python main.py --camera "Front Door" --threshold 0.003 --min-blob 0.002 --min-frames 2
```

---

## Optional: Rust motion backend

The default backend uses OpenCV (pure Python). A Rust backend is included that runs at ~200 fps on a single core — well ahead of any camera feed and with lower CPU usage.

```bash
cd motion_core
cargo build --release
```

The binary lands at `motion_core/target/release/motion_core`. Ring Guardian auto-detects it on the next run.

---

## File layout

```
ring_doorbell/
├── main.py               Entry point and CLI
├── ring_bridge.js        Node.js: authenticates with Ring, streams raw BGR24 frames to stdout
├── ring_capture.py       Spawns bridge subprocess, reads frames into Python
├── motion.py             Motion detection (Rust or OpenCV MOG2 fallback)
├── recorder.py           Writes MP4 clips to clips/ with timestamp overlay
├── gui.py                PyQt6 GUI: clip browser, player, live view
├── package.json          Node.js dependencies (ring-client-api)
├── pyproject.toml        Python dependencies
├── motion_core/          Optional Rust motion detector
│   ├── Cargo.toml
│   └── src/main.rs
└── clips/                Saved clips and thumbnails (git-ignored)
    ├── index.json        Clip metadata index
    └── .trash/           Clips pending undo-delete
```

`ring_token.json` is created at the project root after authentication. It is git-ignored — never commit it.
