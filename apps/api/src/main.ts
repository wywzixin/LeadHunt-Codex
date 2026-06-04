import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { loadEnv } from "./config/load-env.js";

loadEnv();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const frontendUrls = [
    ...(process.env.FRONTEND_URLS ?? "").split(","),
    ...(process.env.FRONTEND_URL ?? "").split(","),
    ...(process.env.NODE_ENV === "production"
      ? []
      : [
          "http://localhost:3000",
          "http://localhost:3100",
          "http://127.0.0.1:3000",
          "http://127.0.0.1:3100"
        ])
  ]
    .map((url) => url.trim().replace(/\/+$/, ""))
    .filter(Boolean)
    .filter((url, index, urls) => urls.indexOf(url) === index);
  const port = Number(process.env.API_PORT ?? 4000);

  app.enableCors({
    origin: frontendUrls,
    credentials: true
  });

  await app.listen(port);
}

void bootstrap();
