import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import type { ChatMessage } from "./gpt55.client.js";
import { Gpt55Client } from "./gpt55.client.js";
import {
  customerProfileAnalysisSchema,
  icpScoreSchema,
  keywordExpansionSchema,
  outreachEmailSchema,
  productProfileAnalysisSchema,
  replyClassificationSchema,
  rewriteEmailSchema,
  searchStrategyPlanSchema,
  taskSummarySchema
} from "./leadhunt-ai.schemas.js";
import type {
  CustomerProfileAnalysis,
  IcpScoreResult,
  KeywordExpansionResult,
  OutreachEmailResult,
  ProductProfileAnalysis,
  ReplyClassificationResult,
  RewriteEmailResult,
  SearchStrategyPlan,
  TaskSummaryResult
} from "./leadhunt-ai.schemas.js";
import {
  buildJsonPrompt,
  leadHuntPromptTemplates,
  leadHuntSystemPrompt
} from "./leadhunt-ai.prompts.js";
import type { LeadHuntPromptTemplate } from "./leadhunt-ai.prompts.js";

export type ProductProfileAnalysisInput = {
  websiteUrl: string;
  productPageUrl?: string | null;
  documentUrls?: string[];
  notes?: string | null;
};

export type CustomerProfileAnalysisInput = {
  targetRegions: string[];
  referenceCustomerUrls: string[];
  crmSampleIds?: string[];
  notes?: string | null;
};

export type KeywordExpansionInput = {
  userTask: string;
  productProfile?: ProductProfileAnalysis | ProductProfileAnalysisInput;
  customerProfile?: CustomerProfileAnalysis | CustomerProfileAnalysisInput;
};

export type SearchStrategyInput = {
  keywordGroups: KeywordExpansionResult;
  targetMarkets: string[];
  operatorLibrary: unknown;
  minQueryCount?: number;
};

export type IcpScoreInput = {
  candidate: {
    companyName: string;
    websiteUrl: string;
    country?: string;
    title?: string;
    snippet?: string;
    sourceUrl?: string;
    contacts?: {
      emails?: string[];
      phones?: string[];
      socialProfiles?: string[];
    };
  };
  productProfile: ProductProfileAnalysis | ProductProfileAnalysisInput;
  customerProfile: CustomerProfileAnalysis | CustomerProfileAnalysisInput;
};

export type OutreachEmailInput = {
  candidate: IcpScoreInput["candidate"];
  productProfile: ProductProfileAnalysis | ProductProfileAnalysisInput;
  icpScore: IcpScoreResult;
  language?: string;
  tone?: string;
};

export type RewriteEmailInput = {
  subject?: string;
  body: string;
  outputLanguage: string;
  tone: string;
  instruction: string;
};

export type ReplyClassificationInput = {
  subject?: string;
  body: string;
  sender?: string;
};

export type TaskSummaryInput = {
  taskTitle: string;
  steps: Array<{ name: string; status: string; summary?: string }>;
  foundCompanies: number;
  qualifiedCompanies: number;
  notes?: string;
};

export class Gpt55OutputValidationError extends Error {
  constructor(message: string) {
    super(message);
  }
}

@Injectable()
export class LeadHuntAiService {
  constructor(@Inject(Gpt55Client) private readonly chatClient: Gpt55Client) {}

  analyzeProductProfile(input: ProductProfileAnalysisInput): Promise<ProductProfileAnalysis> {
    return this.completeJson(
      leadHuntPromptTemplates.productProfileAnalysis,
      input,
      productProfileAnalysisSchema
    );
  }

  analyzeCustomerProfile(input: CustomerProfileAnalysisInput): Promise<CustomerProfileAnalysis> {
    return this.completeJson(
      leadHuntPromptTemplates.customerProfileAnalysis,
      input,
      customerProfileAnalysisSchema
    );
  }

  expandKeywords(input: KeywordExpansionInput): Promise<KeywordExpansionResult> {
    return this.completeJson(
      leadHuntPromptTemplates.keywordExpansion,
      input,
      keywordExpansionSchema
    );
  }

  generateSearchStrategy(input: SearchStrategyInput): Promise<SearchStrategyPlan> {
    return this.completeJson(
      leadHuntPromptTemplates.searchStrategyGeneration,
      input,
      searchStrategyPlanSchema,
      4096
    );
  }

  scoreIcp(input: IcpScoreInput): Promise<IcpScoreResult> {
    return this.completeJson(leadHuntPromptTemplates.icpScoring, input, icpScoreSchema);
  }

  generateOutreachEmail(input: OutreachEmailInput): Promise<OutreachEmailResult> {
    return this.completeJson(
      leadHuntPromptTemplates.outreachEmailGeneration,
      input,
      outreachEmailSchema
    );
  }

  rewriteEmail(input: RewriteEmailInput): Promise<RewriteEmailResult> {
    return this.completeJson(leadHuntPromptTemplates.emailRewrite, input, rewriteEmailSchema);
  }

  classifyReply(input: ReplyClassificationInput): Promise<ReplyClassificationResult> {
    return this.completeJson(
      leadHuntPromptTemplates.replyClassification,
      input,
      replyClassificationSchema
    );
  }

  summarizeTask(input: TaskSummaryInput): Promise<TaskSummaryResult> {
    return this.completeJson(leadHuntPromptTemplates.taskSummary, input, taskSummarySchema);
  }

  private async completeJson<T>(
    template: LeadHuntPromptTemplate,
    input: unknown,
    schema: z.ZodType<T>,
    maxTokens = 2048
  ) {
    const baseMessages: ChatMessage[] = [
      { role: "system", content: leadHuntSystemPrompt },
      { role: "user", content: buildJsonPrompt(template, input) }
    ];
    let messages = baseMessages;
    let lastError = "Unknown validation error";

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const content = await this.chatClient.complete(messages, {
        responseFormat: "json_object",
        temperature: 0.1,
        maxTokens
      });
      const parsed = safeParseModelJson(content);
      const result = parsed.ok ? schema.safeParse(parsed.value) : parsed;

      if (result.success) {
        return result.data;
      }

      lastError = formatValidationError(result.error);
      messages = [
        ...baseMessages,
        {
          role: "user",
          content: [
            "The previous response failed JSON validation.",
            `Validation issue: ${lastError}`,
            "Return corrected JSON only, with the exact required keys and no Markdown."
          ].join("\n")
        }
      ];
    }

    throw new Gpt55OutputValidationError(`GPT-5.5 returned invalid JSON: ${lastError}`);
  }
}

type JsonParseResult =
  | { ok: true; success: true; value: unknown; data: unknown }
  | { ok: false; success: false; error: Error };

export function safeParseModelJson(content: string): JsonParseResult {
  const candidates = [stripCodeFence(content), extractJsonBlock(content)].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const data = JSON.parse(candidate ?? "");
      return { ok: true, success: true, value: data, data };
    } catch {
      continue;
    }
  }

  return {
    ok: false,
    success: false,
    error: new Error("Response was not valid JSON.")
  };
}

function stripCodeFence(content: string) {
  return content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJsonBlock(content: string) {
  const objectStart = content.indexOf("{");
  const arrayStart = content.indexOf("[");
  const starts = [objectStart, arrayStart].filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;

  if (start < 0) {
    return "";
  }

  const objectEnd = content.lastIndexOf("}");
  const arrayEnd = content.lastIndexOf("]");
  const end = Math.max(objectEnd, arrayEnd);

  return end > start ? content.slice(start, end + 1).trim() : "";
}

function formatValidationError(error: unknown) {
  if (error instanceof z.ZodError) {
    return error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
