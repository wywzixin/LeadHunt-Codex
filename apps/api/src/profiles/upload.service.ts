import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { z } from "zod";

const maxUploadBytes = 20 * 1024 * 1024;

const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(160),
  contentType: z.string().trim().min(3).max(120),
  size: z.number().int().min(0).max(maxUploadBytes),
  contentBase64: z.string().optional()
});

@Injectable()
export class UploadService {
  async save(userId: string | null, input: unknown) {
    if (!userId) {
      throw new UnauthorizedException("Authentication required");
    }

    const parsed = uploadSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException("Invalid upload payload");
    }

    const data = parsed.data;
    const buffer = data.contentBase64 ? Buffer.from(data.contentBase64, "base64") : Buffer.alloc(0);
    if (buffer.length !== data.size) {
      throw new BadRequestException("Upload size does not match content");
    }

    const uploadId = randomUUID();
    const safeName = sanitizeFileName(data.fileName);
    const relativePath = path.posix.join("uploads", userId, `${uploadId}-${safeName}`);
    const absolutePath = path.join(getUploadRoot(), userId, `${uploadId}-${safeName}`);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);

    return {
      ok: true,
      file: {
        id: uploadId,
        fileName: data.fileName,
        contentType: data.contentType,
        size: data.size,
        url: `/${relativePath}`
      }
    };
  }
}

function getUploadRoot() {
  return process.env.UPLOAD_DIR ?? path.resolve(process.cwd(), "../../runtime/uploads");
}

function sanitizeFileName(fileName: string) {
  const baseName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
  return baseName.slice(0, 120) || "upload.bin";
}
