export const REASON_PERMISSION: Record<string, string> = {
  RECEIVE: 'movement.receive', PUTAWAY: 'movement.putaway', REFILL: 'movement.refill',
  TRANSFER_OUT: 'movement.transfer_out', TRANSFER_IN: 'movement.transfer_in',
  SALE: 'movement.sale', RETURN: 'movement.return', COUNT: 'count.approve', ADJUST: 'movement.adjust',
};
export const PHASE1_REASONS = ['RECEIVE', 'PUTAWAY', 'REFILL', 'COUNT', 'ADJUST'] as const;
export const COST_PERMISSION = 'product.view_cost';
export type Lang = 'zh' | 'ms' | 'en';
export const LANGS: Lang[] = ['zh', 'ms', 'en'];
