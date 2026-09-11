-- EV-009: 법령 시행 전 Snapshot이 시행 후 조회와 충돌하지 않는다.
begin;
do $$
declare old_id uuid; old_reused uuid; current_id uuid; repeated_id uuid;
begin
 old_id := private.record_source_snapshot('LAW','A','법제처','합성 시행일 경계 법령',null,
  'synthetic:effective-boundary','합성 시행일 경계 법령','제2조',null,'2026-09-08','2026-09-08',
  repeat('a',64),repeat('b',64),'UNKNOWN','LAW_GO_KR_PUBLIC',true,false,'lookup_statute','synthetic:before');
 -- 기존 버전으로 다시 쓰면 이전의 인용 불가 Snapshot이 반환되는 실제 실패 원인.
 old_reused := private.record_source_snapshot('LAW','A','법제처','합성 시행일 경계 법령',null,
  'synthetic:effective-boundary','합성 시행일 경계 법령','제2조',null,'2026-09-08','2026-09-08',
  repeat('a',64),repeat('b',64),'FRESH','LAW_GO_KR_PUBLIC',true,true,'lookup_statute','synthetic:old-reused');
 if old_id <> old_reused or (select is_citable from kb.source_snapshots where id=old_id) then
  raise exception '과거 Snapshot 불변성 훼손';
 end if;
 current_id := private.record_source_snapshot('LAW','A','법제처','합성 시행일 경계 법령',null,
  'synthetic:effective-boundary','합성 시행일 경계 법령','제2조',null,'2026-09-08','2026-09-08:effective',
  repeat('a',64),repeat('b',64),'FRESH','LAW_GO_KR_PUBLIC',true,true,'lookup_statute','synthetic:current');
 repeated_id := private.record_source_snapshot('LAW','A','법제처','합성 시행일 경계 법령',null,
  'synthetic:effective-boundary','합성 시행일 경계 법령','제2조',null,'2026-09-08','2026-09-08:effective',
  repeat('a',64),repeat('b',64),'FRESH','LAW_GO_KR_PUBLIC',true,true,'lookup_statute','synthetic:repeat');
 if current_id = old_id or current_id <> repeated_id or not
  (select is_citable from kb.source_snapshots where id=current_id) then
  raise exception '시행 후 Snapshot 분리·재조회 실패';
 end if;
 if (select count(distinct source_fingerprint) from kb.source_snapshots where id in(old_id,current_id))<>1 then
  raise exception '같은 원문을 독립 출처로 중복 계산';
 end if;
 raise notice '43_statute_effective_snapshot: 시행 전후 조회·과거 불변성·원문 지문 보존 통과했습니다';
end $$;
rollback;
