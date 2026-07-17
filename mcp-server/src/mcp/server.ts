import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { AppConfig } from "../config/env.js";
import type { AppLogger } from "../config/logger.js";
import type { OpenAIFileReference } from "../types.js";
import { getErrorMessage, publicErrorMessage } from "../utils/errors.js";
import { buildImageDocument } from "../utils/markdown.js";
import { downloadImage, type FetchLike } from "../services/image-download.js";
import { YuqueClient } from "../services/yuque.js";

const openAIFileSchema = z
  .object({
    download_url: z.string(),
    file_id: z.string(),
    mime_type: z.string().optional(),
    file_name: z.string().optional(),
  })
  .strict();

const repoIdSchema = z
  .string()
  .regex(/^[^/\s]+\/[^/\s]+$/, "Use namespace/repo format")
  .optional();

const jsonScalarSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
]);

const metadataSchema = z.record(z.string(), jsonScalarSchema).optional();

function textResult(text: string, structuredContent?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    ...(structuredContent ? { structuredContent } : {}),
  };
}

function toolError(error: unknown, logger: AppLogger, operation: string) {
  logger.error(
    {
      operation,
      error: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
    "MCP tool failed",
  );

  return {
    content: [{ type: "text" as const, text: publicErrorMessage(error) }],
    isError: true,
  };
}

export function createYuqueMcpServer(
  config: AppConfig,
  logger: AppLogger,
  fetchFn: FetchLike = fetch,
): McpServer {
  const server = new McpServer({
    name: "yuque-image-mcp",
    version: "1.0.0",
  });
  const yuque = new YuqueClient(config, logger, fetchFn);

  server.registerTool(
    "check_yuque_connection",
    {
      title: "检查语雀连接",
      description: "验证语雀 Token，并返回当前账号和默认知识库。不会修改语雀数据。",
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({
        login: z.string(),
        name: z.string(),
        default_repo: z.string(),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      _meta: {
        "openai/toolInvocation/invoking": "正在检查语雀连接…",
        "openai/toolInvocation/invoked": "语雀连接检查完成",
      },
    },
    async () => {
      try {
        const user = await yuque.checkToken();
        const output = {
          login: user.login,
          name: user.name,
          default_repo: config.yuqueRepo,
        };
        return textResult(
          `语雀 Token 有效，当前账号：${user.name}（${user.login}），默认知识库：${config.yuqueRepo}。`,
          output,
        );
      } catch (error) {
        return toolError(error, logger, "check_yuque_connection");
      }
    },
  );

  server.registerTool(
    "upload_yuque_image",
    {
      title: "上传图片到语雀",
      description: "将一张由用户提供或 ChatGPT 生成的图片上传到语雀，返回语雀托管图片地址。",
      inputSchema: z
        .object({
          image: openAIFileSchema,
        })
        .strict(),
      outputSchema: z.object({
        image_url: z.string(),
        file_name: z.string(),
        mime_type: z.string(),
        source_file_id: z.string(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: false,
      },
      _meta: {
        "openai/fileParams": ["image"],
        "openai/toolInvocation/invoking": "正在上传图片到语雀…",
        "openai/toolInvocation/invoked": "图片已上传到语雀",
      },
    },
    async ({ image }) => {
      try {
        const downloaded = await downloadImage(image as OpenAIFileReference, config, fetchFn);
        const uploaded = await yuque.uploadImage(downloaded);
        const output = {
          image_url: uploaded.url,
          file_name: downloaded.fileName,
          mime_type: downloaded.mimeType,
          source_file_id: downloaded.sourceFileId,
        };
        return textResult(`图片已上传到语雀：${uploaded.url}`, output);
      } catch (error) {
        return toolError(error, logger, "upload_yuque_image");
      }
    },
  );

  server.registerTool(
    "upload_yuque_images",
    {
      title: "批量上传图片到语雀",
      description: `批量上传图片到语雀，单次最多 ${config.maxBatchImages} 张，并返回每张图片的结果。`,
      inputSchema: z
        .object({
          images: z.array(openAIFileSchema).min(1).max(config.maxBatchImages),
        })
        .strict(),
      outputSchema: z.object({
        results: z.array(
          z.object({
            source_file_id: z.string(),
            success: z.boolean(),
            image_url: z.string().optional(),
            file_name: z.string().optional(),
            mime_type: z.string().optional(),
            error: z.string().optional(),
          }),
        ),
        success_count: z.number().int(),
        failure_count: z.number().int(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: false,
      },
      _meta: {
        "openai/fileParams": ["images"],
        "openai/toolInvocation/invoking": "正在批量上传图片到语雀…",
        "openai/toolInvocation/invoked": "批量图片上传完成",
      },
    },
    async ({ images }) => {
      const results: Array<{
        source_file_id: string;
        success: boolean;
        image_url?: string;
        file_name?: string;
        mime_type?: string;
        error?: string;
      }> = [];

      for (const image of images) {
        try {
          const downloaded = await downloadImage(image as OpenAIFileReference, config, fetchFn);
          const uploaded = await yuque.uploadImage(downloaded);
          results.push({
            source_file_id: downloaded.sourceFileId,
            success: true,
            image_url: uploaded.url,
            file_name: downloaded.fileName,
            mime_type: downloaded.mimeType,
          });
        } catch (error) {
          logger.warn(
            { operation: "upload_yuque_images", error: getErrorMessage(error) },
            "One batch image failed",
          );
          results.push({
            source_file_id: image.file_id,
            success: false,
            error: publicErrorMessage(error),
          });
        }
      }

      const successCount = results.filter((result) => result.success).length;
      const output = {
        results,
        success_count: successCount,
        failure_count: results.length - successCount,
      };
      return textResult(
        `批量上传完成：成功 ${output.success_count} 张，失败 ${output.failure_count} 张。`,
        output,
      );
    },
  );

  server.registerTool(
    "create_yuque_image_document",
    {
      title: "创建语雀图片文档",
      description: "使用已有图片地址，在语雀知识库中创建或更新包含提示词和元数据的 Markdown 文档。",
      inputSchema: z
        .object({
          title: z.string().min(1).max(200),
          image_url: z.string().url(),
          prompt: z.string().optional(),
          generated_prompt: z.string().optional(),
          description: z.string().optional(),
          category: z.string().optional(),
          tags: z.array(z.string()).max(30).optional(),
          source: z.string().optional(),
          metadata: metadataSchema,
          repo_id: repoIdSchema,
          document_slug: z.string().min(1).max(200).optional(),
          add_to_toc: z.boolean().default(true),
          public: z.boolean().default(false),
        })
        .strict(),
      outputSchema: z.object({
        document_id: z.number().int(),
        document_slug: z.string(),
        document_url: z.string(),
        image_url: z.string(),
        updated: z.boolean(),
        toc_added: z.boolean(),
        warning: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: false,
      },
      _meta: {
        "openai/toolInvocation/invoking": "正在创建语雀图片文档…",
        "openai/toolInvocation/invoked": "语雀图片文档已保存",
      },
    },
    async (input) => {
      try {
        const body = buildImageDocument({
          title: input.title,
          imageUrl: input.image_url,
          prompt: input.prompt,
          generatedPrompt: input.generated_prompt,
          description: input.description,
          category: input.category,
          tags: input.tags,
          source: input.source,
          metadata: input.metadata,
          timezone: config.documentTimezone,
        });

        const document = await yuque.createOrUpdateDocument({
          repoId: input.repo_id,
          title: input.title,
          body,
          slug: input.document_slug,
          isPublic: input.public,
        });

        let tocAdded = false;
        let warning: string | undefined;
        if (!document.updated && input.add_to_toc) {
          try {
            await yuque.addDocumentToToc(input.repo_id, document.id);
            tocAdded = true;
          } catch (error) {
            warning = publicErrorMessage(error);
            logger.warn(
              { operation: "add_document_to_toc", error: getErrorMessage(error) },
              "Document created but TOC update failed",
            );
          }
        }

        const output = {
          document_id: document.id,
          document_slug: document.slug,
          document_url: document.url,
          image_url: input.image_url,
          updated: document.updated,
          toc_added: tocAdded,
          ...(warning ? { warning } : {}),
        };
        return textResult(
          `${document.updated ? "语雀文档已更新" : "语雀文档已创建"}：${document.url}${warning ? `\n注意：${warning}` : ""}`,
          output,
        );
      } catch (error) {
        return toolError(error, logger, "create_yuque_image_document");
      }
    },
  );

  server.registerTool(
    "save_image_to_yuque",
    {
      title: "保存图片和创作记录到语雀",
      description: "一步完成：下载 ChatGPT 图片、上传到语雀，并创建或更新包含原始提示词、实际生成提示词和元数据的语雀文档。",
      inputSchema: z
        .object({
          image: openAIFileSchema,
          title: z.string().min(1).max(200),
          prompt: z.string().optional(),
          generated_prompt: z.string().optional(),
          description: z.string().optional(),
          category: z.string().optional(),
          tags: z.array(z.string()).max(30).optional(),
          source: z.string().default("ChatGPT"),
          metadata: metadataSchema,
          repo_id: repoIdSchema,
          document_slug: z.string().min(1).max(200).optional(),
          add_to_toc: z.boolean().default(true),
          public: z.boolean().default(false),
        })
        .strict(),
      outputSchema: z.object({
        image_url: z.string(),
        document_id: z.number().int(),
        document_slug: z.string(),
        document_url: z.string(),
        updated: z.boolean(),
        toc_added: z.boolean(),
        warning: z.string().optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
        idempotentHint: false,
      },
      _meta: {
        "openai/fileParams": ["image"],
        "openai/toolInvocation/invoking": "正在保存图片和创作记录到语雀…",
        "openai/toolInvocation/invoked": "图片和创作记录已保存到语雀",
      },
    },
    async (input) => {
      try {
        const downloaded = await downloadImage(
          input.image as OpenAIFileReference,
          config,
          fetchFn,
        );
        const uploaded = await yuque.uploadImage(downloaded);
        const body = buildImageDocument({
          title: input.title,
          imageUrl: uploaded.url,
          prompt: input.prompt,
          generatedPrompt: input.generated_prompt,
          description: input.description,
          category: input.category,
          tags: input.tags,
          source: input.source,
          sourceFileName: downloaded.fileName,
          sourceMimeType: downloaded.mimeType,
          sourceFileId: downloaded.sourceFileId,
          metadata: input.metadata,
          timezone: config.documentTimezone,
        });

        const document = await yuque.createOrUpdateDocument({
          repoId: input.repo_id,
          title: input.title,
          body,
          slug: input.document_slug,
          isPublic: input.public,
        });

        let tocAdded = false;
        let warning: string | undefined;
        if (!document.updated && input.add_to_toc) {
          try {
            await yuque.addDocumentToToc(input.repo_id, document.id);
            tocAdded = true;
          } catch (error) {
            warning = publicErrorMessage(error);
            logger.warn(
              { operation: "save_image_to_yuque_toc", error: getErrorMessage(error) },
              "Image and document saved but TOC update failed",
            );
          }
        }

        const output = {
          image_url: uploaded.url,
          document_id: document.id,
          document_slug: document.slug,
          document_url: document.url,
          updated: document.updated,
          toc_added: tocAdded,
          ...(warning ? { warning } : {}),
        };

        return textResult(
          [
            "图片和创作记录已保存到语雀。",
            `图片：${uploaded.url}`,
            `文档：${document.url}`,
            ...(warning ? [`注意：${warning}`] : []),
          ].join("\n"),
          output,
        );
      } catch (error) {
        return toolError(error, logger, "save_image_to_yuque");
      }
    },
  );

  return server;
}
