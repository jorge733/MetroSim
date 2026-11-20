# Música original del reel (sintetizada, sin derechos de terceros): 120 BPM, en La menor.
# Uso: python3 musica.py [segundos]  → musica.wav
import sys, wave, numpy as np
SR = 44100; BPM = 120; B = 60 / BPM
DUR = float(sys.argv[1]) if len(sys.argv) > 1 else 27.0
n = int(SR * DUR); L = np.zeros(n); R = np.zeros(n)
t_ = lambda d: np.arange(int(SR * d)) / SR
def add(sig, at, pan=0.0, g=1.0):
    i = int(at * SR); j = min(n, i + len(sig))
    if i >= n: return
    s = sig[:j - i] * g
    L[i:j] += s * (1 - max(0, pan)); R[i:j] += s * (1 + min(0, pan))
def hz(m): return 440 * 2 ** ((m - 69) / 12)
def kick():
    t = t_(0.35); f = 45 + 110 * np.exp(-t * 28)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7)
def snare():
    t = t_(0.22); return (np.random.randn(len(t)) * 0.6 + np.sin(2 * np.pi * 190 * t) * 0.5) * np.exp(-t * 18)
def hat(open_=False):
    t = t_(0.18 if open_ else 0.05); x = np.random.randn(len(t)); x = np.diff(x, prepend=0)
    return x * np.exp(-t * (14 if open_ else 70)) * 0.35
def saw(f, d):
    t = t_(d); return 2 * ((t * f) % 1) - 1
def bass(m, d):
    t = t_(d); x = saw(hz(m), d) * 0.5 + np.sin(2 * np.pi * hz(m) * t) * 0.6
    env = np.minimum(1, t * 200) * np.exp(-t * 3)
    k = 12; y = np.convolve(x, np.ones(k) / k, mode='same')  # paso bajo sencillo
    return y * env
def pad(ms, d):
    t = t_(d); x = sum(saw(hz(m) * (1 + det), d) for m in ms for det in (-0.004, 0.004))
    k = 30; x = np.convolve(x, np.ones(k) / k, mode='same')
    env = np.minimum(1, t / 0.08) * np.minimum(1, (d - t) / 0.3).clip(0)
    return x * env / (len(ms) * 2)
def pluck(m, d=0.22):
    t = t_(d); return (np.sign(np.sin(2 * np.pi * hz(m) * t)) * 0.3 + np.sin(2 * np.pi * hz(m) * t)) * np.exp(-t * 14)
def chime():  # «ding-dong» de estación, propio
    out = np.zeros(int(SR * 1.6))
    for k, (m, at) in enumerate([(76, 0), (72, 0.42)]):
        t = t_(1.1); s = (np.sin(2 * np.pi * hz(m) * t) + 0.3 * np.sin(2 * np.pi * hz(m) * 2.01 * t)) * np.exp(-t * 3.2)
        i = int(at * SR); out[i:i + len(s)] += s
    return out
# Progresión Am – F – C – G (un compás cada acorde)
prog = [(57, [69, 72, 76]), (53, [65, 69, 72]), (48, [64, 67, 72]), (55, [62, 67, 71])]
bars = int(DUR / (4 * B)) + 1
INTRO = 2           # compases suaves al principio
add(chime(), 0.05, g=0.35)
for bar in range(bars):
    t0 = bar * 4 * B; root, ch = prog[bar % 4]
    full = bar >= INTRO
    add(pad(ch, 4 * B), t0, g=0.32 if full else 0.24)
    for beat in range(4):
        tb = t0 + beat * B
        if full or beat >= 2 and bar == INTRO - 1:
            add(kick(), tb, g=0.95)
        if full:
            if beat in (1, 3): add(snare(), tb, g=0.35)
            add(hat(), tb + B / 2, pan=0.3, g=0.9); add(hat(), tb + B / 4 * 3, pan=-0.3, g=0.4)
            for e in (0, 0.5): add(bass(root - 12 + (12 if e and beat % 2 else 0), B / 2 * 0.9), tb + e * B, g=0.55)
        else:
            add(hat(), tb + B / 2, g=0.4)
    if full:  # arpegio
        seq = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[1] + 12]
        for s in range(8): add(pluck(seq[s % 4]), t0 + s * B / 2, pan=(-0.4 if s % 2 else 0.4), g=0.16)
# eco simple y salida
d = int(SR * B * 0.75)
for X in (L, R): X[d:] += X[:-d] * 0.18
fade = int(SR * 1.8); env = np.ones(n); env[-fade:] = np.linspace(1, 0, fade); env[:int(SR*0.02)] = np.linspace(0,1,int(SR*0.02))
st = np.stack([L * env, R * env], 1); st = np.tanh(st / np.abs(st).max() * 1.6) * 0.89
with wave.open('musica.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((st * 32767).astype('<i2').tobytes())
print('musica.wav', DUR, 's')
