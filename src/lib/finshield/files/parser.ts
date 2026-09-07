import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";

const word=z.object({text:z.string(),bbox:z.array(z.number()).length(4)});
export const pageSchema=z.object({page_no:z.number().int().min(1).max(10),text:z.string().max(12000),words:z.array(word).max(15000)});
const resultSchema=z.object({ok:z.literal(true),mime:z.enum(["application/pdf","image/png","image/jpeg"]),
  pages:z.array(pageSchema).min(1).max(10),needs_ocr:z.boolean(),parser_version:z.string().optional()});
export type ParsedPage=z.infer<typeof pageSchema>;

export async function parseIsolatedFile(bytes:Buffer,mime:string,filename:string) {
  const snapshotId=process.env.FINSHIELD_PARSER_SNAPSHOT_ID;
  if(!snapshotId)throw new Error("FILE_PARSER_UNAVAILABLE");
  const token=process.env.FINSHIELD_SANDBOX_TOKEN;
  const credentials=token ? {token,projectId:process.env.FINSHIELD_VERCEL_PROJECT_ID!,teamId:process.env.FINSHIELD_VERCEL_TEAM_ID!}:{};
  const sandbox=await Sandbox.create({...credentials,source:{type:"snapshot",snapshotId},persistent:false,
    timeout:35000,networkPolicy:"deny-all",signal:AbortSignal.timeout(10000)});
  try {
    await sandbox.writeFiles([
      {path:"/vercel/sandbox/parser-worker.mjs",content:await readFile(join(process.cwd(),"src/lib/finshield/files/parser-worker.mjs"))},
      {path:"/vercel/sandbox/inspector.mjs",content:await readFile(join(process.cwd(),".github/scripts/file-safety-inspector.mjs"))},
      {path:"/vercel/sandbox/input.bin",content:bytes},
      {path:"/vercel/sandbox/request.json",content:Buffer.from(JSON.stringify({mime,filename}))},
    ]);
    await sandbox.runCommand({cmd:"node",args:["--max-old-space-size=256","parser-worker.mjs"]});
    const output=await sandbox.readFileToBuffer({path:"/vercel/sandbox/result.json"});
    if(!output || output.byteLength>4*1024*1024)throw new Error("FILE_PARSE_FAILED");
    const parsed=resultSchema.safeParse(JSON.parse(output.toString("utf8")));
    if(!parsed.success)throw new Error("FILE_REJECTED");
    return parsed.data;
  } finally {await sandbox.stop();}
}
