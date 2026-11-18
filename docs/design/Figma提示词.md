# Figma 提示词（Figma Make / First Draft）

## 怎么用

1. 打开 figma.com，新建文件，右上角 **Make** 或在画板里按 **Actions → First Draft**。
2. 先贴 **第 0 条**（设计系统），让它先出一张"规矩表"页。
3. 再逐条贴 **第 1–8 条**，每条一个屏幕。生成后点 **Add to file** 保存。
4. 不满意就在同一个对话里追加一句修改（第 9 节有常用改法）。
5. 做完 5 屏后，用 Figma 的 **Prototype** 把按钮连起来，手机上点一遍。
6. 满意后 **Share → Copy link** 发我，我照着改代码。

规则：一次只生成一个屏幕；每条提示词都带 Design System 那段，AI 才不会每屏换风格。

---

## 第 0 条：设计系统（先生成这个）

```
Create a mobile design system page for a warehouse and retail app used by Malaysian shop staff, many over 50 years old. The style is calm and editorial, like a premium paper notebook, not a tech dashboard.

Colors (use exactly):
- Paper background #FAF8F3
- Ink text #15201A
- Primary green #0E3B2B (one primary button per screen only)
- Brass accent #B8894A (badges and small highlights, under 10% of the screen)
- Error red #B3261E
- Muted grey text #6B7470
- Hairline divider #E3DED4

Typography:
- Headings: Fraunces (serif), 28px semibold
- Body: Inter, 22px regular
- Labels: Inter, 14px medium, letter-spacing 0.04em, uppercase for English
- Big numbers: Fraunces, 56px
- Chinese text uses Noto Serif SC for headings and Noto Sans SC for body

Layout rules:
- Phone frame 390 × 844, 24px side margins
- 8px spacing grid, use 8/16/24/32 only
- Square corners (0px radius) everywhere; buttons and cards are rectangles
- Dividers are 1px hairlines, no drop shadows
- Primary button: full width, 72px tall, green fill, white 24px text
- Secondary button: full width, 72px tall, paper fill, 1px ink border
- Every screen has one task, at most 3 steps, and a top bar with Back on the left and screen title centered

Show on this page: the color swatches with hex codes, the type scale with sample text in Chinese, Malay and English, the two buttons, an input field, a list row with a hairline, a small brass badge, an icon row using Lucide outline icons at 28px, 1.75px stroke.
```

---

## 第 1 条：首页（员工）

```
Use the design system above. Design the home screen of the warehouse mobile app for a stock worker.

Top bar: small text "DEMO1 · 主仓" on the left, a sync status dot and the word "已同步" on the right, in muted grey 14px.

Header: greeting "你好，阿强" in Fraunces 28px, below it a 14px label "今天的任务 · TUGAS HARI INI · TODAY'S TASKS".

Main area: a numbered list of exactly 4 tasks, each a full-width row 96px tall separated by hairlines:
1. 收货 — Terima Barang — Receive, Lucide icon "package-plus"
2. 上架 — Susun Rak — Put Away, icon "archive"
3. 补货 — Isi Semula — Refill, icon "refresh-cw"
4. 查询 — Semak — Lookup, icon "search"
Each row: a large number "01" in brass Fraunces 28px on the left, then the Chinese name 24px ink, the Malay and English under it in 14px muted grey, and a chevron on the right.

Below the list, a quiet row showing "待同步 3" with a small brass badge.

Bottom: a 72px secondary button "设置 · Tetapan · Settings".

Lots of white space, no cards, no shadows. The whole screen must be readable from 50cm away.
```

---

## 第 2 条：扫描

```
Use the design system above. Design the scan screen used during receiving.

Top bar: Back on the left, title "收货 · 第 1 步 / 3" centered.

Below the top bar a 14px label "扫条码 · IMBAS BARKOD · SCAN BARCODE".

Main area: a camera viewfinder taking 55% of the screen height, dark background #15201A, with a thin brass rectangular guide in the center and a slow moving horizontal brass scan line. Under the viewfinder, a hairline, then a text input 72px tall with placeholder "或输入条码" and a Lucide "keyboard" icon on the right.

Bottom: a 72px secondary button "手电筒 · Lampu · Torch".

No other elements. The screen must feel calm, not like a hacker interface.
```

---

## 第 3 条：输数量

```
Use the design system above. Design the quantity entry screen, step 2 of 3 in receiving.

Top bar: Back on the left, title "收货 · 第 2 步 / 3".

Product header: product name "可口可乐 325ml × 24 罐" in 24px ink, under it "9556001234567 · 箱" in 14px muted grey, and a small brass badge "1 箱 = 24 罐".

Below, a big number display: the current quantity "24" in Fraunces 56px centered, with a 14px label "数量 · KUANTITI · QTY" above it. Unit toggle under the number: two square chips "箱" (selected, green fill, white text) and "罐" (paper fill, ink border).

Number pad: 3 columns × 4 rows, each key 72px tall, paper background, hairline borders, ink digits 28px. Last row: "清除", "0", backspace icon.

Bottom: a 72px primary green button "确认 · Sahkan · Confirm".

Everything aligned to the 24px margins. No shadows.
```

---

## 第 4 条：完成

```
Use the design system above. Design the done screen shown after a successful receive.

Center of the screen: a large Lucide "check" icon 96px in primary green inside a thin green square outline, below it "完成" in Fraunces 36px, then "Selesai · Done" in 18px muted grey.

Summary block with hairlines above and below: three rows in 22px:
- 商品：可口可乐 325ml
- 数量：24 罐（1 箱）
- 位置：A-03-2

Bottom: a 72px primary button "继续收货 · Terima Lagi · Receive More" and under it a 72px secondary button "回首页 · Laman Utama · Home".

Optional: a tiny line at the very bottom in 12px muted grey "已保存到本机，会自动同步".
```

---

## 第 5 条：查询

```
Use the design system above. Design the product lookup result screen.

Top bar: Back, title "查询".

Product header: "可口可乐 325ml" 24px, "9556001234567" 14px muted grey, a brass badge "饮料".

Key number: "现货 312 罐" in Fraunces 56px, label "总库存 · JUMLAH STOK".

A list titled "位置 · LOKASI · LOCATION" with hairline rows, each 72px tall:
- A-03-2  ·  240 罐  ·  a small green tag "货架"
- B-01-4  ·  72 罐
Each row has a chevron.

Below, a 14px label "有效期 · TARIKH LUPUT" and one row "2026-03-15 · 48 罐" with the date in brass.

Bottom: 72px secondary button "再扫一个 · Imbas Lagi · Scan Another".
```

---

## 第 6 条：登录

```
Use the design system above. Design the login screen.

Top third: the app name "WarehouseShop" in Fraunces 32px, under it "库存 · Stok · Stock" in 14px muted grey label style.

Three tabs as square chips in a row: "手机" (selected), "邮箱", "扫工牌".

Input fields, 72px tall, hairline bottom border only:
- 公司代号 with placeholder "DEMO1"
- 手机号 with placeholder "012 000 0001"
- PIN, masked, 6 dots

Primary button "登录 · Log Masuk · Login".

Under the button, a language row with three small text links "中文 · Bahasa · English", the selected one underlined in brass.

Bottom: 12px muted grey "离线也能登录 · Boleh log masuk tanpa internet".
```

---

## 第 7 条：网页管理端仪表板（电脑）

```
Use the same design system but on a desktop frame 1440 × 900.

Left sidebar 260px, paper background, hairline right border. At the top the company name "DEMO1" in Fraunces 20px and the site "主仓" in 14px grey. Menu items 48px tall with Lucide icons 20px: 仪表板, 审批, 商品, 位置, 导入, 库存, 移动记录, 报表, 工单, 设备, 用户, 日志, 设置. The active item has a 3px brass bar on the left and ink text; others muted grey.

Main area, 48px padding. Page title "仪表板" Fraunces 32px, date on the right in 14px grey.

A row of 4 stat tiles, no borders, separated by vertical hairlines: 待审批 3, 负库存 1, 7 天内到期 12, 离线设备 0. Numbers in Fraunces 48px, labels in 14px uppercase-style.

Below, two columns: left a table "最近移动" with 8 rows (time, product, qty, from, to, who), hairline rows, 16px Inter; right a list "待处理工单" with 4 items each having a brass badge for priority.

No cards with shadows, no colored backgrounds. Looks like a well set newspaper.
```

---

## 第 8 条：三个首页变体（练习用）

```
Use the design system above. Create three variants of the worker home screen side by side, same content (4 tasks: 收货, 上架, 补货, 查询; a sync badge; a settings button):

Variant A "List": numbered rows with hairlines, as in an index page of a book.
Variant B "Tiles": a 2 × 2 grid of square tiles, each 160px, paper background with 1px ink border, icon 40px on top, Chinese name 24px, Malay and English 14px under it.
Variant C "Cards": one tall card per task stacked vertically, each 120px, with the icon on the left in a 72px green square and the names on the right.

Keep every rule of the design system: square corners, hairlines, one primary color, 24px margins. Label each variant at the top in 14px grey.
```

---

## 第 9 节：常用修改句（在同一对话里追加）

| 你想要 | 追加一句 |
|---|---|
| 字再大 | Increase all body text to 24px and buttons to 80px tall; keep margins. |
| 太空 | Reduce vertical spacing between rows from 32px to 16px, keep 24px side margins. |
| 太挤 | Add 16px more space between every section; remove any element that is not needed for the task. |
| 颜色太多 | Use only paper, ink, one green button and one brass badge. Remove every other color. |
| 换圆角风格 | Change all corner radius to 16px and keep everything else. |
| 换深色 | Invert to a dark version: background #15201A, text #FAF8F3, keep green and brass. |
| 加马来文 | Under every Chinese label add the Malay and English in 14px muted grey. |
| 想要瓷砖首页 | Rebuild the home as a 2 × 2 grid of square tiles, 160px each, 1px ink border, icon 40px. |
| 看不出重点 | Make the main number or the primary button the only large element; shrink everything else one step. |
| 像网页不像 App | Add the iOS status bar and home indicator, use the 390 × 844 frame, full-width buttons at the bottom. |

---

## 第 10 节：Figma Make 整套原型一句话版（想一次出 5 屏时用）

```
Build a clickable mobile prototype (390 × 844) for a warehouse receiving flow used by Malaysian shop staff over 50. Screens: Home → Scan → Quantity → Done, plus a Lookup screen reachable from Home. Follow this design system strictly: paper #FAF8F3 background, ink #15201A text, one primary green #0E3B2B button per screen, brass #B8894A for small badges only, hairline dividers #E3DED4, square corners, no shadows, Fraunces for headings (28px) and big numbers (56px), Inter for body (22px), 24px side margins, 72px tall full-width buttons, every label in Chinese with Malay and English under it in 14px grey, Lucide outline icons. Each screen does one task and has a top bar with Back and a title like "收货 · 第 1 步 / 3". Wire the buttons so I can tap through the whole flow.
```

把生成结果的 Share 链接发我即可。
