import {afterEach,expect,it,vi} from 'vitest';
import {lawSearch} from './law_client';
afterEach(()=>vi.unstubAllGlobals());
it('N-PERF-009 취소된 조회는 재시도하거나 새 요청을 보내지 않는다',async()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 const controller=new AbortController();controller.abort(new Error('합성 사용자 취소'));
 await expect(lawSearch('law',{query:'합성 법령'},{signal:controller.signal})).rejects.toThrow('합성 사용자 취소');
 expect(fetcher).not.toHaveBeenCalled();
});
it('N-PERF-009 실행 중 취소는 fetch로 전달되고 재시도를 막는다',async()=>{
 vi.stubEnv('LAW_API_REGISTERED_ORIGIN','https://finshield.example.test');
 const controller=new AbortController();
 const fetcher=vi.fn((_url:unknown,options:RequestInit)=>new Promise((_resolve,reject)=>{
  options.signal!.addEventListener('abort',()=>reject(options.signal!.reason),{once:true});
  controller.abort(new Error('합성 실행 취소'));
 }));vi.stubGlobal('fetch',fetcher);
 try{await expect(lawSearch('law',{query:'합성 법령'},{signal:controller.signal})).rejects.toThrow('합성 실행 취소');expect(fetcher).toHaveBeenCalledTimes(1);}
 finally{vi.unstubAllEnvs();}
});
