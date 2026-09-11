// INP-003·SEC-FILE-004: 외부 연결·서비스 자격증명 없는 일회용 VM에서만 실행한다.
// 입력/출력은 임시 파일이다. 원문·파일명을 stdout/stderr에 출력하지 않는다.
import { readFileSync, writeFileSync } from 'node:fs';
import { inspectFile } from './inspector.mjs';

const save = value => writeFileSync('/vercel/sandbox/result.json', JSON.stringify(value));
async function main() {
  const meta = JSON.parse(readFileSync('/vercel/sandbox/request.json', 'utf8'));
  const bytes = readFileSync('/vercel/sandbox/input.bin');
  const inspection = inspectFile({ bytes, declaredMime: meta.mime, filename: meta.filename });
  if (inspection.verdict !== 'ACCEPT') {
    save({ ok:false, code:'FILE_REJECTED', reasons:inspection.reasons.map(reason=>reason.code) }); return;
  }
  if (inspection.detected_mime !== 'application/pdf') {
    // OCR 한도를 전송 전에 확인하도록 헤더의 가로·세로만 넘긴다. 화소 자료는 넘기지 않는다.
    const image={ width:inspection.metrics.image_width, height:inspection.metrics.image_height };
    save({ ok:true, mime:inspection.detected_mime, pages:[{ page_no:1, text:'', words:[] }], needs_ocr:true, image }); return;
  }
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data:new Uint8Array(bytes), isEvalSupported:false,
    disableFontFace:true, useSystemFonts:false, stopAtErrors:true, verbosity:0,
    standardFontDataUrl:'/vercel/sandbox/node_modules/pdfjs-dist/standard_fonts/',
    cMapUrl:'/vercel/sandbox/node_modules/pdfjs-dist/cmaps/',cMapPacked:true,
    disableAutoFetch:true,disableStream:true });
  try {
    const doc = await task.promise;
    if (doc.numPages>10) {save({ok:false,code:'PAGE_LIMIT'});return;}
    const pages=[];
    for(let pageNo=1;pageNo<=doc.numPages;pageNo++) {
      const page=await doc.getPage(pageNo);
      const viewport=page.getViewport({scale:1});
      if(viewport.width*viewport.height>25_000_000) {save({ok:false,code:'PIXEL_LIMIT'});return;}
      const content=await page.getTextContent();
      const words=content.items.filter(item=>typeof item.str==='string').map(item=>({
        text:item.str, bbox:[item.transform[4]/viewport.width,
          1-(item.transform[5]+item.height)/viewport.height,item.width/viewport.width,item.height/viewport.height],
      }));
      const text=words.map(word=>word.text).join(' ').trim();
      if(text.length>12000) {save({ok:false,code:'TEXT_LIMIT'});return;}
      pages.push({page_no:pageNo,text,words});page.cleanup();
    }
    // 쪽마다 글자 층을 읽을 수 있는지 남긴다. 일부 쪽만 비었으면 나머지는 OCR 없이 쓸 수 있다.
    const unreadable=pages.filter(page=>page.text.length<10 || /\uFFFD/.test(page.text)).map(page=>page.page_no);
    save({ok:true,mime:'application/pdf',parser_version:pdfjs.version,pages,needs_ocr:unreadable.length>0,unreadable_pages:unreadable});
  } finally {await task.destroy();}
}
main().catch(()=>{save({ok:false,code:'PARSER_FAILED'});process.exitCode=1;});
