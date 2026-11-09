import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { IBlobStore } from "@weaveforge/core";
import type { ColdFields, R2Fields } from "@weaveforge/wasm";
import { readyCore } from "@/lib/rust-core";

export interface S3BlobStoreConfig {
  /** Physical S3/R2 bucket name. */
  physicalBucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Custom endpoint (R2, MinIO). Omit for AWS S3. */
  endpoint?: string;
  /** Required for MinIO and most R2 setups. Default true when endpoint is set. */
  forcePathStyle?: boolean;
}

/** Build an S3 client for Cloudflare R2 or OCI MinIO. */
function createS3Client(config: Omit<S3BlobStoreConfig, "physicalBucket">): S3Client {
  const clientConfig: S3ClientConfig = {
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  };
  if (config.endpoint) {
    clientConfig.endpoint = config.endpoint;
    clientConfig.forcePathStyle = config.forcePathStyle ?? true;
  }
  return new S3Client(clientConfig);
}

/** S3-compatible blob store (R2 hot tier, MinIO cold tier). */
export class S3BlobStore implements IBlobStore {
  constructor(
    private readonly client: S3Client,
    private readonly physicalBucket: string,
  ) {}

  static fromConfig(config: S3BlobStoreConfig): S3BlobStore {
    const { physicalBucket, ...rest } = config;
    return new S3BlobStore(createS3Client(rest), physicalBucket);
  }

  /** Object key: logical bucket + path (e.g. paper-images/userId/...). */
  private objectKey(logicalBucket: string, path: string): string {
    return `${logicalBucket}/${path}`;
  }

  async upload(bucket: string, path: string, blob: Blob, contentType?: string): Promise<void> {
    const body = new Uint8Array(await blob.arrayBuffer());
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.physicalBucket,
        Key: this.objectKey(bucket, path),
        Body: body,
        ContentType: contentType ?? (blob.type || "application/octet-stream"),
      }),
    );
  }

  async remove(bucket: string, path: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.physicalBucket,
        Key: this.objectKey(bucket, path),
      }),
    );
  }

  async signedUrls(
    bucket: string,
    paths: string[],
    ttlSeconds: number,
  ): Promise<(string | null)[]> {
    return Promise.all(
      paths.map(async (path) => {
        // Presigning is local work. Whether the object exists is the
        // registry's answer (TieredBlobStore), not a GET per path (10-02).
        try {
          return await getSignedUrl(
            this.client,
            new GetObjectCommand({
              Bucket: this.physicalBucket,
              Key: this.objectKey(bucket, path),
            }),
            { expiresIn: ttlSeconds },
          );
        } catch {
          return null;
        }
      }),
    );
  }

  /** Stream object bytes (server-side proxy reads). */
  async readObject(
    bucket: string,
    path: string,
  ): Promise<{ stream: ReadableStream<Uint8Array>; contentType: string } | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.physicalBucket,
          Key: this.objectKey(bucket, path),
        }),
      );
      if (!res.Body) return null;
      return {
        stream: res.Body.transformToWebStream(),
        contentType: res.ContentType ?? "application/octet-stream",
      };
    } catch {
      return null;
    }
  }
}

/** R2 hot-tier client config (mapping lives in the Rust core, `storage::blob_client`). */
export function r2BlobConfig(fields: R2Fields): S3BlobStoreConfig | null {
  return readyCore().r2BlobClientConfig(fields) as S3BlobStoreConfig | null;
}

/** MinIO / OCI cold-tier client config (Rust core `storage::blob_client`). */
export function coldBlobConfig(fields: ColdFields): S3BlobStoreConfig | null {
  return readyCore().coldBlobClientConfig(fields) as S3BlobStoreConfig | null;
}

/** Error naming the unset R2 env vars (names only, never values). */
export function missingR2ConfigError(fields: R2Fields): Error {
  return new Error(readyCore().missingR2ConfigMessage(fields));
}
