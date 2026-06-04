#!/usr/bin/env node
/**
 * ring_bridge.js
 *
 * Authenticates with Ring, opens a live streaming session for a chosen
 * camera, and pipes raw BGR24 video frames to stdout for the Python pipeline.
 *
 * Frame protocol on stdout:
 *   1. One ASCII header line:  "RING_STREAM <width> <height> <fps>\n"
 *   2. Repeated raw frames:    exactly width * height * 3 bytes each (BGR24)
 *
 * Modes:
 *   node ring_bridge.js <camera_name> [--width 1280] [--height 720] [--fps 15]
 *   node ring_bridge.js --list
 *   node ring_bridge.js --auth --email you@example.com --password secret
 *
 * Auth:
 *   --auth mode writes to stderr:
 *     RING_NEED_2FA: <prompt>   → send 2FA code on stdin, then newline
 *     RING_AUTH_OK              → token saved to ring_token.json
 *     RING_AUTH_ERROR: <msg>    → authentication failed
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
const args    = process.argv.slice(2)
const camName = args[0]

if (!camName) {
  const script = path.basename(process.argv[1])
  process.stderr.write(`Usage: node ${script} <camera_name> [--width N] [--height N] [--fps N]\n`)
  process.stderr.write(`       node ${script} --list\n`)
  process.stderr.write(`       node ${script} --auth --email EMAIL --password PASSWORD\n`)
  process.exit(1)
}

function parseFlag(flag, defaultVal) {
  const idx = args.indexOf(flag)
  return idx !== -1 ? parseInt(args[idx + 1], 10) : defaultVal
}

function parseStringFlag(flag, defaultVal = null) {
  const idx = args.indexOf(flag)
  return idx !== -1 ? args[idx + 1] : defaultVal
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
// Auth mode  (node ring_bridge.js --auth --email E --password P)
// ---------------------------------------------------------------------------
async function authMode() {
  // Lazy import — only used in auth mode, and the subpath must match package.json exports
  const { RingRestClient } = require('ring-client-api/rest-client')

  const email    = parseStringFlag('--email')
  const password = parseStringFlag('--password')

  if (!email || !password) {
    process.stderr.write('RING_AUTH_ERROR: --email and --password are required\n')
    process.exit(1)
  }

  const client = new RingRestClient({ email, password })

  // Helper: read one line from stdin (used for 2FA code)
  function readStdinLine() {
    return new Promise((resolve) => {
      let buf = ''
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', function handler(chunk) {
        buf += chunk
        const nl = buf.indexOf('\n')
        if (nl !== -1) {
          process.stdin.removeListener('data', handler)
          resolve(buf.slice(0, nl).trim())
        }
      })
    })
  }

  async function attemptAuth(twoFactorCode) {
    try {
      const auth = twoFactorCode
        ? await client.getAuth(twoFactorCode)
        : await client.getCurrentAuth()
      saveToken({ refreshToken: auth.refresh_token })
      process.stderr.write('RING_AUTH_OK\n')
      process.exit(0)
    } catch (err) {
      if (client.promptFor2fa) {
        process.stderr.write(`RING_NEED_2FA: ${client.promptFor2fa}\n`)
        const code = await readStdinLine()
        await attemptAuth(code)
      } else {
        // Surface a clean message — the full error can be very verbose
        const msg = err.message || String(err)
        const clean = msg.includes('error_description')
          ? 'Incorrect email or password.'
          : msg.split('\n')[0]
        process.stderr.write(`RING_AUTH_ERROR: ${clean}\n`)
        process.exit(1)
      }
    }
  }

  await attemptAuth(null)
}

// ---------------------------------------------------------------------------
// Stream mode
// ---------------------------------------------------------------------------
async function main() {
  const savedToken = loadToken()
  const envToken   = process.env.RING_REFRESH_TOKEN
  const refreshToken = (savedToken && savedToken.refreshToken) || envToken

  if (!refreshToken) {
    process.stderr.write('[bridge] No refresh token found. Use --auth to sign in.\n')
    process.exit(1)
  }

  const ringApi = new RingApi({ refreshToken })

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

  const liveCall = await camera.startLiveCall()

  const header = `RING_STREAM ${OUT_WIDTH} ${OUT_HEIGHT} ${OUT_FPS}\n`
  process.stdout.write(header)
  process.stderr.write(`[bridge] Header sent: ${header.trim()}\n`)

  let frameBuf = Buffer.alloc(0)
  const FRAME_BYTES = OUT_WIDTH * OUT_HEIGHT * 3

  await liveCall.startTranscoding({
    audio: false,
    video: [
      '-vf',     `scale=${OUT_WIDTH}:${OUT_HEIGHT}`,
      '-vcodec', 'rawvideo',
      '-pix_fmt', 'bgr24',
      '-r',      String(OUT_FPS),
    ],
    output: ['-f', 'rawvideo', 'pipe:1'],
    stdoutCallback: (chunk) => {
      frameBuf = Buffer.concat([frameBuf, chunk])
      while (frameBuf.length >= FRAME_BYTES) {
        process.stdout.write(frameBuf.slice(0, FRAME_BYTES))
        frameBuf = frameBuf.slice(FRAME_BYTES)
      }
    },
  })

  liveCall.onCallEnded.subscribe(async () => {
    process.stderr.write('[bridge] Stream ended — reconnecting in 2s...\n')
    await new Promise(r => setTimeout(r, 2000))
    main().catch(err => {
      process.stderr.write(`[bridge] Fatal reconnect error: ${err}\n`)
      process.exit(1)
    })
  })
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
if (camName === '--auth') {
  authMode().catch(err => {
    process.stderr.write(`RING_AUTH_ERROR: ${err.message || err}\n`)
    process.exit(1)
  })
} else {
  main().catch(err => {
    process.stderr.write(`[bridge] Fatal: ${err}\n`)
    process.exit(1)
  })
}
