"use client";
import { useEffect, useRef, useState } from "react";
import { freshSessionToken, sessionFetch, sessionIdentity, readSessionToken } from "../session-client";
import { uploadFile } from "./upload-file";

export type OcrReviewField={field_kind:"URL"|"INSTITUTION"|"PRODUCT"|"NUMBER"|"NEGATION"|"TEXT";confidence_milli:number;bbox:[number,number,number,number];start:number;end:number};
export type FileClaim={claim_id:string;claim_ref:string;claim_type:string;statement_masked:string;materiality:string;expected_revision_no:number;source_page_no:number;requires_review?:boolean;review_fields?:OcrReviewField[]};
export type PreparedFile={input_purpose?:string;case_id:string;input_id:string;claims:FileClaim[];masked_text:string;masked_pages:{page_no:number;text:string;low_confidence_count?:number;low_confidence_fields?:OcrReviewField[]}[]};

export function FileIntake({token,caseId,onPrepared,onBusyChange}:{token:string;caseId?:string;onPrepared:(value:PreparedFile)=>void;onBusyChange:(busy:boolean)=>void}) {
  const [file,setFile]=useState<File|null>(null), [consent,setConsent]=useState(false);
  const [busy,setBusy]=useState(false), [message,setMessage]=useState("");
  const controller=useRef<AbortController|null>(null);
  const slot=useRef<{case_id:string;input_id:string}|null>(null);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;controller.current?.abort();};},[]);
  const headers={"Content-Type":"application/json",Authorization:`Bearer ${token}`};
  const stop=async()=>{
    controller.current?.abort();
    if(slot.current){const response=await sessionFetch(`/api/finshield/cases/${slot.current.case_id}/stop`,token,{
      method:"POST",headers,body:JSON.stringify({input_id:slot.current.input_id})});
      if(!response.ok)throw new Error("중단 요청을 확인하지 못했습니다. 내 기록에서 상태를 확인해 주세요.");}
    slot.current=null;
  };
  const submit=async()=>{
    if(!file)return;
    if(!["application/pdf","image/png","image/jpeg"].includes(file.type)||file.size<1||file.size>10485760){setMessage("PDF·PNG·JPG 파일을 10 MiB 이내로 올려 주세요.");return;}
    setBusy(true);onBusyChange(true);setMessage("업로드를 준비하고 있습니다.");
    const abort=new AbortController();controller.current=abort;
    try{
      const opened=await sessionFetch("/api/finshield/files/slot",token,{method:"POST",headers,body:JSON.stringify({mime:file.type,size:file.size,...(caseId?{case_id:caseId}:{})}),signal:abort.signal});
      const data=await opened.json();if(!opened.ok)throw new Error(data.error??"업로드를 준비하지 못했습니다.");
      if(caseId && data.case_id!==caseId)throw new Error("계약 파일과 검증 기록의 연결을 확인하지 못했습니다.");
      slot.current={case_id:data.case_id,input_id:data.input_id};
      await uploadFile({file,supabaseUrl:data.supabase_url,publishableKey:data.publishable_key,objectPath:data.object_path,token:()=>freshSessionToken(token),signal:abort.signal,
        onProgress:(sent,total)=>setMessage(`파일 업로드 ${Math.round(sent/total*100)}%`)});
      setMessage("파일의 안전성을 확인하고 문장을 읽고 있습니다.");
      const processed=await sessionFetch("/api/finshield/files/process",token,{method:"POST",headers,
        body:JSON.stringify({...slot.current,ocr_consent:consent}),signal:abort.signal});
      const result=await processed.json();if(!processed.ok)throw new Error(result.error??"파일을 읽지 못했습니다.");
      slot.current=null;
      if(alive.current&&sessionIdentity(readSessionToken())===sessionIdentity(token)){setFile(null);onPrepared(result);}
    }catch(error){
      const reason=abort.signal.aborted?"파일 처리를 중단했습니다.":(error as Error).message;
      try{await stop();setMessage(reason);}catch(e){setMessage((e as Error).message);}
    }finally{controller.current=null;setBusy(false);onBusyChange(false);}
  };
  return <section className="mt-7 border-t border-[var(--fs-line)] pt-5" aria-label="문서로 입력">
    <h3 className="fs-h2">캡처 이미지 또는 PDF</h3>
    <p className="fs-meta mt-2">PDF·PNG·JPG, 최대 10 MiB·10쪽. 원본은 항목 확인이나 중단 시 삭제를 시작하며 최대 24시간 임시 처리합니다.</p>
    <p className="fs-meta mt-2">분쟁 준비에 필요한 원본은 본인 기기에 따로 보관해 주세요. 서버에는 원본을 보관하지 않습니다.</p>
    <label className="mt-4 block fs-body" htmlFor="proposal-file">{caseId?"계약 문서 선택":"권유 문서 선택"}</label>
    <input id="proposal-file" type="file" accept="application/pdf,image/png,image/jpeg" disabled={busy} className="fs-field mt-2"
      onChange={event=>{setFile(event.target.files?.[0]??null);setConsent(false);setMessage("");}}/>
    <label className="mt-4 flex items-start gap-2 fs-meta">
      <input type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)} className="mt-1"/>
      <span>이미지·스캔 PDF의 글자를 읽기 위해 원본을 NAVER Cloud CLOVA OCR에 보내는 데 동의합니다. 선택 사항이며, 동의하지 않으면 디지털 PDF의 텍스트 추출 또는 직접 입력을 이용할 수 있습니다. 이름·계좌번호 등 실제 개인정보가 포함된 문서는 올리지 마세요.</span>
    </label>
    <div className="mt-4 flex gap-3">
      <button type="button" className="fs-btn fs-btn--primary" disabled={!file||busy} onClick={()=>void submit()}>문서에서 항목 추출</button>
      {busy?<button type="button" className="fs-btn fs-btn--quiet" onClick={()=>controller.current?.abort()}>중단하고 지우기</button>:null}
    </div>
    {message?<p className="fs-body mt-3" role="status">{message}</p>:null}
  </section>;
}
