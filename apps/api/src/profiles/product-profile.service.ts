import { BadRequestException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service.js";
import { defaultProductProfile } from "./default-profiles.js";

const profileNotesMaxLength = 800;

const productProfileSchema = z.object({
  websiteUrl: z.string().url(),
  productPageUrl: z.string().url().optional().or(z.literal("")),
  documentUrls: z.array(z.string().url()).optional(),
  notes: z.string().max(profileNotesMaxLength).optional()
});

@Injectable()
export class ProductProfileService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get(userId: string | null) {
    if (!userId) {
      throw new UnauthorizedException("Authentication required");
    }

    const profile = await this.prisma.productProfile.findUnique({
      where: { userId }
    });
    if (profile) {
      return profile;
    }

    return this.prisma.productProfile.create({
      data: {
        userId,
        ...defaultProductProfile
      }
    });
  }

  async save(userId: string | null, input: unknown) {
    if (!userId) {
      throw new UnauthorizedException("Authentication required");
    }

    const parsed = productProfileSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException("Invalid product profile");
    }

    const data = {
      websiteUrl: parsed.data.websiteUrl,
      productPageUrl: parsed.data.productPageUrl || null,
      documentUrls: parsed.data.documentUrls ?? [],
      notes: parsed.data.notes?.trim() || null
    };

    return this.prisma.productProfile.upsert({
      where: { userId },
      create: {
        userId,
        ...data
      },
      update: data
    });
  }
}
