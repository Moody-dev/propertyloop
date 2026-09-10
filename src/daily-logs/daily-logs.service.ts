import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SaveDailyLogDto } from './dto/save-daily-log.dto';

/**
 * The team works to Lagos time. Deriving "which day" from the server's clock
 * would put a 9pm Lagos entry on tomorrow whenever the host runs UTC+something
 * — so the boundary is computed explicitly rather than inherited.
 */
const LAGOS_OFFSET_MINUTES = 60; // West Africa Time, no daylight saving.

export function lagosDay(at: Date = new Date()): string {
  const shifted = new Date(at.getTime() + LAGOS_OFFSET_MINUTES * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/** Start and end instants (UTC) of one Lagos calendar day. */
function lagosDayBounds(day: string): { from: Date; to: Date } {
  const from = new Date(`${day}T00:00:00.000Z`);
  from.setUTCMinutes(from.getUTCMinutes() - LAGOS_OFFSET_MINUTES);
  const to = new Date(from.getTime() + 86_400_000);
  return { from, to };
}

export interface DayActivity {
  propertiesSubmitted: number;
  propertiesPublished: number;
  dealsAdvanced: number;
  leadsContacted: number;
  shootsPrepped: number;
  videosPublished: number;
  threadMessages: number;
  total: number;
}

@Injectable()
export class DailyLogsService {
  constructor(private readonly prisma: PrismaService) {}

  /** One person's entry for one day, or null. */
  async findOne(staffId: string, day: string) {
    return this.prisma.dailyLog.findUnique({
      where: { staffId_day: { staffId, day } },
    });
  }

  /** Recent entries for one person, newest first. */
  async listForStaff(staffId: string, days = 30) {
    return this.prisma.dailyLog.findMany({
      where: { staffId },
      orderBy: { day: 'desc' },
      take: days,
    });
  }

  /**
   * Everyone's entry for one day, with what the records show alongside.
   *
   * The pairing is the whole design. A written log on its own measures how
   * diligently somebody reports; read next to the activity the database
   * already holds, it becomes reviewable — and where the two disagree, that
   * gap is the conversation worth having.
   */
  async listForDay(day: string) {
    const staff = await this.prisma.staffProfile.findMany({
      where: { active: true },
      select: {
        id: true,
        letter: true,
        staffRole: true,
        chapter: true,
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
      orderBy: [{ chapter: 'asc' }, { letter: 'asc' }],
    });

    const logs = await this.prisma.dailyLog.findMany({ where: { day } });
    const byStaff = new Map(logs.map((l) => [l.staffId, l]));

    const rows = await Promise.all(
      staff.map(async (s) => ({
        staff: s,
        log: byStaff.get(s.id) ?? null,
        activity: await this.dayActivity(s.id, day),
      })),
    );

    return {
      day,
      filed: rows.filter((r) => r.log !== null).length,
      total: rows.length,
      rows,
    };
  }

  /**
   * What the RECORDS say a person did on a given day, independent of what
   * they wrote. Nobody can type these numbers.
   */
  async dayActivity(staffId: string, day: string): Promise<DayActivity> {
    const { from, to } = lagosDayBounds(day);
    const window = { gte: from, lt: to };

    const [
      propertiesSubmitted,
      propertiesPublished,
      dealsAdvanced,
      leadsContacted,
      shootsPrepped,
      videosPublished,
      threadMessages,
    ] = await Promise.all([
      this.prisma.listing.count({
        where: { sourcedByStaffId: staffId, createdAt: window },
      }),
      this.prisma.listing.count({
        where: {
          sourcedByStaffId: staffId,
          status: 'ACTIVE',
          updatedAt: window,
        },
      }),
      this.prisma.deal.count({
        where: { ownerId: staffId, lastActivityAt: window },
      }),
      // Leads belong to an agent user, not a staff profile, so this counts
      // through the staff member's own user account.
      this.prisma.lead.count({
        where: { agent: { staffProfile: { id: staffId } }, updatedAt: window },
      }),
      this.prisma.shoot.count({
        where: { secretaryId: staffId, prepCompleteAt: window },
      }),
      this.prisma.shoot.count({
        where: { presenterId: staffId, publishedAt: window },
      }),
      this.prisma.message.count({
        where: {
          sender: { staffProfile: { id: staffId } },
          conversation: { isInternal: true },
          createdAt: window,
        },
      }),
    ]);

    const total =
      propertiesSubmitted +
      propertiesPublished +
      dealsAdvanced +
      leadsContacted +
      shootsPrepped +
      videosPublished +
      threadMessages;

    return {
      propertiesSubmitted,
      propertiesPublished,
      dealsAdvanced,
      leadsContacted,
      shootsPrepped,
      videosPublished,
      threadMessages,
      total,
    };
  }

  /** Create or replace one person's entry for one day. */
  async save(staffId: string, day: string, dto: SaveDailyLogDto) {
    return this.prisma.dailyLog.upsert({
      where: { staffId_day: { staffId, day } },
      create: {
        staffId,
        day,
        summary: dto.summary,
        blockers: dto.blockers ?? '',
        plan: dto.plan ?? '',
      },
      update: {
        summary: dto.summary,
        blockers: dto.blockers ?? '',
        plan: dto.plan ?? '',
      },
    });
  }

  async remove(staffId: string, day: string) {
    const existing = await this.findOne(staffId, day);
    if (!existing) throw new NotFoundException('No entry for that day');
    await this.prisma.dailyLog.delete({
      where: { staffId_day: { staffId, day } },
    });
    return { deleted: true };
  }

  /**
   * Working days in the window with no entry. Weekends are excluded —
   * nobody is expected to file on a Sunday, and counting those as misses
   * would make the number meaningless.
   */
  async missedDays(staffId: string, lastNDays = 14) {
    const days: string[] = [];
    for (let i = 0; i < lastNDays; i += 1) {
      days.push(lagosDay(new Date(Date.now() - i * 86_400_000)));
    }

    const filed = await this.prisma.dailyLog.findMany({
      where: { staffId, day: { in: days } },
      select: { day: true },
    });
    const filedSet = new Set(filed.map((f) => f.day));

    return days.filter((d) => {
      const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
      const isWeekend = weekday === 0 || weekday === 6;
      return !isWeekend && !filedSet.has(d);
    });
  }
}
