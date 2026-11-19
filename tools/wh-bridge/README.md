# wh-bridge：POS 硬件桥接（收银电脑本地）

POS 网页不直接碰硬件。每台收银电脑跑一个本地服务，监听 `ws://127.0.0.1:9123`，网页通过 WebSocket 发指令（`packages/app/src/pos/bridge.ts`）。

## 跑起来

```bash
cd tools/wh-bridge
npm install            # 只装 ws；serialport / usb 是可选依赖，装不上也能跑
node index.mjs --simulate          # 模拟模式：打印到控制台、钱箱假开、秤固定 1.500kg
PRINTER=usb DRAWER=printer node index.mjs            # 真机：USB 打印机 + 打印机 RJ-11 钱箱
PRINTER=tcp:192.168.1.50:9100 SCALE=serial:COM5:9600 node index.mjs
PRINTER=file:/dev/usb/lp0 node index.mjs             # Linux 直接写设备文件
PRINTER=com:COM3:9600 BRIDGE_CODEPAGE=gb18030 node index.mjs   # 打印机内置 GB18030 字库时转码（需 npm i iconv-lite）
```

## 协议

请求 `{ "id": 1, "cmd": "print", "text": "...", "escpos": "<base64>", "open_drawer": true }` → 响应 `{ "id": 1, "ok": true, "result": {...} }`。连上时推 `{ "event": "status", ... }`。

| cmd | 参数 | 结果 |
|---|---|---|
| status | | printer / drawer / scale / simulate / version |
| print | text（32 列纯文本）、escpos（base64，服务器 `lib/receipt.ts` 生成，含二维码和切纸）、open_drawer | { printed, bytes } |
| drawer | | { opened }。打印机 RJ-11：ESC p 0 25 250；USB 钱箱触发器：DRAWER=serial:COMx 写 0x07 |
| scale | | { weight_kg, stable }。串口连续输出格式 `ST,GS,+ 1.500kg`（ST 稳定 / US 不稳） |

快速验证：`node index.mjs --simulate`，另开终端 `node -e "const w=new (require('ws'))('ws://127.0.0.1:9123');w.on('open',()=>w.send(JSON.stringify({id:1,cmd:'status'})));w.on('message',m=>{console.log(String(m));if(String(m).includes('\"id\":1'))process.exit()})"`，或浏览器打开 http://127.0.0.1:9123 看 JSON。

## Windows 安装（第三阶段 01-Windows收银机安装.md）

1. 装 Node 20 LTS；`npm install` 后 `node index.mjs --simulate` 确认能起。
2. 58mm 打印机装驱动后记下端口（USB001 → `PRINTER=usb`；COM3 → `PRINTER=com:COM3:9600`）。中文乱码则试 `BRIDGE_CODEPAGE=gb18030`，还不行就换 80mm 或用驱动打位图。
3. 钱箱接打印机 RJ-11 → `DRAWER=printer`；USB 触发器 → `DRAWER=serial:COMx`。
4. 开机自启：`nssm install wh-bridge "C:\Program Files\nodejs\node.exe" "C:\wh-bridge\index.mjs"`，环境变量在 nssm 的 Environment 页填；托盘图标和 Inno Setup 安装包下一步做。
5. 安卓平板连收银电脑：浏览器 localStorage 设 `wh.bridge = ws://<电脑IP>:9123`，并把监听地址改成 `--host 0.0.0.0`（index.mjs 里 `http.listen(PORT, '127.0.0.1')` 改成环境变量，待做）。
