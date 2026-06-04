#!/usr/bin/env node
/**
 * ring_bridge.js
 *
 * Authenticates with Ring, opens a live SIP streaming session for a chosen
 * camera, and pipes raw BGR24 video frames to stdout for the Python pipeline.
 *
 * Frame protocol on stdout:
 *   1. One ASCII header line:  "RING_STREAM <width> <height> <fps>\n"
 *   2. Repeated raw frames:    exactly width * height * 3 bytes each (BGR24)
 *
 * Usage:
 *   node ring_bridge.js <camera_name> [--width 1280] [--height 720] [--fps 15]
 *
 * Auth:
 *   First run: generate a refresh token with:
 *     npx ring-auth-cli
 *   Then either save it to ring_token.json as {"refreshToken":"<token>"}
 *   or set the RING_REFRESH_TOKEN environment variable.
 *
 * Dependencies:
 *   npm install ring-client-api
 */

'use strict'

const fs   = require('fs')
const path = require('path')
const { RingApi } = require('ring-client-api')

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args     = process.argv.slice(2)
const camName  = args[0]

if (!camName) {
  const script = path.basename(process.argv[1])
  process.stderr.write(`Usage: node ${script} <camera_name> [--width N] [--height N] [--fps N]\n`)
  process.stderr.write(`       List cameras: node ${script} --list\n`)
  process.exit(1)
}

function parseFlag(flag, defaultVal) {
  const idx = args.indexOf(flag)
  return idx !== -1 ? parseInt(args[idx + 1], 10) : defaultVal
}

const OUT_WIDTH  = parseFlag('--width',  1280)
const OUT_HEIGHT = parseFlag('--height', 720)
const OUT_FPS    = parseFlag('--fps',    15)

// ---------------------------------------------------------------------------
// Token persistence
// ---------------------------------------------------------------------------
const TOKEN_FILE = path.join(__dirname, 'ring_token.json')

function loadToken() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
  } catch {
    return null
  }
}

function saveToken(token) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2))
  process.stderr.write('[bridge] Token saved to ring_token.json\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const savedToken = loadToken()
  const envToken   = process.env.RING_REFRESH_TOKEN

  const refreshToken = (savedToken && savedToken.refreshToken) || envToken

  if (!refreshToken) {
    process.stderr.write(
      '[bridge] No refresh token found.\n' +
      '         Generate one with:\n' +
      '           npx ring-auth-cli\n' +
      '         Then either:\n' +
      '           • Save to ring_token.json as {"refreshToken":"<token>"}\n' +
      '           • Or set RING_REFRESH_TOKEN=<token>\n'
    )
    process.exit(1)
  }

  const ringApi = new RingApi({ refreshToken })

  // Hook token refresh
  ringApi.onRefreshTokenUpdated.subscribe(({ newRefreshToken }) => {
    saveToken({ refreshToken: newRefreshToken })
  })

  const cameras = await ringApi.getCameras()

  // --list mode
  if (camName === '--list') {
    process.stderr.write('Available cameras:\n')
    cameras.forEach(c => process.stderr.write(`  • ${c.name}\n`))
    process.exit(0)
  }

  const camera = cameras.find(c => c.name === camName)
  if (!camera) {
    process.stderr.write(`[bridge] Camera not found: "${camName}"\n`)
    process.stderr.write(`         Available: ${cameras.map(c => c.name).join(', ')}\n`)
    process.exit(1)
  }

  process.stderr.write(`[bridge] Starting live stream for: ${camera.name}\n`)

  // Tell the camera to start streaming
  await camera.startVideoOnDemand()

  const session = await camera.createSipSession()

  // Send header line so Python knows the frame dimensions
  const header = `RING_STREAM ${OUT_WIDTH} ${OUT_HEIGHT} ${OUT_FPS}\n`
  process.stdout.write(header)
  process.stderr.write(`[bridge] Header sent: ${header.trim()}\n`)

  // Buffer for accumulating partial chunks from ffmpeg
  let frameBuf = Buffer.alloc(0)
  const FRAME_BYTES = OUT_WIDTH * OUT_HEIGHT * 3   // BGR24

  await session.startTranscoding({
    // No audio needed for motion detection
    audio: false,

    // Video: scale to target size, output rawvideo BGR24
    video: [
      '-vf',   `scale=${OUT_WIDTH}:${OUT_HEIGHT}`,
      '-vcodec', 'rawvideo',
      '-pix_fmt', 'bgr24',
      '-r',    String(OUT_FPS),
    ],

    // Output to stdout as raw bytes (no container)
    output: ['-f', 'rawvideo', 'pipe:1'],

    stdoutCallback: (chunk) => {
      // Accumulate chunks and emit whole frames
      frameBuf = Buffer.concat([frameBuf, chunk])

      while (frameBuf.length >= FRAME_BYTES) {
        const frame = frameBuf.slice(0, FRAME_BYTES)
        frameBuf  = frameBuf.slice(FRAME_BYTES)
        process.stdout.write(frame)
      }
    },
  })

  // Re-connect loop: Ring live streams time out after ~10 minutes
  session.onCallEnded.subscribe(async () => {
    process.stderr.write('[bridge] Stream ended — reconnecting in 2s...\n')
    await new Promise(r => setTimeout(r, 2000))
    main().catch(err => {
      process.stderr.write(`[bridge] Fatal reconnect error: ${err}\n`)
      process.exit(1)
    })
  })
}

main().catch(err => {
  process.stderr.write(`[bridge] Fatal: ${err}\n`)
  process.exit(1)
})
