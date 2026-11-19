#!/usr/bin/env node
// 仓店通 POS 硬件桥接（收银电脑本地跑）。WebSocket ws://127.0.0.1:9123。
// 协议：客户端发 { id, cmd, ...参数 }，回 { id, ok, result | error }；连上时和状态变化时推 { event: 'status', ... }。
// 命令：
//   status                      → { printer, drawer, scale, simulate, version }
//   print { text, escpos?, open_drawer? }  escpos 为 base64 的 ESC/POS 字节；没有则把 text 按 32 列纯文本打；找不到打印机就打到控制台
//   drawer                      → 钱箱：打印机 RJ-11 口（ESC p 0 25 250）或 USB 钱箱触发器（串口写 0x07）
//   scale                       → { weight_kg, stable }：串口读秤（常见 TSCALE/DIGI 连续输出 "ST,GS,+0001.500kg"）；模拟模式固定 1.500kg
//   beep
// 参数（环境变量或命令行）：--simulate 模拟设备；--port 9123；PRINTER=usb|tcp:192.168.1.50:9100|file:/dev/usb/lp0|com:COM3|none；
//   DRAWER=printer|serial:COM4|none；SCALE=serial:COM5:9600|none；BRIDGE_CODEPAGE=gb18030|utf8（中文：打印机内置 GB18030 字库时转码；否则 utf8 原样给驱动）
// 依赖 ws（必装）；serialport / usb 可选，缺少时相应设备自动退为模拟。
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : process.env[n.toUpperCase()] ?? d; };
const SIM = flag('simulate') || process.env.SIMULATE === '1';
const PORT = Number(opt('port', 9123));
const CFG = { printer: SIM ? 'simulate' : opt('printer', 'usb'), drawer: SIM ? 'simulate' : opt('drawer', 'printer'), scale: SIM ? 'simulate' : opt('scale', 'none'), codepage: opt('bridge_codepage', 'utf8') };
const VERSION = '0.1.0';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- 可选依赖 ----------
let SerialPort = null; let usb = null;
try { ({ SerialPort } = await import('serialport')); } catch { /* 无 serialport */ }
try { usb = await import('usb'); } catch { /* 无 usb */ }
let iconv = null; try { iconv = (await import('iconv-lite')).default; } catch { /* 无 iconv-lite：中文走 utf8 */ }

// ---------- 打印机 ----------
const ESC = 0x1b, GS = 0x1d;
const encodeText = (text) => (CFG.codepage === 'gb18030' && iconv ? iconv.encode(text, 'gb18030') : Buffer.from(text, 'utf8'));
function textToEscPos(text, openDrawer) {
  const parts = [Buffer.from([ESC, 0x40])];
  if (openDrawer) parts.push(Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa]));
  parts.push(encodeText(text.replace(/\r?\n/g, '\r\n')), Buffer.from([ESC, 0x64, 0x03]), Buffer.from([GS, 0x56, 0x42, 0x00]));
  return Buffer.concat(parts);
}
async function writeSerial(path, baud, buf) {
  if (!SerialPort) throw new Error('serialport module not installed');
  await new Promise((res, rej) => { const p = new SerialPort({ path, baudRate: baud, autoOpen: false }); p.open((e) => { if (e) return rej(e); p.write(buf, (e2) => { if (e2) return rej(e2); p.drain(() => p.close(() => res())); }); }); });
}
async function writeTcp(host, port, buf) {
  await new Promise((res, rej) => { const s = createConnection({ host, port: Number(port) }, () => s.end(buf, res)); s.setTimeout(8000, () => { s.destroy(); rej(new Error('tcp timeout')); }); s.on('error', rej); });
}
async function writeUsb(buf) {
  if (!usb) throw new Error('usb module not installed');
  const dev = usb.getDeviceList().find((d) => d.configDescriptor?.interfaces?.some((i) => i.some((a) => a.bInterfaceClass === 7)));
  if (!dev) throw new Error('no USB printer');
  dev.open(); const iface = dev.interfaces.find((i) => i.descriptor.bInterfaceClass === 7); try { if (iface.isKernelDriverActive()) iface.detachKernelDriver(); } catch { /* win */ }
  iface.claim(); const ep = iface.endpoints.find((e) => e.direction === 'out');
  await new Promise((res, rej) => ep.transfer(buf, (e) => (e ? rej(e) : res())));
  try { iface.release(true, () => dev.close()); } catch { /* ignore */ }
}
async function printRaw(buf) {
  const [kind, a, b] = CFG.printer.split(':');
  if (kind === 'simulate' || kind === 'none') return false;
  if (kind === 'tcp') return writeTcp(a, b ?? 9100, buf).then(() => true);
  if (kind === 'file') return writeFile(a, buf).then(() => true);
  if (kind === 'com' || kind === 'serial') return writeSerial(a, Number(b ?? 9600), buf).then(() => true);
  if (kind === 'usb') return writeUsb(buf).then(() => true);
  throw new Error(`unknown PRINTER ${CFG.printer}`);
}
async function cmdPrint(p) {
  const buf = p.escpos ? Buffer.from(p.escpos, 'base64') : textToEscPos(String(p.text ?? ''), !!p.open_drawer);
  let real = false;
  try { real = await printRaw(buf); } catch (e) { log('print failed, falling back to console:', e.message); }
  if (!real) { console.log('--- RECEIPT (console) ---\n' + (p.text ?? `[escpos ${buf.length} bytes]`) + '--- END ---'); }
  return { printed: real, bytes: buf.length, device: CFG.printer };
}
async function cmdDrawer() {
  const [kind, a, b] = CFG.drawer.split(':');
  if (kind === 'simulate' || kind === 'none') { log('DRAWER open (simulated)'); return { opened: kind === 'simulate', device: CFG.drawer }; }
  if (kind === 'printer') { const ok = await printRaw(Buffer.from([ESC, 0x70, 0x00, 0x19, 0xfa])).catch((e) => { log('drawer failed', e.message); return false; }); return { opened: ok, device: 'printer' }; }
  if (kind === 'serial') { await writeSerial(a, Number(b ?? 9600), Buffer.from([0x07])); return { opened: true, device: CFG.drawer }; }
  throw new Error(`unknown DRAWER ${CFG.drawer}`);
}
// ---------- 电子秤 ----------
let scalePort = null; let lastScale = { weight_kg: 0, stable: false, at: 0 };
function startScale() {
  const [kind, path, baud] = CFG.scale.split(':');
  if (kind !== 'serial' || !SerialPort) return;
  try {
    scalePort = new SerialPort({ path, baudRate: Number(baud ?? 9600) });
    let buf = '';
    scalePort.on('data', (d) => {
      buf += d.toString('ascii');
      let i; while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        // "ST,GS,+  1.500kg" / "US,GS,+  0.000kg"（ST 稳定 US 不稳）；也接受纯数字
        const m = line.match(/([-+]?\s*\d+(?:\.\d+)?)\s*(kg|g)?/i); if (!m) continue;
        let w = Number(m[1].replace(/\s/g, '')); if ((m[2] ?? 'kg').toLowerCase() === 'g') w /= 1000;
        lastScale = { weight_kg: Math.round(w * 1000) / 1000, stable: /^ST/i.test(line) || !/^US/i.test(line), at: Date.now() };
      }
    });
    scalePort.on('error', (e) => log('scale error', e.message));
  } catch (e) { log('scale open failed', e.message); scalePort = null; }
}
async function cmdScale() {
  if (CFG.scale === 'simulate') return { weight_kg: 1.5, stable: true, simulated: true };
  if (!scalePort) return null;
  if (Date.now() - lastScale.at > 3000) return { weight_kg: lastScale.weight_kg, stable: false, stale: true };
  return { weight_kg: lastScale.weight_kg, stable: lastScale.stable };
}
const status = () => ({ printer: CFG.printer, drawer: CFG.drawer, scale: CFG.scale, simulate: SIM, version: VERSION, codepage: CFG.codepage, serialport: !!SerialPort, usb: !!usb });

// ---------- WebSocket 服务 ----------
const http = createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true, ...status() })); });
const wss = new WebSocketServer({ server: http });
wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ event: 'status', ...status() }));
  ws.on('message', async (raw) => {
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    const reply = (ok, result, error) => { try { ws.send(JSON.stringify({ id: m.id, ok, result, error })); } catch { /* closed */ } };
    try {
      switch (m.cmd) {
        case 'status': return reply(true, status());
        case 'print': return reply(true, await cmdPrint(m));
        case 'drawer': return reply(true, await cmdDrawer());
        case 'scale': return reply(true, await cmdScale());
        case 'beep': process.stdout.write('\x07'); return reply(true, { beeped: true });
        default: return reply(false, null, `unknown cmd ${m.cmd}`);
      }
    } catch (e) { reply(false, null, e.message); }
  });
});
startScale();
http.listen(PORT, '127.0.0.1', () => log(`wh-bridge ${VERSION} listening ws://127.0.0.1:${PORT}`, SIM ? '(simulate)' : '', JSON.stringify(CFG)));
process.on('SIGINT', () => { log('bye'); process.exit(0); });
