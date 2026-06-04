//! motion_core — high-speed per-frame motion detection for ring_guardian
//!
//! ## Protocol (stdin → stdout)
//!
//! ### Init (first message, JSON line):
//! ```json
//! {"cmd":"init","width":1280,"height":720,"threshold":0.005,"history":50}
//! ```
//!
//! ### Per-frame (binary):
//!   - 8 bytes little-endian header: [frame_idx: u32, _reserved: u32]
//!   - width * height * 3 bytes: raw BGR24 pixel data
//!
//! ### Per-frame response (JSON line to stdout):
//! ```json
//! {"frame":0,"has_motion":false,"score":0.0012,"changed_px":1966}
//! ```
//!
//! ### Shutdown:
//! Close stdin.  The process exits cleanly.
//!
//! ## Algorithm
//!
//! Mixture-of-Gaussians-lite background model:
//!  - Maintain a running per-pixel mean (grayscale) with exponential decay.
//!  - A pixel is "foreground" if |current - mean| > threshold_px.
//!  - Apply 3×3 morphological erosion to remove single-pixel noise.
//!  - Motion score = foreground_pixels / total_pixels.
//!  - Adapt mean toward current value at rate `alpha` (faster when no motion).

use std::io::{self, BufRead, Read, Write};

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct InitCmd {
    width:     u32,
    height:    u32,
    /// Fraction of changed pixels required to declare motion (default 0.005)
    #[serde(default = "default_threshold")]
    threshold: f32,
    /// Adaptation history length in frames (higher = slower background update)
    #[serde(default = "default_history")]
    history:   u32,
}

fn default_threshold() -> f32 { 0.005 }
fn default_history()   -> u32 { 50 }

#[derive(Serialize)]
struct FrameResult {
    frame:      u64,
    has_motion: bool,
    score:      f32,
    changed_px: u32,
}

// ---------------------------------------------------------------------------
// Background model
// ---------------------------------------------------------------------------

struct BackgroundModel {
    width:      usize,
    height:     usize,
    threshold:  f32,
    /// Exponential moving average alpha = 1 / history
    alpha:      f32,
    /// Per-pixel background mean (grayscale, f32)
    mean:       Vec<f32>,
    /// Scratch buffer for foreground mask after erosion
    fg:         Vec<bool>,
    initialized: bool,
}

impl BackgroundModel {
    fn new(width: usize, height: usize, threshold: f32, history: u32) -> Self {
        let n = width * height;
        Self {
            width,
            height,
            threshold,
            alpha: 1.0 / (history as f32),
            mean: vec![128.0f32; n],
            fg:   vec![false; n],
            initialized: false,
        }
    }

    /// Process a BGR24 frame, return (has_motion, score, changed_pixel_count)
    fn process(&mut self, bgr: &[u8]) -> (bool, f32, u32) {
        let n = self.width * self.height;
        debug_assert_eq!(bgr.len(), n * 3);

        // Convert BGR → grayscale (luminosity approximation)
        // Y ≈ 0.114*B + 0.587*G + 0.299*R  (BGR order)
        let gray: Vec<f32> = bgr.chunks_exact(3).map(|px| {
            0.114 * px[0] as f32 + 0.587 * px[1] as f32 + 0.299 * px[2] as f32
        }).collect();

        if !self.initialized {
            self.mean.copy_from_slice(&gray);
            self.initialized = true;
            return (false, 0.0, 0);
        }

        // Threshold: pixels that differ from background
        // Use a fixed per-pixel threshold of 25 grey levels (out of 255).
        let px_threshold = 25.0_f32;

        // Raw foreground detection
        let raw_fg: Vec<bool> = gray.iter().zip(self.mean.iter()).map(|(g, m)| {
            (g - m).abs() > px_threshold
        }).collect();

        // 3×3 erosion to remove noise (a pixel is fg only if ≥5 of its 9
        // neighbours are also fg)
        let w = self.width;
        let h = self.height;
        for y in 0..h {
            for x in 0..w {
                let idx = y * w + x;
                if !raw_fg[idx] {
                    self.fg[idx] = false;
                    continue;
                }
                let mut neighbours = 0u32;
                for dy in -1i32..=1 {
                    for dx in -1i32..=1 {
                        let ny = y as i32 + dy;
                        let nx = x as i32 + dx;
                        if ny >= 0 && ny < h as i32 && nx >= 0 && nx < w as i32 {
                            if raw_fg[(ny as usize) * w + nx as usize] {
                                neighbours += 1;
                            }
                        }
                    }
                }
                self.fg[idx] = neighbours >= 5;
            }
        }

        let changed = self.fg.iter().filter(|&&b| b).count() as u32;
        let score   = changed as f32 / n as f32;
        let motion  = score >= self.threshold;

        // Update background mean (slower adaptation during motion)
        let adapt = if motion { self.alpha * 0.1 } else { self.alpha };
        for i in 0..n {
            self.mean[i] += adapt * (gray[i] - self.mean[i]);
        }

        (motion, score, changed)
    }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

fn main() -> io::Result<()> {
    let stdin  = io::stdin();
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());

    // Read init JSON line from stdin
    let mut lines = stdin.lock().lines();
    let init_line = lines.next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "no init"))??;

    let init: InitCmd = serde_json::from_str(&init_line)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    let width  = init.width  as usize;
    let height = init.height as usize;
    let frame_bytes = width * height * 3;

    let mut model = BackgroundModel::new(width, height, init.threshold, init.history);

    // Switch stdin back to raw binary
    drop(lines);
    let mut raw_stdin = io::stdin();

    let mut header_buf = [0u8; 8];
    let mut frame_buf  = vec![0u8; frame_bytes];
    let mut frame_idx  = 0u64;

    loop {
        // Read 8-byte frame header
        match raw_stdin.read_exact(&mut header_buf) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e),
        }

        // Read BGR24 frame data
        match raw_stdin.read_exact(&mut frame_buf) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e),
        }

        let (has_motion, score, changed_px) = model.process(&frame_buf);

        let result = FrameResult { frame: frame_idx, has_motion, score, changed_px };
        let mut json = serde_json::to_string(&result).unwrap();
        json.push('\n');
        out.write_all(json.as_bytes())?;
        out.flush()?;

        frame_idx += 1;
    }

    Ok(())
}
