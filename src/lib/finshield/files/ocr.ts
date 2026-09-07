import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ParsedPage } from "./parser";

const field = z.object({ inferText: z.string().max(12000), lineBreak: z.boolean().optional(),
  boundingPoly: z.object({ vertices: z.array(z.object({ x: z.number().finite(), y: z.number().finite() })).min(4).max(4) }) });
const responseSchema = z.object({ version: z.literal("V2"), requestId: z.string(), images: z.array(z.object({
  inferResult: z.literal("SUCCESS"), fields: z.array(field).max(15000),
  convertedImageInfo: z.object({ pageIndex: z.number().int().min(0).max(9) }).optional(),
})).min(1).max(10) });

/** INP-006: PDF 페이지 순서를 배열 순서로 추측하지 않는다. 부분 성공도 완성된 문서로 받지 않는다. */
export function decodeOcrResponse(raw: unknown, requestId: string, pageCount: number, isPdf: boolean): ParsedPage[] {
  const result = responseSchema.safeParse(raw);
  if (!result.success || result.data.requestId !== requestId || result.data.images.length !== pageCount) throw new Error("OCR_RESPONSE_INVALID");
  const pages = result.data.images.map(image => {
    const index = isPdf ? image.convertedImageInfo?.pageIndex : 0;
    if (index === undefined) throw new Error("OCR_PAGE_LOCATION_MISSING");
    const text = image.fields.map(item => item.inferText + (item.lineBreak ? "\n" : " ")).join("").trim();
    if (!text || text.length > 12000) throw new Error("OCR_TEXT_INVALID");
    return { page_no: index + 1, text, words: image.fields.map(item => {
      const xs = item.boundingPoly.vertices.map(p => p.x), ys = item.boundingPoly.vertices.map(p => p.y);
      return { text: item.inferText, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys)] };
    }) };
  }).sort((a,b) => a.page_no-b.page_no);
  if (pages.some((page,index) => page.page_no !== index+1)) throw new Error("OCR_PAGE_LOCATION_INVALID");
  return pages;
}

/** SEC-PRI-010: 저장된 본인 동의를 전송 직전에 검사한다. 거부하면 fetch 자체가 없다. */
export async function extractWithOcr(args: { bytes: Buffer; mime: string; pageCount: number;
  authorize: () => Promise<boolean>; signal?: AbortSignal }) {
  if (!await args.authorize()) throw new Error("OCR_CONSENT_REQUIRED");
  args.signal?.throwIfAborted();
  const endpoint = process.env.CLOVA_OCR_INVOKE_URL, secret = process.env.CLOVA_OCR_SECRET;
  if (!endpoint || !secret) throw new Error("OCR_UNAVAILABLE");
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".apigw.ntruss.com") || !url.pathname.endsWith("/general")) throw new Error("OCR_ENDPOINT_INVALID");
  const formats: Record<string,string> = { "application/pdf":"pdf", "image/png":"png", "image/jpeg":"jpg" };
  const format = formats[args.mime];
  if (!format || args.bytes.length > 10485760 || args.pageCount < 1 || args.pageCount > 10) throw new Error("OCR_INPUT_INVALID");
  const requestId = randomUUID();
  const timeout = AbortSignal.timeout(25000);
  const response = await fetch(url, { method:"POST", redirect:"error",
    headers:{"Content-Type":"application/json","X-OCR-SECRET":secret},
    body:JSON.stringify({version:"V2",requestId,timestamp:Date.now(),lang:"ko",enableTableDetection:false,
      images:[{format,name:"masked-intake",data:args.bytes.toString("base64")}]}),
    signal:args.signal ? AbortSignal.any([args.signal,timeout]) : timeout });
  if (!response.ok || !response.body) throw new Error("OCR_REQUEST_FAILED");
  const reader=response.body.getReader(); const chunks:Uint8Array[]=[]; let size=0;
  try { for (;;) {const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>4*1024*1024)throw new Error("OCR_RESPONSE_TOO_LARGE");chunks.push(value);} }
  finally {await reader.cancel();}
  return decodeOcrResponse(JSON.parse(Buffer.concat(chunks).toString("utf8")),requestId,args.pageCount,format==="pdf");
}
