# Windows 收银机硬件安装（已购三件）

这三件都是白牌通用货，网上查不到唯一型号，但都是标准协议：打印机是 ESC/POS 的"POS-58"一类，扫码枪是 USB 键盘模式，钱箱是 RJ-11。按下面做就能用。

## 1. 58mm 打印机

先用 USB，不用蓝牙（Windows 上蓝牙打印经常断）。

1. 打印机接电，装纸，按住走纸键再开机，它会自己打一张自检页。自检页上的 "Interface"、"Code page"、"Baud rate" 这几行留着。
2. USB 线接电脑。Windows 会显示"未知设备"或 "USB Printing Support"，正常。
3. 装驱动，三选一，按顺序试：
   - 卖家的驱动：在 Shopee 订单里点"联系卖家"，发一句 "driver download link please"。卖家一般给一个 Google Drive 链接，文件名通常是 `POS Printer Driver Setup V7.17.exe`、`V8.11.exe` 或 `XPrinter Driver Setup V8.2.exe`。这是首选。
   - Xprinter 官网的通用驱动：xprintertech.com 的 Download 页，选 Receipt Printer，下载 `XPrinter Driver Setup V8.2`，装的时候型号选 `XP-58` 系列，端口选 USB。多数 58mm 白牌机和它兼容。
   - 兜底：Windows 自带 "Generic / Text Only" 驱动，能打纯文字，不能打中文和二维码，只用来确认 USB 通了。
4. 装完到"设置 → 蓝牙和其他设备 → 打印机和扫描仪"，点这台打印机 → 打印测试页。能出纸就通了。
5. 把打印机属性里显示的**名称**和**端口**（USB001 或 COM3 这种）告诉我。

不要从 oemdrivers 这类第三方站下载 exe，来源不明。只用卖家给的或 Xprinter 官网的。

## 2. 2D 扫码枪

1. 插电脑 USB，不用装驱动，Windows 当它是键盘。
2. 打开记事本，扫任何商品条码。正常是：条码数字出现，光标自动换到下一行。
3. 如果没有自动换行：盒子里的说明书有一页"设置码"，找 **Add Enter Suffix** 或 **CR Suffix** 或 **回车后缀**，扫一下那个码即可。找不到说明书就在 Shopee 订单里问卖家要 PDF。
4. 用手机打开任何网址的二维码对着枪扫，记事本出现网址就说明二维码也通了。

## 3. 钱箱

1. 看打印机背面有没有一个电话线一样的方口（RJ-11，通常标 DK 或 Drawer）。
2. 有：钱箱的线插进去。打印机属性 → 设备设置或 Peripherals，找 Cash Drawer，选 "Open before printing"，打一张测试页钱箱应弹开。
3. 没有：告诉我，买一个 "USB cash drawer trigger"（RJ-11 转 USB，Shopee 约 RM 50 到 80），桥接服务可以直接控制。

## 4. 装好后发给我的信息

- 打印机在 Windows 里的名称和端口
- 自检页上的 Code page 那一行（决定中文怎么打）
- 打印机背面有没有 RJ-11 口
- 扫码枪扫完是否自动换行

有这四条，第三阶段的桥接服务配置就能写死，不用再猜。
