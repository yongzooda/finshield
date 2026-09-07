// Linux network namespace + Node 권한 모델에서 실행한다. 환경은 PATH만 허용한다.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {linesFromBoxes} from './ocr-quality-text.mjs';
try {
 const data=new Uint8Array(readFileSync(process.argv[2]));
 const parserRoot=process.argv[3];
 const {getDocument,version}=await import(pathToFileURL(`${parserRoot}/node_modules/pdfjs-dist/legacy/build/pdf.mjs`).href);
 const task=getDocument({data,isEvalSupported:false,disableFontFace:true,useSystemFonts:false,stopAtErrors:true,verbosity:0,standardFontDataUrl:pathToFileURL(`${parserRoot}/node_modules/pdfjs-dist/standard_fonts/`).href,cMapUrl:pathToFileURL(`${parserRoot}/node_modules/pdfjs-dist/cmaps/`).href,cMapPacked:true,disableAutoFetch:true,disableStream:true});
 const doc=await task.promise;
 if(doc.numPages<1||doc.numPages>10)throw Error('PAGE_LIMIT');
 const pages=[];
 try {for(let i=1;i<=doc.numPages;i++){
  const page=await doc.getPage(i);const content=await page.getTextContent();
  pages.push(linesFromBoxes(content.items.filter(item=>typeof item.str==='string'&&item.str.trim()).map(item=>({text:item.str,x:item.transform[4],y:-item.transform[5],height:item.height||Math.abs(item.transform[3])||10}))));
 }}finally{await task.destroy();}
 const guard=globalThis.__finshieldNetworkGuard;
 if(!guard||guard.attempts!==0||Object.keys(process.env).some(key=>key!=='PATH' && !(process.platform==='darwin' && key==='__CF_USER_TEXT_ENCODING')))throw Error('ISOLATION_FAILED');
 process.stdout.write(JSON.stringify({pages,parser_version:version,network_attempts:guard.attempts,environment_keys:Object.keys(process.env),permission_model:Boolean(process.permission)}));
}catch{process.stderr.write('OCR_PARSER_FAILED\n');process.exitCode=1;}
