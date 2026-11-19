"""Ethereal, Monument Valley-ish score: soft pads, glass plucks, airy whooshes."""
import math
import wave

import numpy as np

SR = 44100
DUR = 30.0
N = int(SR * DUR)
rng = np.random.default_rng(23)
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


def pad(freqs, dur, attack=0.9, release=1.2):
    t = np.arange(int(SR * dur)) / SR
    sig = np.zeros(len(t))
    for f in freqs:
        sig += np.sin(2 * np.pi * f * t) * 0.6
        sig += np.sin(2 * np.pi * f * 1.004 * t) * 0.4  # gentle detune
    sig /= len(freqs)
    a = np.minimum(t / attack, 1.0)
    r = np.minimum((dur - t) / release, 1.0)
    return sig * a * r


def glass(freq, dur=1.4):
    t = np.arange(int(SR * dur)) / SR
    sig = (
        np.sin(2 * np.pi * freq * t)
        + 0.5 * np.sin(2 * np.pi * freq * 2 * t)
        + 0.22 * np.sin(2 * np.pi * freq * 3.01 * t)
    )
    return sig * env(t, 4.2)


def whoosh(dur=1.0):
    t = np.arange(int(SR * dur)) / SR
    noise = np.convolve(rng.standard_normal(len(t)), np.ones(48) / 48, mode="same")
    shape = np.sin(np.pi * t / dur) ** 2
    return noise * shape


def sub(dur=1.6):
    t = np.arange(int(SR * dur)) / SR
    f = 36 + 24 * np.exp(-t * 4)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(t, 2.2)


def chime(freq, dur=2.4):
    t = np.arange(int(SR * dur)) / SR
    return (
        np.sin(2 * np.pi * freq * t)
        + 0.45 * np.sin(2 * np.pi * freq * 1.5 * t)
        + 0.2 * np.sin(2 * np.pi * freq * 2.01 * t)
    ) * env(t, 2.0)


def reverb(sig, delay=0.28, feedback=0.32, taps=3):
    out = sig.copy()
    for i in range(1, taps + 1):
        shift = int(delay * i * SR)
        if shift >= len(sig):
            break
        out[shift:] += sig[:-shift] * (feedback ** i)
    return out


# --- pads: Cmaj9 / Am9 / Fmaj9 / G6 ---
chords = [
    [130.81, 164.81, 196.0, 246.94, 293.66],
    [110.0, 130.81, 164.81, 196.0, 246.94],
    [87.31, 110.0, 130.81, 164.81, 196.0],
    [98.0, 123.47, 146.83, 164.81, 196.0],
]
for bar in range(int(DUR / 7.5)):
    add(pad(chords[bar % 4], 7.8), bar * 7.5, 0.22)
add(pad(chords[0], 3.2, 1.2, 1.4), 0.0, 0.18)

# --- glass plucks on card entries + phases ---
card_times = [3.0 + i * 0.18 for i in range(9)]
notes = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.5, 1567.98]
for t0, f in zip(card_times, notes):
    add(reverb(glass(f), 0.28, 0.3), t0, 0.16, (-1) ** int(t0 * 10) * 0.2)

for t0, f in zip([11.2, 11.7, 12.2, 12.7], [659.25, 783.99, 880.0, 1046.5]):
    add(glass(f, 1.0), t0, 0.12, 0.1)

# --- air at cuts ---
cuts = [3.0, 9.5, 16.6, 22.6, 27.6]
for c in cuts:
    add(whoosh(), c - 0.55, 0.30, 0.0)
    add(sub(), c, 0.28)

# --- accents ---
add(chime(880), 19.3, 0.22, 0.0)
add(chime(1567.98, 1.0), 26.0, 0.20, 0.15)
add(chime(523.25), 27.6, 0.22, 0.0)
add(chime(783.99), 28.2, 0.16, -0.1)

# gentle fades
fade_in = int(SR * 0.6)
mix[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
fade_out = int(SR * 1.8)
mix[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None]

mix = mix / np.max(np.abs(mix)) * 0.78
pcm = (mix * 32767).astype(np.int16)
with wave.open("soundtrack.wav", "wb") as f:
    f.setnchannels(2)
    f.setsampwidth(2)
    f.setframerate(SR)
    f.writeframes(pcm.tobytes())
print("soundtrack.wav (ethereal)", DUR, "s")
