import { SideMenuExtension } from '@blocknote/core/extensions';
import {
  useComponentsContext, useBlockNoteEditor, useExtensionState, useDictionary,
  SideMenu, DragHandleMenu, RemoveBlockItem, BlockColorsItem, TableRowHeaderItem, TableColumnHeaderItem,
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

function TurnIntoItem({ children }) {
  const Components = useComponentsContext();
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, {
    editor,
    selector: (state) => state?.block,
  });

  if (block === undefined) return null;

  return (
    <Components.Generic.Menu.Root position="right" sub={true}>
      <Components.Generic.Menu.Trigger sub={true}>
        <Components.Generic.Menu.Item className="bn-menu-item" subTrigger={true}>
          {children}
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown sub={true} className="bn-menu-dropdown rv2-turn-into-dropdown">
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
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}

function CustomDragHandleMenu() {
  const dict = useDictionary();
  return (
    <DragHandleMenu>
      <TurnIntoItem>전환</TurnIntoItem>
      <RemoveBlockItem>{dict.drag_handle.delete_menuitem}</RemoveBlockItem>
      <BlockColorsItem>{dict.drag_handle.colors_menuitem}</BlockColorsItem>
      <TableRowHeaderItem>{dict.drag_handle.header_row_menuitem}</TableRowHeaderItem>
      <TableColumnHeaderItem>{dict.drag_handle.header_column_menuitem}</TableColumnHeaderItem>
    </DragHandleMenu>
  );
}

export function CustomSideMenu(props) {
  return <SideMenu {...props} dragHandleMenu={CustomDragHandleMenu} />;
}
