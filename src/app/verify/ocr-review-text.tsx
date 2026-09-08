import type { ReactNode } from "react";
import type { OcrReviewField } from "./file-intake";

/** 마스킹된 문자열의 위치만 표시한다. 원본 파일이나 숨긴 개인정보는 다시 읽지 않는다. */
export function OcrReviewText({text,fields=[]}:{text:string;fields?:OcrReviewField[]}) {
  const spans=fields.filter(field=>Number.isInteger(field.start)&&Number.isInteger(field.end)
    &&field.start>=0&&field.end>field.start&&field.end<=text.length).sort((a,b)=>a.start-b.start);
  let cursor=0;
  const parts:ReactNode[]=[];
  for(const field of spans){
    const start=Math.max(cursor,field.start);
    if(field.end<=start)continue;
    parts.push(text.slice(cursor,start),<mark key={`${start}-${field.end}`} className="rounded bg-amber-100 px-0.5 text-amber-950" title="원본과 대조할 낮은 신뢰도 문구">{text.slice(start,field.end)}</mark>);
    cursor=field.end;
  }
  return <>{parts}{text.slice(cursor)}</>;
}
