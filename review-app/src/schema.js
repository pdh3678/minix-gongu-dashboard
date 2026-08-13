import { BlockNoteSchema, combineByGroup, createCodeBlockSpec } from '@blocknote/core';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import * as coreLocales from '@blocknote/core/locales';
import { codeBlockOptions } from '@blocknote/code-block';
import { getDefaultReactSlashMenuItems } from '@blocknote/react';
import {
  getMultiColumnSlashMenuItems,
  multiColumnDropCursor,
  locales as multiColumnLocales,
  withMultiColumn,
} from '@blocknote/xl-multi-column';

// 다단(2/3열) — 열 블록의 children은 일반 Block[]이라 제목/목록/할일 등 임의 블록이 그대로
// 들어감(자체 구현 시절의 "문단 전용" 한계가 여기서 해소됨). column/columnList 타입 추가.
// codeBlock은 기본 스키마에도 이미 있지만(슬래시 메뉴엔 "코드 블록"으로 노출) 구문 강조/언어
// 목록이 없는 민짜 버전 — @blocknote/code-block의 옵션(Shiki 하이라이터 + 언어 약 50종)으로
// 교체해 노션과 동등한 코드 블록으로 만듦.
export const schema = withMultiColumn(
  BlockNoteSchema.create().extend({
    blockSpecs: { codeBlock: createCodeBlockSpec(codeBlockOptions) },
  })
);

export const dropCursor = multiColumnDropCursor;

// 공식 예제의 병합 형태 그대로 — multi_column 하위 키에 컬럼 전용 사전을 얹음
export const dictionary = {
  ...coreLocales.ko,
  multi_column: multiColumnLocales.ko,
};

// 기본 슬래시 메뉴 + 컬럼(2열/3열) 항목을 합쳐서 반환 — BlockNoteView에는 slashMenu={false}로
// 내장 메뉴를 끄고 이 함수를 SuggestionMenuController에 넘겨야 함(공식 예제 패턴).
export function makeGetSlashMenuItems(editor) {
  return async (query) =>
    filterSuggestionItems(
      combineByGroup(getDefaultReactSlashMenuItems(editor), getMultiColumnSlashMenuItems(editor)),
      query
    );
}
