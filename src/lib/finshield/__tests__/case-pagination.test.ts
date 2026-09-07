import { expect, it } from "vitest";
import { casePage, casePageQuery, readCaseCursor } from "../case-pagination";
const time = "2026-09-07T01:02:03.123456+00:00";
const rows = Array.from({ length: 51 }, (_, i) => ({ created_at: time, id: `00000000-0000-4000-8000-${String(100 - i).padStart(12,"0")}` }));
it("51번째 기록이 있을 때만 다음 페이지를 내며 시각의 마이크로초와 동점 ID를 보존한다", () => {
  const page = casePage(rows);
  expect(page.cases).toHaveLength(50);
  const cursor = readCaseCursor(page.next_cursor);
  expect(cursor).toEqual(rows[49]);
  expect(casePageQuery(cursor).order).toBe("created_at.desc,id.desc");
  expect(casePageQuery(cursor).or).toContain(`created_at.eq.${time},id.lt.${rows[49].id}`);
  expect(casePage(rows.slice(0,50)).next_cursor).toBeNull();
  expect(casePage([])).toEqual({cases:[],next_cursor:null});
});
it("Cursor로 PostgREST 필터를 주입하거나 과대한 요청을 전달할 수 없다", () => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  for (const cursor of ["a".repeat(257),"{raw}",encode({ created_at: time, id: "x),owner_id.neq.null" }),encode({created_at:"x),id.neq.null",id:rows[0].id}),encode({...rows[0], extra:"unexpected"})]) expect(()=>readCaseCursor(cursor)).toThrow("INVALID_CASE_CURSOR");
  expect(readCaseCursor(null)).toBeNull();
});
