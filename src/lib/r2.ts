import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export async function uploadFile(
  file: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: file,
      ContentType: contentType,
    })
  );

  return `${process.env.R2_PUBLIC_URL}/${key}`;
}

/**
 * Читає об'єкт із R2 через S3 API.
 * Використовується для приватної віддачі фото накладних — вони не лежать
 * у публічному доступі, на відміну від фото товарів.
 */
export async function getFile(
  key: string
): Promise<{ body: Buffer; contentType: string } | null> {
  try {
    const res = await r2.send(
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
      })
    );

    if (!res.Body) return null;

    const bytes = await res.Body.transformToByteArray();
    return {
      body: Buffer.from(bytes),
      contentType: res.ContentType || 'application/octet-stream',
    };
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'NoSuchKey' || name === 'NotFound') return null;
    throw e;
  }
}

export async function deleteFile(key: string): Promise<void> {
  await r2.send(
    new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
    })
  );
}

/**
 * Тимчасове посилання на приватний обʼєкт.
 *
 * Потрібне там, де файл завеликий, щоб гнати його через серверну функцію:
 * збірка застосунку важить понад сто мегабайтів, і проксіювання таких
 * обсягів через Vercel — це і час виконання, і трафік, за який платимо
 * двічі. Перевірка доступу лишається в роуті, а байти йдуть з CDN
 * Cloudflare напряму.
 *
 * Строк короткий навмисно: посилання, яким поділилися, має протухнути
 * швидше, ніж встигне розійтися.
 */
export async function signedUrl(key: string, expiresInSeconds = 300): Promise<string> {
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  return getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key }),
    { expiresIn: expiresInSeconds }
  );
}

/** Розмір обʼєкта без завантаження — щоб показати вагу збірки перед скачуванням. */
export async function fileSize(key: string): Promise<number | null> {
  try {
    const res = await r2.send(
      new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME!, Key: key })
    );
    return res.ContentLength ?? null;
  } catch {
    return null;
  }
}
