import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { B2Service } from '../storage/b2.service';

/**
 * Decides whether a stored property-image URL should be served through the
 * watermark proxy, and rewrites it accordingly.
 *
 * Gated by env so it's safe to ship dark:
 *   - WATERMARK_ENABLED=true   turns rewriting on
 *   - PUBLIC_API_URL=<origin>  the backend's public origin (needed to build
 *                              an absolute <img> src; e.g. https://api.site.com)
 * If either is missing, rewrite() is a no-op and images are served straight
 * from R2 exactly as before.
 */

// Bumping this changes every watermark-proxy URL, which busts browser/CDN
// caches whenever the watermark itself changes (the cached image is keyed by
// the full URL, and we cache responses as immutable for a year). Increment it
// any time you tweak the watermark look.
const WATERMARK_VERSION = '2';

// Only object keys under these prefixes (i.e. property photos) are proxied.
const ALLOWED_PREFIXES = ['listings/', 'featured-properties/'];
const KEY_RE =
  /^(listings|featured-properties)\/[A-Za-z0-9][A-Za-z0-9._\-/]*\.(jpe?g|png|webp|gif|avif)$/i;

@Injectable()
export class MediaUrlService implements OnApplicationBootstrap {
  private readonly logger = new Logger(MediaUrlService.name);
  private readonly enabled: boolean;
  private readonly apiBase: string;

  constructor(
    private readonly config: ConfigService,
    private readonly b2: B2Service,
  ) {
    // Accept PUBLIC_API_URL with or without a trailing slash or "/api" — we
    // append "/api/media/img" ourselves, so a value like
    // "http://localhost:3000/api" must collapse back to the origin to avoid
    // building "/api/api/media/img".
    this.apiBase = (this.config.get<string>('PUBLIC_API_URL') ?? '')
      .trim()
      .replace(/\/+$/, '')
      .replace(/\/api$/i, '');
    const flag = (this.config.get<string>('WATERMARK_ENABLED') ?? '').toLowerCase();
    this.enabled = flag === 'true' && !!this.apiBase;
    if (flag === 'true' && !this.apiBase) {
      this.logger.warn(
        'WATERMARK_ENABLED=true but PUBLIC_API_URL is unset — watermarking disabled.',
      );
    }
  }

  // Log once everything (incl. B2's onModuleInit) has finished booting, so the
  // R2 base is actually resolved by the time we report it.
  onApplicationBootstrap(): void {
    this.logger.log(
      `Watermark proxy ${this.enabled ? 'ENABLED' : 'disabled'} — apiBase="${this.apiBase}", r2Base="${this.r2Base()}"`,
    );
  }

  /** Read R2's public base lazily — B2Service fills it in during its own init. */
  private r2Base(): string {
    return this.b2.getPublicBaseUrl().replace(/\/$/, '');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Validate a proxy key so the endpoint can't be used as an open relay. */
  isAllowedKey(key: string): boolean {
    if (!key || key.includes('..')) return false;
    return KEY_RE.test(key);
  }

  /** Rewrite one stored R2 image URL into a watermark-proxy URL (or pass through). */
  rewrite(url?: string | null): string | undefined {
    if (!url) return url ?? undefined;
    if (!this.enabled) return url;
    const r2Base = this.r2Base();
    if (!r2Base || r2Base.includes('undefined')) return url; // R2 not ready/configured
    if (!url.startsWith(r2Base + '/')) return url; // not our bucket
    const key = url.slice(r2Base.length + 1).split('?')[0];
    if (!ALLOWED_PREFIXES.some((p) => key.startsWith(p))) return url;
    if (!this.isAllowedKey(key)) return url;
    return `${this.apiBase}/api/media/img?key=${encodeURIComponent(key)}&v=${WATERMARK_VERSION}`;
  }

  rewriteMany(urls?: (string | null)[] | null): string[] {
    if (!urls) return [];
    return urls.map((u) => this.rewrite(u)).filter((u): u is string => !!u);
  }
}
