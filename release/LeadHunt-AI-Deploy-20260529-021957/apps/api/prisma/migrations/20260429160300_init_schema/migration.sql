-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "status" TEXT NOT NULL DEFAULT 'active',
    "email_verified_at" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "website_url" TEXT NOT NULL,
    "product_page_url" TEXT,
    "document_urls" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target_regions" JSONB NOT NULL,
    "reference_customer_urls" JSONB NOT NULL,
    "crm_sample_ids" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gmail_accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "gmail_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_tasks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'semi_managed',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "target_count" INTEGER NOT NULL DEFAULT 50,
    "input_payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_steps" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "node_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input" JSONB,
    "output" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_queries" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'brave',
    "operator_source" TEXT,
    "execution_status" TEXT NOT NULL DEFAULT 'pending',
    "operator_name" TEXT,
    "strategy_template" TEXT,
    "query" TEXT NOT NULL,
    "keyword_groups" JSONB,
    "country" TEXT,
    "result_count" INTEGER NOT NULL DEFAULT 0,
    "qualified_count" INTEGER NOT NULL DEFAULT 0,
    "effectiveness_score" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_results" (
    "id" UUID NOT NULL,
    "query_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "snippet" TEXT,
    "domain" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_candidates" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "company_name" TEXT NOT NULL,
    "website" TEXT,
    "country" TEXT,
    "source_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_contacts" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icp_scores" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "grade" TEXT NOT NULL,
    "reasons" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "icp_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outreach_drafts" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outreach_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "send_logs" (
    "id" UUID NOT NULL,
    "draft_id" UUID NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider_message_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "send_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement_events" (
    "id" UUID NOT NULL,
    "send_log_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "metadata" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_threads" (
    "id" UUID NOT NULL,
    "draft_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gmail',
    "thread_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbox_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_messages" (
    "id" UUID NOT NULL,
    "thread_id" UUID NOT NULL,
    "from_email" TEXT NOT NULL,
    "subject" TEXT,
    "body_preview" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reply_classifications" (
    "id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "intent" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL,
    "extracted_needs" JSONB,
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reply_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "followup_tasks" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "due_at" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "followup_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_stage_events" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "from_stage" TEXT,
    "to_stage" TEXT NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_stage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_analytics" (
    "id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "dimension" TEXT NOT NULL,
    "dimension_value" TEXT NOT NULL,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "reply_count" INTEGER NOT NULL DEFAULT 0,
    "qualified_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_leads" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "tags" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "product_profiles_user_id_key" ON "product_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_profiles_user_id_key" ON "customer_profiles"("user_id");

-- CreateIndex
CREATE INDEX "auth_accounts_user_id_idx" ON "auth_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "auth_accounts_provider_provider_user_id_key" ON "auth_accounts"("provider", "provider_user_id");

-- CreateIndex
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions"("user_id");

-- CreateIndex
CREATE INDEX "user_sessions_refresh_token_hash_idx" ON "user_sessions"("refresh_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- CreateIndex
CREATE INDEX "gmail_accounts_user_id_idx" ON "gmail_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "gmail_accounts_user_id_email_key" ON "gmail_accounts"("user_id", "email");

-- CreateIndex
CREATE INDEX "lead_tasks_user_id_status_idx" ON "lead_tasks"("user_id", "status");

-- CreateIndex
CREATE INDEX "agent_steps_task_id_node_name_idx" ON "agent_steps"("task_id", "node_name");

-- CreateIndex
CREATE INDEX "search_queries_task_id_execution_status_idx" ON "search_queries"("task_id", "execution_status");

-- CreateIndex
CREATE INDEX "search_results_query_id_idx" ON "search_results"("query_id");

-- CreateIndex
CREATE INDEX "search_results_domain_idx" ON "search_results"("domain");

-- CreateIndex
CREATE INDEX "lead_candidates_task_id_status_idx" ON "lead_candidates"("task_id", "status");

-- CreateIndex
CREATE INDEX "lead_candidates_company_name_idx" ON "lead_candidates"("company_name");

-- CreateIndex
CREATE INDEX "lead_contacts_lead_id_idx" ON "lead_contacts"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_contacts_lead_id_type_value_key" ON "lead_contacts"("lead_id", "type", "value");

-- CreateIndex
CREATE UNIQUE INDEX "icp_scores_lead_id_key" ON "icp_scores"("lead_id");

-- CreateIndex
CREATE INDEX "outreach_drafts_lead_id_status_idx" ON "outreach_drafts"("lead_id", "status");

-- CreateIndex
CREATE INDEX "send_logs_draft_id_status_idx" ON "send_logs"("draft_id", "status");

-- CreateIndex
CREATE INDEX "engagement_events_send_log_id_event_type_idx" ON "engagement_events"("send_log_id", "event_type");

-- CreateIndex
CREATE INDEX "inbox_threads_draft_id_idx" ON "inbox_threads"("draft_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_threads_provider_thread_id_key" ON "inbox_threads"("provider", "thread_id");

-- CreateIndex
CREATE INDEX "inbound_messages_thread_id_received_at_idx" ON "inbound_messages"("thread_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "reply_classifications_message_id_key" ON "reply_classifications"("message_id");

-- CreateIndex
CREATE INDEX "followup_tasks_lead_id_status_idx" ON "followup_tasks"("lead_id", "status");

-- CreateIndex
CREATE INDEX "followup_tasks_due_at_idx" ON "followup_tasks"("due_at");

-- CreateIndex
CREATE INDEX "lead_stage_events_lead_id_created_at_idx" ON "lead_stage_events"("lead_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_analytics_task_id_dimension_dimension_value_key" ON "campaign_analytics"("task_id", "dimension", "dimension_value");

-- CreateIndex
CREATE UNIQUE INDEX "crm_leads_lead_id_key" ON "crm_leads"("lead_id");

-- CreateIndex
CREATE INDEX "crm_leads_stage_idx" ON "crm_leads"("stage");

-- AddForeignKey
ALTER TABLE "product_profiles" ADD CONSTRAINT "product_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gmail_accounts" ADD CONSTRAINT "gmail_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_tasks" ADD CONSTRAINT "lead_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "lead_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_queries" ADD CONSTRAINT "search_queries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "lead_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_results" ADD CONSTRAINT "search_results_query_id_fkey" FOREIGN KEY ("query_id") REFERENCES "search_queries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_candidates" ADD CONSTRAINT "lead_candidates_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "lead_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_contacts" ADD CONSTRAINT "lead_contacts_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "lead_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icp_scores" ADD CONSTRAINT "icp_scores_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "lead_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "lead_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_logs" ADD CONSTRAINT "send_logs_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "outreach_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_events" ADD CONSTRAINT "engagement_events_send_log_id_fkey" FOREIGN KEY ("send_log_id") REFERENCES "send_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_threads" ADD CONSTRAINT "inbox_threads_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "outreach_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "inbox_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reply_classifications" ADD CONSTRAINT "reply_classifications_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "inbound_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "followup_tasks" ADD CONSTRAINT "followup_tasks_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "lead_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_stage_events" ADD CONSTRAINT "lead_stage_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "lead_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_analytics" ADD CONSTRAINT "campaign_analytics_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "lead_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "lead_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
