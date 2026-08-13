import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BlockNoteView } from '@blocknote/mantine';
import { SuggestionMenuController, SideMenuController, getDefaultReactSlashMenuItems, useCreateBlockNote } from '@blocknote/react';
// Inter 폰트(@blocknote/core/fonts/inter.css)는 일부러 로드하지 않음 — theme.js가 폰트를
// Pretendard(대시보드 기본 폰트)로 덮어써서 안 쓰는데, 그 CSS를 로드하면 폰트 파일이
// data URI로 번들에 통째로 인라인되어 review.css가 700KB 넘게 불어남.
import '@blocknote/mantine/style.css';
import { schema, dictionary, dropCursor, makeGetSlashMenuItems } from './schema.js';
import { reviewTheme } from './theme.js';
import { makeUploadFile, reuploadExternalImagesInDocument } from './imageUpload.js';
import { makeNotionPasteHandler } from './notionPaste.js';
import { CustomSideMenu } from './turnInto.jsx';
import { listReviews, getReview, getReviewMetaQuick, saveReview, deleteReview } from './api.js';

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

  return (
    <div className="rv2-card">
      <div className="rv2-card-hd">
        회고
        <button className="rv2-btn-primary" onClick={onNew}>＋ 새 회고</button>
      </div>
      <div className="rv2-list">
        {state === 'loading' && <div className="rv2-placeholder">불러오는 중...</div>}
        {state === 'error' && <div className="rv2-placeholder">불러오기 실패</div>}
        {state === 'ready' && reviews.length === 0 && (
          <div className="rv2-placeholder">아직 작성된 회고가 없습니다.<br />"+ 새 회고"로 시작해보세요.</div>
        )}
        {state === 'ready' && reviews.map((r) => (
          <div className="rv2-list-item" key={r.id} onClick={() => onOpen(r.id)}>
            <div className="rv2-list-title">{r.title || '제목 없음'}</div>
            <div className="rv2-list-meta">
              {[r.ym, r.team, r.part, r.owner].filter(Boolean).join(' · ')}
              {r.updatedAt ? ' · ' + fmtTime(r.updatedAt) : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewEditor({ bridge, docId, onBack }) {
  const [doc, setDoc] = useState(emptyDoc());
  const [initialBlocks, setInitialBlocks] = useState(docId ? undefined : []);
  const [loadState, setLoadState] = useState(docId ? 'loading' : 'ready');
  const [saveStatus, setSaveStatus] = useState('');
  const [saveErr, setSaveErr] = useState(false);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
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
    setSaveStatus('저장 중...'); setSaveErr(false);
    try {
      const j = await saveReview(bridge, d, editor.document);
      setDoc((prev) => ({ ...prev, id: j.id, updatedAt: j.updatedAt, editedBy: j.editedBy }));
      baseUpdatedAtRef.current = j.updatedAt || '';
      dirtyRef.current = false;
      setSaveStatus((j.editedBy ? j.editedBy + ' ' : '') + '최종 편집 · ' + fmtTime(j.updatedAt));
      if (manual) bridge.showToast('저장되었습니다.');
    } catch (e) {
      setSaveStatus('저장 실패: ' + e.message); setSaveErr(true);
      if (manual) bridge.showToast('저장 실패: ' + e.message);
    } finally {
      savingRef.current = false;
    }
  }, [editor, bridge, loadState]);

  const onEdit = useCallback(() => {
    dirtyRef.current = true;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => doSave(false), AUTOSAVE_DELAY_MS);
  }, [doSave]);

  // 이탈 시 대기 중인 자동저장을 흘려보냄(사이드바로 다른 탭 이동 시 유실 방지) — 기존 회고와 동일 정책
  useEffect(() => () => {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    if (dirtyRef.current) doSave(false);
  }, [doSave]);

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
          <button className="rv2-btn-primary" onClick={() => doSave(true)}>저장</button>
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
          <BlockNoteView editor={editor} theme={reviewTheme} slashMenu={false} sideMenu={false} onChange={onEdit} portalElements={{ default: null }}>
            <SuggestionMenuController triggerCharacter="/" getItems={getSlashMenuItems} />
            {/* 기본 사이드 메뉴(⋮⋮) 대신 "전환" 서브메뉴가 추가된 커스텀 메뉴로 교체 — turnInto.jsx */}
            <SideMenuController sideMenu={CustomSideMenu} />
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
      <ReviewEditor
        bridge={bridge}
        docId={route.docId}
        onBack={() => setRoute({ view: 'list' })}
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
