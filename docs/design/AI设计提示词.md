# 仓店通 AI 设计提示词包

用法：每次先贴 **0 号风格提示词**，再贴一个屏幕的提示词。一次只要一个屏幕。出来不满意，加一句 "Make it cleaner, more whitespace, fewer colors." 或 "Make it more premium, like Shopify POS."

---

## 0. 风格基础（每次都先贴）

```
Design a mobile app screen for "WarehouseShop", an inventory app for small supermarkets in Malaysia.
Users are elderly shop staff. Rules that must not break:
- One task per screen. Max 4 primary actions on the home screen.
- Very large touch targets: buttons at least 72px tall, body text 22px, headline numbers 56px.
- High contrast (7:1). Never use color alone to mean something; always icon + text.
- Labels appear in Chinese with a smaller Malay/English line under it.
Style: modern, calm, premium. Off-white background #F4F6F8, white cards with soft shadow and 18px radius,
brand green #0F7A3D for primary actions, red #C62828 for errors, amber #D97706 for warnings, blue #1D4ED8 for info.
Typography: Inter for Latin, Noto Sans SC for Chinese, bold headlines with tight letter spacing.
Icons: Lucide-style thin line icons in rounded tinted squares. No emoji, no illustrations of people.
Portrait phone frame 390 x 844. Show realistic Malaysian supermarket products (Coca-Cola 325ml, Milo 1kg, Lays 70g) with photos.
```

## 1. 登录

```
LOGIN screen. Top: app logo (green rounded square with a white warehouse outline) and name "仓店通".
Three large segmented buttons: "扫员工卡" (active), "手机号", "电邮". Below: a camera viewfinder card with green corner brackets and the text "扫员工卡 / Imbas kad / Scan badge".
Then six PIN dots and a big 3x4 numeric keypad with 72px keys. Bottom: language chips 中 / BM / EN. Friendly, uncluttered, lots of whitespace.
```

## 2. 首页（库存员）

```
HOME screen for a stock staff member. Top bar: green online dot + "在线", store name "示范小店" centered, a help icon on the right.
Greeting block: "你好，库存阿明" in 28px bold, role "库存员" in grey, round avatar on the right.
A 2x2 grid of large square tiles with a thin colored top edge: 收货 Receive (blue, open-box icon), 补货 Refill (green, cart icon, red badge "12"),
盘点 Count (orange, clipboard icon), 查询 Lookup (grey, search icon). Each tile: icon in a tinted rounded square, label 24px bold.
Bottom bar: language chips 中 / BM / EN on the left, a mic button "问" and "退出" on the right.
```

## 3. 扫描

```
SCAN screen for receiving goods. Top bar: "← 返回", title "收货", progress chip "2/8" on the right.
Dark camera viewfinder (4:3) with four green rounded corner brackets and a thin glowing green laser line.
Under it: a green tinted icon square with a box icon, then "请扫产品条码" in 30px bold with "Imbas kod bar / Scan barcode" smaller under it.
A grey line "上一个：可口可乐 325ml ✓ 24 件". Two secondary buttons: "打字输入" (keyboard icon), "手电" (torch icon).
```

## 4. 输入数量

```
QUANTITY screen. Product header card: 96px product photo, "可口可乐 325ml" 28px bold, barcode "9556001234567" grey, "应收 24 件 · 放 S-01".
Big right-aligned number "24" at 56px bold with unit "件". Quick keys row: "+1 箱 (24)", "+1 件", "清".
3x4 keypad with 72px white keys and soft shadows. Full-width green confirm button "✓ 确认 24 件" at the bottom, 80px tall.
```

## 5. 完成屏

```
DONE screen. Full green background. Centered: a large circle with a white checkmark, "收货完成！" 32px bold white, "8 种产品 · 186 件",
an amber line "2 项差异已通知老板". Two stacked buttons: white "继续下一张" and outlined "回到首页". Celebratory but calm.
```

## 6. 错误屏

```
ERROR screen. Full red background. Centered: large circle with an X, message "这是 A-03-3，请去 A-03-2" in 28px bold white,
and one big white button "知道了". Nothing else on screen.
```

## 7. 查询结果

```
LOOKUP RESULT screen. Product header: photo, "可口可乐 325ml", barcode, "售价 RM 1.80".
Row "总库存" with "72 件" in 28px bold. Section label "位置": rows with colored location chips "S-01" (grey) 48, "A-01-1" (red) 24.
Section "货架": "A-01-1 ★". Section "最近移动": 3 rows "11/17 07:51 收货 SUPPLIER→S-01  24". Green button "下一个" at bottom.
```

## 8. 补货清单

```
REFILL LIST screen. Title "补货", chip "12". Section label "货架缺货清单". Cards (112px tall): product photo, name 24px bold,
line with a blue chip "A-01-1" then "货架有 2 · 后仓有 48", a status dot on the right (red = empty, amber = low).
Most urgent first. Bottom: outlined button "扫货架" with a camera icon.
```

## 9. 离线状态

```
Same HOME screen but offline: an amber bar at the top "⚠ 离线 · 3 笔待上传", the online dot is amber with text "离线",
and the "审批" tile is greyed with a small label "需要网络". Show how the app stays usable when offline.
```

## 10. 工单

```
MY TICKETS screen. Title "我的工单". Cards: ticket icon, title "负库存 可口可乐 @ A-01-1 = -3", "#12 · 11/18", status dot and text "NEW" / "IN_PROGRESS".
Bottom: outlined button "+ 开工单".
```

## 11. 老板报表（手机）

```
BOSS REPORTS screen. Five horizontally swipeable cards with page dots. Card 1 "今日销售" with "RM 4,820" 48px bold and a small bar chart by hour.
Card 2 "本月 vs 上月" two bars. Card 3 "损耗" with a red number. Card 4 "最差周转前十" list. Card 5 "各店库存金额". Green accent, calm charts, no gridlines clutter.
```

## 12. 网页仪表板（桌面）

```
Desktop DASHBOARD for a boss, 1440x900. Left: dark navy sidebar (240px) with logo "示范小店", grouped nav with line icons: 总览 (仪表板, 审批), 主数据 (产品管理, 位置和区, Excel 导入),
库存 (库存查询, 移动记录, 报表中心), 运营 (工单, 设备管理), 管理 (用户管理, 审计日志, 公司设定). Main: title "仪表板 · 示范小店",
a grid of 11 stat cards with a colored left edge: 库存金额 RM 128,400, 产品数 312, 今日移动 46, 低库存产品 12 (red), 负库存 1 (red), 待处理导入 0, 待审批 2 (red),
设备离线 0, 未关工单 3 (red), 未打印标签 0, 14 天内到期 5 (red). Below: a line chart of 30-day movements and a table of today's tickets. Clean SaaS style like Linear/Shopify admin.
```

## 13. 网页 Excel 导入预览

```
Desktop IMPORT page. Step indicator "1 下载模板 · 2 上传 · 3 预览 · 4 送审 · 5 批准执行" with steps 1–3 green.
Toolbar: green "下载开店全套模板", ghost buttons per sheet, a file picker, checkbox "最低量、补货量空值用模板规则填", green "上传并验证".
A white panel: file name "import.xlsx" with a blue pill "已验证", 4 stat cards (产品 300 · 通过 100 · 警告 200 · 错误 0 ...),
buttons "送审批" (green), "下载带错误标注的原文件", "关闭". Table "错误和警告" with columns 表 / 行 / 级别 (red or amber pill) / 列 / 说明.
```

## 14. 网页产品管理

```
Desktop PRODUCTS page. Search box "搜索名称、拼音、条码、货号", checkbox "含停用", green "+ 新建产品".
Table with product thumbnail, 货号, 主条码, 名称, 类别 chip, 单位, 成本, 售价, 最低量, 总库存, 状态 (green "启用"), actions "编辑" "停用". Zebra-free, 10px row padding, uppercase small grey headers.
```

## 15. 顾客大屏（第四阶段用）

```
Customer KIOSK screen, portrait 1080x1920 touch display in a supermarket. Top: search bar "找商品 / Cari barang / Find a product" with a mic and camera icon.
Center: a 2.5D isometric store map with aisles A–F as shelf blocks, a "您在这里" marker near the entrance, one shelf glowing amber with a dashed route line to it.
Bottom card: product photo, "酱油 Kicap 500ml" with Malay and English, "RM 8.90", green "有货 / Ada stok / In stock", a big "叫员工 Call staff" button. Bright, friendly, large text for all ages.
```

## 16. 情绪板（给 Midjourney / Ideogram）

```
UI design mood board for a modern supermarket inventory app, several phone screens on a clean white surface, big friendly buttons,
soft green and off-white palette, thin line icons, Chinese and Malay labels, premium fintech feel, soft shadows, one screen shows an isometric store map,
studio lighting, photorealistic mockup --ar 16:9
```

---

## 让 AI 出好结果的小技巧

1. 一个屏幕一个提示词，不要一次要五个。
2. 出来太花就加：`Simplify. Remove gradients and decorations. More whitespace.`
3. 想换方向就加一句参考：`Style reference: Shopify POS` / `Square for Retail` / `Linear app` / `Apple Health`。
4. 要三语显示就加：`Every label shows Chinese on top and a smaller Malay / English line below.`
5. 挑中的设计把图片或 Figma 链接给我，我按它改代码。
