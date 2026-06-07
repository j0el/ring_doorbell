#!/usr/bin/env node
/**
 * ring_bridge.js
 *
 * Authenticates with Ring, opens a live streaming session for a chosen
 * camera, and PUBLISHES it into MediaMTX as an RTSP stream. MediaMTX then
 * re-serves it as HLS/WebRTC to the browser (camera-api UI).
 *
 * ring-client-api already runs an FFmpeg child internally (it decrypts Ring's
 * WebRTC/RTP in JS via werift, then pipes to FFmpeg). We simply point that
 * FFmpeg's OUTPUT at MediaMTX over RTSP instead of at stdout. Ring delivers
 * H.264 already, so video is COPIED (-c:v copy) — no re-encode, low CPU.
 *
 * Pipeline:  Ring → werift → ffmpeg(-c:v copy) → rtsp://…/ring → MediaMTX
 *
 * Modes:
 *   node ring_bridge.js <camera_name> [--rtsp rtsp://127.0.0.1:8554/ring]
 *   node ring_bridge.js --list
 *   node ring_bridge.js --auth --email you@example.com --password secret
 *
 * The RTSP target can also be set via the RING_RTSP_URL env var.
 * Default target: rtsp://127.0.0.1:8554/ring (matches mediamtx.yml "ring" path).
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
  process.stderr.write(`Usage: node ${script} <camera_name> [--rtsp rtsp://127.0.0.1:8554/ring]\n`)
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

// RTSP target to publish into (MediaMTX). Flag overrides env overrides default.
const RTSP_URL = parseStringFlag('--rtsp')
  || process.env.RING_RTSP_URL
  || 'rtsp://127.0.0.1:8554/ring'

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
  process.stderr.write(`[bridge] Publishing to: ${RTSP_URL}\n`)

  const liveCall = await camera.startLiveCall()

  // Point ring-client-api's internal FFmpeg at MediaMTX over RTSP.
  // Ring's video is already H.264, so copy it (no re-encode). Audio is off.
  // -rtsp_transport tcp matches MediaMTX's rtspTransports: [tcp].
  await liveCall.startTranscoding({
    audio: false,
    video: ['-c:v', 'copy'],
    output: [
      '-rtsp_transport', 'tcp',
      '-f', 'rtsp',
      RTSP_URL,
    ],
  })

  process.stderr.write('[bridge] Publishing — stream should appear in MediaMTX.\n')

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
