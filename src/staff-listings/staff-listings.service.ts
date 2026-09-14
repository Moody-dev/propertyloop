import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { B2Service } from '../storage/b2.service';
import { MediaUrlService } from '../media/media-url.service';
import {
  DocumentType,
  ListingOwnership,
  ListingStatus,
  Prisma,
} from '../../generated/prisma/client';
import { CreateStaffListingDto } from './dto/create-staff-listing.dto';
import { UpdateStaffListingDto } from './dto/update-staff-listing.dto';

/**
 * Properties as the staff portal sees them.
 *
 * Everything posted from the team platform is PropertyLoop's own stock —
 * ownership HOUSE — which is what agent partners are given to sell. An
 * agent's own listing belongs to the agent; this module never creates one.
 *
 * ListingsService remains the agent-facing view and is untouched.
 */

/** Same ceiling the photo DTO enforces; a listing page with more is a gallery nobody scrolls. */
const MAX_PHOTOS = 30;

/** The four documents a property is expected to have. */
const REQUIRED_DOCUMENTS: DocumentType[] = [
  DocumentType.C_OF_O,
  DocumentType.SURVEY_PLAN,
  DocumentType.BUILDING_PERMIT,
  DocumentType.RECEIPT,
];

const DOCUMENT_NAME: Record<DocumentType, string> = {
  [DocumentType.C_OF_O]: 'Certificate of Occupancy',
  [DocumentType.SURVEY_PLAN]: 'Survey plan',
  [DocumentType.BUILDING_PERMIT]: 'Building permit',
  [DocumentType.RECEIPT]: 'Receipt',
};

/** "₦65,000,000" — the website renders this string rather than reformatting. */
function priceLabel(naira: number): string {
  return `₦${Math.round(naira).toLocaleString('en-NG')}`;
}

const LISTING_SELECT = {
  id: true,
  title: true,
  location: true,
  chapter: true,
  type: true,
  priceNaira: true,
  status: true,
  verified: true,
  images: true,
  coverImage: true,
  videoUrl: true,
  videoUrls: true,
  units: true,
  unitsSold: true,
  fromDealId: true,
  sourcedByStaffId: true,
  ownership: true,
  createdAt: true,
  publishedAt: true,
  documents: { select: { type: true, verified: true } },
  fromDeal: { select: { id: true, company: true } },
} satisfies Prisma.ListingSelect;

type ListingRow = Prisma.ListingGetPayload<{ select: typeof LISTING_SELECT }>;

@Injectable()
export class StaffListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: B2Service,
    private readonly mediaUrl: MediaUrlService,
  ) {}

  /**
   * Documents are reported as all four, present or not, rather than only the
   * rows that exist. "Missing C of O" is the fact the screen is built to
   * show, and an absent row cannot say it.
   */
  private shape(listing: ListingRow) {
    const held = new Map(listing.documents.map((d) => [d.type, d.verified]));
    return {
      id: listing.id,
      title: listing.title,
      location: listing.location,
      chapter: listing.chapter,
      type: listing.type,
      priceNaira: Number(listing.priceNaira),
      developer: listing.fromDeal?.company ?? null,
      dealId: listing.fromDealId,
      status: listing.status,
      verified: listing.verified,
      photoCount: listing.images.length,
      // Rewritten for display exactly as public listing reads are, so the
      // portal shows the same image the website and the app do.
      images: this.mediaUrl.rewriteMany(listing.images),
      hasVideo: Boolean(listing.videoUrl) || listing.videoUrls.length > 0,
      documents: REQUIRED_DOCUMENTS.map((type) => ({
        type,
        present: held.has(type),
        verified: held.get(type) ?? false,
      })),
      sourcedById: listing.sourcedByStaffId,
      ownership: listing.ownership,
      submittedAt: listing.createdAt,
      publishedAt: listing.publishedAt,
      units: listing.units,
      unitsSold: listing.unitsSold,
    };
  }

  /** House stock by default — an agent's own listings are not this portal's. */
  async list(params: { status?: ListingStatus; includeAgentOwned?: boolean }) {
    const listings = await this.prisma.listing.findMany({
      where: {
        ...(params.includeAgentOwned
          ? {}
          : { ownership: ListingOwnership.HOUSE }),
        ...(params.status && { status: params.status }),
      },
      select: LISTING_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return listings.map((l) => this.shape(l));
  }

  async findOne(id: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: LISTING_SELECT,
    });
    if (!listing) throw new NotFoundException('Property not found');
    return this.shape(listing);
  }

  async create(dto: CreateStaffListingDto, staffId: string, userId: string) {
    const slug = await this.uniqueSlug(dto.title);

    const listing = await this.prisma.listing.create({
      data: {
        title: dto.title,
        slug,
        location: dto.location,
        address: dto.location,
        chapter: dto.chapter,
        type: dto.type,
        priceNaira: BigInt(Math.round(dto.priceNaira)),
        units: dto.units ?? 1,
        fromDealId: dto.dealId ?? null,
        // House stock, sourced by whoever posted it. Both matter: ownership is
        // what makes it sellable by partners, sourcedByStaffId is what makes
        // acquisition numbers attributable to a person.
        ownership: ListingOwnership.HOUSE,
        sourcedByStaffId: staffId,
        agentId: userId,
        // Staff-posted stock still goes through review — posting it is not the
        // same as vouching for it.
        status: ListingStatus.PENDING_REVIEW,
        // Listing is shared with the public website, which requires fields the
        // staff form does not ask for: a property arrives here as a mandate
        // with a price and a unit count, and the photographs and room counts
        // follow later. Defaulted rather than demanded, because refusing to
        // record a signed mandate until somebody knows the bathroom count
        // would lose the mandate. Nothing is public until review passes.
        propertyType: dto.propertyType ?? 'Flat / Apartment',
        priceLabel: priceLabel(dto.priceNaira),
        beds: dto.beds ?? 0,
        baths: dto.baths ?? 0,
        sqft: '',
        description: dto.description ?? '',
        coverImage: '',
        images: [],
        ...(dto.documentsPresent?.length && {
          documents: {
            create: dto.documentsPresent.map((type) => ({
              type,
              name: DOCUMENT_NAME[type],
              date: '',
            })),
          },
        }),
      },
      select: LISTING_SELECT,
    });
    return this.shape(listing);
  }

  async update(id: string, dto: UpdateStaffListingDto) {
    const existing = await this.prisma.listing.findUnique({
      where: { id },
      select: { id: true, units: true },
    });
    if (!existing) throw new NotFoundException('Property not found');

    const units = dto.units ?? existing.units;
    if (dto.unitsSold !== undefined && dto.unitsSold > units) {
      throw new BadRequestException(
        `Cannot sell ${dto.unitsSold} of ${units} units`,
      );
    }

    const listing = await this.prisma.listing.update({
      where: { id },
      data: {
        title: dto.title,
        location: dto.location,
        chapter: dto.chapter,
        type: dto.type,
        // priceLabel is a denormalised copy the website renders directly, so
        // it has to move with the price or the two disagree on screen.
        ...(dto.priceNaira !== undefined && {
          priceNaira: BigInt(Math.round(dto.priceNaira)),
          priceLabel: priceLabel(dto.priceNaira),
        }),
        units: dto.units,
        unitsSold: dto.unitsSold,
        ...(dto.dealId !== undefined && { fromDealId: dto.dealId }),
      },
      select: LISTING_SELECT,
    });
    if (dto.documentsPresent) {
      await this.syncDocuments(id, dto.documentsPresent);
      return this.findOne(id);
    }
    return this.shape(listing);
  }

  /**
   * Publishing stamps publishedAt once. status alone cannot answer "published
   * this month", and re-publishing a paused listing must not move the date it
   * first went live.
   */
  async setStatus(id: string, status: ListingStatus) {
    const existing = await this.prisma.listing.findUnique({
      where: { id },
      select: { id: true, publishedAt: true },
    });
    if (!existing) throw new NotFoundException('Property not found');

    const listing = await this.prisma.listing.update({
      where: { id },
      data: {
        status,
        ...(status === ListingStatus.ACTIVE &&
          !existing.publishedAt && { publishedAt: new Date() }),
      },
      select: LISTING_SELECT,
    });
    return this.shape(listing);
  }

  /**
   * Verifying a document is a separate permission from posting the property,
   * and it is per-document: "verified" on the listing as a whole is only true
   * once all four are.
   */
  async setDocumentVerified(id: string, type: DocumentType, verified: boolean) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: { id: true, documents: { select: { id: true, type: true } } },
    });
    if (!listing) throw new NotFoundException('Property not found');

    const doc = listing.documents.find((d) => d.type === type);
    if (!doc) {
      throw new BadRequestException(
        'That document has not been handed over yet, so there is nothing to verify',
      );
    }

    await this.prisma.listingDocument.update({
      where: { id: doc.id },
      data: { verified },
    });

    const all = await this.prisma.listingDocument.findMany({
      where: { listingId: id },
      select: { type: true, verified: true },
    });
    const fullyVerified =
      REQUIRED_DOCUMENTS.every((t) =>
        all.some((d) => d.type === t && d.verified),
      ) && all.length > 0;

    await this.prisma.listing.update({
      where: { id },
      data: { verified: fullyVerified },
    });

    return this.findOne(id);
  }

  /**
   * Add one photo to a listing.
   *
   * One file per request: a batch that fails halfway leaves nobody sure which
   * photos landed, while one at a time lets the portal say exactly which did.
   * The first photo becomes the cover — the website and the app both lead with
   * it, so a listing with photos but no cover still looks empty.
   */
  async addPhoto(id: string, file: { mimetype?: string } | undefined) {
    if (!file) throw new BadRequestException('No file provided');
    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('Photos must be images');
    }

    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: { id: true, images: true, coverImage: true },
    });
    if (!listing) throw new NotFoundException('Property not found');
    if (listing.images.length >= MAX_PHOTOS) {
      throw new BadRequestException(
        `A property can have at most ${MAX_PHOTOS} photos`,
      );
    }

    // The storage service converts iPhone HEIC to JPEG before it lands.
    const { fileUrl } = await this.storage.uploadFile(file, 'listings');

    const updated = await this.prisma.listing.update({
      where: { id },
      data: {
        images: [...listing.images, fileUrl],
        ...(!listing.coverImage && { coverImage: fileUrl }),
      },
      select: LISTING_SELECT,
    });
    return this.shape(updated);
  }

  /**
   * Reorder or remove photos. Whatever comes first becomes the cover.
   *
   * Only photos already on this listing are accepted. The portal holds the
   * display URLs it was given, so each is matched to its stored original in
   * either form — and anything matching neither is refused, or this route
   * would let anyone attach an arbitrary image to a public listing.
   */
  async setPhotos(id: string, urls: string[]) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: { id: true, images: true },
    });
    if (!listing) throw new NotFoundException('Property not found');

    const stored = new Map<string, string>();
    for (const original of listing.images) {
      stored.set(original, original);
      const shown = this.mediaUrl.rewrite(original);
      if (shown) stored.set(shown, original);
    }

    const next: string[] = [];
    for (const url of urls) {
      const original = stored.get(url);
      if (!original) {
        throw new BadRequestException('That photo is not on this property');
      }
      if (!next.includes(original)) next.push(original);
    }

    const updated = await this.prisma.listing.update({
      where: { id },
      data: { images: next, coverImage: next[0] ?? '' },
      select: LISTING_SELECT,
    });
    return this.shape(updated);
  }

  /**
   * Make the documents on file match what was ticked, then re-derive the
   * listing's verified flag — true only once all four are held and checked,
   * exactly as setDocumentVerified computes it.
   */
  private async syncDocuments(id: string, present: DocumentType[]) {
    const held = await this.prisma.listingDocument.findMany({
      where: { listingId: id },
      select: { id: true, type: true },
    });
    const wanted = new Set(present);
    const removed = held.filter((d) => !wanted.has(d.type)).map((d) => d.id);
    const added = present.filter((t) => !held.some((d) => d.type === t));

    await this.prisma.$transaction([
      this.prisma.listingDocument.deleteMany({
        where: { id: { in: removed } },
      }),
      this.prisma.listingDocument.createMany({
        data: added.map((type) => ({
          listingId: id,
          type,
          name: DOCUMENT_NAME[type],
          date: '',
        })),
      }),
    ]);

    const now = await this.prisma.listingDocument.findMany({
      where: { listingId: id },
      select: { type: true, verified: true },
    });
    await this.prisma.listing.update({
      where: { id },
      data: {
        verified: REQUIRED_DOCUMENTS.every((t) =>
          now.some((d) => d.type === t && d.verified),
        ),
      },
    });
  }

  async remove(id: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: { id: true, _count: { select: { leads: true } } },
    });
    if (!listing) throw new NotFoundException('Property not found');
    await this.prisma.listing.delete({ where: { id } });
    return { deleted: true, leadsRemoved: listing._count.leads };
  }

  /** Listing.slug is unique, and a second "Lekki Court" must still save. */
  private async uniqueSlug(title: string): Promise<string> {
    const base =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || 'property';

    for (let n = 0; n < 50; n += 1) {
      const slug = n === 0 ? base : `${base}-${n + 1}`;
      const taken = await this.prisma.listing.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!taken) return slug;
    }
    return `${base}-${Date.now()}`;
  }
}
