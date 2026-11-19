// kiosk 模块字符串（并行开发：本文件只由 kiosk 模块维护）。格式同 strings.ts：key: [zh, ms, en]
// 覆盖：C5 机器人、S6 顾客呼叫、C6 工单完整版。大屏（/kiosk）不登录、三语同屏，字符串在 screens/kiosk 自带。
export const STR_KIOSK: Record<string, [string, string, string]> = {
  bot_title: ['问机器人', 'Tanya Robot', 'Ask the Bot'], bot_placeholder: ['打字问，例如：可乐放哪里', 'Taip soalan, cth: Milo kat mana', 'Type a question, e.g. where is Coke'],
  bot_hold_talk: ['按住说话', 'Tekan & cakap', 'Hold to talk'], bot_release: ['松开发送', 'Lepas untuk hantar', 'Release to send'], bot_send: ['发送', 'Hantar', 'Send'],
  bot_go_screen: ['去这个屏幕', 'Pergi ke skrin', 'Go to screen'], bot_try_ask: ['可以这样问', 'Cuba tanya', 'Try asking'], bot_thinking: ['在想…', 'Sedang fikir…', 'Thinking…'],
  bot_offline_hint: ['离线：只能查本机知识库', 'Luar talian: hanya pangkalan pengetahuan tempatan', 'Offline: local knowledge only'], bot_no_local: ['本机没有答案，有网再问', 'Tiada jawapan tempatan, cuba bila ada talian', 'No local answer, try when online'],
  bot_escalate: ['转给主管', 'Hantar kepada penyelia', 'Send to supervisor'], bot_escalated: ['已转给主管', 'Telah dihantar kepada penyelia', 'Sent to supervisor'], bot_mic_denied: ['麦克风不可用，请打字', 'Mikrofon tidak tersedia, sila taip', 'Microphone unavailable, please type'],
  bot_hello: ['你好！有什么要问的？', 'Hai! Ada apa nak tanya?', 'Hello! What do you want to ask?'], bot_sop_list: ['看全部 SOP', 'Lihat semua SOP', 'All SOPs'],
  cc_title: ['顾客呼叫', 'Panggilan Pelanggan', 'Customer Call'], cc_customer_needs: ['顾客需要帮忙', 'Pelanggan perlukan bantuan', 'Customer needs help'], cc_i_go: ['我去', 'Saya pergi', 'I will go'], cc_someone_else: ['别人去', 'Orang lain', 'Someone else'],
  cc_handled: ['已处理', 'Selesai', 'Handled'], cc_accepted_by: ['{name} 已接', '{name} telah terima', 'Accepted by {name}'], cc_aisle: ['走道/货架', 'Lorong/Rak', 'Aisle/Shelf'], cc_product: ['产品', 'Produk', 'Product'], cc_waiting: ['等了 {n} 分钟', 'Menunggu {n} minit', 'Waiting {n} min'],
  cc_someone_took: ['别人已经去了', 'Orang lain sudah pergi', 'Someone else took it'],
  tk_all: ['全部', 'Semua', 'All'], tk_new: ['新建', 'Baru', 'New'], tk_in_progress: ['处理中', 'Sedang', 'In progress'], tk_waiting: ['等待他人', 'Menunggu', 'Waiting'], tk_resolved: ['已解决', 'Selesai', 'Resolved'], tk_closed: ['已关闭', 'Ditutup', 'Closed'],
  tk_timeline: ['时间线', 'Garis masa', 'Timeline'], tk_comment: ['评论', 'Komen', 'Comment'], tk_photo: ['拍照', 'Gambar', 'Photo'], tk_assign: ['转派', 'Serahkan', 'Reassign'], tk_close: ['关闭', 'Tutup', 'Close'], tk_close_reason: ['关闭原因', 'Sebab tutup', 'Close reason'],
  tk_deadline: ['期限', 'Tarikh akhir', 'Deadline'], tk_overdue: ['超期', 'Lewat', 'Overdue'], tk_owner: ['负责人', 'Pemilik', 'Owner'], tk_role: ['角色', 'Peranan', 'Role'], tk_type: ['类型', 'Jenis', 'Type'],
  tk_accept: ['我去', 'Saya pergi', 'I will go'], tk_pick_person: ['选人', 'Pilih orang', 'Pick person'], tk_uploading: ['上传中…', 'Memuat naik…', 'Uploading…'], tk_offline_later: ['离线，有网自动传', 'Luar talian, dihantar kemudian', 'Offline, will send later'],
  tk_mine: ['我的', 'Saya', 'Mine'], tk_system: ['系统', 'Sistem', 'System'],
  reason_FIXED: ['已修好/已处理', 'Selesai', 'Fixed'], reason_NOT_AN_ISSUE: ['不是问题', 'Bukan masalah', 'Not an issue'], reason_DUPLICATE: ['重复', 'Pendua', 'Duplicate'], reason_CUSTOMER_LEFT: ['顾客已走', 'Pelanggan pergi', 'Customer left'], reason_HANDLED_OTHER: ['别人处理了', 'Orang lain selesai', 'Handled by other'], reason_CANNOT_REPRODUCE: ['查不出', 'Tidak dapat kesan', 'Cannot reproduce'], reason_OTHER: ['其他', 'Lain', 'Other'],
  type_COUNT_VARIANCE: ['盘点差异', 'Perbezaan kiraan', 'Count variance'], type_RECEIVE_VARIANCE: ['收货差异', 'Perbezaan terima', 'Receive variance'], type_TRANSFER_VARIANCE: ['调拨差异', 'Perbezaan pindahan', 'Transfer variance'], type_NEGATIVE_STOCK: ['负库存', 'Stok negatif', 'Negative stock'],
  type_CUSTOMER_HELP: ['顾客呼叫', 'Panggilan pelanggan', 'Customer help'], type_BOT_UNANSWERED: ['机器人答不了', 'Robot tak dapat jawab', 'Bot unanswered'], type_DEVICE: ['设备', 'Peranti', 'Device'], type_UNKNOWN_BARCODE: ['未知条码', 'Kod bar tidak dikenali', 'Unknown barcode'],
  type_OVERDUE_AR: ['逾期应收', 'Hutang lewat', 'Overdue AR'], type_SYNC_QUARANTINE: ['同步隔离', 'Kuarantin segerak', 'Sync quarantine'], type_MANUAL: ['手动', 'Manual', 'Manual'], type_RECEIVE_DAMAGE: ['收货损坏', 'Rosak semasa terima', 'Receive damage'],
};
