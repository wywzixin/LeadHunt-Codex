export type AddressStatus = "unchecked" | "valid" | "warning";
export type MailingStatus = "draft" | "ready" | "queued" | "completed";

export type PostcardRecipient = {
  id: string;
  companyName: string;
  contactName: string;
  country: string;
  city: string;
  addressLine1: string;
  addressLine2?: string;
  postalCode: string;
  phone?: string;
  website?: string;
  addressStatus: AddressStatus;
};

export type PostcardTemplate = {
  id: string;
  name: string;
  format: string;
  product: string;
  frontTitle: string;
  backTitle: string;
  tone: string;
};

export type PostcardMailingTask = {
  id: string;
  userId: string;
  taskName: string;
  product: string;
  templateId: string;
  templateName: string;
  recipientCount: number;
  countries: string[];
  amountUsd: number;
  status: MailingStatus;
  providerMode: "sandbox" | "real";
  providerMessageId?: string;
  createdAt: string;
  executedAt?: string;
};
