import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required");
    }

    super({
      adapter: new PrismaPg(databaseUrl)
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
