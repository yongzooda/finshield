import {createHash} from 'node:crypto';
// OCR/Parser 출력은 같은 구조로 평가한다. 기대 정답은 추출 함수에 전달하지 않는다.
export const compact = text => text.normalize('NFC').replace(/\s+/gu, '');
export const numericTokens = text => text.split(/\n/u).flatMap(line => {
 const value=compact(line);const label=value.match(/^([^:：]+)[:：]/u)?.[1]??'unlabelled';
 return (value.match(/\d+(?:,\d{3})*(?:\.\d+)?(?:%p|%|만원|개월)?/gu)??[]).map(token=>`${label}:${token}`);
});
export const negationTokens = text => text.split(/\n/u).map(compact).filter(line => /않|없|아닙|못/u.test(line));
export function fieldValues(text) {
 const keys = {기관:'institution',상품:'product',주소:'url'};
 return text.split(/\n/u).flatMap(line => {
  const match = /^\s*(기관|상품|주소)\s*[:：]\s*(.+?)\s*$/u.exec(line);
  return match ? [{type:keys[match[1]],value:compact(match[2])}] : [];
 });
}
export function counts(expected, actual) {
 const pending=new Map();for(const value of expected)pending.set(value,(pending.get(value)??0)+1);
 let tp=0;for(const value of actual){const n=pending.get(value)??0;if(n>0){tp++;pending.set(value,n-1);}}
 return {expected:expected.length,predicted:actual.length,tp,fp:actual.length-tp,fn:expected.length-tp};
}
export function pageDiff(expected, text) {
 const fields=Object.entries(expected.fields).map(([type,value])=>`${type}:${compact(value)}`);
 const observed=fieldValues(text).map(({type,value})=>`${type}:${value}`);
 return {numeric:counts(numericTokens(expected.text),numericTokens(text)),
  negation:counts(negationTokens(expected.text),negationTokens(text)),fields:counts(fields,observed)};
}
// y 좌표가 가까운 field를 행으로 묶고 x 순서로 읽는다. 정답으로 재정렬하지 않는다.
export function linesFromBoxes(boxes) {
 const rows=[];
 for(const box of [...boxes].sort((a,b)=>a.y-b.y||a.x-b.x)) {
  let row=rows.find(row=>Math.abs(row.y-box.y)<=Math.max(2,Math.min(row.height,box.height)*.55));
  if(!row){row={y:box.y,height:box.height,boxes:[]};rows.push(row);}
  row.boxes.push(box);
 }
 return rows.sort((a,b)=>a.y-b.y).map(row=>row.boxes.sort((a,b)=>a.x-b.x).map(box=>box.text).join(' ')).join('\n');
}

const hash = value=>createHash('sha256').update(value).digest('hex');
export function observePage(text) {
 return {text_sha256:hash(text),numeric_hashes:numericTokens(text).map(hash),
  negation_hashes:negationTokens(text).map(hash),field_hashes:fieldValues(text).map(({type,value})=>hash(`${type}:${value}`))};
}
export function expectedPage(truth) {
 return {...observePage(truth.text),field_hashes:Object.entries(truth.fields).map(([type,value])=>hash(`${type}:${compact(value)}`))};
}
