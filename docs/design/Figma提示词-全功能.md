# Figma 提示词：全功能版（按模块，共 70 屏）

配合 `Figma提示词.md` 使用。那份是入门 8 屏，这份把系统**所有功能**的屏幕都列出来，按角色和模块分组。

## 用法

1. 每开一个新的 Figma Make 对话，**先贴"设计系统"那段**（只贴一次，同一对话里后面不用重复）。
2. 想一次出一整个流程（能点着走），贴该模块的 **"整流程"提示词**。
3. 想精修某一屏，贴该屏的**单屏提示词**。
4. 生成后点 Add to file。改动用 `Figma提示词.md` 第 9 节的修改句。

---

## 设计系统（每个新对话先贴）

```
Design system for "WarehouseShop" (仓店通), an inventory + POS app for small supermarkets in Malaysia, used by staff over 50. Calm, editorial, paper-like. Follow strictly on every screen:

Colors: paper #FAF8F3 background, dim paper #F3F0E8 for selected rows, ink #15201A text, muted #6B7470 secondary text, hairline #E3DED4 dividers, green #0E3B2B for the single primary button per screen, brass #B8894A for attention numbers and small badges (under 10% of screen), error red #B3261E for blocking errors, warn yellow #E8C36A as a thin top bar only.

Type: Fraunces + Noto Serif SC for headings 28px and big numbers 56px; Inter + Noto Sans SC for body 22px, buttons 24px, labels 14px uppercase letter-spacing 0.04em.

Shape: square corners, 1px hairlines instead of cards, no shadows, no gradients. Lucide outline icons 28px, stroke 1.75. No emoji.

Elderly rules: one task per screen, max 3 steps, home screens have at most 4 actions, buttons 72px tall full width, contrast 7:1, never color alone (always icon + text), every label shows Chinese on top and "Malay · English" under it in 14px muted.

Frames: phone 390 × 844 with 24px margins; POS tablet landscape 1280 × 800; customer kiosk portrait 1080 × 1920; desktop admin 1440 × 900 with a 260px left sidebar.

Common parts: top bar with "‹ 返回" left and a title right like "收货 · 第 2 步 / 3"; offline state is a thin yellow bar under the top bar "离线 · 12 笔待上传"; scan screens use a dark viewfinder #15201A with a brass rectangular guide; quantity screens use a 3 × 4 keypad with 72px keys; done screens use a thin green square with a check icon; error screens are full red #B3261E with white 28px text and one white button "知道了".

Use realistic Malaysian products: Coca-Cola 325ml, Milo 1kg, Lays 70g, Dutch Lady milk 1L, Jasmine rice 5kg, salmon by weight.
```

---

## 模块 1：共用（所有角色）

### 整流程

```
Build a clickable phone prototype: Login → Select site → Home → Lookup result → Settings, plus a Chatbot screen and a My tickets screen reachable from Home. Use the WarehouseShop design system. Wire every button.
```

### C1 登录
```
LOGIN. Wordmark "WarehouseShop" Fraunces 32px top left with a small green square seal; under it the label "库存 · STOK · STOCK". A row of three square chips: 扫工牌 / 手机号 / 邮箱, selected chip green fill white text. Below the chips a dark camera viewfinder 240px tall with a brass guide and the label "IMBAS KAD · SCAN BADGE". Then a hairline input "公司代号" (placeholder DEMO1), a hairline input "手机号", six PIN dots, and a 3 × 4 keypad with Fraunces digits. Bottom row: 中文 · Bahasa · English text links, selected one underlined in brass. Last line 12px muted "离线也能登录".
```

### C2 选站点
```
SELECT SITE. Title 选站点 Fraunces 28px, label "PILIH LOKASI · SELECT SITE". Hairline rows 96px: Lucide "store" icon, site name 24px (主仓, KL 分店, JB 分店), code and my roles under it in 14px muted ("WH01 · 仓库员"), chevron right. The last used site has a small brass badge "上次".
```

### C3 首页
```
HOME for a stock worker. Top strip 14px muted: "DEMO1 · 主仓" left, a green dot and "在线" right. Date "11月18日 · 星期二" uppercase label. Greeting "早安，阿明" Fraunces 28px, role line "仓库员" 14px muted. A short 24px brass rule. Numbered task list, rows 96px with hairlines, number "01–04" in brass Fraunces: 收货 Terima · Receive, 上架 Susun · Put away (brass count "12" right), 补货 Isi semula · Refill, 查询 Cari · Lookup. Each row has a Lucide icon and a chevron. Bottom bar 72px: three ghost buttons 问 (mic icon), 工单 (badge "2"), 设置.
```

### C4 查询结果
```
LOOKUP RESULT. Top bar Back / 查询. Product header: 72px square photo, name 24px "可口可乐 325ml", barcode 14px muted, price "售价 RM 1.80" (hidden for roles without price permission, show a muted "—"). Big row: label 总库存 · JUMLAH STOK, number "312 罐" Fraunces 56px. Section 位置: hairline rows 72px, a square hairline chip with the location code "A-03-2", a brass star for the registered shelf, quantity on the right in Fraunces 28px. Section 有效期: "2026-03-15 · 48 罐", date in brass. Section 最近移动: three muted rows "11/18 07:51 收货 → S-01 24". Primary button 再扫一个 · Imbas lagi · Scan another.
```

### C5 机器人（AI 助手）
```
ASSISTANT. Title 问 Fraunces 28px, label "TANYA · ASK". Chat area with two message styles: user text right-aligned in dim paper rectangles, assistant left-aligned on plain paper with a 2px brass left rule. Example: user "可乐放哪里", assistant "货架 A-03-2 有 240 罐，后仓 S-01 还有 72 罐" followed by a ghost button "去查询屏幕 →". Three suggestion chips above the input: 今天要补什么 / 怎么收货 / 谁在上班. Bottom: hairline input "打字" and a 72px square green mic button labeled 按住说话.
```

### C6 我的工单
```
MY TICKETS. Title 工单, label "TIKET · TICKETS". Two square chips 待处理 (selected) / 已完成. Hairline rows 96px: Lucide "alert-circle" icon, title 24px "负库存 可口可乐 @ A-03-2", "#12 · 11/18 · 系统自动" 14px muted, status on the right: 新 in brass, 处理中 muted, 已解决 green. Primary button "+ 开工单".
```

### C6b 工单详情
```
TICKET DETAIL. Title "#12 负库存". Body 22px: "可口可乐 325ml 在 A-03-2 库存 -3". A timeline with hairline rows: time, who, what ("07:51 系统 建单", "08:10 阿明 已查看"). A photo slot 120px square with a Lucide "camera" icon. A hairline textarea "写几句". Two buttons: ghost 拍照, primary 已解决 · Selesai · Resolved.
```

### C7 设置
```
SETTINGS. Sections with uppercase labels. 语言: three square chips 中文 / Bahasa / English. 字体: two chips 正常 / 特大. 改 PIN: two hairline inputs 旧 PIN, 新 PIN, ghost button 保存. 同步: one row "上次同步 07:51 · 全部已上传" with a ghost button 重新下载数据. 关于: version "1.0.0 · 设备 DEV-0A31" 14px muted. Bottom ghost button 退出 · Keluar · Logout in error red text.
```

### C8 离线与错误
```
Two states on one page. Left frame: any screen with a 40px yellow bar under the top bar reading "离线 · 12 笔待上传 · Luar talian" with a Lucide "wifi-off" icon. Right frame: a full-screen error, background #B3261E, white Lucide "x-octagon" 96px, white 28px "这个货位不能放饮料", white 18px "Lokasi ini bukan untuk minuman", one white 72px button with red text "知道了 · Faham · OK".
```

### C9 完成屏（通用）
```
DONE. Centered thin green square 120px with a Lucide "check" 64px, "完成" Fraunces 36px, "Selesai · Done" 18px muted. A summary block between hairlines, three rows 22px (商品, 数量, 位置). Primary button 继续 · Teruskan · Continue, ghost button 回首页 · Laman utama · Home. Footer 12px muted "已保存到本机，会自动同步".
```

---

## 模块 2：仓库员（收货、上架、拣货）

### 整流程
```
Build a clickable phone prototype for the warehouse worker: Home → Pending POs → Scan product → Quantity → Damage (optional) → Receive summary → Done; and Home → Pending putaway → Scan product (shows suggested location) → Scan location → Quantity → Done; and Home → Pick lists → Pick step → Pick done. Use the WarehouseShop design system. Every quantity screen uses the keypad component; every scan screen uses the viewfinder component.
```

### W1 待收货
```
PENDING RECEIVING. Title 收货, label "TERIMA · RECEIVE". A ghost full-width button at the top "无单收货 · Tanpa PO". Then a list of purchase orders as hairline rows 112px: supplier name 24px "F&N Beverages", "PO-2026-0142 · 预计 11/18 · 12 行" 14px muted, right side a brass Fraunces "12" with label 行, chevron. A second row shows a status chip "部分收" in dim paper.
```

### W2 收货扫产品
```
RECEIVE SCAN. Top bar Back / "收货 · 第 1 步 / 3". Under it a progress line "PO-2026-0142 · 已收 3 / 12 行" 14px muted. Viewfinder 50% height with brass guide and slow scan line. Under it a hairline list of the PO lines, each row: product name, "应收 10 箱 · 已收 4" muted, a thin green check for done lines. Ghost button 打字输入.
```

### W3 收货输数量
```
RECEIVE QTY. Top bar "收货 · 第 2 步 / 3". Product header with photo, "可口可乐 325ml", "箱码 · 1 箱 = 24 罐" brass badge, "应收 10 箱" 14px muted. Big number "10" Fraunces 56px (prefilled from the PO, shown muted until typed). Unit chips 箱 (selected) / 罐. Keypad. Below the keypad a row "有效期 · TARIKH LUPUT" with a ghost button "选月份" that opens a 3 × 4 grid of month chips. Primary button 确认.
```

### W4 收货损坏
```
DAMAGE. Title "有损坏吗？". Two 120px tall buttons stacked: ghost "没有损坏 · Tiada" and ghost with red text "有损坏 · Ada rosak". When 有损坏: a quantity row "损坏数" with keypad, a 120px photo slot with camera icon and "拍一张", 14px muted "会自动开工单给经理". Primary button 继续.
```

### W5 收货完成
```
RECEIVE SUMMARY. Title "收货摘要", "PO-2026-0142". Three big numbers in one row separated by hairlines: 少货 "2" brass, 多货 "0", 损坏 "1" red. A hairline list of lines with differences: product, "应收 10 · 实收 8" muted, "-2" in brass. Toggle row "打印收货单 GRN" with a square checkbox. Primary button 完成收货 · Selesai.
```

### W6 待上架
```
PENDING PUTAWAY. Title 上架, label "SUSUN RAK · PUT AWAY". Subtitle "收货区 S-01 · 12 件待上架". Hairline rows 96px ordered by arrival: product photo 56px, name, "24 罐 · 07:51 收" muted, a square chip with the suggested location "A-03-2" in green, chevron.
```

### W7 上架扫产品
```
PUTAWAY SCAN PRODUCT. Top bar "上架 · 第 1 步 / 3". Viewfinder. After scan, under the viewfinder a large instruction: label "去这个货位 · PERGI KE", location "A-03-2" Fraunces 56px with a colored zone dot (zone A = green), "饮料区 · 第 3 架 · 第 2 层" 18px muted. Ghost button 其他货位.
```

### W8 上架扫货位（含扫错）
```
PUTAWAY SCAN LOCATION, two frames. Frame 1: top bar "上架 · 第 2 步 / 3", viewfinder, label "扫货位标签 · IMBAS LOKASI", expected "A-03-2" in 28px. Frame 2 (wrong zone): full red error screen "B-01-4 是干货区，饮料不能放这里", white button 知道了; and a third small frame for "allowed but different": a yellow bar "你扫的是 A-03-3，不是建议的 A-03-2" with two chips 用这个 / 重扫.
```

### W9 上架输数量
```
PUTAWAY QTY. Top bar "上架 · 第 3 步 / 3". Product header, "从 S-01 → A-03-2" in 18px with a Lucide "arrow-right". Big number "24" prefilled (all remaining). Unit chips. Keypad. Primary button 确认上架.
```

### W10 拣货单
```
PICK LISTS. Title 拣货, label "PILIH · PICK". Hairline rows 112px: destination "KL 分店" 24px, "调拨 TR-0031 · 8 行 · 要求 11:00" muted, right side brass "8" with label 行, chevron. Rows past due show the time in red.
```

### W11 拣货步骤
```
PICK STEP. Top bar "拣货 · 第 3 / 8 行". A large instruction block: label 去货位, "A-03-2" Fraunces 56px; label 拿, product "可口可乐 325ml" 24px with photo; label 数量, "6 罐" Fraunces 56px. Viewfinder 200px tall below with "扫货位再扫产品". Two buttons: primary 拿好了 · Dah ambil, ghost "这里没有 · Tiada di sini" (shows next location).
```

### W12 拣货完成
```
PICK DONE. Thin green square with check, "拣货完成". Summary "TR-0031 · 8 行 · 2 箱". A 160px QR code placeholder centered with "箱贴 · 贴在箱子上" 14px muted. Buttons: primary 打印箱贴 · Cetak, ghost 已装车 · Dah muat.
```

---

## 模块 3：盘点员（盲盘）

### 整流程
```
Build a clickable phone prototype for blind stock count: Home → Today's count list → Scan location → Scan product → Quantity → Location done → Count finished; plus My records. Use the WarehouseShop design system. Never show the system quantity on count screens.
```

### K1 今日盘点
```
TODAY'S COUNT. Title 盘点, label "KIRA STOK · STOCK COUNT". Progress row: "今天 20 个货位 · 完成 7" with a 4px progress bar in green on hairline. Hairline rows 80px in route order: location code "A-01-1" Fraunces 24px, zone name muted, right side a thin green check for done or a chevron. Primary button 开始下一个 · Seterusnya.
```

### K2 盘点扫货位
```
COUNT SCAN LOCATION. Top bar "盘点 · A-01-1". Viewfinder with "扫货位标签 · IMBAS LOKASI". Under it 28px "下一个：A-01-1". Second frame: red error "你扫的是 A-01-2，请去 A-01-1".
```

### K3 盘点扫产品
```
COUNT SCAN PRODUCT. Top bar "盘点 · A-01-1". Viewfinder. Below, label "这个货位已数 · DAH KIRA", hairline rows of counted products: name, counted qty in Fraunces 24px on the right. Do NOT show expected quantity anywhere. Ghost button 这个货位数完了.
```

### K4 盘点输数量
```
COUNT QTY. Product header. Big number empty with placeholder "0" muted. Unit chips 件 / 箱, and for weighed items a chip "kg" with the number showing one decimal "12.4". Keypad with a "." key for kg. Primary button 确认 · Sahkan.
```

### K5 货位完成
```
LOCATION DONE. Thin green square check, "A-01-1 数完了". Summary "5 种商品 · 共 138 件". Two buttons: primary 下一个货位, ghost "货位是空的 · Kosong" in muted text (shown on the previous screen too).
```

### K6 盘点结束
```
COUNT FINISHED. Full paper screen: thin green square check 120px, "今天的盘点完成" Fraunces 32px, "已送主管审批 · Dihantar untuk kelulusan" 18px muted, "20 个货位 · 412 件" in Fraunces 28px. Primary button 回首页.
```

### K7 我的记录
```
MY RECORDS. Title 我的记录, label "30 天". Hairline rows: date "11/17", "18 个货位 · 差异 2" muted, result on the right: "准确 98%" in green or a brass "待审" chip.
```

---

## 模块 4：上架员 / 店面（补货、登记、顾客呼叫、调拨）

### 整流程
```
Build a clickable phone prototype for the shop-floor worker: Home → Low shelf list → Scan shelf → Scan product (first time asks "set as location?") → Quantity → Done; Home → Register location (scan shelf, scan product, confirm); a full-screen Customer call alert; Receive transfer; Request transfer. Use the WarehouseShop design system.
```

### S1 货架缺货清单
```
LOW SHELF LIST. Title 补货, label "ISI SEMULA · REFILL". Hairline rows 112px sorted by urgency: product photo, name 24px, "货架 A-03-2 · 剩 2 / 最低 12" muted, right side "后仓 72" in Fraunces 24px green (0 in red), chevron. A thin brass count "12 项" top right.
```

### S2 补货扫货架
```
REFILL SCAN SHELF. Top bar "补货 · 第 1 步 / 3". Viewfinder "扫货架标签". Under it "货架现有 2 罐 · 最低 12" in 22px.
```

### S3 补货扫产品 + 设位置
```
REFILL SCAN PRODUCT, two frames. Frame 1: viewfinder and "扫产品". Frame 2: a bottom sheet (paper, hairline top) 40% height: "第一次放在这里 · 设为这个产品的货架？" 24px, two 72px buttons side by side: ghost 否, primary 是 · Ya.
```

### S4 补货输数量
```
REFILL QTY. Product header with "后仓 S-01 → 货架 A-03-2". Big number "72" prefilled (all from backroom) with a 14px muted "默认全部". Keypad. Primary button 确认补货.
```

### S5 登记位置
```
REGISTER LOCATION. Three-step strip at top: 扫货架 ✓ → 扫产品 ✓ → 确认, done steps with thin green checks. Summary: location "A-03-2" Fraunces 56px, product name with photo, 14px muted "只登记位置，不移动库存". Primary button 确认登记 · Daftar.
```

### S6 顾客呼叫
```
CUSTOMER CALL ALERT. Full-screen red #B3261E. White Lucide "bell-ring" 96px, white 32px "顾客需要帮助", white 24px "B 走道 · 牛奶", a 120px product photo with white hairline, white 18px "Lorong B · Susu". Two white 80px buttons with red text: 我去 · Saya pergi, and smaller ghost white outline 别人去.
```

### S7 收调拨
```
RECEIVE TRANSFER. Top bar "收调拨 · 第 1 步 / 3". Viewfinder "扫箱贴二维码". After scan: "TR-0031 从 主仓 · 8 行" 22px, then the same scan product / quantity flow as receiving with the PO replaced by the transfer.
```

### S8 申请调拨
```
REQUEST TRANSFER. Title 要补货, label "MINTA · REQUEST". Viewfinder. After scan: product header, "货架 2 · 本店后仓 0 · 主仓 312" in three hairline columns with Fraunces 28px numbers. Primary button 申请从主仓调 · Minta, 14px muted "经理批准后仓库拣货". No quantity input.
```

---

## 模块 5：POS 收银（平板横屏 1280 × 800）

### 整流程
```
Build a clickable tablet landscape prototype (1280 × 800) for the POS: Open shift → POS main → Weigh overlay → Hold/Recall → Payment → Done (with e-invoice option) → Return → Manager override → Close shift. Use the WarehouseShop design system. The cart list is on the left 60%, the total and actions on the right 40%.
```

### P1 开班
```
OPEN SHIFT. Left half: "开班" Fraunces 48px, "Buka syif · Open shift" muted, cashier "阿丽 · KL01-P2" 24px, date/time. Right half: label 开班现金 · WANG MULA, input showing "RM 200.00" Fraunces 56px, keypad 3 × 4 with 88px keys. Primary button 开始收银 · Mula.
```

### P2 收银主屏
```
POS MAIN. Top strip 48px: wordmark, "KL01-P2 · 阿丽", time, sync dot. Left 60%: hairline list of cart lines 72px each: photo 48px, name 22px, "2 × RM 1.80" muted, line total Fraunces 24px right; selected line in dim paper. Empty state text "扫商品开始 · Imbas untuk mula". Right 40%: label 合计 · JUMLAH, "RM 48.60" Fraunces 72px, "6 件" muted; buttons stacked 88px: primary 付款 · Bayar, ghost 数量, ghost 删行, ghost 挂单, ghost 退货. A hairline search input "找商品 / 输条码" at the top of the left panel.
```

### P3 称重
```
WEIGH OVERLAY on POS main, dimmed background. Centered paper panel 720 × 480 with hairline border: product "三文鱼 · Salmon" 28px, label 重量 · BERAT, "0.846 kg" Fraunces 72px in green (live from scale), status row with thin check "秤已稳定 · Stabil", "RM 68.00 / kg" muted, "= RM 57.53" Fraunces 36px. Buttons: ghost 重称, primary 加入 · Tambah.
```

### P4 挂单 / 取单
```
HOLD & RECALL. Left: list of held carts as hairline rows: "#H-03 · 14:02 · 5 件 · RM 23.40", a ghost button 取回 on each. Right: current cart summary and primary button 挂起当前单 · Tangguh. Top: title 挂单 Fraunces 36px.
```

### P5 付款
```
PAYMENT. Left 40%: label 应付 · JUMLAH, "RM 48.60" Fraunces 72px, below it "已收 RM 50.00" and "找零 RM 1.40" Fraunces 48px in green. Right 60%: three 112px tall hairline buttons in a row: 现金 (banknote icon), 卡 (credit-card icon), 电子钱包 (qr-code icon, shows DuitNow QR when tapped); under them a keypad for cash received with quick chips RM 5 / 10 / 20 / 50 / 100. Primary button 完成 · Selesai.
```

### P6 完成
```
SALE DONE. Thin green square check 120px, "已收款" Fraunces 48px, "找零 RM 1.40" Fraunces 72px. Row of three chips: 打印收据 (printer icon), 要电子发票 (file-text icon), 不用收据. Primary button 下一位 · Seterusnya. Footer "KL01-P2-000123 · 14:02".
```

### P7 电子发票（MyInvois）
```
E-INVOICE on a tablet. Title 电子发票 · E-INVOIS. A form with hairline inputs 72px: 公司名, TIN, SST 号, 邮箱; a chip row 个人 / 公司. Right side a preview panel of the invoice with hairline rows. Primary button 提交到 MyInvois, status line "发送中 · 已接受 · 被拒" with a thin check or red x. 14px muted "顾客 72 小时内可以要".
```

### P8 退货
```
RETURN. Top: viewfinder strip 160px tall "扫收据二维码 · Imbas resit". After scan: receipt header "KL01-P2-000123 · 11/18 14:02 · 阿丽". Hairline rows per line with a square checkbox 32px, product, qty, price. Right: 退款合计 Fraunces 56px, reason chips 坏了 / 买错 / 过期, primary button 申请退货, 14px muted "经理批准后退款". 
```

### P9 经理授权
```
MANAGER OVERRIDE overlay. Panel 560 × 480: Lucide "shield" 48px, "需要经理 · Perlu pengurus" 28px, reason "折扣超过 10%" 22px muted, a viewfinder 160px "经理扫工牌" and a 6-dot PIN with keypad. Buttons ghost 取消, primary 确认.
```

### P10 折扣
```
DISCOUNT overlay. Panel: selected line name, chips 5% / 10% / 15% / 自定, a keypad, "折后 RM 1.62" Fraunces 36px. 14px muted "超过 10% 需要经理". Buttons ghost 取消, primary 应用.
```

### P11 日结
```
CLOSE SHIFT. Title 日结 · TUTUP SYIF Fraunces 48px. Left: hairline rows 预期现金 RM 1,284.50, 现金销售, 卡, 电子钱包, 退款, each Fraunces 28px right-aligned. Right: label 数到的现金, input Fraunces 56px, keypad; "差额 RM -4.50" in brass (red when over RM 20). Primary button 打印 Z 报表并交班 · Cetak & tutup.
```

---

## 模块 6：经理（手机）

### 整流程
```
Build a clickable phone prototype for the store manager: Home (审批, 盘点差异, 手动调整, 站点今日) → Approvals list → Variance detail → approve; Manual adjust form; Site today dashboard; Assign count task. Use the WarehouseShop design system.
```

### M1 待审批
```
APPROVALS. Title 审批, label "KELULUSAN · APPROVALS", brass count "5". Hairline rows 112px: uppercase type label 14px (盘点差异 / 退货 / 调拨 / 订货 / 导入), one-line summary 22px "A 区 盘点差异 -3 件", amount "RM -3.60" Fraunces 24px brass right, "阿明 · 08:10" muted, chevron.
```

### M2 盘点差异明细
```
VARIANCE DETAIL. Title "盘点差异 · A 区". Summary row: "系统 412 · 实数 409 · 差 -3 · RM -3.60". Hairline rows per product: name 22px, "系统 48 · 实数 45" muted, "-3" Fraunces 28px brass, two small square chips 接受 / 重盘 on the right. Bottom: primary 批准 · Lulus, ghost 全部重盘.
```

### M3 安排盘点
```
ASSIGN COUNT. Title 安排盘点. Section 谁: hairline rows with radio circles (阿明, 阿丽). Section 哪里: square chips for zones A / B / C / S, "或扫货位" ghost button. Section 什么时候: chips 今天 / 明天 / 选日期. Primary button 安排 · Jadualkan.
```

### M4 手动调整
```
MANUAL ADJUST. Product header, location chip, "现在 48" muted, big number input "45" Fraunces 56px with label 改成. Reason as hairline rows with radio circles: 损坏 / 过期 / 样品 / 盘错 / 其他. Photo slot. Primary button 提交审批 · Hantar, 14px muted "老板或代理批准后生效".
```

### M5 订货审批
```
ORDER APPROVAL. Title "订货 PO-2026-0143". Supplier row. Hairline rows per line: product, "建议 10 箱" muted, qty Fraunces 24px with small − / + square buttons, line amount right. Total "RM 1,240.00" Fraunces 36px. Buttons: primary 批准并发给供应商 · Lulus, ghost 退回修改. 14px muted "Telegram 也会收到".
```

### M6 站点今日
```
SITE TODAY. Greeting "KL 分店 · 今天". KPI rows separated by hairlines, label left, Fraunces 36px number right: 今日销售 RM 4,820 · 未处理工单 3 (brass) · 负库存 1 (red) · 待上架 12 · 待收货 2 · 在班 4 人. Each row chevron.
```

---

## 模块 7：老板（手机 + Telegram）

### 整流程
```
Build a clickable phone prototype for the owner: Home (报表, 审批, 代理, 设置) → Reports (5 swipe cards) → Approvals → Delegation setup → Boss settings. Use the WarehouseShop design system.
```

### O1 Telegram 审批卡（消息设计）
```
Design a Telegram message card as it appears in the Telegram app (light theme), 360px wide. Bot name "仓店通". Message: bold "订货审批 PO-2026-0143", lines "供应商：F&N Beverages", "12 行 · RM 1,240.00", "提交人：阿丽 · 11/18 08:10", then two inline buttons side by side "✅ 批准" and "✏️ 修改" and a third full-width "查看明细". Show a second message after approval: "已批准 · 已发给供应商 · 阿强 09:02".
```

### O2 订货建议
```
ORDER SUGGESTIONS. Title 订货, label "PESAN · ORDER". Grouped by supplier with uppercase labels. Hairline rows: product, "7 天销 48 · 现货 12 · 建议 10 箱" muted, qty Fraunces 24px with − / + squares. Supplier subtotal row. Primary button 生成订单 · Buat PO.
```

### O3 老板报表
```
BOSS REPORTS. Five horizontally swipeable full-width panels with hairline borders and page dots. Panel 1: label 今日销售, "RM 4,820" Fraunces 56px, a minimal bar chart by hour in muted grey with the current hour in green, no gridlines. Panel 2: 本月 vs 上月 two numbers and a delta in brass. Panel 3: 损耗 this month. Panel 4: 最差周转前十 list. Panel 5: 各店库存金额 rows.
```

### O4 老板审批
```
BOSS APPROVALS. Same as M1 but with an extra filter chip row 全部 / 订货 / 大额, and each row shows who it came from with the site name. Amounts over the threshold have a brass "大额" badge.
```

### O5 代理设定
```
DELEGATION. Title 我的代理, label "WAKIL · DELEGATE". Step labels uppercase. 选人: hairline rows with radio circles and role under the name. 范围: square checkboxes 订货 / 盘点差异 / 退货 / 手动调整 / 用户角色. 时间: two hairline date inputs 从 / 到. 金额上限: input "RM 5,000". Primary button 确认指定 · Sahkan, 14px muted "到期自动失效，所有操作记录在案".
```

### O6 老板设置
```
BOSS SETTINGS. Hairline rows with chevrons: 我的代理 (value "阿强 · 到 11/30"), 审批门槛 (value "RM 2,000"), 折扣上限 ("10%"), Telegram 绑定 (thin green check "已绑定"), 电子发票 MyInvois ("已连接"), 门店与区 ("3 店 · 12 区"), 角色与权限, 外观设计.
```

---

## 模块 8：顾客大屏（竖屏 1080 × 1920）

### 整流程
```
Build a clickable kiosk prototype (1080 × 1920 portrait, touch): Idle → Search (big keyboard + scan) → Results map → Call staff → Thank you. Use the WarehouseShop design system scaled ×2 (body 44px, buttons 144px). Must be usable by elderly customers standing 1 metre away.
```

### D1 待机
```
KIOSK IDLE. Paper background. Top: store name Fraunces 72px. Center: "找商品？" Fraunces 96px, "Cari barang? · Find a product?" 44px muted. A 240px tall green button "点这里 · Tekan sini". Below, three promo rows with hairlines: product photo 200px, name 44px, price Fraunces 64px. Footer: date/time and "扫商品条码也可以" with a Lucide "scan-line".
```

### D2 找商品
```
KIOSK SEARCH. Top: hairline input 144px tall with typed text "可乐" 64px. A full-width on-screen keyboard with 120px keys (pinyin letters and digits), paper keys with hairline borders. Category chips above the keyboard: 饮料 / 米粮 / 零食 / 牛奶 / 海鲜 144px tall. Live results list on the right side of the input: two rows with photo and name.
```

### D3 结果地图
```
KIOSK RESULT MAP. Top: product photo 240px, name Fraunces 64px, price 72px. Center: a simplified store floor plan 900 × 900, aisles as paper rectangles with hairlines and labels A–F, the target shelf filled green with a brass pin, "你在这里" dot. Below: "走道 A · 第 3 架 · 第 2 层" 56px. Buttons: 144px green 叫员工帮忙 · Panggil staf, ghost 再找一个.
```

### D4 叫员工
```
KIOSK CALL STAFF. Thin green square check 240px, "员工马上来" Fraunces 96px, "Staf akan datang · Staff is coming" 44px muted, a countdown "30" Fraunces 160px in brass. Ghost button 取消.
```

### D5 谢谢
```
KIOSK THANKS. "谢谢 · Terima kasih" Fraunces 120px centered, returns to idle after 5s, small progress line at the bottom.
```

---

## 模块 9：网页管理端（1440 × 900）

### 整流程
```
Build a clickable desktop prototype (1440 × 900): sidebar navigation across Dashboard, Approvals, Products, Locations & zones, Map editor, Stock, Movements, Reports, Tickets, Devices, Users & roles, Audit log, Excel import, Settings, Theme editor. Use the WarehouseShop design system: paper background, 260px sidebar with hairline right border, Fraunces page titles 32px, tables with hairline rows and 14px uppercase headers, KPI numbers in Fraunces 48px separated by vertical hairlines, no cards with shadows.
```

### G1 仪表板
```
DASHBOARD. Title 仪表板, date right. KPI row of 6 separated by vertical hairlines: 今日销售 RM 4,820 · 待审批 3 (brass) · 负库存 1 (red) · 7 天到期 12 · 待上架 24 · 离线设备 0. Two columns below: left table 最近移动 8 rows (时间, 商品, 数量, 从, 到, 谁); right list 待处理工单 4 rows with brass priority badges. Bottom: a minimal line chart 本周销售 with no gridlines, green line, muted dots.
```

### G2 产品管理
```
PRODUCTS. Title 商品, right side buttons: ghost 导出 Excel, ghost 导入, primary + 新商品. Filter bar: hairline search 360px, chips 类别 / 供应商 / 有条码 / 称重. Table with hairline rows 56px: photo 40px, 名称, 条码 (multiple shown as "3 个"), 类别, 售价, 成本 (hidden column shown as "—" for roles without cost permission), 总库存, 状态. Right-side drawer 480px when a row is clicked: product form with hairline inputs, a barcode list with "+ 加条码", tax code select, "称重商品" toggle with PLU field.
```

### G3 库存查询
```
STOCK. Title 库存. Chips: 全部 / 低于最低 / 负库存 / 即将到期. Table: 商品, 位置, 数量, 单位, 有效期 (brass when < 30 days), 最后移动. A left tree of sites and zones 240px with counts. Bulk action row at the bottom: ghost 导出, ghost 打印标签.
```

### G4 移动记录
```
MOVEMENTS. Title 移动记录. Date range inputs, chips 收货 / 上架 / 补货 / 销售 / 调整 / 盘点. Table: 时间, 商品, 数量, 从, 到, 原因, 谁, 设备. A muted note "记录只增不改" top right. Row click opens a drawer with the full audit of that movement.
```

### G5 位置和区
```
LOCATIONS & ZONES. Left: site selector and zone list with colored dots and category restriction chips ("只放 饮料"). Right: a grid of racks for the selected zone, each rack a hairline rectangle with levels, location codes like A-03-2 inside, stock count in muted. Buttons: primary + 新区, ghost 改大小 (shows a warning drawer "货位有库存，不能删" in red when needed), ghost 打印标签 (opens a label preview panel with QR + big code).
```

### G6 地图编辑器
```
MAP EDITOR. Canvas 1000 × 700 paper with a fine dot grid. Draggable zone rectangles with hairline borders and zone letter, aisle labels, entrance marker, kiosk marker. Right panel 300px: selected zone properties (name, color dot, categories allowed, rack count × levels). Toolbar: ghost 加区, 加走道, 加入口, primary 保存. This map feeds the customer kiosk.
```

### G7 用户与角色
```
USERS & ROLES. Two tabs 用户 / 角色. Users table: 名字, 手机, 站点, 角色 chips, 状态, 最后登录, actions (ghost 重置 PIN shows a one-time PIN modal, ghost 打印工牌 opens a badge preview with QR). Roles tab: left list of roles (老板, 经理, 仓库员, 盘点员, 上架员, 收银员, 代理), right a permission matrix with square checkboxes grouped by module (库存, 收货, 盘点, POS, 审批, 报表, 设置), plus a "首页 4 个按钮" picker with drag ordering. Primary 保存.
```

### G8 审批中心
```
APPROVALS (web). Table: 类型, 摘要, 金额, 提交人, 站点, 时间, 状态 chips. Right drawer: full detail with line items, a hairline textarea 备注, buttons primary 批准, ghost 退回, red text 拒绝. Self-approval shows a muted disabled note "不能批准自己提交的".
```

### G9 订货与供应商
```
PURCHASE ORDERS. Table of POs with status chips (草稿 / 待批 / 已发 / 部分收 / 完成). Primary + 新订单 opens a page: supplier select, suggested lines table (7 天销, 现货, 建议, 订购 qty input, 单价, 金额), total, buttons 保存草稿 / 送审批. Supplier tab: list with contact, lead time, payment terms.
```

### G10 报表中心
```
REPORTS. Left list of reports: 销售日报, 库存金额, 损耗, 周转, 盘点准确率, 员工绩效, 到期商品, 供应商表现. Right: the selected report with a filter row (date range, site), KPI numbers in Fraunces, one minimal chart, a table, and a top-right ghost 导出 Excel / PDF. Columns hidden by role show "—".
```

### G11 Excel 导入
```
EXCEL IMPORT. Three-step strip: 下载模板 → 上传 → 检查并提交. Step 1: template cards (hairline, not shadowed) 商品 / 期初库存 / 位置 / 供应商 / 用户 / 条码, each with a ghost 下载. Step 2: a dashed drop zone 240px tall. Step 3: a preview table where each row has a status chip (OK green text, 警告 brass, 错误 red) and the message in Chinese + Malay; summary "412 行 · 3 错误 · 7 警告"; buttons ghost 下载标注文件, primary 提交审批 (disabled while errors > 0).
```

### G12 工单
```
TICKETS (web). Kanban with three hairline columns 新 / 处理中 / 已解决, tickets as plain paper rectangles with hairline border: title, product, location chip, assignee avatar initials, priority badge in brass. Right drawer with timeline and photos. Top filter chips: 负库存 / 损坏 / 同步隔离 / 顾客 / 其他.
```

### G13 设备与同步
```
DEVICES & SYNC. Table: 设备名, 类型 (手机 / POS / 大屏 / 秤 / 打印机), 站点, 最后在线 (green dot or red "离线 2 小时"), 待上传, 版本, actions ghost 停用. Below a section 同步隔离: rows of quarantined records with reason and buttons ghost 重试 / red text 丢弃. A small hardware bridge status row: "本机桥接 ws://127.0.0.1:9123 · 打印机 OK · 钱箱 OK · 扫码枪 OK".
```

### G14 审计日志
```
AUDIT LOG. Filters: date range, user, table, action chips 新增 / 修改 / 删除 / 登录 / 审批. Table: 时间, 谁, 做了什么 (plain sentence), 表, 记录, 设备. Row expands to a before/after diff with two hairline columns, changed fields in brass.
```

### G15 设置
```
SETTINGS. Left sub-nav: 公司, 门店, 税务 (SST, MyInvois TIN, sandbox toggle), Telegram, 电子发票, 审批规则, 语言默认, 会计导出 (SQL Account / AutoCount / CSV). Right: hairline forms with 48px inputs and a primary 保存 at the bottom right.
```

### G16 外观设计
```
THEME EDITOR. Left 320px: preset chips (极简 / 市场 / 玻璃 / 夜间 / 超级应用 / 清新), color swatches with hex inputs (底色, 文字, 主色, 强调), font select, radius slider 0–24, home layout chips 清单 / 瓷砖, density chips. Right: a live phone frame 390 × 844 showing the home screen with the current theme. Primary 保存并应用到全公司.
```

---

## 模块 10：超级管理员（卖给其他公司）

### A1 公司列表
```
COMPANIES (super admin). Title 公司. Table: 名称, 代号, 方案 (A 小店 / B 中型) chip, 门店数, 用户数, 上次活动, 状态, actions ghost 进入. Primary + 新公司.
```

### A2 开店向导
```
NEW COMPANY WIZARD. Four-step strip 基本资料 → 选方案 → 区与货位 → 老板账号. Step 2 shows two large hairline panels A 小店 (无 POS, 1 店, 预设 4 区) and B 中型 (接 Pandal POS, 多店), selected panel with a 3px brass left rule. Step 3 a zone table with editable rows (区名, 类别限制, 架数, 层数). Step 4 inputs for boss name, phone, email, and a generated one-time PIN shown in Fraunces 36px with a "打印工牌" ghost button. Primary 创建 · Cipta.
```

### A3 同步监控
```
SYNC MONITOR. KPI row: 在线设备, 积压 > 100 笔 (brass), 隔离记录 (red), 今日同步批次. Table per company: 公司, 设备数, 最旧未上传, 隔离, 最后错误. Row click shows a small timeline chart of batches per hour, minimal, green line.
```

---

## 组件库（让 Figma 建成可复用组件）

```
Create a component library page for WarehouseShop with variants: Button (primary / secondary / ghost / danger-text; sizes 72 and 88; states default / pressed / disabled), Top bar (with back / without), Yellow offline bar, List row (with icon / with photo / with number; with chevron / with check / with count), Chip (default / selected / brass / red), Input (hairline bottom; default / focused / error), Keypad (digits / with decimal / with clear), Viewfinder (idle / scanned / error), Big number (56 / 72), Badge (brass / green / red), Step strip (1–3 steps with done states), Done block, Error screen, Bottom sheet, Sidebar item (default / active), Table row, KPI tile, Drawer. All square corners, hairlines, Lucide icons. Name layers clearly so a developer can map them to CSS tokens: --paper, --ink, --green, --brass, --hairline, --muted, --red, --warn.
```

---

## 交给我的方式

做完任意一个模块：Share → Copy link（Anyone with the link, can view）。发链接给我，我按模块接进代码。优先顺序建议：模块 1 共用 → 模块 2 仓库员 → 模块 5 POS → 模块 9 网页。
