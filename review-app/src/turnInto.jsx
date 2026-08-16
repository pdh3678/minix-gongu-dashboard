import { SideMenuExtension } from '@blocknote/core/extensions';
import {
  useComponentsContext, useBlockNoteEditor, useExtensionState,
  SideMenu, DragHandleMenu, RemoveBlockItem, BlockColorsItem,
} from '@blocknote/react';

// 노션처럼 ⋮⋮ 핸들 메뉴에서 곧바로 블록 유형을 바꿀 수 있게 하는 "전환" 서브메뉴.
// 인라인 툴바(텍스트 선택 시 뜨는 것)의 블록 전환은 그대로 두고, 이건 별도로 추가하는 것 —
// BlockColorsItem(색깔)이 이미 이 정확한 서브메뉴 패턴(Menu.Root sub + Trigger + Dropdown)을
// 쓰고 있어 그대로 재사용. type만 바꿔서 updateBlock을 부르면 텍스트/children은 BlockNote가
// 알아서 보존함(내용까지 새로 넘길 필요 없음 — updateBlock 소스로 확인).
const TURN_INTO_OPTIONS = [
  { type: 'paragraph', label: '텍스트', ic: '¶' },
  { type: 'heading', props: { level: 1 }, label: '제목 1', ic: 'H1' },
  { type: 'heading', props: { level: 2 }, label: '제목 2', ic: 'H2' },
  { type: 'heading', props: { level: 3 }, label: '제목 3', ic: 'H3' },
  { type: 'bulletListItem', label: '글머리 목록', ic: '•' },
  { type: 'numberedListItem', label: '번호 목록', ic: '1.' },
  { type: 'checkListItem', label: '할 일', ic: '☑' },
  { type: 'toggleListItem', label: '토글', ic: '▸' },
  { type: 'quote', label: '인용', ic: '❝' },
  { type: 'codeBlock', label: '코드', ic: '</>' },
];

function useHoveredBlock() {
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });
  return { editor, block };
}

function SubMenu({ trigger, children }) {
  const Components = useComponentsContext();
  return (
    <Components.Generic.Menu.Root position="right" sub={true}>
      <Components.Generic.Menu.Trigger sub={true}>
        <Components.Generic.Menu.Item className="bn-menu-item" subTrigger={true}>
          {trigger}
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown sub={true} className="bn-menu-dropdown rv2-turn-into-dropdown">
        {children}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}

function TurnIntoItem({ children }) {
  const Components = useComponentsContext();
  const { editor, block } = useHoveredBlock();
  if (block === undefined) return null;

  return (
    <SubMenu trigger={children}>
      {TURN_INTO_OPTIONS.map((opt) => (
        <Components.Generic.Menu.Item
          key={opt.type + (opt.props ? opt.props.level : '')}
          className="bn-menu-item"
          onClick={() => editor.updateBlock(block, { type: opt.type, props: opt.props })}
        >
          <span className="rv2-turn-into-ic">{opt.ic}</span>
          {opt.label}
        </Components.Generic.Menu.Item>
      ))}
    </SubMenu>
  );
}

// "전환"에도 목록 세 종류가 다 있지만, 이미 목록인 블록을 다른 목록 종류로 바로 바꾸는
// 전용 지름길 — 노션의 "목록 형식" 메뉴와 같은 위치. 목록류 블록(글머리/번호/할일)일
// 때만 보이고, 그 외 블록에서는 항목 자체가 나타나지 않음(BlockColorsItem이 색 지원
// 안 하는 블록에서 null 반환하는 것과 같은 패턴).
const LIST_TYPE_OPTIONS = [
  { type: 'bulletListItem', label: '글머리 목록', ic: '•' },
  { type: 'numberedListItem', label: '번호 목록', ic: '1.' },
  { type: 'checkListItem', label: '할 일', ic: '☑' },
];

function ListTypeItem({ children }) {
  const Components = useComponentsContext();
  const { editor, block } = useHoveredBlock();
  if (block === undefined) return null;
  if (!LIST_TYPE_OPTIONS.some((opt) => opt.type === block.type)) return null;

  return (
    <SubMenu trigger={children}>
      {LIST_TYPE_OPTIONS.map((opt) => (
        <Components.Generic.Menu.Item
          key={opt.type}
          className="bn-menu-item"
          onClick={() => editor.updateBlock(block, { type: opt.type })}
        >
          <span className="rv2-turn-into-ic">{opt.ic}</span>
          {opt.label}
        </Components.Generic.Menu.Item>
      ))}
    </SubMenu>
  );
}

// id를 전부 제거한 깊은 복사본을 만들어 insertBlocks에 넘김 — id가 남아있으면 기존 블록과
// 충돌할 수 있어(BlockNote가 새 id를 만들도록) 재귀적으로 children까지 지움.
function cloneBlockWithoutIds(block) {
  const { id, children, ...rest } = block;
  return { ...rest, children: children ? children.map(cloneBlockWithoutIds) : undefined };
}

function DuplicateItem({ children }) {
  const Components = useComponentsContext();
  const { editor, block } = useHoveredBlock();
  if (block === undefined) return null;

  return (
    <Components.Generic.Menu.Item
      className="bn-menu-item"
      onClick={() => editor.insertBlocks([cloneBlockWithoutIds(block)], block, 'after')}
    >
      {children}
    </Components.Generic.Menu.Item>
  );
}

// moveBlocksUp/Down은 콜아웃 안 첫/마지막 자식에서 "형제가 없으면 부모 밖으로 꺼내
// 앞/뒤에 놓는다"는 BlockNote 기본 동작이 있어(문서 주석 확인) — 콜아웃 안에서는 이게
// 콜아웃 밖으로 블록이 빠져나가는 것이라 요구사항 위반. 부모가 콜아웃이고 그 방향에
// 형제가 없을 때만 아무 것도 안 하게(no-op) 막아서 콜아웃 밖 이동만 예외 처리하고,
// 그 외(최상위·다른 컨테이너)는 BlockNote 기본 동작 그대로 둠.
function moveUp(editor, block) {
  const parent = editor.getParentBlock(block);
  if (parent?.type === 'callout' && !editor.getPrevBlock(block)) return;
  editor.moveBlocksUp(block);
}
function moveDown(editor, block) {
  const parent = editor.getParentBlock(block);
  if (parent?.type === 'callout' && !editor.getNextBlock(block)) return;
  editor.moveBlocksDown(block);
}

function MoveItem({ children }) {
  const Components = useComponentsContext();
  const { editor, block } = useHoveredBlock();
  if (block === undefined) return null;

  return (
    <SubMenu trigger={children}>
      <Components.Generic.Menu.Item className="bn-menu-item" onClick={() => moveUp(editor, block)}>
        위로 이동
      </Components.Generic.Menu.Item>
      <Components.Generic.Menu.Item className="bn-menu-item" onClick={() => moveDown(editor, block)}>
        아래로 이동
      </Components.Generic.Menu.Item>
    </SubMenu>
  );
}

function CustomDragHandleMenu() {
  return (
    <DragHandleMenu>
      <TurnIntoItem>전환</TurnIntoItem>
      <BlockColorsItem>색</BlockColorsItem>
      <ListTypeItem>목록 형식</ListTypeItem>
      <DuplicateItem>복제</DuplicateItem>
      <MoveItem>옮기기</MoveItem>
      <RemoveBlockItem>삭제</RemoveBlockItem>
    </DragHandleMenu>
  );
}

export function CustomSideMenu(props) {
  return <SideMenu {...props} dragHandleMenu={CustomDragHandleMenu} />;
}
