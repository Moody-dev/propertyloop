# Team portal API

Internal staff tooling for the September 2026 org structure. Never exposed to
buyers, agents or vendors.

All routes sit under the global `/api` prefix and require `JwtAuthGuard` plus
`StaffPermissionsGuard`.

## Authentication and access

A staff member signs in with the same credentials as anyone else. What makes
them staff is a **`StaffProfile`** row, not the `Role` enum.

That distinction is the point. `Role` is `BUYER | AGENT | VENDOR | ADMIN`, and
every handler in `AdminController` runs the same check — `role !== ADMIN`.
Giving the team logins under that scheme would have handed a Secretary and a
Video Presenter the CEO's powers: suspend any user, change any listing's
status, approve withdrawals, resolve escrow disputes, read KYC identity
documents.

`StaffPermissionsGuard` is **not bypassed by `Role.ADMIN`**. An admin who is
also staff passes on their own permissions; one who is not staff is refused.

```ts
@UseGuards(JwtAuthGuard, StaffPermissionsGuard)
@RequireStaff(StaffPermission.MANAGE_DEALS)   // ALL listed permissions required
@Controller('deals')
```

`@RequireStaff()` with no arguments means "any active staff member".
`@CurrentStaff()` gives the handler the profile the guard loaded.

Defaults per position live in `staff-permissions.ts`, but the stored
`permissions` array is the authority — changing a default never silently
re-grants anyone.

### Start here

`GET /api/staff/me` returns the caller's profile or `null`. Deliberately
outside the guard: the client calls it to decide whether to show the portal at
all, and a 403 is a worse answer than `null` for that question.

## Routes

| Area | Base | Permission |
| --- | --- | --- |
| Staff & permissions | `/api/staff` | read: any staff · write: `MANAGE_STAFF` |
| Deals & mandates | `/api/deals` | `MANAGE_DEALS` |
| Daily logs | `/api/daily-logs` | own: any staff · others: `VIEW_ALL_LOGS` |
| Shoots & content | `/api/production` | `MANAGE_CONTENT` |
| Targets | `/api/targets` | read all: `VIEW_ALL_TARGETS` · write: `MANAGE_TARGETS` |
| Operations queue | `/api/ops-queue` | `HANDLE_OPS` |
| Internal threads | `/api/threads` | any staff |

58 routes in total.

## Rules worth knowing before you wire a client

**Staff are deactivated, never deleted.** A `StaffProfile` id is stamped on
every listing, deal, log and message that person touched. `PATCH
/staff/:id/active` is the only removal.

**Targets carry a provenance.** `DATABASE` targets name a `metricKey` and are
recomputed on every read — the stored `actual` column is ignored for them, so
it cannot drift. `MANUAL` targets are somebody typing. The distinction is
surfaced on purpose: a scorecard made mostly of `MANUAL` rows measures
diligence in reporting rather than results.

**Ceiling targets invert.** A reshoot rate of 8% against a 10% limit scores
100, not 20 — it is success, not four-fifths of a failure.

**Only `TASK` items can be created in the ops queue.** KYC reviews, payouts,
reports, disputes and listing reviews are projections of `KycSubmission`,
`WithdrawalRequest`, `Report`, `VendorJob` and `Listing`. `createTask` refuses
any other kind and names the model it actually comes from. A hand-made payout
row could be marked resolved without any money moving.

**Daily logs key on the Lagos calendar day**, computed explicitly rather than
inherited from the host clock — Railway runs UTC, which would file a 9pm Lagos
entry against tomorrow. There is no route to write somebody else's log,
whatever permissions you hold.

**Revenue is filtered, not just hidden client-side.** `GET /targets` strips
`actual`, `min` and `max` from `NAIRA` targets for callers without
`VIEW_REVENUE` and marks them `hidden: true`.

## Changes to existing behaviour

**`Listing.sourcedByStaffId`** (new, nullable) records who *brought a listing
in*, as distinct from `agentId` which records who owns it. Without it, "Ola
listed 14 properties this month" could not be answered from the database at
all. `AdminCreateListingDto` accepts it, along with `fromDealId`.

**`Conversation.isInternal`** (new, defaults `false`) separates staff
conversations from customer ones. Two existing queries now filter on it:

- `MessagesService.listConversations` — otherwise a staff member who is also
  an agent would find internal threads in their customer inbox.
- `MessagesService.getUnreadCount` — its own comment already said it must
  apply the same rules as the inbox, or the badge counts an unread the user
  can never clear.

No existing row changes meaning: everything already in the table is
`isInternal = false`, which is what it always was.

## Migration

`prisma/migrations/20260909120000_add_team_portal/` is **additive only** —
every new column on `Listing` and `Conversation` is nullable or defaulted, so
it applies without rewriting either table. Nothing is dropped or renamed.

It has **not been applied to any database**. Run `npx prisma migrate deploy`
when you are ready.

One deliberate omission: no foreign key is added for the pre-existing
`Conversation.listingId` column. It has never had one, and some rows may point
at listings since deleted — adding the constraint could fail on live data. A
listing-pinned thread resolves its title with a separate query instead.
