// 声音和震动（第 2 节声音表）。WebAudio 合成，不依赖音频文件。
let ctx: AudioContext | null = null;
const ac = () => (ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)());
function tone(freq: number, ms: number, type: OscillatorType = 'sine', gain = 0.4, when = 0) {
  try { const a = ac(); const o = a.createOscillator(); const g = a.createGain(); o.type = type; o.frequency.value = freq; g.gain.value = gain; o.connect(g); g.connect(a.destination); o.start(a.currentTime + when); o.stop(a.currentTime + when + ms / 1000); } catch { /* 无音频 */ }
}
const vib = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* 无震动 */ } };
export const fx = {
  unlock: () => { try { void ac().resume(); } catch { /* */ } },
  scanOk: () => { tone(1000, 100); },
  done: () => { tone(880, 140); tone(1320, 160, 'sine', 0.4, 0.16); vib([40, 40, 40]); },
  error: () => { tone(250, 400, 'square', 0.3); vib(200); },
  tap: () => { tone(1800, 15, 'square', 0.05); vib(20); },
  alert: () => { tone(1200, 200); tone(900, 200, 'sine', 0.4, 0.25); tone(1200, 200, 'sine', 0.4, 0.5); vib([300, 100, 300, 100, 300]); },
};
