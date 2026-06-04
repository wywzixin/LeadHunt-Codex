ALTER TABLE "send_logs" ADD COLUMN "recipient_email" TEXT;
ALTER TABLE "send_logs" ADD COLUMN "reply_to" TEXT;
ALTER TABLE "send_logs" ADD COLUMN "scheduled_at" TIMESTAMP(3);
ALTER TABLE "send_logs" ADD COLUMN "last_error" TEXT;

CREATE INDEX "send_logs_status_scheduled_at_idx" ON "send_logs"("status", "scheduled_at");
