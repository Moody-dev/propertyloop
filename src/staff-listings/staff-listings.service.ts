import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { B2Service } from '../storage/b2.service';
import { MediaUrlService } from '../media/media-url.service';
import { cleanDescription } from '../common/utils/sanitize';
import { assertNotObjectionable } from '../common/content-filter';
import {
  DocumentType,
  ListingOwnership,
  ListingStatus,
  ListingType,
  Prisma,
} from '../../generated/prisma/client';
import { CreateStaffListingDto } from './dto/create-staff-listing.dto';
import { UpdateStaffListingDto } from './dto/update-staff-listing.dto';
import { StaffAlertsService } from '../staff-alerts/staff-alerts.service';
import { StockAlertsService } from '../stock-alerts/stock-alerts.service';

/**
 * Properties as the staff portal sees them.
 *
 * Everything posted from the team platform is PropertyLoop's own stock —
 * ownership HOUSE — which is what agent partners are given to sell. An
 * agent's own listing belongs to the agent; this module never creates one.
 *
 * ListingsService remains the agent-facing view and is untouched.
 */

/** The same ceiling agents have: CreateListingDto accepts 20 images. */
const MAX_PHOTOS = 20;

/** Uploaded files and pasted links together, as agents' listings allow. */
const MAX_VIDEOS = 10;

/** What the agent form's document picker accepts. */
const DOCUMENT_MIME = ['application/pdf', 'image/jpeg', 'image/png'];

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

/** The period suffix the website prints after a price, set as the agent form sets it. */
function periodFor(type: ListingType): string | null {
  if (type === ListingType.RENT) return '/year';
  if (type === ListingType.SHORTLET) return '/night';
  return null;
}

/** Guess a document's type from its file name, exactly as the agent form does. */
function inferDocType(name: string): DocumentType {
  const n = name.toLowerCase();
  if (n.includes('survey')) return DocumentType.SURVEY_PLAN;
  if (n.includes('permit')) return DocumentType.BUILDING_PERMIT;
  if (n.includes('receipt')) return DocumentType.RECEIPT;
  return DocumentType.C_OF_O;
}

/** A pasted link the website can embed — YouTube or Vimeo, as for agents. */
function isVideoLink(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return /(^|\.)youtube\.com$|^youtu\.be$|(^|\.)vimeo\.com$/.test(host);
  } catch {
    return false;
  }
}

const LISTING_SELECT = {
  id: true,
  title: true,
  propertyType: true,
  address: true,
  location: true,
  beds: true,
  baths: true,
  sqft: true,
  yearBuilt: true,
  description: true,
  features: true,
  virtualTourUrl: true,
  period: true,
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
  documents: {
    select: { id: true, type: true, name: true, url: true, verified: true },
  },
  fromDeal: { select: { id: true, company: true } },
} satisfies Prisma.ListingSelect;

type ListingRow = Prisma.ListingGetPayload<{ select: typeof LISTING_SELECT }>;

@Injectable()
export class StaffListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: B2Service,
    private readonly mediaUrl: MediaUrlService,
    @Optional() private readonly alerts?: StaffAlertsService,
    @Optional() private readonly stockAlerts?: StockAlertsService,
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
      // The agent form's fields, so the portal can edit what the website shows.
      propertyType: listing.propertyType,
      address: listing.address,
      beds: listing.beds,
      baths: listing.baths,
      sqft: listing.sqft,
      yearBuilt: listing.yearBuilt,
      description: listing.description,
      features: listing.features,
      virtualTourUrl: listing.virtualTourUrl,
      videoUrls: listing.videoUrls,
      documentFiles: listing.documents.map((d) => ({
        id: d.id,
        type: d.type,
        name: d.name,
        url: d.url,
        verified: d.verified,
      })),
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
    // The checks an agent's listing goes through. House stock is published
    // under PropertyLoop's own name, so it gets no less scrutiny.
    assertNotObjectionable(dto.title, 'Listing title');
    assertNotObjectionable(dto.description, 'Listing description');

    const slug = await this.uniqueSlug(dto.title);
    const videoUrls = dto.videoUrls ?? [];

    const listing = await this.prisma.listing.create({
      data: {
        // The public listing, as the website's agent form sends it.
        title: dto.title,
        slug,
        type: dto.type,
        propertyType: dto.propertyType,
        priceNaira: BigInt(Math.round(dto.priceNaira)),
        priceLabel: priceLabel(dto.priceNaira),
        period: periodFor(dto.type) ?? undefined,
        address: dto.address,
        location: dto.location,
        beds: dto.beds,
        baths: dto.baths,
        sqft: dto.sqft?.trim() ?? '',
        yearBuilt: dto.yearBuilt?.trim() || undefined,
        description: cleanDescription(dto.description),
        features: dto.features ?? [],
        virtualTourUrl: dto.virtualTourUrl || undefined,
        videoUrls,
        videoUrl: videoUrls[0] ?? undefined,
        // Photos, documents and video files follow once the listing exists.
        coverImage: '',
        images: [],
        // What only the company records.
        chapter: dto.chapter,
        units: dto.units ?? 1,
        fromDealId: dto.dealId ?? null,
        // House stock, sourced by whoever posted it. Ownership is what makes it
        // sellable by partners; sourcedByStaffId is what makes acquisition
        // numbers attributable to a person.
        ownership: ListingOwnership.HOUSE,
        sourcedByStaffId: staffId,
        agentId: userId,
        // Staff-posted stock still goes through review — posting it is not the
        // same as vouching for it.
        status: ListingStatus.PENDING_REVIEW,
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
    this.alerts?.propertyForReview(dto.title, staffId);
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
    if (dto.title !== undefined) {
      assertNotObjectionable(dto.title, 'Listing title');
    }
    if (dto.description !== undefined) {
      assertNotObjectionable(dto.description, 'Listing description');
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
        propertyType: dto.propertyType,
        address: dto.address,
        beds: dto.beds,
        baths: dto.baths,
        sqft: dto.sqft?.trim(),
        ...(dto.yearBuilt !== undefined && {
          yearBuilt: dto.yearBuilt.trim() || null,
        }),
        ...(dto.description !== undefined && {
          description: cleanDescription(dto.description),
        }),
        features: dto.features,
        ...(dto.virtualTourUrl !== undefined && {
          virtualTourUrl: dto.virtualTourUrl || null,
        }),
        // The price suffix follows the listing type, as on the agent form.
        ...(dto.type !== undefined && { period: periodFor(dto.type) }),
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
  async setStatus(id: string, status: ListingStatus, actorStaffId?: string) {
    const existing = await this.prisma.listing.findUnique({
      where: { id },
      select: {
        id: true,
        publishedAt: true,
        status: true,
        title: true,
        sourcedByStaffId: true,
        ownership: true,
      },
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
    if (
      status === ListingStatus.ACTIVE &&
      existing.status !== ListingStatus.ACTIVE
    ) {
      this.alerts?.propertyPublished(
        existing.title,
        existing.sourcedByStaffId,
        actorStaffId,
      );
      // Every agent hears about PropertyLoop's own stock the moment it goes
      // live — but only the first time, so pausing and putting a listing
      // back up does not email them again.
      if (
        !existing.publishedAt &&
        existing.ownership === ListingOwnership.HOUSE
      ) {
        this.stockAlerts?.announcePublished(id);
      }
    }
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

    if (!listing.documents.some((d) => d.type === type)) {
      throw new BadRequestException(
        'That document has not been handed over yet, so there is nothing to verify',
      );
    }

    // Every file of that type: a survey plan scanned as two pages is still one
    // document, and verifying it must not leave half of it unchecked.
    await this.prisma.listingDocument.updateMany({
      where: { listingId: id, type },
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
   * Attach one document file — PDF, JPG or PNG, as the agent form accepts.
   *
   * The type is taken as given, or guessed from the file name the way the
   * agent form guesses it. Several files of one type are allowed; a survey plan
   * often arrives as more than one scan. A new file starts unverified, so the
   * listing's verified flag is re-derived.
   */
  async addDocument(
    id: string,
    file: { mimetype?: string; originalname?: string } | undefined,
    type?: string,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    if (!DOCUMENT_MIME.includes(file.mimetype ?? '')) {
      throw new BadRequestException('Documents must be PDF, JPG or PNG');
    }
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!listing) throw new NotFoundException('Property not found');

    const docType = Object.values(DocumentType).includes(type as DocumentType)
      ? (type as DocumentType)
      : inferDocType(file.originalname ?? '');

    const { fileUrl } = await this.storage.uploadFile(file, 'listing-docs');
    await this.prisma.listingDocument.create({
      data: {
        listingId: id,
        type: docType,
        name: (file.originalname || DOCUMENT_NAME[docType]).slice(0, 160),
        url: fileUrl,
        date: new Date().toLocaleDateString('en-NG', {
          month: 'short',
          year: 'numeric',
        }),
      },
    });
    await this.refreshVerified(id);
    return this.findOne(id);
  }

  async removeDocument(id: string, docId: string) {
    const doc = await this.prisma.listingDocument.findUnique({
      where: { id: docId },
      select: { id: true, listingId: true },
    });
    if (!doc || doc.listingId !== id) {
      throw new NotFoundException('Document not found');
    }
    await this.prisma.listingDocument.delete({ where: { id: docId } });
    await this.refreshVerified(id);
    return this.findOne(id);
  }

  /**
   * Attach one video file — the agent form's 50MB cap. The first video on a
   * listing becomes its main video, as with agents'.
   */
  async addVideo(id: string, file: { mimetype?: string } | undefined) {
    if (!file) throw new BadRequestException('No file provided');
    if (!file.mimetype?.startsWith('video/')) {
      throw new BadRequestException('Please choose a video file');
    }
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: { id: true, videoUrls: true, videoUrl: true },
    });
    if (!listing) throw new NotFoundException('Property not found');
    if (listing.videoUrls.length >= MAX_VIDEOS) {
      throw new BadRequestException(
        `A property can have at most ${MAX_VIDEOS} videos`,
      );
    }

    const { fileUrl } = await this.storage.uploadFile(file, 'listings-videos');
    const updated = await this.prisma.listing.update({
      where: { id },
      data: {
        videoUrls: [...listing.videoUrls, fileUrl],
        ...(!listing.videoUrl && { videoUrl: fileUrl }),
      },
      select: LISTING_SELECT,
    });
    return this.shape(updated);
  }

  /**
   * Reorder or remove videos, or add a pasted link.
   *
   * Accepts only videos already on this listing, or YouTube and Vimeo links —
   * anything else would let an arbitrary file be embedded on a public page.
   */
  async setVideos(id: string, urls: string[]) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      select: { id: true, videoUrls: true },
    });
    if (!listing) throw new NotFoundException('Property not found');

    const next: string[] = [];
    for (const raw of urls) {
      const url = raw.trim();
      if (!listing.videoUrls.includes(url) && !isVideoLink(url)) {
        throw new BadRequestException(
          'Videos must be uploaded files on this property, or YouTube or Vimeo links',
        );
      }
      if (!next.includes(url)) next.push(url);
    }
    if (next.length > MAX_VIDEOS) {
      throw new BadRequestException(
        `A property can have at most ${MAX_VIDEOS} videos`,
      );
    }

    const updated = await this.prisma.listing.update({
      where: { id },
      data: { videoUrls: next, videoUrl: next[0] ?? null },
      select: LISTING_SELECT,
    });
    return this.shape(updated);
  }

  /** verified is true only once all four document types are held and checked. */
  private async refreshVerified(id: string) {
    const docs = await this.prisma.listingDocument.findMany({
      where: { listingId: id },
      select: { type: true, verified: true },
    });
    await this.prisma.listing.update({
      where: { id },
      data: {
        verified: REQUIRED_DOCUMENTS.every(
          (t) =>
            docs.some((d) => d.type === t) &&
            docs.filter((d) => d.type === t).every((d) => d.verified),
        ),
      },
    });
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
