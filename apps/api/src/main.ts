import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { loadEnv } from "./config/load-env.js";

loadEnv();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
  const port = Number(process.env.API_PORT ?? 4000);

  app.enableCors({
    origin: frontendUrl,
    credentials: true
  });

  await app.listen(port);
}

void bootstrap();
