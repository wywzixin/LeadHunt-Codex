import { BadRequestException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service.js";
import { defaultCustomerProfile } from "./default-profiles.js";

const profileNotesMaxLength = 800;

const customerProfileSchema = z.object({
  targetRegions: z.array(z.string().trim().min(1)).min(1),
  referenceCustomerUrls: z.array(z.string().url()).min(1),
  crmSampleIds: z.array(z.string().trim().min(1)).optional(),
  notes: z.string().max(profileNotesMaxLength).optional()
});

@Injectable()
export class CustomerProfileService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async get(userId: string | null) {
    if (!userId) {
      throw new UnauthorizedException("Authentication required");
    }

    const profile = await this.prisma.customerProfile.findUnique({
      where: { userId }
    });
    if (profile) {
      return profile;
    }

    return this.prisma.customerProfile.create({
      data: {
        userId,
        ...defaultCustomerProfile
      }
    });
  }

  async save(userId: string | null, input: unknown) {
    if (!userId) {
      throw new UnauthorizedException("Authentication required");
    }

    const parsed = customerProfileSchema.safeParse(input);
    if (!parsed.success) {
      throw new BadRequestException("Invalid customer profile");
    }

    const data = {
      targetRegions: parsed.data.targetRegions,
      referenceCustomerUrls: parsed.data.referenceCustomerUrls,
      crmSampleIds: parsed.data.crmSampleIds ?? [],
      notes: parsed.data.notes?.trim() || null
    };

    return this.prisma.customerProfile.upsert({
      where: { userId },
      create: {
        userId,
        ...data
      },
      update: data
    });
  }
}
