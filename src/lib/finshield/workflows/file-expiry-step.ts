import { RetryableError } from "workflow";
import { fsql } from "../db";
import { cleanupCaseFiles } from "../files/cleanup";

export async function fileExpiryDeadline(inputId: string) {
  "use step";
  const [row] = await fsql()`select private.file_expiry_context(${inputId}::uuid) as context`;
  return row?.context?.pending ? row.context.expires_at as string : null;
}

export async function expireFileStep(inputId: string) {
  "use step";
  const sql = fsql();
  const [row] = await sql`select private.file_expiry_context(${inputId}::uuid) as context`;
  if (!row?.context?.pending) return { input_id: inputId, status: "ABSENT" };
  await sql`select private.expire_file_input(${inputId}::uuid)`;
  await cleanupCaseFiles(sql, row.context.owner_id, row.context.case_id);
  const [remaining] = await sql`select private.file_expiry_context(${inputId}::uuid) as context`;
  if (remaining?.context?.pending) throw new RetryableError("FILE_DELETE_UNCONFIRMED", { retryAfter: "5m" });
  return { input_id: inputId, status: "DELETED" };
}
expireFileStep.maxRetries = 8;
