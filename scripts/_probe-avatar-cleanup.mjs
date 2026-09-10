// Прибирає за пробою: усе, що вона поклала в avatars/probe-avatar-*.
import { S3Client, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const Bucket = process.env.R2_BUCKET_NAME;

const list = await r2.send(new ListObjectsV2Command({ Bucket, Prefix: "avatars/probe-avatar-" }));
for (const o of list.Contents ?? []) {
  await r2.send(new DeleteObjectCommand({ Bucket, Key: o.Key }));
  console.log("видалено", o.Key);
}
console.log("усього:", (list.Contents ?? []).length);
