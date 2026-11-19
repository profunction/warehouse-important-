// orders 模块字符串（并行开发：本文件只由 orders 模块维护）。格式同 strings.ts：key: [zh, ms, en]
export const STR_ORDERS: Record<string, [string, string, string]> = {
  // 收货 W1–W5
  pending_po: ['待收采购单', 'PO menunggu', 'POs to receive'], receive_without_po: ['无单收货', 'Terima tanpa PO', 'Receive without PO'],
  expected_date: ['预计到货', 'Jangka tiba', 'Expected'], lines_n: ['{n} 行', '{n} baris', '{n} lines'], received_so_far: ['已收', 'Diterima', 'Received'],
  not_on_po: ['不在这张采购单上，照样收吗？', 'Tiada dalam PO ini, terima juga?', 'Not on this PO, receive anyway?'], receive_anyway: ['照样收', 'Terima juga', 'Receive anyway'],
  short_items: ['少货', 'Kurang', 'Short'], over_items: ['多货', 'Lebih', 'Over'], damaged_items: ['损坏', 'Rosak', 'Damaged'], no_variance: ['数量全部对上', 'Semua kuantiti tepat', 'All quantities match'],
  tickets_opened: ['已开 {n} 张工单', '{n} tiket dibuka', '{n} tickets opened'], po_partial: ['采购单部分收货', 'PO diterima sebahagian', 'PO partially received'], po_received: ['采购单已收齐', 'PO diterima penuh', 'PO fully received'],
  photo_taken: ['已拍照', 'Gambar diambil', 'Photo taken'], damaged_photo_hint: ['损坏请拍照，老板看得到', 'Ambil gambar barang rosak', 'Photo the damage for the boss'],
  grn_no: ['收货单号', 'No. GRN', 'GRN no.'], start_receiving: ['开始收货', 'Mula terima', 'Start receiving'], complete_offline_hint: ['离线：收货记录会在联网后上传，完成对单需联网', 'Luar talian: rekod dimuat naik kemudian', 'Offline: lines upload later; completing needs network'],
  // 上架 W6
  by_grn: ['按收货单', 'Ikut GRN', 'By GRN'], arrived: ['到货', 'Tiba', 'Arrived'],
  // 拣货 W10–W12
  pick_list: ['拣货单', 'Senarai pilih', 'Pick lists'], to_site: ['送到', 'Hantar ke', 'Deliver to'], required_at: ['要求时间', 'Masa diperlukan', 'Required by'],
  go_take: ['去 {loc} 拿 {qty} {unit}', 'Pergi {loc} ambil {qty} {unit}', 'Go to {loc}, take {qty} {unit}'], not_here: ['这里没有', 'Tiada di sini', 'Not here'], next_location: ['下一个货位 {loc}（有 {qty}）', 'Lokasi seterusnya {loc} (ada {qty})', 'Next location {loc} (has {qty})'],
  no_other_location: ['其他货位也没有，记为缺货', 'Tiada di lokasi lain, catat kurang', 'No other location, mark as short'], picked: ['已拣', 'Dipilih', 'Picked'], of_total: ['共', 'daripada', 'of'],
  pick_done: ['拣货完成！', 'Pemilihan selesai!', 'Picking done!'], print_box_label: ['打印箱贴', 'Cetak label kotak', 'Print box labels'], loaded: ['已装车', 'Sudah dimuat', 'Loaded'], dispatched: ['已发运！', 'Dihantar!', 'Dispatched!'],
  scan_transfer_qr: ['扫调拨单二维码', 'Imbas QR pindahan', 'Scan transfer QR'], wrong_location_scan: ['这是 {got}，要去 {want}', 'Ini {got}, pergi ke {want}', 'This is {got}, go to {want}'], wrong_product_scan: ['不是这个产品', 'Bukan produk ini', 'Wrong product'],
  skip_line: ['先跳过', 'Langkau dulu', 'Skip for now'], pick_short: ['缺 {n}', 'Kurang {n}', 'Short {n}'],
  // 收调拨 S7
  receive_transfer: ['收调拨', 'Terima pindahan', 'Receive transfer'], in_transit_list: ['运输中的调拨', 'Pindahan dalam perjalanan', 'Transfers in transit'], sent_qty: ['发出', 'Dihantar', 'Sent'],
  transfer_done: ['调拨收货完成！', 'Pindahan diterima!', 'Transfer received!'], variance_n: ['{n} 项差异已开工单', '{n} perbezaan, tiket dibuka', '{n} variances, ticket opened'], not_on_transfer: ['这个产品不在这张调拨单上', 'Produk ini tiada dalam pindahan', 'Product not on this transfer'],
  // 申请调拨 S8
  request_transfer: ['申请调拨', 'Mohon pindahan', 'Request transfer'], need_refill: ['要补货', 'Perlu isi semula', 'Need refill'], added_n: ['已加 {n} 个产品', '{n} produk ditambah', '{n} products added'], send_request: ['送出申请', 'Hantar permohonan', 'Send request'],
  request_sent: ['申请已送出！', 'Permohonan dihantar!', 'Request sent!'], wait_manager: ['等仓库经理批准', 'Menunggu pengurus gudang', 'Waiting for warehouse manager'], already_added: ['已经加过了', 'Sudah ditambah', 'Already added'], no_warehouse: ['没有仓库站点', 'Tiada gudang', 'No warehouse site'],
  // 老板订货 O2
  orders: ['订货', 'Pesanan', 'Orders'], todays_proposal: ['今日订货建议', 'Cadangan pesanan hari ini', "Today's order proposal"], no_proposal_today: ['今天没有订货建议', 'Tiada cadangan hari ini', 'No proposal today'], new_order: ['新订单', 'Pesanan baru', 'New order'],
  approve_all: ['全部批准', 'Lulus semua', 'Approve all'], reject: ['拒绝', 'Tolak', 'Reject'], remove_line: ['不要', 'Buang', 'Remove'], restore_line: ['恢复', 'Pulih', 'Restore'], current_qty: ['现有', 'Ada', 'Have'], suggested_qty: ['建议', 'Cadangan', 'Suggested'],
  approved_pos: ['已批准，生成 {n} 张采购单', 'Diluluskan, {n} PO dijana', 'Approved, {n} POs created'], pdf_sent: ['PDF 已发到 Telegram，请转发给供应商', 'PDF dihantar ke Telegram', 'PDF sent to Telegram, forward to supplier'],
  no_supplier: ['未指定供应商', 'Tiada pembekal', 'No supplier'], supplier: ['供应商', 'Pembekal', 'Supplier'], total_amount: ['合计', 'Jumlah', 'Total'], generate_now: ['现在生成建议', 'Jana cadangan sekarang', 'Generate now'], nothing_low: ['没有低于最低量的产品', 'Tiada produk di bawah paras minimum', 'Nothing below minimum'],
  order_placed: ['订单已下！', 'Pesanan dibuat!', 'Order placed!'], pending_approval: ['待老板审批', 'Menunggu bos', 'Pending boss approval'], submit_review: ['送审', 'Hantar untuk kelulusan', 'Submit'], status_PENDING_REVIEW: ['待预审', 'Menunggu semakan', 'Pending review'], status_PENDING_APPROVAL: ['待审批', 'Menunggu kelulusan', 'Pending approval'], status_APPROVED: ['已批准', 'Diluluskan', 'Approved'], status_REJECTED: ['已拒绝', 'Ditolak', 'Rejected'], status_RETURNED: ['已退回', 'Dikembalikan', 'Returned'],
  status_REQUESTED: ['待批', 'Menunggu', 'Requested'], status_PICKING: ['拣货中', 'Memilih', 'Picking'], status_IN_TRANSIT: ['运输中', 'Dalam perjalanan', 'In transit'], status_RECEIVED: ['已收', 'Diterima', 'Received'], status_SENT: ['已发出', 'Dihantar', 'Sent'], status_PARTIAL: ['部分收货', 'Sebahagian', 'Partial'], status_CANCELLED: ['已取消', 'Dibatalkan', 'Cancelled'],
  order_proposals: ['订货建议', 'Cadangan pesanan', 'Order proposals'], purchase_orders: ['采购单', 'Pesanan belian', 'Purchase orders'], suppliers: ['供应商', 'Pembekal', 'Suppliers'],
  remove: ['删除', 'Padam', 'Remove'], add_product: ['加产品', 'Tambah produk', 'Add product'], boxes_n: ['{n} 箱', '{n} kotak', '{n} cases'],
};
