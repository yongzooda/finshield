import {describe,expect,it,vi} from 'vitest';
vi.mock('@/lib/agents/model',()=>({callStructured:vi.fn()}));
import {acceptExtractedClaims,assertClaimSource} from '../agents/model-adapter';
it('CLM-002 상품명과 금리를 자리표시자로 지운 추출을 거부한다',()=>{
 expect(()=>assertClaimSource('햇살론15는 연 3% 고정금리다.','연 3% 고정금리다.','[상품명]은 연 [금리]% 고정금리다.')).toThrow('CLAIM_FACTS_REMOVED');
});
it('CLM-002 원문에 없는 인용·추가 숫자·삭제된 숫자는 거부한다',()=>{
 expect(()=>assertClaimSource('연 3% 금리','연 15% 금리','연 15% 금리')).toThrow('CLAIM_SOURCE_NOT_FOUND');
 expect(()=>assertClaimSource('연 3% 금리','연 3% 금리','연 5% 금리')).toThrow('CLAIM_NUMBERS_CHANGED');
 expect(()=>assertClaimSource('연 3% 금리','연 3% 금리','낮은 금리')).toThrow('CLAIM_NUMBERS_CHANGED');
 expect(()=>assertClaimSource('햇살론15는 연 3% 금리','연 3% 금리','햇살론15는 연 3% 금리')).not.toThrow();
});

describe("추출 항목 중 잘못 옮긴 항목만 버리기 (CLM-002)", () => {
  const text = "햇살론15 연 3.2% 고정금리로 최대 2천만원까지 당일 입금 가능합니다.";
  const claim = (statement: string, quote: string) => ({
    claim_type: "PRODUCT_TERM" as const, statement_masked: statement, source_quote: quote,
    source_page_no: null, materiality: "MATERIAL" as const,
  });

  it("숫자를 바꾼 항목 하나 때문에 나머지 항목까지 버리지 않는다", () => {
    const accepted = acceptExtractedClaims([
      claim("햇살론15를 연 3.2% 고정금리로 받을 수 있다.", "연 3.2% 고정금리로"),
      claim("햇살론15 한도는 최대 3천만원이다.", "최대 2천만원까지"),
    ], text);
    expect(accepted.map((row) => row.statementMasked)).toEqual(["햇살론15를 연 3.2% 고정금리로 받을 수 있다."]);
  });

  it("모든 항목이 잘못 옮겨졌으면 첫 사유로 실패한다", () => {
    expect(() => acceptExtractedClaims([claim("햇살론15 금리는 연 5%다.", "연 3.2% 고정금리로")], text))
      .toThrow("CLAIM_NUMBERS_CHANGED");
  });
});
