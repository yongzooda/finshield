"use client";
import { useEffect, useRef, useState } from "react";
import { FileIntake, type OcrReviewField } from "../../../verify/file-intake";
import { sessionFetch, sessionIdentity, readSessionToken } from "../../../session-client";
import type { PriorClaim } from "@/lib/finshield/contract-comparison";

type Term={id:string;case_input_id:string;statement_masked:string;original_statement_masked:string;source_locator:{page_no:number;review_required?:boolean;review_fields?:OcrReviewField[]};confirmed:boolean;removed:boolean;base_passport_id:string|null;target_claim_id:string|null};
type Input={id:string;input_stage:string;input_outcome:string;raw_delete_status:string;raw_expires_at:string};
type Document={input:Input;terms:Term[]};
export function AftercareDocuments({token,caseId,basePassport,prior,onUse,onBusyChange}:{token:string;caseId:string;basePassport:string;
  prior:PriorClaim[];onUse:(terms:Record<string,string>,links:Record<string,string>)=>void;onBusyChange:(busy:boolean)=>void}) {
  const sessionKey=sessionIdentity(token);
  const aliveRef=useRef(true);
  useEffect(()=>{aliveRef.current=true;return()=>{aliveRef.current=false;};},[]);
  const [document,setDocument]=useState<Document|null>(null),[message,setMessage]=useState("");
  const [texts,setTexts]=useState<Record<string,string>>({}),[targets,setTargets]=useState<Record<string,string>>({});
  const [ocrReviewed,setOcrReviewed]=useState<Set<string>>(new Set());
  const [busy,setBusy]=useState(false);
  const current=()=>aliveRef.current&&sessionIdentity(readSessionToken())===sessionKey;
  const load=async()=>{
    const response=await sessionFetch(`/api/finshield/cases/${caseId}/aftercare/documents`,token,{headers:{Authorization:`Bearer ${token}`}});
    const data=await response.json();if(!response.ok)throw new Error(data.error??"문서를 복원하지 못했습니다.");
    const input=(data.inputs as Input[]).find(i=>i.input_outcome==="ACTIVE");
    const terms=(data.terms as Term[]).filter(t=>t.case_input_id===input?.id&&!t.removed);
    const value=input?{input,terms}:null;
    if(current()){
      setDocument(value);setTexts(Object.fromEntries(terms.map(t=>[t.id,t.statement_masked])));
      setTargets(Object.fromEntries(terms.map(t=>[t.id,t.base_passport_id===basePassport?t.target_claim_id??"":""])));
      setOcrReviewed(new Set(terms.filter(t=>t.confirmed).map(t=>t.id)));
    }
    return value;
  };
  useEffect(()=>{
    let alive=true;const activeToken=readSessionToken();if(!activeToken)return;
    void (async()=>{try {
      const response=await sessionFetch(`/api/finshield/cases/${caseId}/aftercare/documents`,activeToken,{headers:{Authorization:`Bearer ${activeToken}`}});
      const data=await response.json();if(!response.ok)throw new Error(data.error??"문서 기록을 복원하지 못했습니다.");
      if(!alive||sessionIdentity(readSessionToken())!==sessionKey)return;
      const input=(data.inputs as Input[]).find(i=>i.input_outcome==="ACTIVE");
      const terms=(data.terms as Term[]).filter(t=>t.case_input_id===input?.id&&!t.removed);
      setDocument(input?{input,terms}:null);setTexts(Object.fromEntries(terms.map(t=>[t.id,t.statement_masked])));
      setTargets(Object.fromEntries(terms.map(t=>[t.id,t.base_passport_id===basePassport?t.target_claim_id??"":""])));
      setOcrReviewed(new Set(terms.filter(t=>t.confirmed).map(t=>t.id)));
    }catch(e){if(alive&&sessionIdentity(readSessionToken())===sessionKey)setMessage((e as Error).message);}})();
    return ()=>{alive=false;};
    // 세션 갱신은 같은 사용자의 작성 중 문구를 초기화하지 않는다.
  },[caseId,basePassport,sessionKey]);
  const apply=(value:Document)=>{
    const selected=value.terms.filter(t=>t.confirmed&&t.base_passport_id===basePassport&&t.target_claim_id);
    if(!selected.length)throw new Error("현재 기준 Passport에 연결한 문구가 없습니다.");
    onUse(Object.fromEntries(selected.map(t=>[t.target_claim_id!,t.statement_masked])),Object.fromEntries(selected.map(t=>[t.target_claim_id!,t.id])));
    setMessage("확인한 문구를 아래 계약 비교에 적용했습니다. 아직 점검을 시작하지 않았습니다.");
  };
  const confirm=async()=>{
    if(!document||!current())return;
    setBusy(true);onBusyChange(true);
    try {
      if(document.terms.some(t=>t.confirmed)){apply(document);return;}
      const selected=document.terms.filter(t=>targets[t.id]).map(t=>({id:t.id,target_claim_id:targets[t.id],statement_masked:texts[t.id],
        ...(t.source_locator.review_required?{ocr_reviewed:ocrReviewed.has(t.id)}:{})}));
      if(!selected.length)throw new Error("한 문구 이상을 이전 권유와 연결해 주세요.");
      if(document.terms.some(t=>targets[t.id]&&t.source_locator.review_required&&!ocrReviewed.has(t.id)))throw new Error("낮은 신뢰도 문구를 원본과 대조해 주세요.");
      const response=await sessionFetch(`/api/finshield/cases/${caseId}/aftercare/documents`,token,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
        body:JSON.stringify({input_id:document.input.id,base_passport_id:basePassport,claims:selected})});
      const data=await response.json();if(!response.ok)throw new Error(data.error);
      const saved=await load();if(saved&&current())apply(saved);
    }catch(e){if(current())setMessage((e as Error).message);}finally{if(current()){setBusy(false);onBusyChange(false);}}
  };
  const discard=async()=>{
    if(!document)return;setBusy(true);onBusyChange(true);
    try{const response=await sessionFetch(`/api/finshield/cases/${caseId}/stop`,token,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({input_id:document.input.id})});
      if(!response.ok)throw new Error("문서 중단을 확인하지 못했습니다.");await load();setMessage("문서 처리를 중단하고 원본 삭제를 요청했습니다.");
    }catch(e){if(current())setMessage((e as Error).message);}finally{if(current()){setBusy(false);onBusyChange(false);}}
  };
  const confirmed=document?.terms.some(t=>t.confirmed);
  return <section aria-label="가입 후 계약 문서" className="mt-5">
    <h3 className="fs-h2">계약 파일의 문구 확인</h3>
    <p className="fs-meta mt-2">인식한 숫자·단위·부정 표현을 원본과 대조하고 필요한 문구를 수정하세요. 확인한 문구는 같은 Case의 가입 후 비교에만 사용합니다.</p>
    {document?<div className="mt-4">
      <p className="fs-meta">{document.input.raw_delete_status==="SUCCEEDED"?"서버 원본 삭제 확인":"원본 임시 처리 또는 삭제 진행 중"} · 원본은 본인 기기에 보관하세요.</p>
      {!document.terms.length?<p className="fs-body mt-2">문장 추출을 끝내지 못한 입력입니다. 중단하고 새로 올릴 수 있습니다.</p>:null}
      {document.terms.map(t=><div key={t.id} className="mt-4">
        <label htmlFor={`document-text-${t.id}`} className="fs-label">{t.source_locator.page_no}쪽 인식 문구</label>
        <textarea id={`document-text-${t.id}`} className="fs-field" maxLength={400} rows={2} value={texts[t.id]??""} disabled={busy||confirmed}
          onChange={e=>{setTexts(old=>({...old,[t.id]:e.target.value}));setOcrReviewed(old=>{const next=new Set(old);next.delete(t.id);return next;});}}/>
        {t.source_locator.review_required?<label className="fs-inline-notice mt-2 flex items-start gap-2">
          <input type="checkbox" className="mt-1" checked={ocrReviewed.has(t.id)} disabled={busy||confirmed}
            onChange={e=>setOcrReviewed(old=>{const next=new Set(old);if(e.target.checked)next.add(t.id);else next.delete(t.id);return next;})}/>
          <span>OCR 신뢰도가 낮은 숫자·기관·상품·주소·부정 표현 등의 문구이 있습니다. 본 기기의 원본 {t.source_locator.page_no}쪽과 대조했습니다.</span>
        </label>:null}
        <label htmlFor={`document-target-${t.id}`} className="fs-label mt-2">비교할 이전 권유</label>
        <select id={`document-target-${t.id}`} className="fs-field" value={targets[t.id]??""} disabled={busy||confirmed} onChange={e=>setTargets(old=>({...old,[t.id]:e.target.value}))}>
          <option value="">이 문구를 비교에서 제외</option>{prior.map(c=><option key={c.claim_id} value={c.claim_id}>{c.statement_masked}</option>)}
        </select>
      </div>)}
      <div className="mt-4 flex flex-wrap gap-3">
        {document.terms.length?<button type="button" className="fs-btn fs-btn--quiet" disabled={busy} onClick={()=>void confirm()}>{confirmed?"확인한 문구 적용":"문구 확인하고 원본 지우기"}</button>:null}
        {!confirmed?<button type="button" className="fs-btn fs-btn--quiet" disabled={busy} onClick={()=>void discard()}>이 문서 중단하고 지우기</button>:null}
      </div>
    </div>:null}
    {!document||confirmed?<FileIntake token={token} caseId={caseId} onBusyChange={onBusyChange} onPrepared={()=>{void load().catch(()=>setMessage("추출한 문구를 다시 읽지 못했습니다. 화면을 다시 열어 주세요."));}}/>:null}
    {message?<p role="status" className="fs-body mt-3">{message}</p>:null}
  </section>;
}
