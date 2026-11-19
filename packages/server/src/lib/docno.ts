import type { Tx } from './db.js';
/** 单据编号：PO-2026-0001、GRN-2026-0001、TR-0001、CS-0001、INV-2026-0001、SI-0001；收据用 店代码-机号-000123 */
export async function nextDocNo(tx: Tx, companyId: string, kind: string, prefix: string, scope = '', width = 4): Promise<string> {
  return (await tx.query(`SELECT next_doc_no($1, $2, $3, $4, $5) AS no`, [companyId, kind, prefix, scope, width])).rows[0].no;
}
export const yearPrefix = (p: string) => `${p}-${new Date().getFullYear()}-`;
