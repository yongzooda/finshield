import "server-only";
import type postgres from "postgres";

/** RES-004·RES-007: 문구는 코드 규칙으로, 연락처는 승인 Registry에서만 가져온다. */
export async function buildActionGuide(sql: ReturnType<typeof postgres>) {
  const channels = await sql`
    select id, channel_type, display_value from kb.official_channel_registry
    where institution_code='INST_KINFA'
      and (valid_from is null or valid_from<=current_date)
      and (valid_to is null or valid_to>=current_date)
    order by created_at desc`;
  const phone = channels.find(channel => channel.channel_type === "PHONE");
  const actions = [{
    action_no: 1, action_code: "VERIFY_OFFICIAL_CHANNEL",
    title: "가입·송금·앱 설치 전에 공식 창구로 확인하세요",
    detail: "권유자가 준 연락처 대신 공식 창구에 상품 조건과 선입금·원격제어 앱 요구를 확인하세요.",
  }];
  return {
    stored: {
      status: "COMPLETED", guide_schema_version: "g1", actions,
      limitation_codes: phone ? [] : ["OFFICIAL_CHANNEL_UNAVAILABLE"],
      channels: phone ? [{ action_no: 1, display_order: 1, official_channel_registry_id: phone.id }] : [],
    },
    display: { actions, channels: phone ? [{ action_no: 1, display_value: phone.display_value }] : [] },
  };
}
