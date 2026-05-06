import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { PostcardMailingTask, PostcardRecipient, PostcardTemplate } from "./postcard.types.js";

const sampleRecipients: PostcardRecipient[] = [
  {
    id: "recipient-emirates-tower-power",
    companyName: "Emirates Tower Power",
    contactName: "Procurement Manager",
    country: "UAE",
    city: "Dubai",
    addressLine1: "Office 1205, Business Bay",
    postalCode: "00000",
    phone: "+971 4 555 0188",
    website: "emiratestowerpower.ae",
    addressStatus: "unchecked"
  },
  {
    id: "recipient-gulf-telecom",
    companyName: "Gulf Telecom Supplies FZE",
    contactName: "Sourcing Team",
    country: "UAE",
    city: "Dubai",
    addressLine1: "Jebel Ali Free Zone, Warehouse 8",
    postalCode: "00000",
    phone: "+971 4 555 0126",
    website: "gulftelecom.ae",
    addressStatus: "unchecked"
  },
  {
    id: "recipient-riyadh-radio",
    companyName: "Riyadh Radio Parts",
    contactName: "Spare Parts Buyer",
    country: "Saudi Arabia",
    city: "Riyadh",
    addressLine1: "King Fahd Road, Telecom District",
    postalCode: "12212",
    phone: "+966 11 555 0188",
    website: "riyadhradio.sa",
    addressStatus: "unchecked"
  },
  {
    id: "recipient-metro-network",
    companyName: "Metro Network Systems",
    contactName: "Operations Director",
    country: "UAE",
    city: "Abu Dhabi",
    addressLine1: "Al Reem Island, Tower B",
    postalCode: "00000",
    website: "metronetwork.ae",
    addressStatus: "unchecked"
  }
];

const templates: PostcardTemplate[] = [
  {
    id: "telecom-spares-postcard",
    name: "通信备件明信片",
    format: "4x6 明信片",
    product: "RRU / BBU / AAU 备件",
    frontTitle: "Reliable telecom spare parts, ready to ship",
    backTitle: "Factory supply for RRU, BBU, rectifier and microwave parts",
    tone: "blue"
  },
  {
    id: "network-rollout-letter",
    name: "网络建设项目信件",
    format: "6x9 信件",
    product: "站点建设与替换件",
    frontTitle: "Support for network rollout and site maintenance",
    backTitle: "Send us your BOM, we will match stock and lead time",
    tone: "green"
  },
  {
    id: "tower-power-card",
    name: "塔站电源明信片",
    format: "6x11 明信片",
    product: "整流模块 / 电源系统",
    frontTitle: "Telecom power modules for urgent replacement",
    backTitle: "Huawei, ZTE, Eltek, Delta and compatible stock",
    tone: "amber"
  }
];

@Injectable()
export class PostcardService {
  private readonly tasks = new Map<string, PostcardMailingTask>();

  list(userId: string) {
    return {
      recipients: sampleRecipients,
      templates,
      tasks: this.userTasks(userId)
    };
  }

  validateAddresses(recipients: PostcardRecipient[]) {
    return {
      recipients: recipients.map((recipient) => ({
        ...recipient,
        addressStatus: isCompleteAddress(recipient) ? "valid" : "warning"
      }))
    };
  }

  createTask(
    userId: string,
    input: {
      taskName: string;
      product: string;
      countryGroup: string;
      templateId: string;
      recipients: PostcardRecipient[];
      realSend?: boolean;
    }
  ) {
    if (input.realSend) {
      throw new BadRequestException("真实寄送需要在执行步骤单独确认，不能在创建任务时直接触发。");
    }

    const template = templates.find((item) => item.id === input.templateId);
    if (!template) {
      throw new BadRequestException("未知明信片模板");
    }

    const invalidRecipients = input.recipients.filter((recipient) => recipient.addressStatus !== "valid");
    if (invalidRecipients.length) {
      throw new BadRequestException("请先完成地址检测，再提交邮寄任务。");
    }

    const task: PostcardMailingTask = {
      id: randomUUID(),
      userId,
      taskName: input.taskName,
      product: input.product,
      templateId: template.id,
      templateName: template.name,
      recipientCount: input.recipients.length,
      countries: unique(input.recipients.map((recipient) => recipient.country)),
      amountUsd: Number((input.recipients.length * 3.9).toFixed(2)),
      status: "ready",
      providerMode: "sandbox",
      createdAt: new Date().toISOString()
    };

    this.tasks.set(task.id, task);

    return { task };
  }

  async sendTask(userId: string, taskId: string, confirmRealSend = false) {
    const task = this.tasks.get(taskId);
    if (!task || task.userId !== userId) {
      throw new NotFoundException("邮寄任务不存在");
    }

    const realSendAvailable = isRealSendConfigured();
    if (confirmRealSend && !realSendAvailable) {
      throw new BadRequestException("未配置真实邮寄供应商，无法真实寄送明信片。");
    }

    const providerMode = confirmRealSend ? "real" : "sandbox";
    const providerMessageId = confirmRealSend ? await submitToConfiguredProvider(task) : `sandbox_postcard_${task.id.slice(0, 8)}`;
    const updated: PostcardMailingTask = {
      ...task,
      status: "completed",
      providerMode,
      providerMessageId,
      executedAt: new Date().toISOString()
    };

    this.tasks.set(updated.id, updated);

    return {
      task: updated,
      realSendAvailable
    };
  }

  private userTasks(userId: string) {
    return Array.from(this.tasks.values())
      .filter((task) => task.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
}

function isCompleteAddress(recipient: PostcardRecipient) {
  return Boolean(
    recipient.companyName.trim() &&
      recipient.contactName.trim() &&
      recipient.country.trim() &&
      recipient.city.trim() &&
      recipient.addressLine1.trim() &&
      recipient.postalCode.trim()
  );
}

function isRealSendConfigured() {
  return (
    process.env.POSTCARD_REAL_SEND_ENABLED === "true" &&
    Boolean(process.env.POSTCARD_PROVIDER_URL) &&
    Boolean(process.env.POSTCARD_PROVIDER_API_KEY)
  );
}

async function submitToConfiguredProvider(task: PostcardMailingTask) {
  const providerUrl = process.env.POSTCARD_PROVIDER_URL;
  const apiKey = process.env.POSTCARD_PROVIDER_API_KEY;
  if (!providerUrl || !apiKey) {
    throw new BadRequestException("未配置真实邮寄供应商。");
  }

  const response = await fetch(providerUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      taskId: task.id,
      taskName: task.taskName,
      product: task.product,
      templateId: task.templateId,
      recipientCount: task.recipientCount,
      countries: task.countries
    })
  });

  if (!response.ok) {
    throw new BadRequestException(`真实邮寄供应商调用失败：HTTP ${response.status}`);
  }

  const payload = (await response.json().catch(() => null)) as { id?: string; messageId?: string } | null;
  return payload?.messageId ?? payload?.id ?? `real_postcard_${task.id.slice(0, 8)}`;
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
