import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BlockNoteView } from '@blocknote/mantine';
import { SuggestionMenuController, SideMenuController, FormattingToolbarController, getDefaultReactSlashMenuItems, useCreateBlockNote } from '@blocknote/react';
// Inter 폰트(@blocknote/core/fonts/inter.css)는 일부러 로드하지 않음 — theme.js가 폰트를
// Pretendard(대시보드 기본 폰트)로 덮어써서 안 쓰는데, 그 CSS를 로드하면 폰트 파일이
// data URI로 번들에 통째로 인라인되어 review.css가 700KB 넘게 불어남.
import '@blocknote/mantine/style.css';
import { schema, dictionary, dropCursor, makeGetSlashMenuItems } from './schema.js';
import { reviewTheme } from './theme.js';
import { makeUploadFile, reuploadExternalImagesInDocument } from './imageUpload.js';
import { makeNotionPasteHandler } from './notionPaste.js';
import { CustomSideMenu } from './turnInto.jsx';
import { CustomFormattingToolbar } from './formattingToolbar.jsx';
import { PeriodFilter, reviewMatchesPeriod } from './periodFilter.jsx';
import { listReviews, getReview, getReviewMetaQuick, saveReview, deleteReview, duplicateReview } from './api.js';

const AUTOSAVE_DELAY_MS = 3000;

function currentYm() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function emptyDoc() {
  return { id: '', title: '', ym: currentYm(), owner: '', team: '', part: '', updatedAt: '', editedBy: '' };
}

// 구 Editor.js 문서(예: {time,blocks,version} 객체)는 BlockNote 배열 문서와 다른 포맷이라
// 마이그레이션하지 않음(원본은 노션에 있음) — 배열이면 그대로 쓰고, 아니면 빈 문서로 시작.
function contentToInitialBlocks(content) {
  const s = String(content == null ? '' : content).trim();
  if (!s) return undefined;
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (e) {
    /* 구버전 일반 텍스트 등 — 빈 문서로 시작 */
  }
  return undefined;
}

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    return (
      d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0') +
      ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
    );
  } catch (e) {
    return '';
  }
}

function ReviewList({ bridge, onOpen, onNew }) {
  const [reviews, setReviews] = useState([]);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [filterYear, setFilterYear] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [busyId, setBusyId] = useState(''); // 복사/삭제 진행 중인 항목 id — 중복 클릭 방지

  const load = useCallback(async () => {
    setState('loading');
    try {
      const list = await listReviews(bridge);
      setReviews(list);
      setState('ready');
    } catch (e) {
      setState('error');
    }
  }, [bridge]);

  useEffect(() => { load(); }, [load]);

  // 정렬은 listReviews가 이미 최신순(updatedAt 내림차순)으로 내려준 순서를 그대로 유지 —
  // 여기선 걸러내기만 하고 재정렬하지 않음.
  const filtered = useMemo(
    () => reviews.filter((r) => reviewMatchesPeriod(r.ym, filterYear, filterMonth)),
    [reviews, filterYear, filterMonth]
  );

  const handleDuplicate = useCallback(async (r, ev) => {
    ev.stopPropagation();
    if (busyId) return;
    setBusyId(r.id);
    try {
      const j = await duplicateReview(bridge, r.id);
      bridge.showToast('복사본이 생성되었습니다.', { type: 'success' });
      onOpen(j.id); // 복사 직후 바로 새 회고 편집 화면으로 이동
    } catch (e) {
      bridge.showToast('복사 실패: ' + e.message, { type: 'error' });
    } finally {
      setBusyId('');
    }
  }, [bridge, busyId, onOpen]);

  const handleDelete = useCallback(async (r, ev) => {
    ev.stopPropagation();
    if (busyId) return;
    if (!window.confirm('이 회고를 삭제하시겠습니까? 되돌릴 수 없습니다.\n\n' + (r.title || '제목 없음'))) return;
    setBusyId(r.id);
    try {
      await deleteReview(bridge, r.id);
      setReviews((prev) => prev.filter((x) => x.id !== r.id));
      bridge.showToast('삭제되었습니다.', { type: 'success' });
    } catch (e) {
      bridge.showToast('삭제 실패: ' + e.message, { type: 'error' });
    } finally {
      setBusyId('');
    }
  }, [bridge, busyId]);

  return (
    <div className="rv2-card">
      <div className="rv2-card-hd">
        회고
        <button className="rv2-btn-primary" onClick={onNew}>＋ 새 회고</button>
      </div>
      {state === 'ready' && reviews.length > 0 && (
        <PeriodFilter reviews={reviews} year={filterYear} month={filterMonth} onChange={(y, m) => { setFilterYear(y); setFilterMonth(m); }} />
      )}
      <div className="rv2-list">
        {state === 'loading' && <div className="rv2-placeholder">불러오는 중...</div>}
        {state === 'error' && <div className="rv2-placeholder">불러오기 실패</div>}
        {state === 'ready' && reviews.length === 0 && (
          <div className="rv2-placeholder">아직 작성된 회고가 없습니다.<br />"+ 새 회고"로 시작해보세요.</div>
        )}
        {state === 'ready' && reviews.length > 0 && filtered.length === 0 && (
          <div className="rv2-placeholder">해당 기간에 회고가 없습니다.</div>
        )}
        {state === 'ready' && filtered.map((r) => (
          <div className="rv2-list-item" key={r.id} onClick={() => onOpen(r.id)}>
            <div className="rv2-list-title">{r.title || '제목 없음'}</div>
            <div className="rv2-list-meta">
              {[r.ym, r.team, r.part, r.owner].filter(Boolean).join(' · ')}
              {r.updatedAt ? ' · ' + fmtTime(r.updatedAt) : ''}
            </div>
            <div className="rv2-list-item-actions">
              <button type="button" className="rv2-icon-btn" title="복사" aria-label="복사" disabled={!!busyId} onClick={(ev) => handleDuplicate(r, ev)}>{busyId === r.id ? '...' : '📋'}</button>
              <button type="button" className="rv2-icon-btn danger" title="삭제" aria-label="삭제" disabled={!!busyId} onClick={(ev) => handleDelete(r, ev)}>{busyId === r.id ? '...' : '🗑'}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewEditor({ bridge, docId, onBack, onOpen }) {
  const [doc, setDoc] = useState(emptyDoc());
  const [initialBlocks, setInitialBlocks] = useState(docId ? undefined : []);
  const [loadState, setLoadState] = useState(docId ? 'loading' : 'ready');
  const [saveStatus, setSaveStatus] = useState('');
  const [saveErr, setSaveErr] = useState(false);
  const [isSaving, setIsSaving] = useState(false); // 저장 버튼 비활성화/라벨 전환용(ref는 리렌더를 안 일으켜 별도 state 필요)
  const [isDup, setIsDup] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const deletingRef = useRef(false); // 삭제 요청 도중 편집이 들어와도 자동저장이 그 회고를 되살리지 않게 막음
  const baseUpdatedAtRef = useRef('');
  const autosaveTimer = useRef(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  useEffect(() => {
    if (!docId) return;
    let cancelled = false;
    (async () => {
      try {
        const review = await getReview(bridge, docId);
        if (cancelled) return;
        baseUpdatedAtRef.current = review.updatedAt || '';
        setDoc({
          id: review.id, title: review.title || '', ym: review.ym || currentYm(),
          owner: review.owner || '', team: review.team || '', part: review.part || '',
          updatedAt: review.updatedAt || '', editedBy: review.editedBy || '',
        });
        setInitialBlocks(contentToInitialBlocks(review.content) || []);
        setLoadState('ready');
      } catch (e) {
        if (!cancelled) setLoadState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [bridge, docId]);

  const uploadFile = useMemo(() => makeUploadFile(bridge), [bridge]);
  const pasteHandler = useMemo(() => makeNotionPasteHandler(), []);

  // deps에 loadState를 넣어 "불러오는 중"(초기 콘텐츠 비어있는 임시 에디터) →
  // "준비됨"(실제 initialContent로) 전환 시 1회만 재생성되게 함 — 스키마는 항상 동일하게 유지.
  const editor = useCreateBlockNote(
    { schema, dictionary, dropCursor, uploadFile, pasteHandler, initialContent: initialBlocks && initialBlocks.length ? initialBlocks : undefined },
    [loadState, docId]
  );

  const getSlashMenuItems = useMemo(() => makeGetSlashMenuItems(editor), [editor]);

  const doSave = useCallback(async (manual) => {
    if (loadState !== 'ready' || savingRef.current) {
      if (savingRef.current) autosaveTimer.current = setTimeout(() => doSave(false), AUTOSAVE_DELAY_MS);
      return;
    }
    const d = docRef.current;
    if (!bridge.getGasUrl() || !bridge.getToken()) {
      if (manual) bridge.showToast('로그인이 필요합니다.');
      return;
    }
    if (d.id && baseUpdatedAtRef.current) {
      const remote = await getReviewMetaQuick(bridge, d.id);
      if (remote && remote.updatedAt && remote.updatedAt !== baseUpdatedAtRef.current) {
        if (!manual) {
          setSaveStatus('다른 팀원(' + (remote.editedBy || '?') + ')이 이 회고를 수정했습니다 — [저장] 버튼으로 덮어쓸지 결정해주세요.');
          setSaveErr(true);
          return;
        }
        const who = remote.editedBy ? '다른 팀원(' + remote.editedBy + ')' : '다른 팀원';
        if (!window.confirm(who + '이 이 회고를 수정했습니다. 덮어쓰시겠습니까?\n(취소하면 저장하지 않습니다)')) return;
      }
    }
    savingRef.current = true;
    setIsSaving(true);
    setSaveStatus('저장 중...'); setSaveErr(false);
    try {
      // GAS 콜드스타트로 느릴 수 있어 여기 await가 응답(또는 _gasFetch 자체의 20초 타임아웃+3회
      // 재시도가 전부 실패)까지 그대로 걸림 — 그동안 버튼은 isSaving으로 계속 비활성 상태 유지.
      const j = await saveReview(bridge, d, editor.document);
      setDoc((prev) => ({ ...prev, id: j.id, updatedAt: j.updatedAt, editedBy: j.editedBy }));
      baseUpdatedAtRef.current = j.updatedAt || '';
      dirtyRef.current = false;
      setSaveStatus((j.editedBy ? j.editedBy + ' ' : '') + '최종 편집 · ' + fmtTime(j.updatedAt));
      if (manual) bridge.showToast('저장되었습니다.', { type: 'success' });
    } catch (e) {
      setSaveStatus('저장 실패: ' + e.message); setSaveErr(true);
      if (manual) bridge.showToast('저장에 실패했습니다. 다시 시도해주세요.', { type: 'error' });
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }, [editor, bridge, loadState]);

  const onEdit = useCallback(() => {
    if (deletingRef.current) return; // 삭제 진행 중엔 편집을 자동저장 대상으로 잡지 않음(아래 handleDelete 참고)
    dirtyRef.current = true;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => doSave(false), AUTOSAVE_DELAY_MS);
  }, [doSave]);

  // 이탈 시 대기 중인 자동저장을 흘려보냄(사이드바로 다른 탭 이동 시 유실 방지) — 기존 회고와 동일 정책
  useEffect(() => () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    if (dirtyRef.current) doSave(false);
  }, [doSave]);

  // 복사 — 서버가 메타+본문+이미지를 전부 복제한 새 문서를 만들어주면, 그 id로 바로 편집 화면 이동.
  const handleDuplicate = useCallback(async () => {
    if (!doc.id || isDup) return;
    setIsDup(true);
    try {
      const j = await duplicateReview(bridge, doc.id);
      bridge.showToast('복사본이 생성되었습니다.', { type: 'success' });
      onOpen(j.id);
    } catch (e) {
      bridge.showToast('복사 실패: ' + e.message, { type: 'error' });
    } finally {
      setIsDup(false);
    }
  }, [bridge, doc.id, isDup, onOpen]);

  // 삭제 — 확인 즉시 대기 중인 자동저장을 끊고 dirty를 꺼서, 삭제 요청이 나간 뒤 컴포넌트가
  // 언마운트될 때(위 이탈 처리 effect)나 삭제 도중의 편집으로 도로 저장되어 "되살아나는" 일이
  // 없게 함(2026-08-25 — deleteReview는 행을 완전히 지우므로, 뒤늦은 saveReview가 같은 id로
  // 다시 appendRow해버리면 삭제가 무의미해짐).
  const handleDelete = useCallback(async () => {
    if (!doc.id || isDeleting) return;
    if (!window.confirm('이 회고를 삭제하시겠습니까? 되돌릴 수 없습니다.')) return;
    deletingRef.current = true;
    if (autosaveTimer.current) { clearTimeout(autosaveTimer.current); autosaveTimer.current = null; }
    dirtyRef.current = false;
    setIsDeleting(true);
    try {
      await deleteReview(bridge, doc.id);
      bridge.showToast('삭제되었습니다.', { type: 'success' });
      onBack();
    } catch (e) {
      deletingRef.current = false;
      bridge.showToast('삭제 실패: ' + e.message, { type: 'error' });
      setIsDeleting(false);
    }
  }, [bridge, doc.id, isDeleting, onBack]);

  // 붙여넣기 직후 외부(비-Drive) 이미지 URL을 Drive로 재업로드 — 노션 S3 서명 URL 만료 회피
  const onPasteCapture = useCallback(() => {
    if (loadState !== 'ready') return;
    setTimeout(() => {
      reuploadExternalImagesInDocument(editor, bridge, ({ total, failed }) => {
        if (total) { onEdit(); if (failed) bridge.showToast(failed + '개 이미지 재업로드 실패(원본 링크 유지)'); }
      });
    }, 400);
  }, [editor, bridge, onEdit, loadState]);

  const updateMeta = (patch) => { setDoc((prev) => ({ ...prev, ...patch })); onEdit(); };

  if (loadState === 'loading') return <div className="rv2-placeholder">불러오는 중...</div>;
  if (loadState === 'error') return <div className="rv2-placeholder">불러오기 실패했습니다. <button className="rv2-link-btn" onClick={onBack}>목록으로</button></div>;

  return (
    <div className="rv2-detail">
      <div className="rv2-detail-top">
        <button className="rv2-btn-cancel" onClick={onBack}>← 목록</button>
        <input className="rv2-title-input" placeholder="제목 없음" value={doc.title} onChange={(e) => updateMeta({ title: e.target.value })} />
        <div className="rv2-top-r">
          <input className="rv2-ym-input" type="month" value={doc.ym} onChange={(e) => updateMeta({ ym: e.target.value })} />
          {doc.id && <button className="rv2-btn-cancel" onClick={handleDuplicate} disabled={isDup || isDeleting}>{isDup ? '복사 중...' : '📋 복사'}</button>}
          {doc.id && <button className="rv2-btn-cancel danger" onClick={handleDelete} disabled={isDeleting || isDup}>{isDeleting ? '삭제 중...' : '🗑 삭제'}</button>}
          <button className="rv2-btn-primary" onClick={() => doSave(true)} disabled={isSaving}>{isSaving ? '저장 중...' : '저장'}</button>
        </div>
      </div>
      <div className="rv2-meta-row">
        <div className="rv2-f-grp"><label className="rv2-f-lbl">담당자</label><input className="rv2-f-inp" value={doc.owner} onChange={(e) => updateMeta({ owner: e.target.value })} /></div>
        <div className="rv2-f-grp"><label className="rv2-f-lbl">팀</label><input className="rv2-f-inp" value={doc.team} onChange={(e) => updateMeta({ team: e.target.value })} /></div>
        <div className="rv2-f-grp"><label className="rv2-f-lbl">파트</label><input className="rv2-f-inp" value={doc.part} onChange={(e) => updateMeta({ part: e.target.value })} /></div>
      </div>
      <div className="rv2-editor" onPasteCapture={onPasteCapture}>
        {editor && (
          // portalElements default:null → 사이드 메뉴/슬래시 메뉴/색상 등 모든 팝오버를
          // document.body 직속으로 강제 이동. 기본값(에디터 자신의 bn-container)로 두면
          // #reviewRoot 서브트리 안에 그대로 남는데, 대시보드 사이드바(.sidebar, position:fixed
          // z-index:60)가 이 서브트리 전체보다 위 스택 레이어에 있어(형제 관계, 서브트리 쪽엔
          // 명시적 z-index/position이 없음) 메뉴 자신의 z-index(300)가 아무리 높아도 사이드바에
          // 가려짐 — 스태킹 컨텍스트 경계를 못 넘는 문제라 z-index를 올려서는 해결 안 됨(실측 확인).
          <BlockNoteView editor={editor} theme={reviewTheme} slashMenu={false} sideMenu={false} formattingToolbar={false} onChange={onEdit} portalElements={{ default: null }}>
            <SuggestionMenuController triggerCharacter="/" getItems={getSlashMenuItems} />
            {/* 기본 사이드 메뉴(⋮⋮) 대신 "전환" 서브메뉴가 추가된 커스텀 메뉴로 교체 — turnInto.jsx */}
            <SideMenuController sideMenu={CustomSideMenu} />
            {/* 기본 서식 툴바에 인라인 코드 버튼 추가 — formattingToolbar.jsx */}
            <FormattingToolbarController formattingToolbar={CustomFormattingToolbar} />
          </BlockNoteView>
        )}
      </div>
      <div className={'rv2-save-status' + (saveErr ? ' err' : '')}>{saveStatus || ' '}</div>
    </div>
  );
}

export default function ReviewApp({ bridge }) {
  const [route, setRoute] = useState({ view: 'list' });

  if (route.view === 'detail') {
    return (
      // key=docId: 복사 직후처럼 편집기가 마운트된 채로 다른 문서 id로 넘어갈 때, ReviewEditor의
      // 내부 상태/이펙트(로드 상태·자동저장 타이머·BlockNote 에디터 인스턴스)가 전부 새 문서
      // 기준으로 깨끗하게 다시 초기화되도록 React가 컴포넌트를 완전히 새로 마운트하게 강제함
      // (docId prop만 바뀌면 같은 인스턴스가 재사용돼 옛 문서의 상태가 일부 남는 문제가 있었음).
      <ReviewEditor
        key={route.docId}
        bridge={bridge}
        docId={route.docId}
        onBack={() => setRoute({ view: 'list' })}
        onOpen={(id) => setRoute({ view: 'detail', docId: id })}
      />
    );
  }
  return (
    <ReviewList
      bridge={bridge}
      onOpen={(id) => setRoute({ view: 'detail', docId: id })}
      onNew={() => setRoute({ view: 'detail', docId: '' })}
    />
  );
}
