/** INP-003: 회원 JWT와 one-use 경로만 사용하는 TUS. 파일명·토큰을 로컬 저장소에 남기지 않는다. */
export async function uploadFile(args:{file:File;supabaseUrl:string;publishableKey:string;objectPath:string;token:()=>Promise<string>;
  signal?:AbortSignal;onProgress?:(sent:number,total:number)=>void}) {
  const base=new URL(args.supabaseUrl);
  if(base.protocol!=="https:" || !base.hostname.endsWith(".supabase.co"))throw new Error("UPLOAD_ORIGIN_INVALID");
  const endpoint=new URL("/storage/v1/upload/resumable",base);
  const headers=async()=>{
    args.signal?.throwIfAborted();
    const token=await args.token();
    args.signal?.throwIfAborted();
    return {"Tus-Resumable":"1.0.0",Authorization:`Bearer ${token}`,apikey:args.publishableKey,"x-upsert":"false"};
  };
  const encode=(value:string)=>btoa(String.fromCharCode(...new TextEncoder().encode(value)));
  const metadata={bucketName:"finshield-quarantine",objectName:args.objectPath,contentType:args.file.type,cacheControl:"0"};
  const started=await fetch(endpoint,{method:"POST",headers:{...await headers(),"Upload-Length":String(args.file.size),
    "Upload-Metadata":Object.entries(metadata).map(([key,value])=>`${key} ${encode(value)}`).join(",")},signal:args.signal,redirect:"error"});
  const location=started.headers.get("Location");
  if(!started.ok || !location)throw new Error("UPLOAD_START_FAILED");
  const url=new URL(location,endpoint);
  if(url.origin!==endpoint.origin || !url.pathname.startsWith(endpoint.pathname+"/"))throw new Error("UPLOAD_LOCATION_INVALID");
  let offset=0, failures=0;
  while(offset<args.file.size) {
    const end=Math.min(offset+6*1024*1024,args.file.size);
    const chunkHeaders=await headers();
    try {
      const response=await fetch(url,{method:"PATCH",headers:{...chunkHeaders,"Content-Type":"application/offset+octet-stream","Upload-Offset":String(offset)},
        body:args.file.slice(offset,end),signal:args.signal,redirect:"error"});
      const next=Number(response.headers.get("Upload-Offset"));
      if(!response.ok || next!==end)throw new Error("UPLOAD_CHUNK_FAILED");
      offset=next;failures=0;
    }catch(error){
      args.signal?.throwIfAborted();
      if(++failures>2)throw error;
      // 응답만 끊긴 경우 이미 받은 청크를 덮어쓰지 않는다.
      const status=await fetch(url,{method:"HEAD",headers:await headers(),signal:args.signal,redirect:"error"});
      const value=status.headers.get("Upload-Offset"), next=Number(value);
      if(!status.ok || value===null || !Number.isInteger(next) || next<offset || next>end)throw new Error("UPLOAD_RESUME_FAILED");
      offset=next;
    }
    args.onProgress?.(offset,args.file.size);
  }
}
