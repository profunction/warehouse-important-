import type { Lang } from '@wh/shared';
import { STR_ORDERS } from './ext/orders.js';
import { STR_COUNTS } from './ext/counts.js';
import { STR_POS } from './ext/pos.js';
import { STR_KIOSK } from './ext/kiosk.js';
type S = Record<string, [string, string, string]>; // zh, ms, en
export const STR: S = {
  ...STR_ORDERS, ...STR_COUNTS, ...STR_POS, ...STR_KIOSK,
  app_name: ['仓店通', 'WarehouseShop', 'WarehouseShop'],
  login: ['登录', 'Log Masuk', 'Log In'], logout: ['退出', 'Keluar', 'Log Out'], confirm_logout: ['确定退出？', 'Pasti mahu keluar?', 'Log out?'],
  scan_badge: ['扫员工卡', 'Imbas kad pekerja', 'Scan staff badge'], or_phone: ['或输手机号', 'atau nombor telefon', 'or phone number'], company_code: ['公司代码', 'Kod syarikat', 'Company code'], phone: ['手机号', 'Telefon', 'Phone'], email: ['电邮', 'E-mel', 'Email'],
  enter_pin: ['输入 6 位 PIN', 'Masukkan PIN 6 digit', 'Enter 6-digit PIN'], pin_wrong: ['PIN 不对，请再试', 'PIN salah', 'Wrong PIN'],
  hello: ['你好', 'Hai', 'Hello'], online: ['在线', 'Dalam talian', 'Online'], offline: ['离线', 'Luar talian', 'Offline'], pending_upload: ['笔待上传', 'rekod menunggu', 'records pending'], synced: ['已同步', 'Disegerak', 'Synced'],
  stale_data: ['数据超过一天未更新', 'Data lebih sehari tidak dikemas kini', 'Data not updated for over a day'], please_connect: ['请连接网络上传', 'Sila sambung internet', 'Please connect to upload'],
  back: ['返回', 'Kembali', 'Back'], cancel: ['取消', 'Batal', 'Cancel'], ok: ['知道了', 'Faham', 'OK'], confirm: ['确认', 'Sahkan', 'Confirm'], done: ['完成', 'Selesai', 'Done'], yes: ['是', 'Ya', 'Yes'], no: ['否', 'Tidak', 'No'], next: ['下一个', 'Seterusnya', 'Next'], home: ['回到首页', 'Laman utama', 'Home'], continue_next: ['继续下一个', 'Teruskan', 'Continue'],
  abandon_step: ['放弃这一步？', 'Batalkan langkah ini?', 'Abandon this step?'], abandon: ['放弃', 'Batal', 'Abandon'], keep: ['继续做', 'Teruskan', 'Keep going'],
  scan_product: ['请扫产品条码', 'Imbas kod bar produk', 'Scan product barcode'], scan_location: ['请扫货位', 'Imbas lokasi', 'Scan location'], scan_shelf: ['请扫货架', 'Imbas rak', 'Scan shelf'], type_in: ['打字输入', 'Taip', 'Type in'], torch: ['手电', 'Lampu', 'Torch'], camera_denied: ['摄像头不可用，请打字输入或用扫描枪', 'Kamera tidak tersedia', 'Camera unavailable, type in or use scanner'],
  last: ['上一个', 'Sebelumnya', 'Last'], qty: ['数量', 'Kuantiti', 'Qty'], unit_pcs: ['件', 'unit', 'pcs'], unit_kg: ['公斤', 'kg', 'kg'], case: ['箱', 'kotak', 'case'], plus_case: ['+1 箱', '+1 kotak', '+1 case'], plus_one: ['+1 件', '+1 unit', '+1 pc'], clear: ['清', 'Padam', 'Clear'],
  expected: ['应收', 'Dijangka', 'Expected'], put_at: ['放', 'Letak', 'Put'], go_to: ['去', 'Pergi ke', 'Go to'], backroom_has: ['后仓有', 'Stor ada', 'Backroom has'], shelf_has: ['货架有', 'Rak ada', 'Shelf has'], total_stock: ['总库存', 'Jumlah stok', 'Total stock'], price: ['售价', 'Harga', 'Price'], cost: ['成本', 'Kos', 'Cost'], sales_30d: ['30 天销量', 'Jualan 30 hari', '30-day sales'],
  more_than_expected: ['比应收多 {n}，确定吗？', 'Lebih {n} daripada dijangka, pasti?', '{n} more than expected, sure?'],
  expiry: ['到期日', 'Tarikh luput', 'Expiry'], pick_month: ['选到期月份', 'Pilih bulan luput', 'Pick expiry month'], day: ['日', 'Hari', 'Day'], skip: ['跳过', 'Langkau', 'Skip'],
  receive: ['收货', 'Terima', 'Receive'], putaway: ['上架', 'Susun', 'Put Away'], refill: ['补货', 'Isi Semula', 'Refill'], count: ['盘点', 'Kira Stok', 'Count'], lookup: ['查询', 'Cari', 'Lookup'], pick: ['拣货', 'Pilih', 'Pick'], assign_shelf: ['登记位置', 'Daftar Lokasi', 'Assign Shelf'], tickets: ['工单', 'Tiket', 'Tickets'], approvals: ['审批', 'Kelulusan', 'Approvals'], reports: ['报表', 'Laporan', 'Reports'], settings: ['设置', 'Tetapan', 'Settings'], my_records: ['我的记录', 'Rekod saya', 'My records'], help: ['帮助', 'Bantuan', 'Help'], ask_bot: ['问', 'Tanya', 'Ask'],
  coming_soon: ['即将推出', 'Akan datang', 'Coming soon'], needs_network: ['需要网络', 'Perlu internet', 'Needs network'],
  receive_no_po: ['无单收货', 'Terima tanpa PO', 'Receive without PO'], receive_title: ['收货', 'Terima barang', 'Receiving'], damaged: ['有损坏', 'Ada rosak', 'Damaged'], damaged_qty: ['损坏数量', 'Kuantiti rosak', 'Damaged qty'], take_photo: ['拍照', 'Ambil gambar', 'Take photo'],
  receive_done: ['收货完成！', 'Penerimaan selesai!', 'Receiving done!'], refill_done: ['补货完成！', 'Isi semula selesai!', 'Refill done!'], putaway_done: ['上架完成！', 'Susun selesai!', 'Put-away done!'], assigned_done: ['位置已登记！', 'Lokasi didaftar!', 'Location assigned!'],
  items_summary: ['{p} 种产品 · {q} 件', '{p} produk · {q} unit', '{p} products · {q} units'], variance_notified: ['{n} 项差异已通知老板', '{n} perbezaan dimaklumkan kepada bos', '{n} variances sent to boss'],
  set_as_shelf: ['把这个产品的位置设为 {code} 吗？', 'Tetapkan lokasi produk ini ke {code}?', 'Set this product\'s shelf to {code}?'],
  shelf_low_list: ['货架缺货清单', 'Rak perlu diisi', 'Shelves to refill'], none_to_refill: ['货架都满了', 'Semua rak penuh', 'All shelves stocked'], none_pending: ['今天没有待处理的', 'Tiada yang tertunggak', 'Nothing pending today'],
  pending_putaway: ['收货区待上架', 'Menunggu disusun', 'Waiting put-away'], suggested: ['建议', 'Cadangan', 'Suggested'], wrong_location: ['这是 {got}，请去 {want}', 'Ini {got}, pergi ke {want}', 'This is {got}, go to {want}'], location_changed: ['已改为 {code}', 'Ditukar ke {code}', 'Changed to {code}'],
  not_in_system: ['这个条码不在系统里', 'Kod bar tiada dalam sistem', 'Barcode not in system'], link_barcode: ['挂到已有产品', 'Pautkan ke produk', 'Link to product'],
  my_tickets: ['我的工单', 'Tiket saya', 'My tickets'], new_ticket: ['开工单', 'Buka tiket', 'New ticket'], resolved: ['已解决', 'Selesai', 'Resolved'], device_problem: ['设备问题', 'Masalah peranti', 'Device problem'], describe: ['写一句话说明', 'Tulis penerangan', 'Describe briefly'],
  language: ['语言', 'Bahasa', 'Language'], font_size: ['字体大小', 'Saiz tulisan', 'Font size'], normal: ['正常', 'Biasa', 'Normal'], large: ['特大', 'Besar', 'Large'], change_pin: ['改 PIN', 'Tukar PIN', 'Change PIN'], old_pin: ['旧 PIN', 'PIN lama', 'Old PIN'], new_pin: ['新 PIN', 'PIN baru', 'New PIN'], saved: ['已保存', 'Disimpan', 'Saved'],
  needs_attention: ['{n} 条记录需要处理', '{n} rekod perlu tindakan', '{n} records need attention'], sent_to_supervisor: ['{n} 条记录已交给主管处理', '{n} rekod dihantar kepada penyelia', '{n} records sent to supervisor'], retry: ['重传', 'Hantar semula', 'Resend'], delete_record: ['删除这条记录', 'Padam rekod', 'Delete record'], really_delete: ['确定删除？不能恢复', 'Pasti padam? Tidak boleh pulih', 'Delete? Cannot undo'],
  clock_skew: ['手机时间不准，请校对', 'Masa telefon tidak tepat', 'Phone clock is off, please fix'], select_site: ['选站点', 'Pilih tapak', 'Select site'], loading: ['加载中…', 'Memuatkan…', 'Loading…'], no_camera: ['无摄像头', 'Tiada kamera', 'No camera'],
  recent: ['最近移动', 'Pergerakan terkini', 'Recent movements'], locations: ['位置', 'Lokasi', 'Locations'], shelves: ['货架', 'Rak', 'Shelves'], offline_data: ['离线数据', 'Data luar talian', 'Offline data'], last_update: ['上次更新', 'Kemas kini terakhir', 'Last update'],
  supervisor_ans: ['找不到答案？找主管', 'Tiada jawapan? Tanya penyelia', 'No answer? Ask supervisor'],
  role_SUPER_ADMIN: ['超级管理员', 'Pentadbir Utama', 'Super Admin'], role_BOSS: ['老板', 'Bos', 'Boss'], role_MANAGER: ['经理', 'Pengurus', 'Manager'], role_PURCHASER: ['采购员', 'Pembeli', 'Purchaser'], role_WAREHOUSE: ['库存员', 'Pekerja Stok', 'Stock Staff'], role_COUNTER: ['盘点员', 'Pengira Stok', 'Stock Checker'], role_STOCKER: ['上架员', 'Penyusun Rak', 'Shelf Stocker'], role_CASHIER: ['收银员', 'Juruwang', 'Cashier'], role_ACCOUNTS: ['会计', 'Akaun', 'Accounts'],
  reason_RECEIVE: ['收货', 'Terima', 'Receive'], reason_PUTAWAY: ['上架', 'Susun', 'Put away'], reason_REFILL: ['补货', 'Isi semula', 'Refill'], reason_COUNT: ['盘点', 'Kira', 'Count'], reason_ADJUST: ['调整', 'Laras', 'Adjust'], reason_SALE: ['销售', 'Jualan', 'Sale'], reason_RETURN: ['退货', 'Pulangan', 'Return'], reason_TRANSFER_OUT: ['调出', 'Keluar', 'Transfer out'], reason_TRANSFER_IN: ['调入', 'Masuk', 'Transfer in'],
};
const IDX: Record<Lang, number> = { zh: 0, ms: 1, en: 2 };
export function tr(lang: Lang, key: string, vars?: Record<string, string | number>) {
  let s = STR[key]?.[IDX[lang]] ?? STR[key]?.[0] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
/** 第二行：当前语言之外的两种语言，用 · 连接（Muse 设计：中文在上，马来文英文在下） */
export function tr2(lang: Lang, key: string) {
  const row = STR[key]; if (!row) return '';
  const others = (['zh', 'ms', 'en'] as Lang[]).filter((l) => l !== lang).map((l) => row[IDX[l]]).filter((v, i, a) => v && a.indexOf(v) === i && v !== row[IDX[lang]]);
  return others.join(' · ');
}
export function name3(lang: Lang, o: { name_zh?: string | null; name_ms?: string | null; name_en?: string | null } | null | undefined) {
  if (!o) return '';
  const order = lang === 'zh' ? [o.name_zh, o.name_en, o.name_ms] : lang === 'ms' ? [o.name_ms, o.name_en, o.name_zh] : [o.name_en, o.name_ms, o.name_zh];
  return order.find(Boolean) ?? '';
}
