/*
 * audio.ts — the WCA inspection beeps.
 *
 * Node-only (src/platform/, the home of non-pure code — see AGENTS.md): the
 * cues themselves are decided in pure core/timer.ts (`onCue`); this module
 * only turns a cue into sound.
 *
 * The WAV files are generated here rather than shipped: two short pulses of
 * a C6 tone (one for the 8 s signal, two for 12 s), 16-bit mono PCM with
 * fade-in/out so the edges do not click. They are written to the temp dir
 * on first use and reused after. Playback tries the first available player
 * (PipeWire, PulseAudio, GStreamer, ALSA) and is fire-and-forget — a failed
 * beep must never take the timer down, so spawn errors are swallowed.
 */

import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { InspectionCue } from '../core/timer.js'

const SAMPLE_RATE = 44_100
const TONE_HZ = 1046.5 // C6 — high enough to cut through fan noise
const PULSE_MS = 90
const GAP_MS = 60 // silence between the two pulses of the 12 s signal
const FADE_MS = 5 // edge fade, in samples computed below

/** One candidate player per line: first that runs wins, others are ignored. */
const PLAYERS: Array<(file: string) => [string, string[]]> = [
  (file) => ['pw-play', [file]],
  (file) => ['paplay', [file]],
  (file) => ['gst-launch-1.0', ['playbin', `uri=file://${file}`]],
  (file) => ['aplay', ['-q', file]],
]

function wavFor(pulses: 1 | 2): string {
  const file = join(tmpdir(), `puzzle-timer-beep-${pulses}.wav`)
  if (existsSync(file)) return file

  const pulseSamples = Math.round((SAMPLE_RATE * PULSE_MS) / 1000)
  const gapSamples = Math.round((SAMPLE_RATE * GAP_MS) / 1000)
  const fadeSamples = Math.round((SAMPLE_RATE * FADE_MS) / 1000)
  const total = pulses * pulseSamples + (pulses - 1) * gapSamples

  const samples = new Int16Array(total)
  let at = 0
  for (let pulse = 0; pulse < pulses; pulse += 1) {
    for (let i = 0; i < pulseSamples; i += 1) {
      // 1.0 at the middle of the pulse, linear fade at both edges.
      const edge = Math.min(i + 1, pulseSamples - i, fadeSamples)
      const envelope = Math.min(1, edge / fadeSamples)
      const value = Math.round(Math.sin((2 * Math.PI * TONE_HZ * i) / SAMPLE_RATE) * 0.5 * envelope * 32_767)
      samples[at + i] = value
    }
    at += pulseSamples
    if (pulse < pulses - 1) at += gapSamples
  }

  writeFileSync(file, encodeWav(samples))
  return file
}

/** Minimal RIFF/WAVE wrapper around 16-bit little-endian mono PCM. */
function encodeWav(samples: Int16Array): Buffer {
  const dataBytes = samples.length * 2
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataBytes, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // PCM chunk size
  header.writeUInt16LE(1, 20) // format: PCM
  header.writeUInt16LE(1, 22) // channels
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataBytes, 40)

  const data = Buffer.alloc(dataBytes)
  for (let i = 0; i < samples.length; i += 1) data.writeInt16LE(samples[i], i * 2)
  return Buffer.concat([header, data])
}

/**
 * Play an inspection cue: '8s' = one beep, '12s' = two. Never throws and
 * never blocks — `spawn` errors just fall through to the next player.
 */
export function playInspectionCue(cue: InspectionCue): void {
  try {
    const file = wavFor(cue === '8s' ? 1 : 2)
    const attempt = (index: number): void => {
      if (index >= PLAYERS.length) return
      const [cmd, args] = PLAYERS[index](file)
      const child = spawn(cmd, args, { stdio: 'ignore' })
      child.on('error', () => attempt(index + 1)) // ENOENT: try the next one
    }
    attempt(0)
  } catch {
    // A beep is a nicety; silence is an acceptable failure mode.
  }
}
