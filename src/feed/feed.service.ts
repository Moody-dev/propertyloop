import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FeedPostType, Prisma } from '../../generated/prisma/client';
import { CreateFeedPostDto } from './dto/create-post.dto';
import { CreateFeedCommentDto } from './dto/create-comment.dto';

const POLL_DURATION_DAYS = 3;

const authorSelect = {
  id: true,
  name: true,
  avatarUrl: true,
  role: true,
  location: true,
  agentProfile: { select: { verified: true, agencyName: true } },
  vendorProfile: { select: { verified: true, serviceCategory: true } },
} satisfies Prisma.UserSelect;

const postInclude = {
  author: { select: authorSelect },
  listing: {
    select: {
      id: true,
      slug: true,
      title: true,
      priceLabel: true,
      period: true,
      address: true,
      location: true,
      beds: true,
      baths: true,
      sqft: true,
      coverImage: true,
      type: true,
    },
  },
  pollOptions: {
    orderBy: { order: 'asc' as const },
    include: { _count: { select: { votes: true } } },
  },
  _count: { select: { likes: true, comments: true } },
} satisfies Prisma.FeedPostInclude;

type PostWithInclude = Prisma.FeedPostGetPayload<{ include: typeof postInclude }>;

@Injectable()
export class FeedService {
  constructor(private readonly prisma: PrismaService) {}

  // ── posts ──────────────────────────────────────────────────────────────

  async listPosts(params: {
    viewerId?: string;
    filter?: string;
    authorId?: string;
    hashtag?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(50, Math.max(1, params.limit ?? 10));
    const { viewerId, filter, authorId, hashtag } = params;

    const where: Prisma.FeedPostWhereInput = { deletedAt: null };
    // Explore ranks by engagement (likes, then comments) instead of recency.
    let orderBy:
      | Prisma.FeedPostOrderByWithRelationInput
      | Prisma.FeedPostOrderByWithRelationInput[] = { createdAt: 'desc' };

    if (hashtag) {
      const clean = hashtag.replace(/[^A-Za-z0-9_]/g, '');
      if (!clean) return { items: [], total: 0, page, limit, pages: 0 };
      where.body = { contains: `#${clean}`, mode: 'insensitive' };
    } else if (authorId) {
      where.authorId = authorId;
    } else if (filter === 'following') {
      if (!viewerId) return { items: [], total: 0, page, limit, pages: 0 };
      where.author = {
        followers: { some: { followerId: viewerId } },
      };
    } else if (filter === 'saved') {
      if (!viewerId) return { items: [], total: 0, page, limit, pages: 0 };
      where.saves = { some: { userId: viewerId } };
    } else if (filter === 'explore') {
      orderBy = [
        { likes: { _count: 'desc' } },
        { comments: { _count: 'desc' } },
        { createdAt: 'desc' },
      ];
    } else if (
      filter &&
      (Object.values(FeedPostType) as string[]).includes(filter)
    ) {
      where.type = filter as FeedPostType;
    }

    const [total, posts] = await this.prisma.$transaction([
      this.prisma.feedPost.count({ where }),
      this.prisma.feedPost.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: postInclude,
      }),
    ]);

    const items = await this.decorateForViewer(posts, viewerId);
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async createPost(authorId: string, dto: CreateFeedPostDto) {
    const type = dto.type ?? FeedPostType.UPDATE;
    const videos = (dto.videos ?? []).filter(Boolean).slice(0, 1);

    if (type === FeedPostType.POLL) {
      const options = (dto.pollOptions ?? [])
        .map((o) => o.trim())
        .filter(Boolean);
      if (options.length < 2) {
        throw new BadRequestException('A poll needs at least 2 options');
      }
    }

    if (dto.listingId) {
      const listing = await this.prisma.listing.findFirst({
        where: { id: dto.listingId, agentId: authorId },
        select: { id: true },
      });
      if (!listing) {
        throw new BadRequestException(
          'You can only attach one of your own listings',
        );
      }
    }

    const post = await this.prisma.feedPost.create({
      data: {
        authorId,
        type,
        body: dto.body.trim(),
        // A clip wins: never store both, so the card has one thing to render.
        images: videos.length > 0 ? [] : (dto.images ?? []),
        videos,
        listingId: dto.listingId || null,
        insightMetric: dto.insightMetric || null,
        insightPeriod: dto.insightPeriod || null,
        insightDelta: dto.insightDelta || null,
        insightBars: dto.insightBars ?? [],
        projectName: dto.projectName || null,
        projectLocation: dto.projectLocation || null,
        projectUnits: dto.projectUnits || null,
        ...(type === FeedPostType.POLL
          ? {
              pollEndsAt: new Date(
                Date.now() + POLL_DURATION_DAYS * 24 * 60 * 60 * 1000,
              ),
              pollOptions: {
                create: (dto.pollOptions ?? [])
                  .map((o) => o.trim())
                  .filter(Boolean)
                  .map((text, order) => ({ text, order })),
              },
            }
          : {}),
      },
      include: postInclude,
    });

    const [item] = await this.decorateForViewer([post], authorId);
    return item;
  }

  async deletePost(userId: string, postId: string) {
    const post = await this.prisma.feedPost.findUnique({
      where: { id: postId },
      select: { authorId: true, deletedAt: true },
    });
    if (!post || post.deletedAt) throw new NotFoundException('Post not found');
    if (post.authorId !== userId) {
      throw new ForbiddenException('You can only delete your own posts');
    }
    await this.prisma.feedPost.update({
      where: { id: postId },
      data: { deletedAt: new Date() },
    });
    return { deleted: true };
  }

  // ── reactions ──────────────────────────────────────────────────────────

  async toggleLike(userId: string, postId: string) {
    await this.assertPostExists(postId);
    const existing = await this.prisma.feedLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (existing) {
      await this.prisma.feedLike.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.feedLike.create({ data: { postId, userId } });
    }
    const count = await this.prisma.feedLike.count({ where: { postId } });
    return { liked: !existing, count };
  }

  async toggleSave(userId: string, postId: string) {
    await this.assertPostExists(postId);
    const existing = await this.prisma.feedSave.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (existing) {
      await this.prisma.feedSave.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.feedSave.create({ data: { postId, userId } });
    }
    return { saved: !existing };
  }

  async vote(userId: string, postId: string, optionId: string) {
    const option = await this.prisma.feedPollOption.findFirst({
      where: { id: optionId, postId },
      include: { post: { select: { pollEndsAt: true, deletedAt: true } } },
    });
    if (!option || option.post.deletedAt) {
      throw new NotFoundException('Poll option not found');
    }
    if (option.post.pollEndsAt && option.post.pollEndsAt < new Date()) {
      throw new BadRequestException('This poll has ended');
    }

    // One vote per post — switching options moves the vote.
    await this.prisma.feedPollVote.upsert({
      where: { postId_userId: { postId, userId } },
      create: { postId, userId, optionId },
      update: { optionId },
    });

    const options = await this.prisma.feedPollOption.findMany({
      where: { postId },
      orderBy: { order: 'asc' },
      include: { _count: { select: { votes: true } } },
    });
    const totalVotes = options.reduce((a, o) => a + o._count.votes, 0);
    return {
      votedOptionId: optionId,
      totalVotes,
      options: options.map((o) => ({
        id: o.id,
        text: o.text,
        votes: o._count.votes,
      })),
    };
  }

  // ── comments ───────────────────────────────────────────────────────────

  async listComments(postId: string) {
    await this.assertPostExists(postId);
    const comments = await this.prisma.feedComment.findMany({
      where: { postId, parentId: null },
      orderBy: { createdAt: 'asc' },
      include: {
        author: { select: authorSelect },
        replies: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: authorSelect } },
        },
      },
    });
    return comments.map((c) => ({
      ...this.formatComment(c),
      replies: c.replies.map((r) => this.formatComment(r)),
    }));
  }

  async createComment(
    authorId: string,
    postId: string,
    dto: CreateFeedCommentDto,
  ) {
    await this.assertPostExists(postId);
    if (dto.parentId) {
      const parent = await this.prisma.feedComment.findFirst({
        where: { id: dto.parentId, postId },
        select: { id: true, parentId: true },
      });
      if (!parent) throw new BadRequestException('Parent comment not found');
      // Keep threads one level deep — replying to a reply attaches to its root.
      if (parent.parentId) dto.parentId = parent.parentId;
    }
    const comment = await this.prisma.feedComment.create({
      data: {
        postId,
        authorId,
        body: dto.body.trim(),
        parentId: dto.parentId || null,
      },
      include: { author: { select: authorSelect } },
    });
    return this.formatComment(comment);
  }

  // ── follows ────────────────────────────────────────────────────────────

  async toggleFollow(followerId: string, followingId: string) {
    if (followerId === followingId) {
      throw new BadRequestException("You can't follow yourself");
    }
    const target = await this.prisma.user.findFirst({
      where: { id: followingId, deletedAt: null },
      select: { id: true },
    });
    if (!target) throw new NotFoundException('User not found');

    const existing = await this.prisma.userFollow.findUnique({
      where: { followerId_followingId: { followerId, followingId } },
    });
    if (existing) {
      await this.prisma.userFollow.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.userFollow.create({
        data: { followerId, followingId },
      });
    }
    return { following: !existing };
  }

  async reportPost(userId: string, postId: string, reason?: string) {
    await this.assertPostExists(postId);
    await this.prisma.feedReport.upsert({
      where: { postId_reporterId: { postId, reporterId: userId } },
      create: { postId, reporterId: userId, reason: reason?.slice(0, 500) },
      update: { reason: reason?.slice(0, 500) },
    });
    return { reported: true };
  }

  // ── user profile (feed) ────────────────────────────────────────────────

  async getUserProfile(userId: string, viewerId?: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        role: true,
        location: true,
        bio: true,
        createdAt: true,
        agentProfile: {
          select: {
            verified: true,
            agencyName: true,
            website: true,
            specialty: true,
            rating: true,
            listingsCount: true,
            soldRentedCount: true,
            businessAddress: true,
          },
        },
        vendorProfile: {
          select: {
            verified: true,
            serviceCategory: true,
            serviceArea: true,
            rating: true,
            jobsCount: true,
          },
        },
        _count: {
          select: {
            feedPosts: { where: { deletedAt: null } },
            followers: true,
            following: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const following = viewerId
      ? Boolean(
          await this.prisma.userFollow.findUnique({
            where: {
              followerId_followingId: {
                followerId: viewerId,
                followingId: userId,
              },
            },
            select: { id: true },
          }),
        )
      : false;

    const verified = Boolean(
      user.agentProfile?.verified || user.vendorProfile?.verified,
    );

    return {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
      location: user.location,
      bio: user.bio,
      createdAt: user.createdAt,
      verified,
      agency: user.agentProfile?.agencyName ?? null,
      website: user.agentProfile?.website ?? null,
      businessAddress: user.agentProfile?.businessAddress ?? null,
      specialty: user.agentProfile?.specialty ?? [],
      serviceCategory: user.vendorProfile?.serviceCategory ?? null,
      serviceArea: user.vendorProfile?.serviceArea ?? null,
      rating:
        user.agentProfile?.rating ?? user.vendorProfile?.rating ?? null,
      listingsCount: user.agentProfile?.listingsCount ?? null,
      soldRentedCount: user.agentProfile?.soldRentedCount ?? null,
      jobsCount: user.vendorProfile?.jobsCount ?? null,
      counts: {
        posts: user._count.feedPosts,
        followers: user._count.followers,
        following: user._count.following,
      },
      viewer: {
        following,
        isSelf: viewerId === user.id,
      },
    };
  }

  // ── sidebar metadata ───────────────────────────────────────────────────

  async meta(viewerId?: string) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [roleCounts, recentPosts, savedCount] = await Promise.all([
      this.prisma.user.groupBy({
        by: ['role'],
        where: { deletedAt: null, isActive: true },
        _count: { _all: true },
      }),
      this.prisma.feedPost.findMany({
        where: { deletedAt: null, createdAt: { gte: since } },
        select: { body: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
      viewerId
        ? this.prisma.feedSave.count({ where: { userId: viewerId } })
        : Promise.resolve(0),
    ]);

    // Trending hashtags from recent post bodies
    const tagCounts = new Map<string, number>();
    for (const p of recentPosts) {
      const tags = p.body.match(/#[A-Za-z]\w*/g) ?? [];
      for (const t of new Set(tags.map((x) => x.toLowerCase()))) {
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }
    const trending = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, count]) => ({ tag, count }));

    // People to follow: most-followed active agents/vendors the viewer
    // doesn't already follow (excluding themselves).
    const suggestions = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        role: { in: ['AGENT', 'VENDOR'] },
        ...(viewerId
          ? {
              id: { not: viewerId },
              followers: { none: { followerId: viewerId } },
            }
          : {}),
      },
      select: {
        ...authorSelect,
        _count: { select: { followers: true } },
      },
      orderBy: [{ followers: { _count: 'desc' } }, { createdAt: 'desc' }],
      take: 3,
    });

    return {
      roles: roleCounts.map((r) => ({ role: r.role, count: r._count._all })),
      trending,
      savedCount,
      suggestions: suggestions.map((u) => ({
        ...this.formatAuthor(u),
        followersCount: u._count.followers,
      })),
    };
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private async assertPostExists(postId: string) {
    const post = await this.prisma.feedPost.findFirst({
      where: { id: postId, deletedAt: null },
      select: { id: true },
    });
    if (!post) throw new NotFoundException('Post not found');
  }

  private formatAuthor(u: {
    id: string;
    name: string;
    avatarUrl: string | null;
    role: string;
    location: string | null;
    agentProfile: { verified: boolean; agencyName: string } | null;
    vendorProfile: { verified: boolean; serviceCategory: string } | null;
  }) {
    return {
      id: u.id,
      name: u.name,
      avatarUrl: u.avatarUrl,
      role: u.role,
      location: u.location,
      verified: Boolean(
        u.agentProfile?.verified || u.vendorProfile?.verified,
      ),
      agency: u.agentProfile?.agencyName ?? null,
      serviceCategory: u.vendorProfile?.serviceCategory ?? null,
    };
  }

  private formatComment(c: {
    id: string;
    body: string;
    parentId: string | null;
    createdAt: Date;
    author: Parameters<FeedService['formatAuthor']>[0];
  }) {
    return {
      id: c.id,
      body: c.body,
      parentId: c.parentId,
      createdAt: c.createdAt,
      author: this.formatAuthor(c.author),
    };
  }

  private async decorateForViewer(posts: PostWithInclude[], viewerId?: string) {
    const ids = posts.map((p) => p.id);
    const authorIds = [...new Set(posts.map((p) => p.authorId))];

    const [likes, saves, votes, follows] = viewerId
      ? await Promise.all([
          this.prisma.feedLike.findMany({
            where: { userId: viewerId, postId: { in: ids } },
            select: { postId: true },
          }),
          this.prisma.feedSave.findMany({
            where: { userId: viewerId, postId: { in: ids } },
            select: { postId: true },
          }),
          this.prisma.feedPollVote.findMany({
            where: { userId: viewerId, postId: { in: ids } },
            select: { postId: true, optionId: true },
          }),
          this.prisma.userFollow.findMany({
            where: { followerId: viewerId, followingId: { in: authorIds } },
            select: { followingId: true },
          }),
        ])
      : [[], [], [], []];

    const likedSet = new Set(likes.map((l) => l.postId));
    const savedSet = new Set(saves.map((s) => s.postId));
    const voteMap = new Map(votes.map((v) => [v.postId, v.optionId]));
    const followingSet = new Set(follows.map((f) => f.followingId));

    return posts.map((p) => {
      const totalVotes = p.pollOptions.reduce(
        (a, o) => a + o._count.votes,
        0,
      );
      return {
        id: p.id,
        type: p.type,
        body: p.body,
        images: p.images,
        videos: p.videos,
        createdAt: p.createdAt,
        author: this.formatAuthor(p.author),
        listing: p.listing
          ? { ...p.listing, sqft: p.listing.sqft ?? null }
          : null,
        insight: p.insightMetric
          ? {
              metric: p.insightMetric,
              period: p.insightPeriod,
              delta: p.insightDelta,
              bars: p.insightBars,
            }
          : null,
        project: p.projectName
          ? {
              name: p.projectName,
              location: p.projectLocation,
              units: p.projectUnits,
            }
          : null,
        poll:
          p.pollOptions.length > 0
            ? {
                endsAt: p.pollEndsAt,
                totalVotes,
                options: p.pollOptions.map((o) => ({
                  id: o.id,
                  text: o.text,
                  votes: o._count.votes,
                })),
              }
            : null,
        likesCount: p._count.likes,
        commentsCount: p._count.comments,
        viewer: {
          liked: likedSet.has(p.id),
          saved: savedSet.has(p.id),
          votedOptionId: voteMap.get(p.id) ?? null,
          followingAuthor: followingSet.has(p.authorId),
          isAuthor: viewerId === p.authorId,
        },
      };
    });
  }
}
