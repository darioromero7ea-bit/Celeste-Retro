// Sintetizador estilo PICO-8: 4 canales, 8 formas de onda, efectos y patrones de musica.
import { SFX_LINES, MUSIC_LINES } from './data';

interface Note {
  pitch: number;
  wave: number;
  vol: number;
  fx: number;
}
interface Sfx {
  speed: number;
  loopStart: number;
  loopEnd: number;
  notes: Note[];
}
interface Pattern {
  flags: number;
  chans: number[];
}

const sfxData: Sfx[] = [];
for (let n = 0; n < 64; n++) {
  const line = SFX_LINES[n] || '';
  const notes: Note[] = [];
  for (let i = 0; i < 32; i++) {
    const s = line.substr(8 + i * 5, 5);
    notes.push({
      pitch: parseInt(s.substr(0, 2), 16) || 0,
      wave: parseInt(s.substr(2, 1), 16) || 0,
      vol: parseInt(s.substr(3, 1), 16) || 0,
      fx: parseInt(s.substr(4, 1), 16) || 0,
    });
  }
  sfxData.push({
    speed: Math.max(1, parseInt(line.substr(2, 2), 16) || 1),
    loopStart: parseInt(line.substr(4, 2), 16) || 0,
    loopEnd: parseInt(line.substr(6, 2), 16) || 0,
    notes,
  });
}

const patterns: Pattern[] = [];
for (let n = 0; n < 64; n++) {
  const line = MUSIC_LINES[n];
  if (!line) {
    patterns.push({ flags: 4, chans: [0x41, 0x42, 0x43, 0x44] });
    continue;
  }
  const [f, c] = line.split(' ');
  patterns.push({
    flags: parseInt(f, 16),
    chans: [0, 1, 2, 3].map((i) => parseInt(c.substr(i * 2, 2), 16)),
  });
}

interface Chan {
  sfx: number;
  pos: number; // posicion en muestras dentro del sfx
  phase: number;
  music: boolean;
  noise: number;
}

const tri = (t: number) => (t < 0.5 ? 4 * t - 1 : 3 - 4 * t);

function wave(w: number, t: number, ch: Chan): number {
  switch (w) {
    case 0:
      return tri(t) * 0.9;
    case 1:
      return t < 0.875 ? (t / 0.875) * 2 - 1 : (1 - t) / 0.125 * 2 - 1;
    case 2:
      return (t * 2 - 1) * 0.65;
    case 3:
      return t < 0.5 ? 0.45 : -0.45;
    case 4:
      return t < 1 / 3 ? 0.45 : -0.45;
    case 5:
      return (tri(t) + tri((t * 2) % 1) * 0.5) * 0.6;
    case 6: {
      return ch.noise;
    }
    case 7:
      return (tri(t) + tri((t * 1.007 * 2) % 1)) * 0.5;
    default:
      return tri(t);
  }
}

export class P8Audio {
  ctx: AudioContext | null = null;
  node: ScriptProcessorNode | null = null;
  chans: Chan[] = [0, 1, 2, 3].map(() => ({ sfx: -1, pos: 0, phase: 0, music: false, noise: 0 }));
  musicPlaying = false;
  pattern = 0;
  musicMask = 7;
  masterChan = 0;
  gain = 1; // ganancia de fundido de la musica
  fadeStep = 0;
  fadeTarget = 1;
  stopAfterFade = false;
  muted = false;
  sr = 44100;

  init() {
    if (this.ctx) return;
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.sr = this.ctx!.sampleRate;
    this.node = this.ctx!.createScriptProcessor(2048, 0, 1);
    this.node.onaudioprocess = (e) => this.process(e.outputBuffer.getChannelData(0));
    this.node.connect(this.ctx!.destination);
  }

  resume() {
    this.init();
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
  }

  sfx(n: number) {
    if (n < 0 || n > 63) return;
    // canales libres de musica; si no hay ninguno libre, roba el ultimo
    let target = -1;
    for (let i = 0; i < 4; i++) {
      const reserved = this.musicPlaying && (this.musicMask & (1 << i)) !== 0;
      if (reserved) continue;
      if (this.chans[i].sfx < 0) {
        target = i;
        break;
      }
      if (target < 0) target = i;
    }
    if (target < 0) target = 3;
    const c = this.chans[target];
    c.sfx = n;
    c.pos = 0;
    c.phase = 0;
    c.music = false;
  }

  startPattern(p: number) {
    this.pattern = p;
    const pat = patterns[p];
    this.masterChan = -1;
    let firstEnabled = -1;
    for (let i = 0; i < 4; i++) {
      const v = pat.chans[i];
      if (!(this.musicMask & (1 << i))) continue;
      const c = this.chans[i];
      if (v & 64) {
        if (c.music) {
          c.sfx = -1;
          c.music = false;
        }
        continue;
      }
      c.sfx = v & 63;
      c.pos = 0;
      c.phase = 0;
      c.music = true;
      const s = sfxData[c.sfx];
      const looping = s.loopStart < s.loopEnd;
      if (firstEnabled < 0) firstEnabled = i;
      if (this.masterChan < 0 && !looping) this.masterChan = i;
    }
    if (this.masterChan < 0) this.masterChan = firstEnabled;
  }

  music(n: number, fadeMs = 0, mask = 7) {
    if (n < 0) {
      if (fadeMs > 0 && this.musicPlaying) {
        this.fadeTarget = 0;
        this.fadeStep = -this.gain / ((fadeMs / 1000) * this.sr);
        this.stopAfterFade = true;
      } else {
        this.stopMusic();
      }
      return;
    }
    this.musicMask = mask;
    this.musicPlaying = true;
    this.stopAfterFade = false;
    if (fadeMs > 0) {
      this.gain = 0;
      this.fadeTarget = 1;
      this.fadeStep = 1 / ((fadeMs / 1000) * this.sr);
    } else {
      this.gain = 1;
      this.fadeStep = 0;
    }
    this.startPattern(n);
  }

  stopMusic() {
    this.musicPlaying = false;
    for (const c of this.chans) {
      if (c.music) {
        c.sfx = -1;
        c.music = false;
      }
    }
    this.gain = 1;
    this.fadeStep = 0;
  }

  nextPattern() {
    const pat = patterns[this.pattern];
    if (pat.flags & 2) {
      let p = this.pattern;
      while (p > 0 && !(patterns[p].flags & 1)) p--;
      this.startPattern(p);
    } else if (pat.flags & 4) {
      this.stopMusic();
    } else if (this.pattern + 1 >= 64) {
      this.stopMusic();
    } else {
      this.startPattern(this.pattern + 1);
    }
  }

  process(out: Float32Array) {
    const sr = this.sr;
    const tickLen = 183 * (sr / 22050);
    for (let i = 0; i < out.length; i++) {
      let mix = 0;
      if (this.fadeStep !== 0) {
        this.gain += this.fadeStep;
        if ((this.fadeStep > 0 && this.gain >= this.fadeTarget) || (this.fadeStep < 0 && this.gain <= this.fadeTarget)) {
          this.gain = this.fadeTarget;
          this.fadeStep = 0;
          if (this.stopAfterFade) {
            this.stopAfterFade = false;
            this.stopMusic();
          }
        }
      }
      for (let k = 0; k < 4; k++) {
        const ch = this.chans[k];
        if (ch.sfx < 0) continue;
        const s = sfxData[ch.sfx];
        const noteLen = s.speed * tickLen;
        const looping = s.loopStart < s.loopEnd;
        let idxF = ch.pos / noteLen;
        if (looping && idxF >= s.loopEnd && !(ch.music && k === this.masterChan)) {
          ch.pos -= (s.loopEnd - s.loopStart) * noteLen;
          idxF = ch.pos / noteLen;
        }
        let idx = Math.floor(idxF);
        if (idx >= 32 || (looping && ch.music && k === this.masterChan && idx >= s.loopEnd)) {
          if (!(ch.music && k === this.masterChan)) {
            ch.sfx = -1;
            ch.music = false;
            continue;
          }
          idx = 31;
        }
        const note = s.notes[idx];
        const frac = idxF - idx;
        let pitch = note.pitch;
        let vol = note.vol / 7;
        const fx = note.fx;
        if (fx === 1 && idx > 0) {
          const pv = s.notes[idx - 1];
          pitch = pv.pitch + (note.pitch - pv.pitch) * frac;
          vol = (pv.vol + (note.vol - pv.vol) * frac) / 7;
        } else if (fx === 2) {
          pitch += Math.sin((ch.pos / sr) * Math.PI * 2 * 7.5) * 0.5;
        } else if (fx === 4) {
          vol *= frac;
        } else if (fx === 5) {
          vol *= 1 - frac;
        } else if (fx === 6 || fx === 7) {
          const base = idx & ~3;
          const step = Math.floor((ch.pos - idx * noteLen) / (tickLen * (fx === 6 ? 2 : 4)));
          pitch = s.notes[base + (step % 4)].pitch;
        }
        let f = 440 * Math.pow(2, (pitch - 33) / 12);
        if (fx === 3) f *= 1 - frac;
        if (vol > 0 && note.vol > 0) {
          ch.phase += f / sr;
          if (ch.phase >= 1) {
            ch.phase -= Math.floor(ch.phase);
            ch.noise = Math.random() * 2 - 1;
          }
          const sample = wave(note.wave, ch.phase, ch);
          mix += sample * vol * 0.22 * (ch.music ? this.gain : 1);
        }
        ch.pos += 1;
      }
      // avance de patrones
      if (this.musicPlaying && this.masterChan >= 0) {
        const mc = this.chans[this.masterChan];
        if (mc.music) {
          const s = sfxData[mc.sfx];
          const looping = s.loopStart < s.loopEnd;
          const len = (looping ? s.loopEnd : 32) * s.speed * tickLen;
          if (mc.pos >= len) this.nextPattern();
        } else {
          this.nextPattern();
        }
      }
      out[i] = this.muted ? 0 : Math.max(-1, Math.min(1, mix));
    }
  }
}
