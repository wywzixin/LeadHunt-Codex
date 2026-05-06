import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PostcardController } from "./postcard.controller.js";
import { PostcardService } from "./postcard.service.js";

@Module({
  imports: [AuthModule],
  controllers: [PostcardController],
  providers: [PostcardService]
})
export class PostcardModule {}
