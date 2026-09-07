import { afterEach, expect, it, vi } from "vitest";
import { uploadFile } from "../upload-file";

const endpoint="https://synthetic.supabase.co/storage/v1/upload/resumable";
const file=new File([new Uint8Array(7*1024*1024)],"synthetic.png",{type:"image/png"});
const args={file,supabaseUrl:"https://synthetic.supabase.co",publishableKey:"public-test-key",objectPath:"synthetic/input/image.png"};
afterEach(()=>vi.unstubAllGlobals());

it("TUS의 시작·각 청크에서 최신 세션을 사용한다",async()=>{
 const auth:string[]=[];let offset=0;
 vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init:RequestInit)=>{
  auth.push(new Headers(init.headers).get("Authorization")!);
  if(init.method==="POST")return new Response(null,{status:201,headers:{Location:endpoint+"/owned"}});
  offset+=(init.body as Blob).size;
  return new Response(null,{status:204,headers:{"Upload-Offset":String(offset)}});
 }));
 let version=0;await uploadFile({...args,token:async()=>`session-${++version}`});
 expect(auth).toEqual(["Bearer session-1","Bearer session-2","Bearer session-3"]);
 expect(offset).toBe(file.size);
});

it("청크 응답 유실 뒤 갱신된 인증으로 Offset을 읽고 받은 바이트를 재전송하지 않는다",async()=>{
 const methods:string[]=[];const offsets:string[]=[];let version=0;
 vi.stubGlobal("fetch",vi.fn(async(_url:unknown,init:RequestInit)=>{
  methods.push(init.method!);expect(new Headers(init.headers).get("Authorization")).toBe(`Bearer session-${methods.length}`);
  if(init.method==="POST")return new Response(null,{status:201,headers:{Location:endpoint+"/owned"}});
  if(init.method==="HEAD")return new Response(null,{headers:{"Upload-Offset":String(6*1024*1024)}});
  offsets.push(new Headers(init.headers).get("Upload-Offset")!);
  if(offsets.length===1)throw new TypeError("synthetic response lost");
  return new Response(null,{status:204,headers:{"Upload-Offset":String(file.size)}});
 }));
 await uploadFile({...args,token:async()=>`session-${++version}`});
 expect(methods).toEqual(["POST","PATCH","HEAD","PATCH"]);expect(offsets).toEqual(["0",String(6*1024*1024)]);
});

it("인증을 기다리는 동안 취소되면 파일을 전송하지 않는다",async()=>{
 const controller=new AbortController(),fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
 await expect(uploadFile({...args,signal:controller.signal,token:async()=>{controller.abort();return "session";}})).rejects.toThrow();
 expect(fetcher).not.toHaveBeenCalled();
});

it("세션 교체로 인증이 거부되면 다른 계정으로 청크를 보내지 않는다",async()=>{
 let grants=0;const fetcher=vi.fn(async()=>new Response(null,{status:201,headers:{Location:endpoint+"/owned"}}));vi.stubGlobal("fetch",fetcher);
 await expect(uploadFile({...args,token:async()=>{if(++grants>1)throw new Error("session changed");return "session";}})).rejects.toThrow("session changed");
 expect(fetcher).toHaveBeenCalledTimes(1);
});
