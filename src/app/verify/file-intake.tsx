"use client";
import { useEffect, useRef, useState } from "react";
import { freshSessionToken, sessionFetch, sessionIdentity, readSessionToken } from "../session-client";
import { uploadFile } from "./upload-file";

export type OcrReviewField={field_kind:"URL"|"INSTITUTION"|"PRODUCT"|"NUMBER"|"NEGATION"|"TEXT";confidence_milli:number;bbox:[number,number,number,number];start:number;end:number};
export type FileClaim={claim_id:string;claim_ref:string;claim_type:string;statement_masked:string;materiality:string;expected_revision_no:number;source_page_no:number;requires_review?:boolean;review_fields?:OcrReviewField[]};
export type PreparedFile={input_purpose?:string;case_id:string;input_id:string;claims:FileClaim[];masked_text:string;masked_pages:{page_no:number;text:string;low_confidence_count?:number;low_confidence_fields?:OcrReviewField[]}[];unread_pages?:number[]};

/** 브라우저가 읽은 이미지 가로·세로. 읽지 못하면 null 이고 서버 검사에 맡긴다. */
const imageSize=(file:File)=>new Promise<{width:number;height:number}|null>(resolve=>{
  const url=URL.createObjectURL(file); const image=new Image();
  image.onload=()=>{resolve({width:image.naturalWidth,height:image.naturalHeight});URL.revokeObjectURL(url);};
  image.onerror=()=>{resolve(null);URL.revokeObjectURL(url);};
  image.src=url;
});

/** OCR 없이 글자 층만 읽은 PDF의 빠진 쪽을 알린다. 빠진 쪽이 없으면 null. */
export const unreadPagesNotice=(pages?:number[])=>pages?.length
  ?`${pages.join("·")}쪽은 글자 층이 없어 읽지 않았습니다. 그 쪽 내용도 확인하려면 OCR에 동의하고 다시 올리거나 해당 부분을 텍스트로 붙여 넣어 주세요.`:null;

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
    // 이미지는 글자 층이 없어 언제나 OCR이 필요하다. 동의 없이 올리면 업로드만 하고 실패하므로 먼저 알린다.
    if(file.type!=="application/pdf"&&!consent){setMessage("사진·캡처 이미지는 글자 인식(OCR) 동의가 있어야 읽을 수 있습니다. 아래 동의 항목을 선택하거나 내용을 텍스트로 붙여 넣어 주세요.");return;}
    // 문서 인식(CLOVA OCR)은 긴 변이 8,000픽셀 미만인 이미지만 받는다. 긴 스크롤 캡처는 올리기 전에 알린다.
    if(file.type!=="application/pdf"){const size=await imageSize(file);
      if(size&&Math.max(size.width,size.height)>=8000){setMessage(`이 이미지는 ${size.width}×${size.height}픽셀입니다. 긴 화면 캡처는 가로·세로 모두 8,000픽셀보다 작아야 글자를 읽을 수 있으니 두세 장으로 나눠 캡처해 올려 주세요.`);return;}}
    setBusy(true);onBusyChange(true);setMessage("업로드를 준비하고 있습니다.");
    const abort=new AbortController();controller.current=abort;
    try{
      const opened=await sessionFetch("/api/finshield/files/slot",token,{method:"POST",headers,body:JSON.stringify({mime:file.type,size:file.size,...(caseId?{case_id:caseId}:{})}),signal:abort.signal});
      const data=await opened.json().catch(()=>({}));if(!opened.ok)throw new Error(data.error??"업로드를 준비하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
      if(caseId && data.case_id!==caseId)throw new Error("계약 파일과 검증 기록의 연결을 확인하지 못했습니다.");
      slot.current={case_id:data.case_id,input_id:data.input_id};
      await uploadFile({file,supabaseUrl:data.supabase_url,publishableKey:data.publishable_key,objectPath:data.object_path,token:()=>freshSessionToken(token),signal:abort.signal,
        onProgress:(sent,total)=>setMessage(`파일 업로드 ${Math.round(sent/total*100)}%`)});
      setMessage("파일의 안전성을 확인하고 문장을 읽고 있습니다.");
      const processed=await sessionFetch("/api/finshield/files/process",token,{method:"POST",headers,
        body:JSON.stringify({...slot.current,ocr_consent:consent}),signal:abort.signal});
      const result=await processed.json().catch(()=>({}));if(!processed.ok)throw new Error(result.error??"파일을 읽지 못했습니다. 잠시 뒤 다시 시도하거나 내용을 직접 붙여 넣어 주세요.");
      slot.current=null;
      if(alive.current&&sessionIdentity(readSessionToken())===sessionIdentity(token)){setFile(null);onPrepared(result);}
    }catch(error){
      const raw=(error as Error).message;
      // 업로드 모듈의 내부 코드(UPLOAD_…)를 화면에 그대로 내보내지 않는다.
      const reason=abort.signal.aborted?"파일 처리를 중단했습니다."
        :/^UPLOAD_/.test(raw)?"파일을 올리는 중 연결이 끊겼습니다. 네트워크를 확인하고 다시 시도해 주세요."
        :raw;
      try{await stop();setMessage(reason);}catch(e){setMessage((e as Error).message);}
    }finally{controller.current=null;setBusy(false);onBusyChange(false);}
  };
  return <section className="mt-7 border-t border-[var(--fs-line)] pt-5" aria-label="문서로 입력">
    <h3 className="fs-h2">캡처 이미지 또는 PDF</h3>
    <p className="fs-meta mt-2">PDF·PNG·JPG, 최대 10 MiB·10쪽. 이미지는 긴 변 8,000픽셀 미만이어야 합니다. 원본은 항목 확인이나 중단 시 삭제를 시작하며 최대 24시간 임시 처리합니다.</p>
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
