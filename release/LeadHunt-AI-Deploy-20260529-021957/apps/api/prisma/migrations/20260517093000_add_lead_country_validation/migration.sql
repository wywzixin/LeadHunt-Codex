ALTER TABLE "lead_candidates"
  ADD COLUMN "query_country" TEXT,
  ADD COLUMN "inferred_country" TEXT,
  ADD COLUMN "country_evidence" JSONB,
  ADD COLUMN "country_confidence" TEXT,
  ADD COLUMN "country_conflict" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "lead_candidates_country_confidence_idx"
  ON "lead_candidates"("country_confidence");
