// BlockNote 기본 붙여넣기는 노션 콘텐츠 대부분(제목/중첩목록/할일/인용/코드/표/토글 — details·summary를
// 그대로 toggleListItem으로 변환)을 이미 정확히 처리함(실측 확인, 2026-08-13). 유일한 공백은 노션의
// 다단(className에 column-list가 들어간 div) — 기본 파서가 그냥 순서대로 평탄화해 좌우 배치가 사라짐.
// 그래서 column-list가 있을 때만 개입하고, 그 안팎의 다른 내용은 각 노드마다
// editor.tryParseHTMLToBlocks로 BlockNote의 기본 파싱을 그대로 재사용해 유실 없이 재구성함.
export function makeNotionPasteHandler() {
  return ({ event, editor, defaultPasteHandler }) => {
    const html = event.clipboardData && event.clipboardData.getData('text/html');
    if (!html || !/column-list/i.test(html)) return defaultPasteHandler();

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
