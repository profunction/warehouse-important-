# 仓店通 全套屏幕设计提示词（Muse 版，方向 D 深林与黄铜）
用法：手机屏幕先贴「手机风格基础」，网页先贴「网页风格基础」，再贴一个屏幕的提示词。一次一个屏幕。
## 手机风格基础
```
Design a premium, understated mobile app screen for "WarehouseShop" (仓店通), an inventory app for small supermarkets in Malaysia.
Palette: paper #FAF8F3, dim paper #F3F0E8, ink #15201A, muted grey-green #43534A, hairline #E3DFD2, forest green #0E3B2B (primary buttons only), brass #B8894A (at most 2% of the screen: a number, an underline, one rule).
Typography: headings and large numbers in Fraunces (Latin) and Noto Serif SC (Chinese); body and buttons in Inter and Noto Sans SC. Small labels uppercase, letter-spacing 0.24em.
Shape: square corners, 1px hairline dividers instead of cards, no gradients, no glass, shadows only on product photos. Thin line icons (Lucide style), no emoji.
Hard rules for elderly staff: one task per screen, max 4 actions on a home screen, buttons at least 72px tall, body text 22px, big numbers 56px, contrast 7:1, icon + text never color alone, every label shows Chinese on top and a smaller Malay · English line under it.
Portrait 390 x 844. Use realistic Malaysian supermarket products with photos (Coca-Cola 325ml, Milo 1kg, Lays 70g, Dutch Lady milk 1L, rice 5kg).
Screen top: a back row "‹ 返回 Kembali · Back" on the left and a serif screen title on the right, unless it is a home screen.
```
## 网页风格基础
```
Design a desktop admin page (1440 x 900) for "WarehouseShop" in the same premium system: paper background #FAF8F3, left sidebar in forest green #0E3B2B with serif brand name and small uppercase group labels, active item marked by a 2px brass left rule. Headings in Noto Serif SC, body Inter / Noto Sans SC, tables with hairline rows and uppercase small headers, KPI numbers in Fraunces separated by hairlines (no boxes). Brass only for attention numbers. No gradients, no colorful icons.
```

## 共用（所有角色）

### C1 登录

```
LOGIN. Wordmark "WAREHOUSESHOP" top left with a small forest-green square seal. Three segmented buttons in one hairline-bordered row: 扫员工卡 / 手机号 / 电邮. Below: a dark camera viewfinder with thin mint corner marks, label "IMBAS KAD · SCAN BADGE", six PIN dots, a 3x4 serif-digit keypad in a hairline grid. Bottom: 中文 / BM / EN text chips, active one underlined in brass.
```

### C2 选站点

```
SELECT SITE. Serif title 选站点. Hairline rows, each: site icon, site name 22px, code and roles in muted 15px, chevron right.
```

### C3 首页

```
HOME for a stock staff member. Top strip: company wordmark and "店名 · ● 在线". Date line in small uppercase, serif greeting 早安，阿明, role line. A 26px brass rule. Then a numbered task list (01–04) with hairlines: 收货 Terima · Receive, 补货 Isi semula · Refill (brass serif count 12 on the right), 盘点 Kira · Count, 查询 Cari · Lookup, each row 92px with a thin icon and chevron. Bottom: 中文 BM EN chips, mic "问", 退出.
```

### C4 查询结果

```
LOOKUP RESULT. Product header: 72px photo with soft shadow, name 22px, barcode muted, 售价 RM 1.80. Row 总库存 with serif 56px "72" and small 件. Section label 位置: rows with a hairline-bordered location code chip (S-01, A-01-1 ★) and serif quantity on the right. Section 最近移动: 3 rows "11/18 07:51 收货 → S-01 24". Full-width green button 下一个 Seterusnya · Next.
```

### C5 机器人

```
ASSISTANT chat. Serif title 问. Chat bubbles: staff question "可乐放哪里", answer "A-01-1 货架，后仓 S-01 还有 48 件" with a ghost button "去这个屏幕". Bottom: a hairline input "按住说话 / 打字" with a mic button 72px.
```

### C6 我的工单

```
MY TICKETS. Serif title 我的工单. Hairline rows: ticket icon, title 22px "负库存 可口可乐 @ A-01-1", "#12 · 11/18" muted, status text on the right (NEW in brass, IN PROGRESS muted). Ghost full-width button "+ 开工单".
```

### C7 设置

```
SETTINGS. Sections with uppercase labels: 语言 (three segmented buttons), 字体大小 (正常 / 特大), 改 PIN (two hairline inputs and a ghost button), 同步 (one ghost button 重新下载数据). Nothing else.
```

### C8 离线状态

```
HOME while OFFLINE: a 52px bar at the top on dim paper with a 3px brass left rule "离线 · 3 笔待上传 · Luar talian", the online dot turns brass, the 审批 row is faded with small uppercase "需要网络". Everything else unchanged.
```

## 仓库员 / 库存员

### W1 待收货

```
RECEIVE LIST. Label "01 · TERIMA · RECEIVE", serif title 收货, sub "今天 3 张". Hairline rows: supplier name 22px, "PO-2026-0412 · 8 种 · 今天到" muted, status text 待收 on the right. Bottom ghost button "无单收货 Terima tanpa PO".
```

### W2 收货扫产品

```
RECEIVE SCAN. Top row back and title 收货 with serif "2 / 8". Dark viewfinder block with mint corner marks and one thin laser line. Below: uppercase label "IMBAS KOD BAR · SCAN BARCODE", then 请扫产品条码 28px bold. A muted line "上一个：可口可乐 325ml ✓ 24 件". Two ghost buttons 打字输入, 手电.
```

### W3 收货输数量

```
RECEIVE QUANTITY. Product header (photo, 可口可乐 325ml, barcode, "1 箱 = 24 件 · 放 S-01"). Right-aligned serif 56px "2" with small uppercase 箱, under it muted "= 48 件 · 应收 48". Quick keys row +1 箱 (24) / +1 件 / 清 as hairline-bordered buttons. A 3x4 keypad in a hairline grid with serif digits. Full-width green 80px button 确认 48 件.
```

### W4 收货损坏

```
DAMAGED GOODS. Product header. Serif 56px damaged qty "3" with label 损坏数量. Keypad. A photo slot 120px square with a camera icon and "拍照 Ambil gambar". Green button 记录损坏并通知老板.
```

### W5 收货完成

```
RECEIVE SUMMARY. Serif title 收货完成. Hairline rows per product: name, received / expected "24 / 24" in serif, variance rows show brass "-3". Bottom line "2 项差异已通知老板" in brass. Green button 完成, ghost button 打印收货单.
```

### W6 待上架

```
PUT-AWAY LIST. Label "RCV · SUSUN · PUT AWAY", serif title 上架, sub "收货区还有 12 种". Hairline rows: photo, product name, "RCV-01-1 · 48 件" muted, chevron. Ghost button 扫产品.
```

### W7 上架扫产品

```
PUT-AWAY SCAN with suggestion: after the viewfinder, a line "去 Pergi ke" and a big serif location "A-03-2" 44px with a thin hairline box around it. Then 请扫货位 instruction and the two ghost buttons.
```

### W8 上架扫货位（扫错）

```
ERROR state: full screen deep red #9B2C2C, a thin white circle with an X, serif white text "这是 A-03-3，请去 A-03-2", small white "Ini A-03-3 · This is A-03-3", one white full-width button 知道了 Faham · OK.
```

### W9 上架输数量

```
PUT-AWAY QUANTITY. Product header with "RCV-01-1 → A-03-2". Serif 56px "48" placeholder in muted grey (default = all remaining). Keypad. Green button 确认 48 件.
```

### W10 拣货单

```
PICK LIST. Serif title 拣货. Hairline rows: transfer number "TR-0031", destination store, "12 行 · 14:00 前" muted, chevron.
```

### W11 拣货步骤

```
PICK STEP, one line per screen: uppercase "3 / 12", big serif location "A-03-2" 44px, product photo and name, serif qty "6 箱". Instruction 请扫货位. Ghost button "这里没有 Tiada di sini".
```

### W12 拣货完成

```
PICK DONE. Thin green circle with a check, serif 拣货完成, "12 行 · 86 件". Two buttons: ghost 打印箱贴, green 已装车 Sudah muat.
```

## 盘点员

### K1 今日盘点

```
COUNT TODAY. Label "KIRA STOK · COUNT", serif title 今日盘点, sub "今天 20 个，完成 7 个". Hairline rows: serif index, location code chip, status 未数 / 已数 on the right. Rows already counted have a thin green check.
```

### K2 盘点扫货位

```
COUNT SCAN LOCATION. Viewfinder, label "IMBAS LOKASI · SCAN LOCATION", 请扫货位, muted "下一个：A-03-2".
```

### K3 盘点扫产品

```
COUNT SCAN PRODUCT. Location chip A-03-2 at top. Viewfinder. Below a hairline list of products already counted here with their counted qty in serif. No system quantity anywhere (blind count).
```

### K4 盘点输数量

```
COUNT QUANTITY. Product header, serif 56px empty placeholder "—", keypad, green button 确认. No expected quantity shown.
```

### K5 货位完成

```
LOCATION DONE. Location chip, hairline list of counted products, two buttons: ghost "货位是空的 Lokasi kosong", green "这个货位数完了 Selesai".
```

### K6 盘点结束

```
COUNT SUBMITTED. Thin green circle with a check, serif 今天盘点完成, muted "已送主管审批 · Dihantar untuk kelulusan". One ghost button 回到首页.
```

### K7 我的记录

```
MY COUNT HISTORY. Hairline rows by date: "11/17 · 20 货位 · 2 差异", variance count in brass serif.
```

## 上架员

### S1 货架缺货清单

```
SHELF LOW LIST. Label "ISI SEMULA · REFILL", serif title 补货, sub "最急在上". Hairline rows: photo, product name 22px, "A-01-1 · 货架有 0 · 后仓有 48" muted, a small dot on the right (brass = low, red = empty). Ghost button 扫货架.
```

### S2 补货扫货架

```
REFILL SCAN SHELF. Viewfinder, label "IMBAS RAK · SCAN SHELF", 请扫货架.
```

### S3 补货扫产品 + 询问设位置

```
REFILL SCAN PRODUCT with a centered modal on paper: "把这个产品的位置设为 A-01-1 吗？" serif, small Malay/English line, two buttons 否 (ghost) and 是 (green).
```

### S4 补货输数量

```
REFILL QUANTITY. Product header "S-01 (后仓有 48) → A-01-1". Serif placeholder "24". Keypad. Green button 确认 24 件.
```

### S5 登记位置

```
ASSIGN SHELF: two-step scan. Step indicator "1 货架 · 2 产品" as small uppercase with the active step in brass. Viewfinder and instruction.
```

### S6 顾客呼叫

```
CUSTOMER CALL full screen: forest green background, white serif "顾客在 B 走道找酱油", product photo 96px, "Pelanggan di lorong B · Customer in aisle B", one white 80px button 我去 Saya pergi · On my way.
```

### S7 收调拨

```
RECEIVE TRANSFER. Serif title 收调拨, transfer number, hairline rows per product with serif "sent / received" numbers, green button 完成.
```

### S8 申请调拨

```
REQUEST TRANSFER. Product header after scan, one green button 要补货 Minta stok · Request refill, muted note "数量由经理决定".
```

## 收银员 POS（横屏平板 1280 x 800）

### P1 开班

```
OPEN SHIFT landscape. Left: serif 开班, cashier name and terminal "KL01-P2". Right: serif 56px opening cash input and keypad. Green button 开始收银.
```

### P2 收银主屏

```
POS MAIN landscape. Left 60%: hairline list of scanned lines (photo, name, qty × price, line total in serif). Right 40%: serif 72px total "RM 48.60" on paper, four stacked buttons 付款 (green 80px), 数量, 删行, 挂单 (ghost). Top strip with wordmark, cashier name, time.
```

### P3 称重

```
WEIGH overlay: product 三文鱼, serif weight "0.846 kg" from the scale in forest green, unit price, computed line total, status "秤已稳定" with a thin check, green button 加入.
```

### P5 付款

```
PAYMENT landscape. Left: total in serif 72px. Right: three large buttons 现金 / 卡 / 电子钱包 (hairline bordered), then a keypad for cash received, "找零 RM 1.40" in serif. Green button 完成.
```

### P6 完成

```
SALE DONE: paper background, thin green circle check, serif 已收款, "找零 RM 1.40" serif 56px, two buttons 要电子发票 (ghost) and 下一位 (green).
```

### P8 退货

```
RETURN. Scanned receipt header "KL01-P2-000123 · 11/18 14:02", hairline rows with a square checkbox per line, serif refund total, green button 申请退货 with muted "经理批准后退款".
```

### P11 日结

```
CLOSE SHIFT. Serif 日结. Rows: 预期现金 RM 1,284.50, 数到的现金 (input), 差额 in brass. Green button 打印 Z 报表并交班.
```

## 经理（手机）

### M1 待审批

```
APPROVALS LIST. Serif title 审批. Hairline rows: type label uppercase (盘点差异 / 退货 / 调拨), one-line summary, amount in serif brass, requester and time muted, chevron.
```

### M2 盘点差异明细

```
VARIANCE DETAIL. Rows per product: name, "系统 48 · 实数 45" muted, difference "-3" in brass serif, "RM -3.60". Each row has two small ghost toggles 接受 / 重盘. Bottom: green 批准, ghost 全部重盘.
```

### M4 手动调整

```
MANUAL ADJUST: product header, location chip, serif new quantity, a reason picker as hairline rows (损坏 / 过期 / 样品 / 盘错), a photo slot, green button 提交审批.
```

### M6 站点今日

```
SITE TODAY. Serif greeting, KPI rows separated by hairlines: 今日销售 RM 4,820, 未处理工单 3, 负库存 1, 待上架 12, 待收货 2, each number in serif, attention numbers in brass.
```

## 老板（手机）

### O6 老板报表

```
BOSS REPORTS. Five swipeable full-width cards with hairline borders and page dots. Card 1: label 今日销售, serif 56px RM 4,820, a minimal bar chart by hour in muted grey-green with the current hour in forest green. Other cards: 本月 vs 上月, 损耗, 最差周转前十 list, 各店库存金额.
```

### O7 老板设置

```
BOSS SETTINGS. Hairline rows: 我的代理 (with "无" or delegate name), 审批门槛, 折扣上限, Telegram 绑定 (状态 已绑定 with thin check). Each row chevron.
```

### O5 代理设定

```
DELEGATION. Steps as uppercase labels: 选人 (hairline rows with radio circles), 范围 (square checkboxes: 订货 盘点差异 退货 手动调整), 时间 (two date fields), 金额上限 (two inputs). Green button 确认指定, muted note "到期自动失效".
```

## 顾客大屏（竖屏 1080 x 1920）

### D1 待机

```
KIOSK IDLE. Paper background, serif store name, a slow product carousel with large photos and prices, bottom text in three languages "触摸找商品 · Sentuh untuk cari · Touch to find".
```

### D2 找商品

```
KIOSK SEARCH. Four large hairline-bordered tiles: 打字 / 类别 / 照片 / 扫码, each with a thin icon and three-language label. Big on-screen keyboard below.
```

### D6 结果地图

```
KIOSK MAP. Top: product photo, name in three languages, RM 8.90, "有货 Ada stok In stock" with thin check. Center: a clean 2D store map, aisles A–F as hairline rectangles on paper, "您在这里" marker, the target shelf filled forest green with a soft pulse, a dashed route line. Bottom: two 96px buttons 叫员工 (green) and 再找一个 (ghost).
```

### D7 叫员工

```
KIOSK STAFF CALLED: serif "员工正在赶来", staff photo in a thin circle, "Pekerja sedang datang · Staff on the way", a thin progress line in brass.
```

## 网页端（桌面 1440 x 900）

### G1 仪表板

```
DASHBOARD. Serif greeting 早上好，陈老板。with date in small uppercase. KPI row separated by hairlines: 今日销售 RM 4,820, 库存金额 RM 128,400, 低库存 12 (brass), 待处理 5 (brass). Below: a 30-day bar chart in muted grey-green with today in forest green on a hairline baseline, and a hairline list of today's tickets with brass due labels.
```

### G2 产品管理

```
PRODUCTS. Toolbar: hairline search "搜索名称、拼音、条码", checkbox 含停用, green button 新建产品. Table with product thumbnail, 货号, 主条码, 名称, 类别, 单位, 成本, 售价, 最低量, 总库存 (serif), 状态, actions as text links.
```

### G3 库存查询

```
STOCK with three underline tabs 按产品 / 按位置 / 按区. Zone view: a grid of zone blocks with name, fill percentage in serif, a thin horizontal fill bar, earliest expiry.
```

### G5 位置和区

```
LOCATIONS. Left column list of zones with hairlines; right: zone detail with racks × levels inputs, allowed categories as square checkboxes, a "打印标签" ghost button, and a table of locations with label-printed time.
```

### G6 地图编辑器

```
MAP EDITOR. Canvas on dim paper with a hairline grid, shelf rectangles labeled A-01…, a selected shelf with brass outline and side panel to bind location codes, a kiosk marker, a "发布版本" green button and version list.
```

### G7 用户管理

```
USERS. Table: name, phone, roles per site as small chips, status, actions 编辑 / 员工卡 / 重置 PIN. A side panel "新员工" with hairline inputs and a big serif one-time PIN "483 921" shown once with a brass note.
```

### G10 报表中心

```
REPORTS. Four sections with uppercase labels: 低库存, 负库存, 即将到期, 区占用; each a hairline table with an "导出 Excel" text button in forest green. A right column listing 导出记录.
```

### G11 Excel 导入

```
IMPORT WIZARD. Step row 1–5 as thin numbered circles (done ones filled green). Toolbar with 下载开店全套模板 (green) and per-sheet ghost buttons, a file picker, a checkbox. Result panel: file name with a status pill, per-sheet counts (通过 / 警告 / 错误) separated by hairlines, a table of problems with 行 / 级别 / 列 / 说明, buttons 送审批 (green, disabled when errors), 下载带错误标注的原文件, 关闭.
```

### G13 设备管理

```
DEVICES. Table: device name, type, site, last seen (red text when over 2 hours), pending uploads in brass, version, status, actions 停用 / 启用.
```

### G14 审计日志

```
AUDIT. Filters row (table, user, date range). Table rows: time, user, action, table, row id; expanding a row shows before / after JSON in two dim-paper panels.
```

### A3 开店向导

```
SETUP WIZARD. Five steps as thin circles. Step 1 form in two columns with uppercase labels; after creation a dim-paper panel shows the boss PIN in serif 48px with brass note "只显示一次", and the badge QR text in monospace.
```

---
共 64 个屏幕。第五部分屏幕清单里没列出的屏幕（P4、P7、P9、P10、P12、M3、M5、B 组、F 组、A 组其余）结构同类，照同组的写法改标题和内容即可。
