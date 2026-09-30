import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { ListingOwnership, Role } from '../../generated/prisma/client';
import { buildNewStockEmail } from './stock-email';
import type { StockProperty } from './stock-email';

/**
 * Tell every agent when PropertyLoop lists a property of its own.
 *
 * House stock is the one inventory an agent can earn on without holding the
 * mandate, so a new one is worth an email rather than waiting to be noticed in
 * the app. Sent on first publish only — a property paused and put back up is
 * not news, and nobody should be emailed twice about the same listing.
 */

/** Resend allows roughly two a second; stay well under it. */
const GAP_MS = 600;

@Injectable()
export class StockAlertsService {
  private readonly logger = new Logger(StockAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** Fire and forget: publishing must not fail because an email did. */
  announcePublished(listingId: string): void {
    void this.run(listingId).catch((err: unknown) =>
      this.logger.error(
        `New-stock announcement failed for ${listingId}: ${(err as Error).message}`,
      ),
    );
  }

  private async run(listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        title: true,
        location: true,
        priceLabel: true,
        coverImage: true,
        beds: true,
        propertyType: true,
        ownership: true,
      },
    });
    if (!listing || listing.ownership !== ListingOwnership.HOUSE) return;

    const property: StockProperty = {
      id: listing.id,
      title: listing.title,
      location: listing.location,
      priceLabel: listing.priceLabel,
      coverImage: listing.coverImage || null,
      beds: listing.beds,
      type: listing.propertyType,
    };

    const agents = await this.prisma.user.findMany({
      where: { role: Role.AGENT, isActive: true, deletedAt: null },
      select: { id: true, name: true, email: true },
    });

    let sent = 0;
    let failed = 0;
    for (const [i, agent] of agents.entries()) {
      if (!agent.email) continue;
      const { subject, html, text } = buildNewStockEmail(agent.name, property);
      try {
        await this.mail.sendEmail({ to: agent.email, subject, html, text });
        sent += 1;
      } catch (err) {
        failed += 1;
        this.logger.warn(
          `New-stock email to ${agent.email} failed: ${(err as Error).message}`,
        );
      }
      if (i < agents.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, GAP_MS));
      }
    }

    this.logger.log(
      `New-stock announcement for "${listing.title}": sent ${sent}, failed ${failed}, of ${agents.length} agents`,
    );
  }
}
