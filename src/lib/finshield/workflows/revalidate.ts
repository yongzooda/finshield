import { executeRevalidationStep } from "./revalidation-step";

/** REV-001: HTTP 응답이 끝나도 계속한다. 원문·Claim·토큰을 Workflow 저장소에 직렬화하지 않는다. */
export async function revalidationWorkflow(jobId:string) {
  "use workflow";
  return await executeRevalidationStep(jobId);
}
