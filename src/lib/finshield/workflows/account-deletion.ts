import { sleep } from "workflow";
import { cleanAccountStep } from "./account-deletion-step";

export async function accountDeletionWorkflow(requestId: string) {
  "use workflow";
  // 한 번의 실행이 끝나지 않아도 DB 요청과 차단은 남으며 같은 요청을 재개할 수 있다.
  for (let attempt = 0; attempt < 288; attempt++) {
    const status = await cleanAccountStep(requestId);
    if (status === "COMPLETED") return { status };
    await sleep(status === "PROGRESS" ? "1s" : "5m");
  }
  return { status: "PENDING" };
}
