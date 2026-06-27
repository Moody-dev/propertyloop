import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import * as crypto from 'crypto';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class PaystackService {
  private axiosInstance: AxiosInstance;
  private secretKey: string;

  constructor(private configService: ConfigService) {
    this.secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    this.axiosInstance = axios.create({
      baseURL: 'https://api.paystack.co',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
      },
    });
  }

  async initializeTransaction(payload: {
    email: string;
    amount: number; // kobo
    reference: string;
    callback_url: string;
    metadata: Record<string, any>;
  }): Promise<{
    authorization_url: string;
    access_code: string;
    reference: string;
  }> {
    const response = await this.axiosInstance.post(
      '/transaction/initialize',
      payload,
    );
    return response.data.data;
  }

  async verifyTransaction(reference: string): Promise<{
    status: 'success' | 'failed' | 'pending';
    amount: number; // kobo
    reference: string;
    metadata: Record<string, any>;
  }> {
    const response = await this.axiosInstance.get(
      `/transaction/verify/${reference}`,
    );
    const { status, amount, reference: ref, metadata } = response.data.data;
    return { status, amount, reference: ref, metadata };
  }

  async initiateTransfer(payload: {
    source: 'balance';
    amount: number; // kobo
    recipient: string; // transfer recipient code
    reason: string;
    reference: string;
  }): Promise<{ transfer_code: string; status: string }> {
    const response = await this.axiosInstance.post('/transfer', payload);
    return {
      transfer_code: response.data.data.transfer_code,
      status: response.data.data.status,
    };
  }

  async createTransferRecipient(payload: {
    type: 'nuban';
    name: string;
    account_number: string;
    bank_code: string;
    currency: 'NGN';
  }): Promise<{ recipient_code: string }> {
    const response = await this.axiosInstance.post(
      '/transferrecipient',
      payload,
    );
    return { recipient_code: response.data.data.recipient_code };
  }

  async listBanks(): Promise<{ id: number; name: string; code: string }[]> {
    const response = await this.axiosInstance.get('/bank');
    return response.data.data;
  }

  // Look up the real account holder name for an account number + bank, so the
  // vendor can confirm it before we save/pay anything to it.
  async resolveAccount(
    accountNumber: string,
    bankCode: string,
  ): Promise<{ account_number: string; account_name: string }> {
    const response = await this.axiosInstance.get('/bank/resolve', {
      params: { account_number: accountNumber, bank_code: bankCode },
    });
    return response.data.data;
  }

  async refundTransaction(
    transactionReference: string,
  ): Promise<{ refund_url?: string }> {
    const response = await this.axiosInstance.post('/refund', {
      transaction: transactionReference,
    });
    return response.data.data || {};
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    const hash = crypto
      .createHmac('sha512', this.secretKey)
      .update(rawBody)
      .digest('hex');

    try {
      return timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
    } catch {
      return false;
    }
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  async createCustomer(payload: {
    email: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
  }): Promise<{ customer_code: string; id: number }> {
    const response = await this.axiosInstance.post('/customer', payload);
    return {
      customer_code: response.data.data.customer_code,
      id: response.data.data.id,
    };
  }

  async createSubscription(payload: {
    customer: string; // customer_code or email
    plan: string; // plan code e.g. PLN_xxxxxxxxxx
    authorization?: string; // reuse a stored card's authorization_code
    start_date?: string; // ISO 8601
  }): Promise<{
    subscription_code: string;
    email_token: string;
    status: string;
  }> {
    const response = await this.axiosInstance.post('/subscription', payload);
    return {
      subscription_code: response.data.data.subscription_code,
      email_token: response.data.data.email_token,
      status: response.data.data.status,
    };
  }

  async disableSubscription(payload: {
    code: string; // subscription_code
    token: string; // email_token
  }): Promise<{ message: string }> {
    const response = await this.axiosInstance.post(
      '/subscription/disable',
      payload,
    );
    return { message: response.data.message };
  }

  async fetchSubscription(subscriptionCode: string): Promise<{
    status: string;
    next_payment_date: string;
    email_token: string | null;
    plan: { plan_code: string; name: string; amount: number };
  }> {
    const response = await this.axiosInstance.get(
      `/subscription/${subscriptionCode}`,
    );
    const d = response.data.data;
    return {
      status: d.status,
      next_payment_date: d.next_payment_date,
      email_token: d.email_token ?? null,
      plan: {
        plan_code: d.plan.plan_code,
        name: d.plan.name,
        amount: d.plan.amount,
      },
    };
  }

  async initializeSubscriptionTransaction(payload: {
    email: string;
    amount: number; // kobo — must match plan amount
    plan: string; // plan code
    reference: string;
    callback_url: string;
    metadata: Record<string, any>;
  }): Promise<{
    authorization_url: string;
    access_code: string;
    reference: string;
  }> {
    const response = await this.axiosInstance.post('/transaction/initialize', {
      ...payload,
    });
    return response.data.data;
  }
}
