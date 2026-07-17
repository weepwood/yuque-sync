import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import net from "node:net";
import { AppError } from "./errors.js";

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().split("%", 1)[0] ?? ip.toLowerCase();
  return normalized === "::" || normalized === "::1" ||
    normalized.startsWith("fc") || normalized.startsWith("fd") ||
    normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
    normalized.startsWith("fea") || normalized.startsWith("feb") ||
    normalized.startsWith("ff") || normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.");
}

function isPrivateIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true;
}

export async function assertSafeDownloadUrl(input: string, allowedHosts: string[]): Promise<URL> {
  let url: URL;
  try { url = new URL(input); } catch {
    throw new AppError("图片下载地址无效。", "INVALID_DOWNLOAD_URL", 400);
  }
  if (url.protocol !== "https:") {
    throw new AppError("图片下载地址必须使用 HTTPS。", "INSECURE_DOWNLOAD_URL", 400);
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new AppError("不允许访问本机地址。", "BLOCKED_DOWNLOAD_HOST", 400);
  }
  if (allowedHosts.length > 0 && !allowedHosts.includes(hostname)) {
    throw new AppError(`图片下载域名不在允许列表中：${hostname}`, "DOWNLOAD_HOST_NOT_ALLOWED", 400);
  }
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new AppError("不允许访问私有网络地址。", "BLOCKED_DOWNLOAD_IP", 400);
    return url;
  }
  let addresses: LookupAddress[];
  try {
    addresses = (await dns.lookup(hostname, { all: true, verbatim: true })) as LookupAddress[];
  } catch (error) {
    throw new AppError("无法解析图片下载域名。", "DOWNLOAD_DNS_FAILED", 400, { cause: error });
  }
  if (addresses.length === 0 || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new AppError("图片下载域名解析到了不安全的网络地址。", "BLOCKED_DOWNLOAD_DNS", 400);
  }
  return url;
}

export async function readBodyWithLimit(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Uint8Array> {
  if (!body) throw new AppError("图片响应没有内容。", "EMPTY_IMAGE_RESPONSE", 400);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("Image exceeds configured size limit");
        throw new AppError("图片超过服务允许的大小。", "IMAGE_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}
