import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CustomerProfileController } from "./customer-profile.controller.js";
import { CustomerProfileService } from "./customer-profile.service.js";
import { ProductProfileController } from "./product-profile.controller.js";
import { ProductProfileService } from "./product-profile.service.js";
import { UploadController } from "./upload.controller.js";
import { UploadService } from "./upload.service.js";

@Module({
  imports: [AuthModule],
  controllers: [ProductProfileController, CustomerProfileController, UploadController],
  providers: [ProductProfileService, CustomerProfileService, UploadService],
  exports: [ProductProfileService, CustomerProfileService, UploadService]
})
export class ProfilesModule {}
