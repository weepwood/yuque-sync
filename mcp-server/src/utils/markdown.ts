import type { ImageDocumentInput } from "../types.js";

function scalar(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "未记录";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `\`${JSON.stringify(value)}\``;
}

function safeAlt(value: string): string {
  return value.replace(/[\[\]\n\r]/g, " ").trim();
}

function formatDate(timezone: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

export function buildImageDocument(input: ImageDocumentInput): string {
  const lines = [`# ${input.title}`, "", `![${safeAlt(input.title)}](${input.imageUrl})`, ""];
  if (input.description?.trim()) lines.push("## 作品说明", "", input.description.trim(), "");
  lines.push(
    "## 原始提示词", "", input.prompt?.trim() || "未记录", "",
    "## 实际生成提示词", "", input.generatedPrompt?.trim() || "未记录", "",
    "## 元数据", "",
    `- 分类：${input.category?.trim() || "未分类"}`,
    `- 标签：${input.tags?.length ? input.tags.join("、") : "无"}`,
    `- 来源：${input.source?.trim() || "ChatGPT"}`,
    `- 文件名：${input.sourceFileName || "未知"}`,
    `- MIME：${input.sourceMimeType || "未知"}`,
    `- ChatGPT 文件 ID：${input.sourceFileId || "未知"}`,
    `- 创建时间：${formatDate(input.timezone)}`,
    `- 语雀图片地址：${input.imageUrl}`,
  );
  if (input.metadata && Object.keys(input.metadata).length > 0) {
    lines.push("", "## 扩展元数据", "");
    for (const [key, value] of Object.entries(input.metadata)) lines.push(`- ${key}：${scalar(value)}`);
  }
  return `${lines.join("\n")}\n`;
}
