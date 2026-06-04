//! motion_core — high-speed per-frame motion detection for ring_guardian
//!
//! ## Protocol (stdin → stdout)
//!
//! ### Init (first message, JSON line):
//! ```json
//! {"cmd":"init","width":1280,"height":720,"threshold":0.005,"history":50,"min_blob_fraction":0.01}
//! ```
//!
//! ### Per-frame (binary):
//!   - 8 bytes little-endian header: [frame_idx: u32, _reserved: u32]
//!   - width * height * 3 bytes: raw BGR24 pixel data
//!
//! ### Per-frame response (JSON line to stdout):
//! ```json
//! {"frame":0,"has_motion":false,"score":0.0012,"changed_px":1966,"largest_blob_px":0}
//! ```
//!
//! ### Shutdown:
//! Close stdin.  The process exits cleanly.
//!
//! ## Algorithm
//!
//! 1. BGR → grayscale
//! 2. Exponential moving-average background model (per-pixel mean)
//! 3. Pixel is foreground if |grey - mean| > 25 grey levels
//! 4. 3×3 morphological erosion (removes isolated noise pixels)
//! 5. BFS connected-component analysis — find the largest contiguous blob
//! 6. has_motion = score >= threshold  AND  largest_blob >= min_blob_fraction
//!    (the blob gate filters reflections / scattered pixel noise that passes
//!     the score threshold but never forms a large contiguous region)

use std::collections::VecDeque;
use std::io::{self, BufRead, Read, Write};

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct InitCmd {
    width:   u32,
    height:  u32,
    /// Fraction of changed pixels required to trigger motion (0–1)
    #[serde(default = "default_threshold")]
    threshold: f32,
    /// Adaptation history in frames (higher = slower background update)
    #[serde(default = "default_history")]
    history: u32,
    /// Minimum contiguous foreground blob as a fraction of total pixels.
    /// Filters reflections and scattered pixel noise.
    #[serde(default = "default_min_blob_fraction")]
    min_blob_fraction: f32,
}

fn default_threshold()         -> f32 { 0.005 }
fn default_history()           -> u32 { 50    }
fn default_min_blob_fraction() -> f32 { 0.01  }

#[derive(Serialize)]
struct FrameResult {
    frame:           u64,
    has_motion:      bool,
    score:           f32,
    changed_px:      u32,
    largest_blob_px: u32,
}

// ---------------------------------------------------------------------------
// Background model
// ---------------------------------------------------------------------------

struct BackgroundModel {
    width:             usize,
    height:            usize,
    threshold:         f32,
    min_blob_fraction: f32,
    alpha:             f32,
    mean:              Vec<f32>,
    fg:                Vec<bool>,
    visited:           Vec<bool>,   // scratch buffer for BFS
    initialized:       bool,
}

impl BackgroundModel {
    fn new(width: usize, height: usize, threshold: f32, history: u32,
           min_blob_fraction: f32) -> Self {
        let n = width * height;
        Self {
            width,
            height,
            threshold,
            min_blob_fraction,
            alpha: 1.0 / (history as f32),
            mean:    vec![128.0f32; n],
            fg:      vec![false; n],
            visited: vec![false; n],
            initialized: false,
        }
    }

    /// Process a BGR24 frame.  Returns (has_motion, score, changed_px, largest_blob_px).
    fn process(&mut self, bgr: &[u8]) -> (bool, f32, u32, u32) {
        let n = self.width * self.height;
        debug_assert_eq!(bgr.len(), n * 3);

        // BGR → grayscale  (Y ≈ 0.114·B + 0.587·G + 0.299·R)
        let gray: Vec<f32> = bgr.chunks_exact(3).map(|px| {
            0.114 * px[0] as f32 + 0.587 * px[1] as f32 + 0.299 * px[2] as f32
        }).collect();

        if !self.initialized {
            self.mean.copy_from_slice(&gray);
            self.initialized = true;
            return (false, 0.0, 0, 0);
        }

        let px_threshold = 25.0_f32;
        let w = self.width;
        let h = self.height;

        // Raw foreground: pixel differs from background mean
        let raw_fg: Vec<bool> = gray.iter().zip(self.mean.iter())
            .map(|(g, m)| (g - m).abs() > px_threshold)
            .collect();

        // 3×3 morphological erosion — keeps only pixels where ≥5 of 9
        // neighbours are also foreground.  Removes isolated noise pixels.
        for y in 0..h {
            for x in 0..w {
                let idx = y * w + x;
                if !raw_fg[idx] {
                    self.fg[idx] = false;
                    continue;
                }
                let mut count = 0u32;
                for dy in -1i32..=1 {
                    for dx in -1i32..=1 {
                        let ny = y as i32 + dy;
                        let nx = x as i32 + dx;
                        if ny >= 0 && ny < h as i32 && nx >= 0 && nx < w as i32
                            && raw_fg[ny as usize * w + nx as usize]
                        {
                            count += 1;
                        }
                    }
                }
                self.fg[idx] = count >= 5;
            }
        }

        let changed = self.fg.iter().filter(|&&b| b).count() as u32;
        let score   = changed as f32 / n as f32;

        // BFS connected-component analysis — find largest contiguous blob.
        // Only runs when the score gate passes (avoids BFS on empty masks).
        let largest_blob = if score >= self.threshold {
            self.largest_blob()
        } else {
            0
        };

        let min_blob_px = (self.min_blob_fraction * n as f32) as u32;
        let has_motion  = score >= self.threshold && largest_blob >= min_blob_px;

        // Update background (slower adaptation during confirmed motion)
        let adapt = if has_motion { self.alpha * 0.1 } else { self.alpha };
        for i in 0..n {
            self.mean[i] += adapt * (gray[i] - self.mean[i]);
        }

        (has_motion, score, changed, largest_blob)
    }

    /// BFS over `self.fg` — returns the pixel count of the largest contiguous blob.
    fn largest_blob(&mut self) -> u32 {
        let w = self.width;
        let h = self.height;
        let n = w * h;
        let min_px = (self.min_blob_fraction * n as f32) as u32;

        self.visited.fill(false);

        let mut max_size = 0u32;
        let mut queue: VecDeque<usize> = VecDeque::new();

        for start in 0..n {
            if !self.fg[start] || self.visited[start] {
                continue;
            }
            let mut size = 0u32;
            queue.clear();
            queue.push_back(start);
            self.visited[start] = true;

            while let Some(idx) = queue.pop_front() {
                size += 1;
                let y = (idx / w) as i32;
                let x = (idx % w) as i32;

                for (dy, dx) in [(-1i32, 0i32), (1, 0), (0, -1), (0, 1)] {
                    let ny = y + dy;
                    let nx = x + dx;
                    if ny < 0 || ny >= h as i32 || nx < 0 || nx >= w as i32 {
                        continue;
                    }
                    let nidx = ny as usize * w + nx as usize;
                    if self.fg[nidx] && !self.visited[nidx] {
                        self.visited[nidx] = true;
                        queue.push_back(nidx);
                    }
                }
            }

            if size > max_size {
                max_size = size;
                // Early exit once we've found a blob large enough —
                // we only care whether the threshold is met, not which
                // blob is technically the largest.
                if max_size >= min_px {
                    return max_size;
                }
            }
        }

        max_size
    }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

fn main() -> io::Result<()> {
    let stdin  = io::stdin();
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());

    let mut lines = stdin.lock().lines();
    let init_line = lines.next()
        .ok_or_else(|| io::Error::new(io::ErrorKind::UnexpectedEof, "no init"))??;

    let init: InitCmd = serde_json::from_str(&init_line)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    let width       = init.width  as usize;
    let height      = init.height as usize;
    let frame_bytes = width * height * 3;

    let mut model = BackgroundModel::new(
        width, height, init.threshold, init.history, init.min_blob_fraction,
    );

    drop(lines);
    let mut raw_stdin = io::stdin();

    let mut header_buf = [0u8; 8];
    let mut frame_buf  = vec![0u8; frame_bytes];
    let mut frame_idx  = 0u64;

    loop {
        match raw_stdin.read_exact(&mut header_buf) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e),
        }
        match raw_stdin.read_exact(&mut frame_buf) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e),
        }

        let (has_motion, score, changed_px, largest_blob_px) = model.process(&frame_buf);

        let result = FrameResult { frame: frame_idx, has_motion, score,
                                   changed_px, largest_blob_px };
        let mut json = serde_json::to_string(&result).unwrap();
        json.push('\n');
        out.write_all(json.as_bytes())?;
        out.flush()?;

        frame_idx += 1;
    }

    Ok(())
}
