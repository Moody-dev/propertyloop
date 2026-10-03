import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import {
  AgentPartner,
  ListingOwnership,
  ListingStatus,
  LeadSource,
  PartnerStatus,
  Prisma,
  Role,
} from '../../generated/prisma/client';
import { RegisterPartnerDto } from './dto/register-partner.dto';
import { UpdatePartnerDto } from './dto/update-partner.dto';
import { normalizePhone } from '../common/phone';
import { StaffAlertsService } from '../staff-alerts/staff-alerts.service';

/*
 * There is no default commission rate. Commission is negotiated per property,
 * so the rate is whatever was agreed on that sale — a fallback number here
 * would quietly pay somebody the wrong amount.
 */

/** Every payout field that must be present before a transfer can be made. */
export function partnerPayoutGaps(p: AgentPartner): string[] {
  const gaps: string[] = [];
  if (!p.passportPhotoUrl) gaps.push('passport photo');
  if (!p.bankCode || !p.accountNumber) gaps.push('bank account');
  if (!p.nin) gaps.push('NIN');
  if (!p.payerId && !p.tin) gaps.push('Payer ID or TIN');
  return gaps;
}

export function partnerPayoutReady(p: AgentPartner): boolean {
  return partnerPayoutGaps(p).length === 0;
}

@Injectable()
export class PartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    @Optional() private readonly alerts?: StaffAlertsService,
  ) {}

  /**
   * A short, human-readable partner number.
   *
   * Partners read this out on the phone and write it on WhatsApp, so it is
   * four digits rather than a cuid. Collisions are retried rather than
   * assumed away — at a few thousand partners the birthday problem is real.
   */
  private async generateCode(): Promise<string> {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const n = 1000 + crypto.randomInt(9000);
      const code = `AGT-${n}`;
      const taken = await this.prisma.agentPartner.findUnique({
        where: { code },
        select: { id: true },
      });
      if (!taken) return code;
    }
    // Exhausted the readable space — fall back to something longer rather
    // than fail a registration.
    return `AGT-${crypto.randomInt(100000, 999999)}`;
  }

  private referralUrl(code: string): string {
    const base = process.env.FRONTEND_URL ?? 'https://propertyloop.ng';
    return `${base.replace(/\/$/, '')}/realtors/partners?ref=${code}`;
  }

  /**
   * Register a realtor.
   *
   * Creates a real User with an AgentProfile, not a directory row. That is
   * not a preference — Listing.agentId is required, so without an account a
   * partner could never be credited on anything they bring in.
   */
  async register(dto: RegisterPartnerDto) {
    if (!dto.consentedToTerms) {
      throw new BadRequestException(
        'Please confirm the terms before registering',
      );
    }

    const email = dto.email.trim().toLowerCase();
    const phone = normalizePhone(dto.whatsapp) ?? dto.whatsapp.trim();

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        role: true,
        agentPartner: { select: { code: true } },
      },
    });

    if (existingUser?.agentPartner) {
      throw new BadRequestException(
        `You are already registered as partner ${existingUser.agentPartner.code}. Check your email for your link.`,
      );
    }

    // An unknown referral code is dropped, never rejected. Losing a
    // registration over somebody's typo is a far worse outcome than an
    // uncredited referral, which can be fixed afterwards.
    let referredById: string | null = null;
    if (dto.referredByCode) {
      const referrer = await this.prisma.agentPartner.findUnique({
        where: { code: dto.referredByCode.trim().toUpperCase() },
        select: { id: true },
      });
      referredById = referrer?.id ?? null;
    }

    const code = await this.generateCode();

    const result = await this.prisma.$transaction(async (tx) => {
      let userId: string;

      if (existingUser) {
        // Somebody who already has a PropertyLoop account is upgraded rather
        // than duplicated. Their existing role is left alone unless they are
        // a plain buyer.
        userId = existingUser.id;
        if (existingUser.role === Role.BUYER) {
          await tx.user.update({
            where: { id: userId },
            data: { role: Role.AGENT },
          });
        }
      } else {
        // The password they chose on the form, so they can sign in straight
        // away and come back to edit their details. Without one the account
        // gets an unusable random hash and they set a password through
        // Forgot password — which is what the welcome email then tells them.
        const passwordHash = dto.password
          ? await bcrypt.hash(dto.password, 12)
          : await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
        const created = await tx.user.create({
          data: {
            email,
            passwordHash,
            name: dto.fullName.trim(),
            role: Role.AGENT,
            phone,
            location: dto.operatingState ?? null,
            signupPlatform: 'web',
          },
          select: { id: true },
        });
        userId = created.id;
      }

      const agentProfile = await tx.agentProfile.findUnique({
        where: { userId },
        select: { userId: true },
      });
      if (!agentProfile) {
        await tx.agentProfile.create({
          data: {
            userId,
            agencyName: dto.agencyName?.trim() || dto.fullName.trim(),
            businessAddress: dto.residentialAddress?.trim() || 'Not provided',
            // verified stays false. Appearing in the public directory is a
            // separate, deliberate act — an unvetted stranger with a
            // PropertyLoop profile is the risk this programme has to avoid.
          },
        });
      }

      const partner = await tx.agentPartner.create({
        data: {
          code,
          userId,
          experience: dto.experience ?? null,
          agencyName: dto.agencyName?.trim() || null,
          operatingState: dto.operatingState || null,
          referredById,
          passportPhotoUrl: dto.passportPhotoUrl || null,
          bankCode: dto.bankCode || null,
          bankName: dto.bankName || null,
          accountNumber: dto.accountNumber || null,
          accountName: dto.accountName || null,
          nin: dto.nin || null,
          tin: dto.tin?.trim() || null,
          payerId: dto.payerId?.trim() || null,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
          residentialAddress: dto.residentialAddress?.trim() || null,
          residentialState: dto.residentialState || null,
          rcNumber: dto.rcNumber?.trim() || null,
        },
      });

      return partner;
    });

    this.alerts?.partnerRegistered(dto.fullName.trim(), code);

    // Fire and forget. The registration is already committed, and a Resend
    // outage must not turn a successful signup into an error the partner
    // sees — they would simply register again and hit the duplicate guard.
    const gaps = partnerPayoutGaps(result);
    // Somebody upgrading an existing account signs in with the password they
    // already have; a new account signs in with the one just chosen.
    const canSignIn = Boolean(dto.password) || Boolean(existingUser);
    this.mail
      .sendEmail({
        to: email,
        subject: `Welcome to PropertyLoop — you are partner ${code}`,
        text: [
          `Welcome to the PropertyLoop Agent Partner Programme.`,
          ``,
          `Your partner number is ${code}.`,
          `Your referral link: ${this.referralUrl(code)}`,
          ``,
          canSignIn
            ? `Sign in any time at ${this.siteUrl()}/login to edit your details, add your bank account and copy your referral link.`
            : `Set a password at ${this.siteUrl()}/forgot-password (enter this email address), then sign in to edit your details and copy your referral link.`,
          ``,
          ...(gaps.length
            ? [
                `Before your first commission can be paid we still need: ${gaps.join(', ')}.`,
                ``,
              ]
            : []),
          `Questions? Reply to this email or message 0705 305 3040 on WhatsApp.`,
        ].join('\n'),
        html: this.buildWelcomeEmail(
          dto.fullName.trim(),
          code,
          gaps,
          canSignIn,
        ),
      })
      .catch((err) =>
        console.error(
          `[partners.register] welcome email failed for ${code}:`,
          err,
        ),
      );

    return {
      partnerCode: code,
      referralUrl: this.referralUrl(code),
      email,
      payoutReady: partnerPayoutReady(result),
      /** Whether they can sign in right now, which decides what we tell them. */
      canSignIn,
    };
  }

  private siteUrl(): string {
    return (process.env.FRONTEND_URL ?? 'https://propertyloop.ng').replace(
      /\/$/,
      '',
    );
  }

  private buildWelcomeEmail(
    name: string,
    code: string,
    gaps: string[],
    canSignIn: boolean,
  ): string {
    const referral = this.referralUrl(code);
    const site = this.siteUrl();
    const signIn = canSignIn
      ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#48544f;">
           Your dashboard is where you edit your details, add your bank account
           and copy your link whenever you need it.
         </p>
         <p style="margin:0 0 20px;">
           <a href="${site}/login" style="display:inline-block;background:#1f6f43;
              color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;
              padding:12px 24px;border-radius:8px;">Sign in to your dashboard</a>
         </p>`
      : `<p style="margin:0 0 20px;padding:12px 14px;background:#dff0e5;border-radius:10px;
            font-size:14px;line-height:1.6;color:#0f4429;">
           To reach your dashboard, set a password first:
           <a href="${site}/forgot-password" style="color:#1f6f43;">${site.replace('https://', '')}/forgot-password</a>
           — enter this email address, then sign in. From there you can edit your
           details, add your bank account and copy your link.
         </p>`;
    const outstanding = gaps.length
      ? `<p style="margin:0 0 16px;padding:12px 14px;background:#fbeed4;border-radius:10px;
            font-size:14px;color:#7a5514;">
           Before your first commission can be paid we still need:
           <strong>${gaps.join(', ')}</strong>.
         </p>`
      : '';

    return `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;
                  margin:0 auto;color:#16201c;">
        <div style="background:linear-gradient(135deg,#0f4429,#1f6f43);padding:28px 24px;
                    border-radius:16px 16px 0 0;color:#fff;">
          <p style="margin:0 0 6px;font-size:11px;letter-spacing:.16em;
                    text-transform:uppercase;color:#fcd34d;">
            Agent Partner Programme
          </p>
          <h1 style="margin:0;font-size:24px;">You are a PropertyLoop partner</h1>
        </div>
        <div style="padding:24px;border:1px solid #dee5df;border-top:0;
                    border-radius:0 0 16px 16px;">
          <p style="margin:0 0 16px;font-size:15px;">Hello ${name},</p>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#48544f;">
            Welcome aboard. Here is everything you need to start.
          </p>
          <div style="padding:16px;background:#dff0e5;border-radius:12px;margin-bottom:16px;">
            <p style="margin:0 0 4px;font-size:11px;letter-spacing:.14em;
                      text-transform:uppercase;color:#0f4429;">Your partner number</p>
            <p style="margin:0;font-size:26px;font-weight:700;color:#0f4429;">${code}</p>
          </div>
          <p style="margin:0 0 6px;font-size:13px;color:#48544f;">
            Your referral link — anyone who registers through it is credited to you:
          </p>
          <p style="margin:0 0 20px;"><a href="${referral}"
             style="font-size:13px;color:#1f6f43;word-break:break-all;">${referral}</a></p>
          ${signIn}
          ${outstanding}
          <p style="margin:0;font-size:13px;color:#7d8a84;">
            Questions? Reply to this email, or message us on WhatsApp at
            <a href="https://wa.me/2347053053040" style="color:#1f6f43;">0705 305 3040</a>.
          </p>
        </div>
      </div>`;
  }

  /** Confirms a referral code belongs to a real partner, for the form. */
  async checkReferral(code: string) {
    if (!code?.trim()) return { valid: false };
    const partner = await this.prisma.agentPartner.findUnique({
      where: { code: code.trim().toUpperCase() },
      select: {
        status: true,
        user: { select: { name: true } },
      },
    });
    // A rejected partner should not be earning referral credit.
    if (!partner || partner.status === PartnerStatus.REJECTED) {
      return { valid: false };
    }
    return { valid: true, partnerName: partner.user.name };
  }

  /* ─── Partner-facing ─────────────────────────────────────────────── */

  private async requirePartner(userId: string) {
    const partner = await this.prisma.agentPartner.findUnique({
      where: { userId },
    });
    if (!partner) {
      throw new ForbiddenException('You are not registered as a partner');
    }
    return partner;
  }

  async me(userId: string) {
    const partner = await this.requirePartner(userId);
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, phone: true },
    });
    const [introductions, commissions] = await Promise.all([
      this.prisma.lead.count({ where: { broughtByPartnerId: partner.id } }),
      this.prisma.partnerCommission.findMany({
        where: { partnerId: partner.id },
        orderBy: { createdAt: 'desc' },
        include: { listing: { select: { title: true, slug: true } } },
      }),
    ]);

    return {
      code: partner.code,
      status: partner.status,
      referralUrl: this.referralUrl(partner.code),
      payoutReady: partnerPayoutReady(partner),
      payoutGaps: partnerPayoutGaps(partner),
      /** Everything the partner may edit, as it stands — the form prefills from this. */
      details: {
        fullName: account?.name ?? '',
        email: account?.email ?? '',
        whatsapp: account?.phone ?? '',
        experience: partner.experience,
        agencyName: partner.agencyName,
        operatingState: partner.operatingState,
        passportPhotoUrl: partner.passportPhotoUrl,
        bankCode: partner.bankCode,
        bankName: partner.bankName,
        accountNumber: partner.accountNumber,
        accountName: partner.accountName,
        nin: partner.nin,
        tin: partner.tin,
        payerId: partner.payerId,
        dateOfBirth: partner.dateOfBirth
          ? partner.dateOfBirth.toISOString().slice(0, 10)
          : null,
        residentialAddress: partner.residentialAddress,
        residentialState: partner.residentialState,
        rcNumber: partner.rcNumber,
      },
      introductions,
      commissions: commissions.map((c) => ({
        id: c.id,
        listing: c.listing?.title ?? null,
        amountNaira: Number(c.amountNaira),
        status: c.status,
        createdAt: c.createdAt,
        paidAt: c.paidAt,
      })),
    };
  }

  /**
   * A partner editing their own details.
   *
   * The reason this exists: most people register without their bank account
   * to hand, and until now there was no way back in to add it — the payout
   * gaps on their dashboard named what was missing with nowhere to put it.
   *
   * Only the fields sent are written. Email is not among them: it is the
   * login, and changing it here would quietly lock somebody out.
   */
  async updateMe(userId: string, dto: UpdatePartnerDto) {
    const partner = await this.requirePartner(userId);

    const name = dto.fullName?.trim();
    const phone = dto.whatsapp
      ? (normalizePhone(dto.whatsapp) ?? dto.whatsapp.trim())
      : undefined;
    if (name || phone) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { ...(name && { name }), ...(phone && { phone }) },
      });
    }

    const text = (value?: string) =>
      value === undefined ? undefined : value.trim() || null;

    await this.prisma.agentPartner.update({
      where: { id: partner.id },
      data: {
        ...(dto.experience !== undefined && { experience: dto.experience }),
        ...(dto.agencyName !== undefined && {
          agencyName: text(dto.agencyName),
        }),
        ...(dto.operatingState !== undefined && {
          operatingState: text(dto.operatingState),
        }),
        ...(dto.passportPhotoUrl !== undefined && {
          passportPhotoUrl: text(dto.passportPhotoUrl),
        }),
        ...(dto.bankCode !== undefined && { bankCode: text(dto.bankCode) }),
        ...(dto.bankName !== undefined && { bankName: text(dto.bankName) }),
        ...(dto.accountNumber !== undefined && {
          accountNumber: text(dto.accountNumber),
        }),
        ...(dto.accountName !== undefined && {
          accountName: text(dto.accountName),
        }),
        ...(dto.nin !== undefined && { nin: text(dto.nin) }),
        ...(dto.tin !== undefined && { tin: text(dto.tin) }),
        ...(dto.payerId !== undefined && { payerId: text(dto.payerId) }),
        ...(dto.dateOfBirth !== undefined && {
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        }),
        ...(dto.residentialAddress !== undefined && {
          residentialAddress: text(dto.residentialAddress),
        }),
        ...(dto.residentialState !== undefined && {
          residentialState: text(dto.residentialState),
        }),
        ...(dto.rcNumber !== undefined && { rcNumber: text(dto.rcNumber) }),
      },
    });

    // The whole record back, so the dashboard shows the new payout gaps
    // without a second request.
    return this.me(userId);
  }

  /**
   * House inventory a partner may sell.
   *
   * Only ownership = HOUSE and status = ACTIVE. An agent's own listing is
   * theirs, and an unpublished one is not ready to be sold to anybody.
   */
  async houseInventory(
    userId: string,
    options: { page: number; limit: number; state?: string },
  ) {
    await this.requirePartner(userId);
    const { page, limit, state } = options;

    const where: Prisma.ListingWhereInput = {
      ownership: ListingOwnership.HOUSE,
      status: ListingStatus.ACTIVE,
      ...(state && { location: { contains: state, mode: 'insensitive' } }),
    };

    const [items, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          slug: true,
          title: true,
          location: true,
          address: true,
          type: true,
          propertyType: true,
          priceNaira: true,
          priceLabel: true,
          beds: true,
          baths: true,
          coverImage: true,
          verified: true,
        },
      }),
      this.prisma.listing.count({ where }),
    ]);

    return {
      items: items.map((l) => ({ ...l, priceNaira: Number(l.priceNaira) })),
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  /**
   * A partner introduces a buyer to a house listing.
   *
   * Creates a Lead attributed to them. The attribution is made BEFORE the
   * sale, which is the whole point — otherwise "I brought that buyer" is a
   * claim somebody makes afterwards with nothing behind it.
   */
  async introduceBuyer(
    userId: string,
    listingId: string,
    dto: { name: string; phone: string; email?: string; message?: string },
  ) {
    const partner = await this.requirePartner(userId);

    if (
      partner.status === PartnerStatus.REJECTED ||
      partner.status === PartnerStatus.DORMANT
    ) {
      throw new ForbiddenException(
        'Your partner account is not active. Please contact us.',
      );
    }

    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, agentId: true, ownership: true, status: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.ownership !== ListingOwnership.HOUSE) {
      throw new ForbiddenException(
        'That listing belongs to an agent directly, not to PropertyLoop',
      );
    }
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('That listing is not currently available');
    }

    const phone = normalizePhone(dto.phone) ?? dto.phone.trim();

    // One partner, one buyer, one listing. A second submission of the same
    // person is the same introduction, not a second claim on the commission.
    const duplicate = await this.prisma.lead.findFirst({
      where: {
        listingId,
        broughtByPartnerId: partner.id,
        phone,
      },
      select: { id: true },
    });
    if (duplicate) {
      return { leadId: duplicate.id, duplicate: true };
    }

    const lead = await this.prisma.lead.create({
      data: {
        agentId: listing.agentId,
        listingId,
        name: dto.name.trim(),
        phone,
        email: dto.email?.trim().toLowerCase() || null,
        message: dto.message?.trim() || null,
        source: LeadSource.PARTNER,
        broughtByPartnerId: partner.id,
      },
      select: { id: true },
    });

    this.alerts?.partnerIntroducedBuyer(partner.id, listingId, dto.name.trim());
    return { leadId: lead.id, duplicate: false };
  }
}
