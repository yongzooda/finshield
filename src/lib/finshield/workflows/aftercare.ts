import { executeAftercareStep } from "./aftercare-step";
export async function aftercareWorkflow(jobId: string) {
  "use workflow";
  return executeAftercareStep(jobId);
}
