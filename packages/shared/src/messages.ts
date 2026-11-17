import type { Lang } from './permissions.js';
export type Tri = { zh: string; ms: string; en: string };
// 错误代码 → 三语说明。服务器返回 code 和三语文本，前端按语言显示。
export const ERROR_MESSAGES: Record<string, Tri> = {
  UNAUTHORIZED: { zh: '请先登录', ms: 'Sila log masuk', en: 'Please log in' },
  FORBIDDEN: { zh: '您的角色不能做这个操作', ms: 'Peranan anda tidak dibenarkan', en: 'Your role cannot do this' },
  PIN_WRONG: { zh: 'PIN 不对，请再试', ms: 'PIN salah, cuba lagi', en: 'Wrong PIN, try again' },
  PIN_LOCKED: { zh: 'PIN 错太多次，15 分钟后再试', ms: 'PIN dikunci 15 minit', en: 'PIN locked for 15 minutes' },
  USER_NOT_FOUND: { zh: '找不到这个员工', ms: 'Pekerja tidak dijumpai', en: 'User not found' },
  USER_INACTIVE: { zh: '此账号已停用，请联系主管', ms: 'Akaun dinyahaktifkan, hubungi penyelia', en: 'Account disabled, contact supervisor' },
  DEVICE_DISABLED: { zh: '此设备已停用，请联系主管', ms: 'Peranti dinyahaktifkan', en: 'Device disabled, contact supervisor' },
  APP_TOO_OLD: { zh: 'App 版本太旧，请更新', ms: 'Versi App lama, sila kemas kini', en: 'App too old, please update' },
  NOT_FOUND: { zh: '找不到', ms: 'Tidak dijumpai', en: 'Not found' },
  BARCODE_NOT_FOUND: { zh: '这个条码不在系统里', ms: 'Kod bar tidak ada dalam sistem', en: 'Barcode not in system' },
  LOCATION_NOT_FOUND: { zh: '这个货位不存在', ms: 'Lokasi tidak wujud', en: 'Location does not exist' },
  LOCATION_INACTIVE: { zh: '这个货位已停用', ms: 'Lokasi dinyahaktifkan', en: 'Location is inactive' },
  PRODUCT_NOT_FOUND: { zh: '这个产品不存在', ms: 'Produk tidak wujud', en: 'Product does not exist' },
  PRODUCT_INACTIVE: { zh: '这个产品已停用', ms: 'Produk dinyahaktifkan', en: 'Product is inactive' },
  COMPANY_MISMATCH: { zh: '数据不属于本公司', ms: 'Data bukan milik syarikat ini', en: 'Data belongs to another company' },
  REASON_DISABLED: { zh: '这种移动在本公司未启用', ms: 'Jenis pergerakan ini tidak diaktifkan', en: 'This movement type is not enabled' },
  PERMISSION_DENIED: { zh: '您没有权限做这个移动', ms: 'Anda tiada kebenaran', en: 'You do not have permission for this movement' },
  CATEGORY_NOT_ALLOWED_IN_ZONE: { zh: '这类产品不能放这个区', ms: 'Kategori ini tidak boleh di zon ini', en: 'This category is not allowed in this zone' },
  INSUFFICIENT_STOCK: { zh: '库存不足', ms: 'Stok tidak mencukupi', en: 'Insufficient stock' },
  CROSS_SITE_NOT_ALLOWED: { zh: '不能跨站点直接移动', ms: 'Tidak boleh pindah antara tapak secara terus', en: 'Cross-site move not allowed' },
  SHELF_ASSIGNMENT_NEEDS_SHOP_SHELF: { zh: '只能登记到店面货架', ms: 'Hanya rak kedai boleh didaftar', en: 'Only shop shelves can be assigned' },
  DUPLICATE: { zh: '已经有了，不能重复', ms: 'Sudah ada, tidak boleh ulang', en: 'Already exists' },
  VALIDATION: { zh: '填写有误', ms: 'Input tidak sah', en: 'Invalid input' },
  IMPORT_HAS_ERRORS: { zh: '文件有错误，改好后重新上传', ms: 'Fail ada ralat, betulkan dan muat naik semula', en: 'File has errors, fix and re-upload' },
  IMPORT_TOO_MANY_ROWS: { zh: '超过 5000 行，请拆成多个文件', ms: 'Melebihi 5000 baris, pecahkan fail', en: 'Over 5000 rows, split the file' },
  IMPORT_BAD_FILE: { zh: '只接受 .xlsx 文件', ms: 'Hanya fail .xlsx diterima', en: 'Only .xlsx files accepted' },
  IMPORT_WRONG_STATUS: { zh: '这个导入任务的状态不允许此操作', ms: 'Status tugasan import tidak membenarkan', en: 'Import job status does not allow this' },
  APPROVAL_SELF: { zh: '不能批准自己发起的请求', ms: 'Tidak boleh meluluskan permintaan sendiri', en: 'Cannot approve your own request' },
  LOCATION_HAS_STOCK: { zh: '货位里还有库存，不能删', ms: 'Lokasi masih ada stok', en: 'Location still has stock' },
  TOO_MANY_REQUESTS: { zh: '操作太频繁，请稍候', ms: 'Terlalu banyak permintaan', en: 'Too many requests' },
  INTERNAL: { zh: '系统出错了，已记录', ms: 'Ralat sistem, telah direkod', en: 'System error, logged' },
};
export function msg(code: string, lang: Lang = 'zh'): string {
  return (ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INTERNAL)[lang];
}
