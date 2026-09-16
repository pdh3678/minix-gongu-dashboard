import DOMPurify from 'dompurify';

// BlockNote 기본 붙여넣기는 노션 콘텐츠 대부분(제목/중첩목록/할일/인용/코드/표/토글 — details·summary를
// 그대로 toggleListItem으로 변환)을 이미 정확히 처리함(실측 확인, 2026-08-13). 유일한 공백은 노션의
// 다단(className에 column-list가 들어간 div) — 기본 파서가 그냥 순서대로 평탄화해 좌우 배치가 사라짐.
// 그래서 column-list가 있을 때만 개입하고, 그 안팎의 다른 내용은 각 노드마다
// editor.tryParseHTMLToBlocks로 BlockNote의 기본 파싱을 그대로 재사용해 유실 없이 재구성함.

/* ── 붙여넣기 HTML 정화 (2026-09-16) ────────────────────────────────────────────
   클립보드의 text/html은 **외부에서 온 임의의 HTML**이다. 노션에서 복사했다고 보장할 수 없고,
   웹페이지에서 복사한 내용에 <script>·onerror·javascript: 가 섞여 있을 수 있다.
   예전엔 그 문자열을 DOMParser로 파싱해 innerHTML/outerHTML을 그대로 editor에 넘겼다.

   회고 본문은 시트에 저장돼 **다른 사람의 화면에서 다시 렌더링**되므로, 한 번 들어간 스크립트는
   그걸 여는 모든 사람에게 실행된다(저장형 XSS). 파싱 **전에** 한 번 정화한다 —
   파싱 후 노드를 돌며 지우는 방식은 빠뜨리는 경로가 생긴다.

   FORBID_*를 따로 지정하지 않는 이유: DOMPurify 기본 설정이 이미 script/style/이벤트 핸들러·
   위험 프로토콜을 제거한다. 여기서는 노션 다단 판정에 필요한 class 속성만 확실히 남긴다. */
function sanitizeClipboardHtml(html) {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['class'],  // column-list 판정이 className에 의존한다
    // 표/체크박스/토글 등 노션 구조를 살리기 위해 기본 허용 태그 집합을 그대로 쓴다
    KEEP_CONTENT: true,
  });
}

export function makeNotionPasteHandler() {
  return ({ event, editor, defaultPasteHandler }) => {
    const raw = event.clipboardData && event.clipboardData.getData('text/html');
    if (!raw) return defaultPasteHandler();
    const html = sanitizeClipboardHtml(raw);
    // 다단이 아니면 BlockNote 기본 처리에 맡긴다(기본 파서도 자체적으로 정화한다)
    if (!/column-list/i.test(html)) return defaultPasteHandler();

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const blocks = [];
    Array.from(doc.body.children).forEach((node) => {
      if (/column-list/i.test(node.className || '')) {
        const cols = Array.from(node.children).filter((c) => c.nodeType === 1);
        if (cols.length >= 2) {
          blocks.push({
            type: 'columnList',
            children: cols.map((col) => ({
              type: 'column',
              props: { width: 1 },
              children: editor.tryParseHTMLToBlocks(col.innerHTML),
            })),
          });
          return;
        }
      }
      blocks.push(...editor.tryParseHTMLToBlocks(node.outerHTML));
    });
    if (!blocks.length) return defaultPasteHandler();

    const cur = editor.getTextCursorPosition().block;
    editor.insertBlocks(blocks, cur, 'after');
    event.preventDefault();
    return true;
  };
}
