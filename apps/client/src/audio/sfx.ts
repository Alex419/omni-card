import type { Sfx } from '@omni/shared';

/**
 * Chiptune sound effects synthesised with WebAudio: no audio files to download.
 * Browsers only allow audio after a user gesture, so ensureAudio() is called from input handlers.
 */
let ac: AudioContext | null = null;
let enabled = true;

export function ensureAudio() {
  if (!ac) {
    try {
      ac = new AudioContext();
    } catch {
      ac = null;
    }
  }
  if (ac?.state === 'suspended') ac.resume().catch(() => {});
}

export const setSound = (on: boolean) => (enabled = on);
export const soundOn = () => enabled;

function beep(f1: number, f2: number, dur: number, type: OscillatorType = 'square', vol = 0.045) {
  if (!enabled || !ac) return;
  const t = ac.currentTime;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur = 0.03, vol = 0.08) {
  if (!enabled || !ac) return;
  const b = ac.createBuffer(1, Math.max(1, (ac.sampleRate * dur) | 0), ac.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = ac.createBufferSource();
  const g = ac.createGain();
  g.gain.value = vol;
  s.buffer = b;
  s.connect(g).connect(ac.destination);
  s.start();
}

export const SFX: Record<Sfx, () => void> = {
  pick: () => beep(520, 880, 0.07),
  drop: () => beep(320, 140, 0.08),
  flip: () => beep(900, 1400, 0.05, 'square', 0.03),
  deal: () => {
    for (let i = 0; i < 5; i++) setTimeout(() => beep(1300, 700, 0.04, 'triangle', 0.06), i * 60);
  },
  err: () => beep(220, 110, 0.14, 'sawtooth', 0.035),
  give: () => {
    beep(660, 990, 0.08);
    setTimeout(() => beep(990, 1480, 0.09), 80);
  },
  shuffle: () => {
    for (let i = 0; i < 7; i++) setTimeout(() => noise(0.035), i * 50);
  },
  tidy: () => {
    for (let i = 0; i < 3; i++)
      setTimeout(() => {
        noise(0.02, 0.06);
        beep(500 + i * 120, 400 + i * 120, 0.03, 'square', 0.03);
      }, i * 70);
  },
  stick: () => {
    noise(0.025, 0.12);
    beep(170, 80, 0.07, 'square', 0.06);
  },
  rip: () => {
    noise(0.12, 0.1);
    beep(700, 180, 0.1, 'sawtooth', 0.03);
  },
  huh: () => {
    beep(300, 600, 0.09, 'square', 0.04);
    setTimeout(() => beep(600, 450, 0.08, 'square', 0.04), 90);
  },
  join: () => {
    beep(440, 660, 0.06);
    setTimeout(() => beep(660, 880, 0.06), 70);
  },
};

/** A single quiet tick, for selecting cards. */
export const tick = () => beep(1300, 700, 0.04, 'triangle', 0.06);
