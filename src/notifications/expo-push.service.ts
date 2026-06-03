import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  badge?: number;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

@Injectable()
export class ExpoPushService {
  private readonly logger = new Logger(ExpoPushService.name);

  constructor(private readonly config: ConfigService) {}

  /** Quick sanity check — Expo tokens look like ExponentPushToken[xxxx]. */
  static isExpoToken(token: string): boolean {
    return (
      token.startsWith('ExponentPushToken[') ||
      token.startsWith('ExpoPushToken[')
    );
  }

  /**
   * Send a batch of push messages. Returns the set of tokens Expo reports as
   * dead (DeviceNotRegistered) so the caller can prune them. Network/Expo
   * failures are swallowed and logged — push is best-effort, never blocking.
   */
  async send(messages: ExpoPushMessage[]): Promise<{ deadTokens: string[] }> {
    const valid = messages.filter((m) => ExpoPushService.isExpoToken(m.to));
    if (valid.length === 0) return { deadTokens: [] };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const accessToken = this.config.get<string>('EXPO_ACCESS_TOKEN');
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const deadTokens: string[] = [];
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(
          valid.map((m) => ({ sound: 'default', ...m })),
        ),
      });
      if (!res.ok) {
        this.logger.warn(`Expo push HTTP ${res.status}`);
        return { deadTokens };
      }
      const json = (await res.json()) as { data?: ExpoTicket[] };
      const tickets = json.data ?? [];
      tickets.forEach((t, i) => {
        if (
          t.status === 'error' &&
          t.details?.error === 'DeviceNotRegistered'
        ) {
          deadTokens.push(valid[i].to);
        }
      });
    } catch (err) {
      this.logger.warn(`Expo push failed: ${(err as Error).message}`);
    }
    return { deadTokens };
  }
}
