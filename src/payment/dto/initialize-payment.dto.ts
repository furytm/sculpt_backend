export interface InitializePaymentDto {
  email: string;
  amount: number;

  currency?: string;

  channels?: string[];

  transaction_charge?: number;

  split_code?: string;

  subaccount?: string;

  bearer?: string;

  callback_url?: string;

  reference: string;
}