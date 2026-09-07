import {afterEach,expect,it,vi} from 'vitest';
import {extractWarningSection,searchOfficialWarning} from '../tools/official-warning';
import type {ToolCallContext} from '../tools/runtime';
const html=`<div class="board-detail-header"><p class="tit">합성 공식 안내</p><!--2026-01-01--><li>2021-05-27</li></div><div class="board-detail-con contents"><p>문자메시지나 전화 안내의 합성 검사 문구</p><p>정상적인 금융기관 관련 합성 검사 문구</p><p>출처가 불분명한 앱 관련 합성 검사 문구</p></div><div class="board-detail-footer">목록의 다른 문서</div>`;
afterEach(()=>vi.unstubAllGlobals());
it('EV-009 주석 날짜와 주변 목록을 공식 본문으로 인용하지 않는다',()=>{
 const result=extractWarningSection(html);expect(result.publishedAt).toBe('2021-05-27');expect(result.excerpt).not.toContain('다른 문서');expect(()=>extractWarningSection('<html>안내가 이동됨</html>')).toThrow('OFFICIAL_WARNING_STRUCTURE_CHANGED');
});
it('EV-007 오래된 안내는 현재 거래의 직접 증거가 아니며 출처 날짜를 유지한다',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(html)));
 const result=await searchOfficialWarning({query:'선입금 요구'},{} as ToolCallContext);
 expect(result.items[0]).toMatchObject({publishedAt:'2021-05-27',freshness:'STALE',referenceOnly:true,directness:'CONTEXT_ONLY',isCitable:false});
});
