/**
 * Tool 구현 등록부.
 *
 * Manifest 에 선언된 Tool 마다 구현을 하나씩 건다. 아직 자료가 적재되지 않은
 * 것은 빈 결과와 이유를 남기는 구현을 건다. 없는 기능을 있는 것처럼 보이게
 * 하지 않는다 (E-017, OPS-005). 결과가 비었다는 사실이 안전의 근거가 되지
 * 않도록 이유 코드를 함께 남긴다.
 */

import "server-only";
import { TOOLS } from "../manifest";
import type { ToolImpl } from "./runtime";
import { lookupStatute, searchPrecedent } from "./statute";
import {
  lookupOfficialChannel, searchFinancialProduct, verifyFinancialInstitution,
} from "./registry";
import { parseUrlHost } from "./url";
import { analyzeRiskPattern, checkDocuments, getSourceSnapshot, searchDisputeCase, searchPublicKnowledge } from "./public-knowledge";
import { searchOfficialWarning } from "./official-warning";

const searchProductForContext: ToolImpl = async (input, ctx) => {
  if (ctx.allowedSourceSnapshotIds?.length) {
    return searchPublicKnowledge(input, ctx, ["PRODUCT"]);
  }
  return searchFinancialProduct(input, ctx);
};

const searchWarningForContext: ToolImpl = async (input, ctx) => {
  if (ctx.allowedSourceSnapshotIds?.length) {
    const stored = await searchPublicKnowledge(input, ctx, ["GUIDE", "ALERT"]);
    return {
      ...stored,
      observations: {
        ...stored.observations,
        kind: "APPROVED_DEMO_GUIDE_SEARCH",
        current_transaction_proof: false,
      },
    };
  }
  return searchOfficialWarning(input, ctx);
};

export const TOOL_IMPLS: Record<string, ToolImpl> = {
  lookup_statute: lookupStatute,
  search_precedent: searchPrecedent,
  parse_url_host: parseUrlHost,
  lookup_official_channel: lookupOfficialChannel,
  search_financial_product: searchProductForContext,
  verify_financial_institution: verifyFinancialInstitution,
  // 공용 KB는 Manifest Release와 실제 적재 범위 안에서 조회한다.
  get_source_snapshot: getSourceSnapshot,
  search_consumer_warning: searchWarningForContext,
  analyze_risk_pattern: analyzeRiskPattern,
  check_documents: checkDocuments,
  search_dispute_case: searchDisputeCase,
};

/** 구현이 빠진 Tool 이 없는지 시작할 때 확인한다. */
export const assertToolsImplemented = () => {
  for (const tool of TOOLS) {
    if (!TOOL_IMPLS[tool.toolCode]) throw new Error(`구현이 없는 Tool 이다: ${tool.toolCode}`);
  }
};
