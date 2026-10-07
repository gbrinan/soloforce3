/**
 * 파일 스토리지 추상화 레이어
 * 로컬 파일시스템 또는 S3 호환 스토리지 지원
 */
import { promises as fs } from "fs";
import path from "path";
import { nanoid } from "nanoid";

export interface StorageProvider {
  upload(key: string, data: Buffer, contentType: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  getUrl(key: string): string;
}

// ============================================
// 로컬 파일시스템 스토리지
// ============================================

class LocalStorage implements StorageProvider {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  async upload(key: string, data: Buffer, _contentType: string): Promise<string> {
    const filePath = path.join(this.baseDir, key);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, data);
    return key;
  }

  async download(key: string): Promise<Buffer> {
    const filePath = path.join(this.baseDir, key);
    return fs.readFile(filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = path.join(this.baseDir, key);
    try {
      await fs.unlink(filePath);
    } catch {
      // 파일이 없으면 무시
    }
  }

  getUrl(key: string): string {
    // Next.js [...path] 동적 라우트는 자동으로 URL 디코딩하므로 인코딩하지 않음
    // 보안: route.ts에서 "..", "/", "\\" 필터링 수행
    return `/api/files/${key}`;
  }
}

// ============================================
// S3 호환 스토리지 (placeholder)
// ============================================

class S3Storage implements StorageProvider {
  private bucket: string;
  private region: string;

  constructor(bucket: string, region: string) {
    this.bucket = bucket;
    this.region = region;
  }

  async upload(key: string, data: Buffer, contentType: string): Promise<string> {
    // TODO: AWS SDK v3 @aws-sdk/client-s3 사용
    // const client = new S3Client({ region: this.region });
    // await client.send(new PutObjectCommand({
    //   Bucket: this.bucket,
    //   Key: key,
    //   Body: data,
    //   ContentType: contentType,
    // }));
    throw new Error("S3 스토리지는 아직 구현되지 않았습니다. @aws-sdk/client-s3를 설치하세요.");
  }

  async download(key: string): Promise<Buffer> {
    throw new Error("S3 스토리지는 아직 구현되지 않았습니다.");
  }

  async delete(key: string): Promise<void> {
    throw new Error("S3 스토리지는 아직 구현되지 않았습니다.");
  }

  getUrl(key: string): string {
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
  }
}

// ============================================
// 팩토리
// ============================================

let storageInstance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (storageInstance) return storageInstance;

  const provider = process.env.STORAGE_PROVIDER || "local";

  if (provider === "s3") {
    const bucket = process.env.S3_BUCKET!;
    const region = process.env.S3_REGION!;
    storageInstance = new S3Storage(bucket, region);
  } else {
    const uploadDir = process.env.UPLOAD_DIR || "./uploads";
    storageInstance = new LocalStorage(uploadDir);
  }

  return storageInstance;
}

/**
 * 고유한 스토리지 키 생성
 */
export function generateStorageKey(
  prefix: string,
  originalFilename: string
): string {
  const ext = path.extname(originalFilename);
  const id = nanoid(12);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
  return `${prefix}/${date}/${id}${ext}`;
}
