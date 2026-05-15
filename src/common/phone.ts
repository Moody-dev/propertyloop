import { Transform } from 'class-transformer';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

const DEFAULT_COUNTRY = 'NG';

export function normalizePhone(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  const parsed = parsePhoneNumberFromString(raw, DEFAULT_COUNTRY);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

export const NormalizePhone = () =>
  Transform(({ value }) => {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    return normalizePhone(value) ?? value;
  });
