import {expect,it,vi} from 'vitest';
vi.mock('@/lib/agents/model',()=>({callStructured:vi.fn()}));
import {assertClaimSource} from '../agents/model-adapter';
it('CLM-002 상품명과 금리를 자리표시자로 지운 추출을 거부한다',()=>{
 expect(()=>assertClaimSource('햇살론15는 연 3% 고정금리다.','연 3% 고정금리다.','[상품명]은 연 [금리]% 고정금리다.')).toThrow('CLAIM_FACTS_REMOVED');
});
it('CLM-002 원문에 없는 인용·추가 숫자·삭제된 숫자는 거부한다',()=>{
 expect(()=>assertClaimSource('연 3% 금리','연 15% 금리','연 15% 금리')).toThrow('CLAIM_SOURCE_NOT_FOUND');
 expect(()=>assertClaimSource('연 3% 금리','연 3% 금리','연 5% 금리')).toThrow('CLAIM_NUMBERS_CHANGED');
 expect(()=>assertClaimSource('연 3% 금리','연 3% 금리','낮은 금리')).toThrow('CLAIM_NUMBERS_CHANGED');
 expect(()=>assertClaimSource('햇살론15는 연 3% 금리','연 3% 금리','햇살론15는 연 3% 금리')).not.toThrow();
});
