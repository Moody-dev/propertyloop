/**
 * Nuke every object in the R2 bucket. Use after wipe-platform-data.ts so the
 * bucket isn't full of orphaned listing photos / banners / job attachments
 * from the test/dev period.
 *
 * Usage:
 *   npx ts-node scripts/wipe-r2-storage.ts                 # dry-run (default)
 *   npx ts-node scripts/wipe-r2-storage.ts --confirm       # actually delete
 *   npx ts-node scripts/wipe-r2-storage.ts --prefix=profile-pictures/   # scope to one prefix
 *
 * Required env (loaded from backend/.env):
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_ACCOUNT_ID
 *   R2_BUCKET_NAME
 *   R2_ENDPOINT
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  type _Object,
} from '@aws-sdk/client-s3';

// ─── Args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const confirm = args.includes('--confirm');
const prefixArg = args.find((a) => a.startsWith('--prefix='));
const prefix = prefixArg ? prefixArg.split('=')[1] : undefined;

// ─── Env ────────────────────────────────────────────────────────────────
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const bucket = process.env.R2_BUCKET_NAME;
const endpoint = process.env.R2_ENDPOINT;

if (!accessKeyId || !secretAccessKey || !bucket || !endpoint) {
  console.error(
    '✗ Missing R2 env. Need R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_ENDPOINT.',
  );
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint,
  credentials: { accessKeyId, secretAccessKey },
});

// ─── Helpers ────────────────────────────────────────────────────────────
function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)}GB`;
}

async function listAllObjects(): Promise<_Object[]> {
  const all: _Object[] = [];
  let continuationToken: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    if (res.Contents) all.push(...res.Contents);
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  return all;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log('═══ R2 storage wipe ═══');
  console.log(`Bucket:   ${bucket}`);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Prefix:   ${prefix ?? '(entire bucket)'}`);
  console.log(`Mode:     ${confirm ? '🔥 EXECUTE' : 'DRY-RUN'}\n`);

  console.log('Listing objects…');
  const objects = await listAllObjects();
  const totalBytes = objects.reduce((sum, o) => sum + (o.Size ?? 0), 0);
  console.log(`Found ${objects.length} object${objects.length === 1 ? '' : 's'} (${humanBytes(totalBytes)})\n`);

  if (objects.length === 0) {
    console.log('Nothing to delete. Bye.');
    return;
  }

  // Group by top-level prefix for context
  const byPrefix: Record<string, { count: number; bytes: number }> = {};
  for (const o of objects) {
    const top = o.Key?.split('/')[0] ?? '(root)';
    if (!byPrefix[top]) byPrefix[top] = { count: 0, bytes: 0 };
    byPrefix[top].count += 1;
    byPrefix[top].bytes += o.Size ?? 0;
  }

  console.log('By top-level prefix:');
  for (const [p, { count, bytes }] of Object.entries(byPrefix)) {
    console.log(`  ${p.padEnd(28)}: ${String(count).padStart(5)}  (${humanBytes(bytes)})`);
  }
  console.log('');

  // Snapshot for audit
  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotPath = path.join(outDir, `r2-wipe-snapshot-${stamp}.json`);
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify(
      {
        bucket,
        prefix: prefix ?? null,
        executedAt: new Date().toISOString(),
        mode: confirm ? 'execute' : 'dry-run',
        totalObjects: objects.length,
        totalBytes,
        keys: objects.map((o) => ({
          key: o.Key,
          size: o.Size,
          lastModified: o.LastModified?.toISOString(),
        })),
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`Snapshot: ${snapshotPath}\n`);

  if (!confirm) {
    console.log('▶  Dry-run only. Re-run with --confirm to actually delete.');
    return;
  }

  // ─── Execute ─────────────────────────────────────────────────────────
  console.log('🔥 Deleting in batches of 1000…');
  const batches = chunk(objects, 1000);
  let deleted = 0;
  let errors = 0;

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    process.stdout.write(`  batch ${i + 1}/${batches.length} (${batch.length} keys)… `);
    try {
      const res = await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: batch.map((o) => ({ Key: o.Key! })),
            Quiet: true,
          },
        }),
      );
      const errs = res.Errors ?? [];
      deleted += batch.length - errs.length;
      errors += errs.length;
      if (errs.length) {
        console.log(`⚠ ${errs.length} errors`);
        for (const e of errs.slice(0, 3)) {
          console.log(`     ${e.Key}: ${e.Code} ${e.Message}`);
        }
      } else {
        console.log('✓');
      }
    } catch (err: any) {
      errors += batch.length;
      console.log(`✗ ${err?.message ?? err}`);
    }
  }

  console.log('\n══════ DONE ══════');
  console.log(`Deleted: ${deleted}`);
  console.log(`Errors:  ${errors}`);
  console.log(`Snapshot: ${snapshotPath}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
