export interface NetWorthHistoryRow {
  date: string;
  netWorth: number;
  assetType: string;
  source: string;
  /** 存款列：該日餘額由交易明細推算（第一次同步之前）。 */
  derived?: boolean;
}

export interface ExchangeRateRow {
  currency: string;
  rateTwd: number;
  updatedAt: string;
}

export interface ManualAssetRow {
  id: string;
  name: string;
  category: string;
  note: string | null;
  currency: string;
  createdAt: string;
  value?: number;
  date?: string;
}

export interface ManualAssetHistoryEntry {
  date: string;
  value: number;
}
