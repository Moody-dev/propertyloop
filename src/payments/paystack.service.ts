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
  }): Promise<{ authorization_url: string; access_code: string; reference: string }> {
    const response = await this.axiosInstance.post('/transaction/initialize', payload);
    return response.data.data;
  }

  async verifyTransaction(reference: string): Promise<{
    status: 'success' | 'failed' | 'pending';
    amount: number; // kobo
    reference: string;
    metadata: Record<string, any>;
  }> {
    const response = await this.axiosInstance.get(`/transaction/verify/${reference}`);
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
    const response = await this.axiosInstance.post('/transferrecipient', payload);
    return { recipient_code: response.data.data.recipient_code };
  }

  async listBanks(): Promise<{ id: number; name: string; code: string }[]> {
    const response = await this.axiosInstance.get('/bank');
    return response.data.data;
  }

  async refundTransaction(transactionReference: string): Promise<{ refund_url?: string }> {
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
}
