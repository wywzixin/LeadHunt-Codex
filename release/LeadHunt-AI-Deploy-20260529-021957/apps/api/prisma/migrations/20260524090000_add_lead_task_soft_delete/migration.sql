ALTER TABLE "lead_tasks" ADD COLUMN "deleted_at" TIMESTAMP(3);

CREATE INDEX "lead_tasks_user_id_deleted_at_idx" ON "lead_tasks"("user_id", "deleted_at");
