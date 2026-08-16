import { createBlockConfig, createBlockSpec } from '@blocknote/core';

// 노션 콜아웃처럼 "여러 블록을 담는 컨테이너"로 만들기 위해 콜아웃 자신은 content:'none'
// (자기 소유 텍스트 없음)으로 두고, 실제 본문(문단/제목/목록/할일 등)은 전부 BlockNote의
// 표준 children으로 둠 — 이러면 Enter/Tab/Backspace/슬래시메뉴/실행취소/IME는 BlockNote
// 코어가 모든 블록에 이미 범용으로 제공하는 동작을 그대로 물려받아 별도 구현이 필요 없음
// (다단 열(column/columnList)도 같은 content:'none'+children 패턴이라 이미 검증된 방식).
export const createCalloutBlockConfig = createBlockConfig(
  () =>
    ({
      type: 'callout',
      propSchema: {},
      content: 'none',
    })
);

// createBlockSpec()은 스펙 객체가 아니라 그걸 만드는 팩토리 함수를 반환함(BlockNote
// 기본 블록들도 전부 defaultBlocks.ts에서 createQuoteBlockSpec() 처럼 호출해서 씀) —
// 그래서 여기서도 바로 호출까지 해서 blockSpecs에 등록 가능한 실제 스펙을 내보냄.
// content:'none' 블록도 render()가 dom을 반환해야 하지만(아이콘 제거로 시각적 내용은
// 없음), 이 dom은 styles.css에서 display:none 처리 — children(.bn-block-group)이
// 유일한 보이는 flex 자식이 되어 아이콘이 있던 자리에 빈 여백이 남지 않음.
export const calloutBlockSpec = createBlockSpec(createCalloutBlockConfig, {
  meta: { isolating: false },
  render() {
    const dom = document.createElement('div');
    dom.className = 'rv2-callout';
    return { dom };
  },
})();

// BlockNote 코어의 insertOrUpdateBlockForSlashMenu + setSelectionToNextContentEditableBlock
// 조합은 content:'none' 블록의 "다음 편집 가능 블록"을 자식이 아니라 형제로 판단해 커서가
// 콜아웃 밖으로 빠져나가는 것을 실측으로 확인함(로컬 재현: 삽입 직후 타이핑한 글자가
// 콜아웃 안 문단이 아니라 콜아웃 다음에 새로 생긴 문단에 들어감). 그래서 커서 배치를
// 직접 제어 — 삽입/치환 직후 방금 만든 콜아웃의 첫 번째 자식(빈 문단)으로 커서를 이동.
export function insertCallout(editor) {
  const currentBlock = editor.getTextCursorPosition().block;
  const content = currentBlock.content;
  const isEmptyOrSlash =
    !Array.isArray(content) ||
    content.length === 0 ||
    (content.length === 1 && content[0].type === 'text' && content[0].text === '/');

  const calloutBlock = { type: 'callout', children: [{ type: 'paragraph' }] };
  const inserted = isEmptyOrSlash
    ? editor.updateBlock(currentBlock, calloutBlock)
    : editor.insertBlocks([calloutBlock], currentBlock, 'after')[0];

  const firstChild = inserted.children && inserted.children[0];
  if (firstChild) editor.setTextCursorPosition(firstChild, 'start');
}
