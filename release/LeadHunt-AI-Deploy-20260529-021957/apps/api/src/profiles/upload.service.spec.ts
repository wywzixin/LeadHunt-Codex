import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploadService } from "./upload.service.js";

describe("UploadService", () => {
  let uploadDir: string;
  let service: UploadService;

  beforeEach(async () => {
    uploadDir = await mkdtemp(path.join(os.tmpdir(), "leadhunt-upload-test-"));
    vi.stubEnv("UPLOAD_DIR", uploadDir);
    service = new UploadService();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(uploadDir, { recursive: true, force: true });
  });

  it("requires authentication", async () => {
    await expect(
      service.save(null, {
        fileName: "catalog.pdf",
        contentType: "application/pdf",
        size: 0,
        contentBase64: ""
      })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("stores a base64 upload under the current user directory", async () => {
    const content = Buffer.from("telecom catalog");

    const result = await service.save("user-1", {
      fileName: "../catalog 2026.pdf",
      contentType: "application/pdf",
      size: content.length,
      contentBase64: content.toString("base64")
    });

    expect(result.ok).toBe(true);
    expect(result.file.fileName).toBe("../catalog 2026.pdf");
    expect(result.file.url).toMatch(/^\/uploads\/user-1\/[a-f0-9-]+-catalog_2026\.pdf$/);

    const diskPath = path.join(uploadDir, result.file.url.replace("/uploads/", ""));
    await expect(readFile(diskPath, "utf8")).resolves.toBe("telecom catalog");
  });

  it("rejects mismatched upload sizes", async () => {
    await expect(
      service.save("user-1", {
        fileName: "catalog.pdf",
        contentType: "application/pdf",
        size: 99,
        contentBase64: Buffer.from("small").toString("base64")
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
