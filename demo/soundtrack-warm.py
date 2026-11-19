"""Warm, slow score for the sleep film: 36s, soft pads, glass piano, air."""
import math
import wave

import numpy as np

SR = 44100
DUR = 36.0
N = int(SR * DUR)
rng = np.random.default_rng(41)
mix = np.zeros((N, 2), dtype=np.float64)


def add(sig, start, gain=1.0, pan=0.0):
    i = int(start * SR)
    if i >= N:
        return
    n = min(len(sig), N - i)
    left = math.sqrt((1 - pan) / 2)
    right = math.sqrt((1 + pan) / 2)
    mix[i:i + n, 0] += sig[:n] * gain * left
    mix[i:i + n, 1] += sig[:n] * gain * right


def env(t, rate):
    return np.exp(-t * rate)


def pad(freqs, dur, attack=1.6, release=2.0):
    t = np.arange(int(SR * dur)) / SR
    sig = np.zeros(len(t))
    for f in freqs:
        sig += np.sin(2 * np.pi * f * t) * 0.6
        sig += np.sin(2 * np.pi * f * 1.003 * t) * 0.4
    sig /= len(freqs)
    a = np.minimum(t / attack, 1.0)
    r = np.minimum((dur - t) / release, 1.0)
    return sig * a * r


def piano(freq, dur=2.6):
    t = np.arange(int(SR * dur)) / SR
    sig = (
        np.sin(2 * np.pi * freq * t)
        + 0.42 * np.sin(2 * np.pi * freq * 2 * t)
        + 0.16 * np.sin(2 * np.pi * freq * 3.01 * t)
        + 0.06 * np.sin(2 * np.pi * freq * 4 * t)
    )
    return sig * env(t, 2.2)


def air(dur=1.4):
    t = np.arange(int(SR * dur)) / SR
    noise = np.convolve(rng.standard_normal(len(t)), np.ones(60) / 60, mode="same")
    return noise * np.sin(np.pi * t / dur) ** 2


def sub(dur=2.0):
    t = np.arange(int(SR * dur)) / SR
    f = 32 + 20 * np.exp(-t * 3)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(t, 1.8)


def chime(freq, dur=3.0):
    t = np.arange(int(SR * dur)) / SR
    return (
        np.sin(2 * np.pi * freq * t)
        + 0.4 * np.sin(2 * np.pi * freq * 1.5 * t)
        + 0.18 * np.sin(2 * np.pi * freq * 2.01 * t)
    ) * env(t, 1.6)


def tick(dur=0.06):
    t = np.arange(int(SR * dur)) / SR
    return np.sin(2 * np.pi * 1200 * t) * env(t, 70)


def pop(dur=0.12):
    t = np.arange(int(SR * dur)) / SR
    f = 760 + 320 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(t, 45)


def reverb(sig, delay=0.31, feedback=0.34, taps=3):
    out = sig.copy()
    for i in range(1, taps + 1):
        shift = int(delay * i * SR)
        if shift >= len(sig):
            break
        out[shift:] += sig[:-shift] * (feedback ** i)
    return out


# Warm chords: Fmaj9 / Am9 / Cmaj9 / G6, 9s each
chords = [
    [87.31, 130.81, 174.61, 220.0, 261.63],
    [110.0, 146.83, 196.0, 246.94, 329.63],
    [130.81, 164.81, 196.0, 246.94, 329.63],
    [98.0, 123.47, 146.83, 196.0, 293.66],
]
for bar in range(4):
    add(pad(chords[bar], 9.6), bar * 9.0, 0.24)
add(pad(chords[0], 3.4, 1.4, 1.6), 0.0, 0.2)

# Glass piano on card entries
notes = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.5, 1567.98]
for i, f in enumerate(notes):
    add(reverb(piano(f), 0.31, 0.32), 3.2 + i * 0.18, 0.15, (-1) ** i * 0.2)

# Human-sleep beat
for t0, f in zip([12.1, 12.7, 13.3], [392.0, 523.25, 659.25]):
    add(reverb(piano(f, 3.2), 0.31, 0.32), t0, 0.17)

# Phases
for t0, f in zip([15.2, 15.7, 16.2, 16.7], [523.25, 659.25, 783.99, 1046.5]):
    add(piano(f, 1.6), t0, 0.12, 0.1)

# Cuts: 3, 8, 12, 15, 20, 26, 31
for c in [3.0, 8.0, 12.0, 15.0, 20.0, 26.0, 31.0]:
    add(air(), c - 0.7, 0.30)
    add(sub(), c, 0.30)

# Chat pops
add(pop(), 8.3, 0.22)
for t0 in (8.9, 9.0, 9.1):
    add(tick(), t0, 0.10)
add(pop(), 9.6, 0.22)
add(chime(1046.5, 1.4), 10.4, 0.16)

# Accents
add(chime(880), 23.0, 0.18)
add(tick(), 5.93, 0.22)
add(tick(), 29.07, 0.22)
add(chime(1567.98, 1.2), 29.0, 0.18, 0.12)
add(chime(523.25), 31.0, 0.24)
add(chime(659.25), 31.8, 0.18, -0.1)
add(chime(783.99), 32.6, 0.14, 0.1)
fade_in = int(SR * 0.8)
mix[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
fade_out = int(SR * 2.4)
mix[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None]

mix = mix / np.max(np.abs(mix)) * 0.78
pcm = (mix * 32767).astype(np.int16)
with wave.open("soundtrack.wav", "wb") as f:
    f.setnchannels(2)
    f.setsampwidth(2)
    f.setframerate(SR)
    f.writeframes(pcm.tobytes())
print("soundtrack.wav (warm)", DUR, "s")
