"""사전 고정 OCR 평가용 합성 문서. 실제 상품·기관·사용자 정보가 아니다."""
from pathlib import Path
import hashlib
import json
import sys
import fitz

ROOT = Path(__file__).parent
FONT = sys.argv[1] if len(sys.argv) > 1 else '/System/Library/Fonts/AppleSDGothicNeo.ttc'
FAMILIES = [
 ('refinance','가상새빛은행','시험대환론','refinance', '선입금 수수료를 요구하지 않습니다.', '승인을 보장하지 않습니다.'),
 ('living','가상다온금융','시험생활론','living', '대출 실행 전 입금을 받지 않습니다.', '심사 없이 승인되지 않습니다.'),
 ('institution','가상누리은행','시험보증론','guarantee', '등록만으로 개별 거래를 보장하지 않습니다.', '문자만으로 기관을 확인할 수 없습니다.'),
 ('channel','가상온빛금융','시험안심론','channel', '개인 계좌로 보증료를 받지 않습니다.', '공식 상담은 승인을 의미하지 않습니다.'),
 ('withdrawal','가상푸른은행','시험선택론','withdrawal', '철회 가능 기간을 무제한으로 보장하지 않습니다.', '모든 비용이 면제되는 것은 아닙니다.'),
 ('fee','가상맑은금융','시험준비론','fee', '표시된 금리는 중개수수료가 아닙니다.', '중개인이 보증 승인을 결정하지 않습니다.'),
 ('overdue','가상여울은행','시험회복론','overdue', '연체 이자를 면제한다고 보장하지 않습니다.', '추가 대출이 자동 승인되지 않습니다.'),
 ('repayment','가상솔빛금융','시험상환론','repayment', '원금 상환 의무가 없어지는 것은 아닙니다.', '금리가 항상 고정되는 것은 아닙니다.'),
]

def document(family_index, page_number, variant):
    family, institution, product, slug, negative1, negative2 = FAMILIES[family_index]
    index = family_index + 1
    rate = f'{index + 2}.{(page_number + variant) % 10}%'
    amount = f'{(index + page_number) * 125:,}만원'
    term = f'{12 + page_number * 3}개월'
    fee = f'{(index + variant) % 3}.{page_number % 10}%'
    url = f'https://{slug}.example/loan'
    lines = ['FinShield 합성 품질 평가 문서', '실제 상품 조건과 사용자 문서가 아닙니다.',
             f'문서 구분: {family}', f'페이지: {page_number}',
             f'기관: {institution}', f'상품: {product}', f'주소: {url}',
             f'연 금리: {rate}', f'한도: {amount}', f'상환 기간: {term}',
             f'보증료율: {fee}', negative1, negative2]
    doc = fitz.open(); page = doc.new_page(width=595, height=842)
    page.insert_font(fontname='ko', fontfile=FONT)
    # 앞부분은 안내문, 조건은 선이 있는 2열 표다. 모든 값은 수동 label로 고정한다.
    for pos, line in enumerate(lines[:7]):
        page.insert_text((38, 52 + pos * 34), line, fontname='ko', fontsize=15)
    y=302
    for pos, line in enumerate(lines[7:11]):
        label,value=line.split(': ',1);top=y+pos*42
        page.draw_rect(fitz.Rect(38,top,555,top+42),color=(.4,.4,.4),width=.5)
        page.draw_line((210,top),(210,top+42),color=(.4,.4,.4),width=.5)
        page.insert_text((48,top+27),label+':',fontname='ko',fontsize=15)
        page.insert_text((226,top+27),value,fontname='ko',fontsize=15)
    for pos,line in enumerate(lines[11:]):
        page.insert_text((38,515+pos*40),line,fontname='ko',fontsize=14)
    return doc, {'text':'\n'.join(lines), 'fields': {'institution':institution,'product':product,'url':url}, 'negations':[negative1,negative2]}

fixtures=[]
for fi,(family,*_) in enumerate(FAMILIES):
    for variant,(kind,ext,pages) in enumerate([('text','txt',1),('image','png',1),('digital','pdf',2),('scanned','pdf',10)]):
        name=f'{family}-{kind}.{ext}'; expected=[]; out=fitz.open() if kind in ('digital','scanned') else None
        for number in range(1,pages+1):
            page_doc,truth=document(fi,number,variant); expected.append(truth)
            if kind=='text': (ROOT/name).write_text(truth['text']+'\n')
            elif kind=='image': page_doc[0].get_pixmap(dpi=150).save(ROOT/name)
            elif kind=='digital': out.insert_pdf(page_doc)
            else:
                page=out.new_page(width=595,height=842)
                page.insert_image(page.rect,stream=page_doc[0].get_pixmap(dpi=150).tobytes('png'))
            page_doc.close()
        if out:
            if kind=='scanned': assert all(not p.get_text().strip() for p in out)
            else: out.subset_fonts()
            out.save(ROOT/name,garbage=4,deflate=True,no_new_id=True);out.close()
        raw=(ROOT/name).read_bytes();assert len(raw)<=10*1024*1024
        fixtures.append({'id':f'{family}-{kind}','family':family,'kind':kind,'path':name,'pages':expected,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()})
manifest={'version':'ocr-quality-v1','synthetic_only':True,'independent_blind_review':False,'table_detection':False,'documents':32,'pages':112,'fixtures':fixtures}
(ROOT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'documents':len(fixtures),'pages':sum(len(f['pages']) for f in fixtures),'bytes':sum(f['bytes'] for f in fixtures)}))
