import "server-only";
import {finshieldEnv} from "../env";

const BUCKET="finshield-quarantine";
export async function readQuarantinedFile(path:string,expectedSize:number) {
  const env=finshieldEnv();const key=env.SUPABASE_SECRET_KEY;
  if(!key)throw new Error("STORAGE_UNAVAILABLE");
  const response=await fetch(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`,{
    headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(10000),redirect:"error",cache:"no-store"});
  if(!response.ok||!response.body)throw new Error("UPLOAD_NOT_FOUND");
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try {for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>10485760||size>expectedSize)throw new Error("FILE_SIZE_MISMATCH");chunks.push(value);}}
  finally {await reader.cancel();}
  if(size!==expectedSize)throw new Error("FILE_SIZE_MISMATCH");
  return Buffer.concat(chunks);
}
