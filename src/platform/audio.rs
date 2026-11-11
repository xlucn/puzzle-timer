//! The WCA inspection beeps.
//!
//! The cues themselves are decided in `core::timer`; this module only turns a
//! cue into sound.
//!
//! The WAV files are generated here rather than shipped: two short pulses of a
//! C6 tone (one for the 8 s signal, two for 12 s), 16-bit mono PCM with
//! fade-in/out so the edges do not click. They are written to the temp dir on
//! first use and reused after. Playback tries the first available player
//! (PipeWire, PulseAudio, GStreamer, ALSA) and is fire-and-forget — a failed
//! beep must never take the timer down.

use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use crate::core::timer::InspectionCue;

const SAMPLE_RATE: u32 = 44_100;
const TONE_HZ: f64 = 1046.5; // C6 — high enough to cut through fan noise
const PULSE_MS: u32 = 90;
const GAP_MS: u32 = 60; // silence between the two pulses of the 12 s signal
const FADE_MS: u32 = 5;

/// One candidate player per entry: the first that starts wins.
const PLAYERS: [(&str, bool); 4] = [
    // (command, whether it takes the file argument directly)
    ("pw-play", true),
    ("paplay", true),
    ("gst-launch-1.0", false),
    ("aplay", true),
];

fn beep_path(pulses: u32) -> PathBuf {
    std::env::temp_dir().join(format!("puzzle-timer-beep-{pulses}.wav"))
}

fn wav_for(pulses: u32) -> PathBuf {
    let file = beep_path(pulses);
    if file.exists() {
        return file;
    }
    let _ = fs::write(&file, wav_bytes(pulses));
    file
}

/// 16-bit mono PCM samples for `pulses` beeps.
fn samples(pulses: u32) -> Vec<i16> {
    let pulse_samples = (SAMPLE_RATE * PULSE_MS).div_ceil(1000) as usize;
    let gap_samples = (SAMPLE_RATE * GAP_MS).div_ceil(1000) as usize;
    let fade_samples = (SAMPLE_RATE * FADE_MS).div_ceil(1000).max(1) as usize;
    let total = (pulses as usize) * pulse_samples + (pulses as usize - 1) * gap_samples;

    let mut samples = vec![0i16; total];
    let mut at = 0;
    for pulse in 0..pulses as usize {
        for index in 0..pulse_samples {
            // 1.0 at the middle of the pulse, linear fade at both edges.
            let edge = (index + 1).min(pulse_samples - index).min(fade_samples);
            let envelope = (edge as f64 / fade_samples as f64).min(1.0);
            let value = (std::f64::consts::TAU * TONE_HZ * index as f64 / SAMPLE_RATE as f64).sin()
                * 0.5
                * envelope
                * 32_767.0;
            samples[at + index] = value.round() as i16;
        }
        at += pulse_samples;
        if pulse < pulses as usize - 1 {
            at += gap_samples;
        }
    }
    samples
}

/// Minimal RIFF/WAVE wrapper around 16-bit little-endian mono PCM.
fn wav_bytes(pulses: u32) -> Vec<u8> {
    let samples = samples(pulses);
    let data_bytes = (samples.len() * 2) as u32;
    let mut bytes = Vec::with_capacity(44 + samples.len() * 2);

    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_bytes).to_le_bytes());
    bytes.extend_from_slice(b"WAVE");
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes()); // PCM chunk size
    bytes.extend_from_slice(&1u16.to_le_bytes()); // format: PCM
    bytes.extend_from_slice(&1u16.to_le_bytes()); // channels
    bytes.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    bytes.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes()); // byte rate
    bytes.extend_from_slice(&2u16.to_le_bytes()); // block align
    bytes.extend_from_slice(&16u16.to_le_bytes()); // bits per sample
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_bytes.to_le_bytes());
    for sample in samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    bytes
}

/// Play an inspection cue: 8 s = one beep, 12 s = two. Never throws and never
/// blocks the caller — spawn errors just fall through to the next player.
pub fn play_inspection_cue(cue: InspectionCue) {
    let pulses = match cue {
        InspectionCue::Cue8s => 1,
        InspectionCue::Cue12s => 2,
    };
    let file = wav_for(pulses);
    let path = file.to_string_lossy().to_string();
    for (player, takes_file) in PLAYERS {
        let mut command = Command::new(player);
        if takes_file {
            command.arg(&path);
        } else {
            command.args(["playbin", &format!("uri=file://{path}")]);
        }
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        match command.spawn() {
            // The beep is fire-and-forget; reap it off the main thread so it
            // cannot linger as a zombie.
            Ok(mut child) => {
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
                return;
            }
            Err(_) => continue, // ENOENT: try the next player
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_a_riff_wave_with_the_requested_pulse_count() {
        let one = wav_bytes(1);
        let two = wav_bytes(2);
        assert_eq!(&one[..4], b"RIFF");
        assert_eq!(&one[8..12], b"WAVE");
        assert!(two.len() > one.len());
        // 44-byte header plus 16-bit samples.
        assert_eq!((one.len() - 44) % 2, 0);
    }

    #[test]
    fn the_pulses_are_audible_and_the_edges_are_faded() {
        let samples = samples(1);
        assert!(samples.iter().any(|sample| *sample != 0));
        assert!(samples[0].abs() < 2_000, "the first sample is faded in");
        let peak = samples.iter().map(|sample| sample.abs()).max().unwrap_or(0);
        assert!(peak > 8_000, "the middle of the pulse is loud: {peak}");
    }

    #[test]
    fn reuses_the_cached_file() {
        let file = wav_for(1);
        assert!(file.exists());
        let first = fs::metadata(&file).expect("beep file").len();
        let again = wav_for(1);
        assert_eq!(fs::metadata(again).expect("beep file").len(), first);
    }
}
