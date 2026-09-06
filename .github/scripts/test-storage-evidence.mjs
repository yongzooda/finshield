// B-STORAGE-01 계약 시험. 가짜 fetch 와 가짜 sql 로 client·spike·정책을 확인한다.
import assert from "node:assert/strict";
import { BUCKET, FORMULA_VERSION, PNG_BYTES, SCENARIOS, SIZE_LIMIT_BYTES, createStorageClient, runStorageSpike } from "./storage-spike.mjs";
import { validateStorageEvidenceResult } from "./storage-evidence-policy.mjs";

let passed = 0;
let rejected = 0;
const ok = (condition, message) => { assert.ok(condition, message); passed += 1; };

// ---------- 1. 시나리오 구성 ----------
ok(SCENARIOS.filter((s) => s.expect === "allow").length >= 1, "허용 시나리오가 있어야 한다");
ok(SCENARIOS.filter((s) => s.expect === "deny").length >= 7, "거부 시나리오가 일곱 개 이상이어야 한다");
ok(SCENARIOS.some((s) => s.key === "same_path_upsert"), "덮어쓰기 시나리오가 있어야 한다");
ok(SCENARIOS.some((s) => s.key === "resumable_token_after_close"), "발급 token 재사용 시나리오가 있어야 한다");
ok(SCENARIOS.some((s) => s.kind === "read"), "읽기 거부 시나리오가 있어야 한다");
ok(new Set(SCENARIOS.map((s) => s.key)).size === SCENARIOS.length, "시나리오 키가 겹치지 않아야 한다");
ok(SIZE_LIMIT_BYTES === 10 * 1024 * 1024, "상한이 10 MiB 여야 한다");

// ---------- 2. client 가 보내는 요청 ----------
const calls = [];
const fakeFetch = async (url, init) => {
  calls.push({ url: String(url), method: init?.method ?? "GET", headers: init?.headers ?? {} });
  if (String(url).includes("/auth/v1/token")) {
    return new Response(JSON.stringify({ access_token: "tok", user: { id: "11111111-1111-4111-8111-111111111111" } }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (String(url).includes("/rest/v1/financial_profiles")) return new Response("[]", { status: 201 });
  if (String(url).includes("/upload/resumable")) {
    return new Response(null, { status: 201, headers: { location: "https://example.invalid/upload/1" } });
  }
  if (String(url).startsWith("https://example.invalid/upload/")) return new Response(null, { status: 403 });
  if (String(url).includes("/storage/v1/object/list/")) return new Response("[]", { status: 400 });
  if (init?.method === "GET") return new Response(null, { status: 400 });
  // 첫 업로드만 성공하고 나머지 쓰기는 거부한다.
  const uploads = calls.filter((c) => c.method === "POST" && c.url.includes(`/storage/v1/object/${BUCKET}/`)).length;
  return new Response(null, { status: uploads === 1 ? 200 : 403 });
};
const client = createStorageClient({ baseUrl: "https://demo.supabase.co/", anonKey: "anon", fetchImpl: fakeFetch });
const signed = await client.signIn({ email: "a@b.c", password: "x" });
ok(signed.token === "tok" && signed.userId.length === 36, "로그인이 token 과 사용자 식별자를 돌려줘야 한다");
ok(calls[0].headers.apikey === "anon", "모든 요청에 공개 키가 붙어야 한다");
ok(!JSON.stringify(calls).includes("service_role"), "우회 키를 쓰지 않아야 한다");

// ---------- 3. spike 조립 ----------
let slotNo = 0;
const fakeSql = (strings) => {
  const text = strings.join(" ");
  if (text.includes("create_case")) return Promise.resolve([{ case_id: "22222222-2222-4222-8222-222222222222" }]);
  if (text.includes("open_upload_slot")) {
    slotNo += 1;
    const input = `33333333-3333-4333-8333-${String(slotNo).padStart(12, "0")}`;
    const object = `44444444-4444-4444-8444-${String(slotNo).padStart(12, "0")}`;
    return Promise.resolve([{ case_input_id: input, object_id: object, object_path: `owner/case/${input}/${object}.png`, expires_at: new Date().toISOString() }]);
  }
  return Promise.resolve([{ slot_state: "CLOSED" }]);
};
const observations = await runStorageSpike({
  client, sql: fakeSql, credentials: { email: "a@b.c", password: "x" }, progress: () => {},
});
ok(observations.contract.uses_service_role === false, "계약에 우회 키 미사용이 남아야 한다");
ok(observations.contract.slot_path_chosen_by === "server", "경로를 서버가 정한다는 사실이 남아야 한다");
ok(observations.scenarios.length === SCENARIOS.length, "시나리오 기록이 모두 있어야 한다");
ok(observations.totals.unauthorized_allows === 0, "가짜 응답에서 부당 허용이 없어야 한다");
ok(observations.totals.allow_passed === observations.totals.allow_scenarios, "허용 경로가 동작해야 한다");
ok(PNG_BYTES.length > 0, "업로드 본문이 있어야 한다");

// ---------- 4. 정책 ----------
const good = () => ({
  schema_version: 3, blocker_id: "B-STORAGE-01", requirements_blob_sha: "a".repeat(40), adr_decision_sha256: "b".repeat(64),
  code_under_test_sha: "c".repeat(40), workflow_head_sha: "c".repeat(40), scope_sha256: "d".repeat(64),
  run: { id: 1, attempt: 1 }, environment: {}, redactions_applied: true,
  observations: JSON.parse(JSON.stringify(observations)),
});
const check = (result) => { const errors = []; validateStorageEvidenceResult(result, (m) => errors.push(m)); return errors; };
assert.deepEqual(check(good()), [], "기준 결과는 정책을 통과해야 한다");
passed += 1;

const rejects = (name, mutate) => {
  const result = good();
  mutate(result.observations);
  assert.ok(check(result).length > 0, `정책이 '${name}' 를 거부해야 한다`);
  rejected += 1;
};
rejects("산식 변경", (o) => { o.contract.formula_version = "other"; });
rejects("Bucket 변경", (o) => { o.contract.bucket = "public"; });
rejects("상한 완화", (o) => { o.contract.size_limit_bytes = 999999999; });
rejects("우회 키 사용", (o) => { o.contract.uses_service_role = true; });
rejects("경로를 호출자가 고름", (o) => { o.contract.slot_path_chosen_by = "client"; });
rejects("거부해야 할 쓰기가 통과", (o) => { const r = o.scenarios.find((x) => x.key ?? x.scenario === "foreign_path_upload"); const t = o.scenarios.find((x) => x.scenario === "foreign_path_upload"); t.status = 200; t.allowed = true; o.totals.unauthorized_allows = 1; o.totals.unauthorized_writes = 1; void r; });
rejects("허용 표시가 상태와 불일치", (o) => { o.scenarios[0].allowed = false; });
rejects("허용 경로가 거부됨", (o) => { const t = o.scenarios.find((x) => x.expect === "allow"); t.status = 403; t.allowed = false; o.totals.allow_passed = 0; });
rejects("덮어쓰기 통과", (o) => { o.totals.upsert_allows = 1; });
rejects("발급 token 재사용 통과", (o) => { o.totals.resumable_reuse_allows = 1; });
rejects("읽기 통과", (o) => { o.totals.unauthorized_reads = 1; });
rejects("부당 허용 합계", (o) => { o.totals.unauthorized_allows = 1; });
rejects("시나리오 누락", (o) => { o.scenarios.pop(); });
rejects("상태 코드 이상", (o) => { o.scenarios[0].status = 999; });
rejects("observations 키 추가", (o) => { o.extra = 1; });

console.log(`B-STORAGE-01 계약 시험 통과: 합격 ${passed}건, 정책 거부 ${rejected}건.`);
