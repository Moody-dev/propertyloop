import 'dotenv/config';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

async function main() {
  const prefix = process.argv[2];
  if (!prefix) {
    console.error('Usage: npx ts-node scripts/list-r2-objects.ts <prefix>');
    process.exit(1);
  }

  const res = await s3.send(
    new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME!,
      Prefix: prefix,
      MaxKeys: 50,
    }),
  );

  console.log(`Prefix: ${prefix}`);
  console.log(`Found ${res.Contents?.length ?? 0} objects:`);
  for (const o of res.Contents ?? []) {
    console.log(`  ${o.Key}  (${o.Size} bytes, ${o.LastModified?.toISOString()})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
