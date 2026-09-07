import { sleep } from "workflow";
import { fileExpiryDeadline, expireFileStep } from "./file-expiry-step";

/** 원문 대신 입력 ID만 예약한다. 대기 중에는 서버 실행 시간을 소비하지 않는다. */
export async function fileExpiryWorkflow(inputId: string) {
  "use workflow";
  const deadline = await fileExpiryDeadline(inputId);
  if (!deadline) return { input_id: inputId, status: "ABSENT" };
  await sleep(new Date(deadline));
  return await expireFileStep(inputId);
}
