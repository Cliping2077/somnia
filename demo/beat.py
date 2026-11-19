"""Generate a 30s 120 BPM beat bed for the rhythm demo."""
import math
import wave

import numpy as np

SR = 44100
DUR = 30.0
BPM = 120
BEAT = 60.0 / BPM
N = int(SR * DUR)
rng = np.random.default_rng(7)

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


def kick(dur=0.22):
    t = np.arange(int(SR * dur)) / SR
    f = 48 + 70 * np.exp(-t * 28)
    sig = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(t, 14)
    return sig + 0.25 * rng.standard_normal(len(t)) * env(t, 90)


def snare(dur=0.18):
    t = np.arange(int(SR * dur)) / SR
    noise = rng.standard_normal(len(t))
    noise = np.diff(np.concatenate([[0], noise]))  # crude high-pass
    tone = np.sin(2 * np.pi * 190 * t) * env(t, 30) * 0.4
    return noise * env(t, 26) * 0.8 + tone


def hat(dur=0.05):
    t = np.arange(int(SR * dur)) / SR
    noise = rng.standard_normal(len(t))
    noise = np.diff(np.concatenate([[0], noise]))
    return noise * env(t, 90)


def bass(freq, dur=0.42):
    t = np.arange(int(SR * dur)) / SR
    sig = np.sin(2 * np.pi * freq * t) + 0.25 * np.sin(2 * np.pi * freq * 2 * t)
    return sig * env(t, 6) * 0.5


def pad(freqs, dur=2.0):
    t = np.arange(int(SR * dur)) / SR
    sig = np.zeros(len(t))
    for f in freqs:
        sig += np.sin(2 * np.pi * f * t) / len(freqs)
    attack = np.minimum(t / 0.4, 1.0)
    release = np.minimum((dur - t) / 0.4, 1.0)
    return sig * attack * release


def impact(dur=1.2):
    t = np.arange(int(SR * dur)) / SR
    f = 30 + 60 * np.exp(-t * 8)
    sig = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(t, 3.2)
    return sig + 0.3 * rng.standard_normal(len(t)) * env(t, 12)


def riser(dur=0.9):
    t = np.arange(int(SR * dur)) / SR
    noise = rng.standard_normal(len(t))
    noise = np.convolve(noise, np.ones(24) / 24, mode="same")
    sweep = np.sin(2 * np.pi * (300 + 1400 * t / dur) * t)
    return (noise * 0.6 + sweep * 0.25) * (t / dur) ** 2


def chime(freq=880, dur=2.2):
    t = np.arange(int(SR * dur)) / SR
    sig = np.sin(2 * np.pi * freq * t) + 0.5 * np.sin(2 * np.pi * freq * 1.5 * t)
    return sig * env(t, 2.4)


# drums
for b in range(int(DUR / BEAT)):
    t = b * BEAT
    add(kick(), t, 0.9 if b % 2 == 0 else 0.7)
    if b % 4 in (1, 3):
        add(snare(), t, 0.5, -0.1)
    add(hat(), t + BEAT / 2, 0.22, 0.2)

# bass / pad: 4-bar loop
prog = [(55.0, [220, 261.6, 329.6]), (43.65, [174.6, 220, 261.6]),
        (65.4, [261.6, 329.6, 392]), (49.0, [196, 246.9, 293.7])]
for bar in range(int(DUR / (BEAT * 4))):
    root, chord = prog[bar % 4]
    t0 = bar * BEAT * 4
    add(pad(chord, dur=BEAT * 4), t0, 0.16)
    for k in range(4):
        add(bass(root), t0 + k * BEAT, 0.5)

# transitions and accents
for cut in (10.0, 16.6, 22.6, 27.6):
    add(riser(), cut - 0.8, 0.4, 0.0)
    add(impact(), cut, 0.75)
add(chime(), 27.6, 0.35)
add(chime(1174.7), 28.2, 0.2)

# fades
fade_in = int(SR * 0.4)
mix[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
fade_out = int(SR * 1.6)
mix[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None]

peak = np.max(np.abs(mix))
mix = mix / peak * 0.82
pcm = (mix * 32767).astype(np.int16)

with wave.open("beat.wav", "wb") as f:
    f.setnchannels(2)
    f.setsampwidth(2)
    f.setframerate(SR)
    f.writeframes(pcm.tobytes())
print("beat.wav", DUR, "s", SR, "Hz")
