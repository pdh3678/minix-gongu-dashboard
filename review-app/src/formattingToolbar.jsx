import { BasicTextStyleButton, FormattingToolbar, getFormattingToolbarItems } from '@blocknote/react';

// 기본 서식 툴바에는 bold/italic/underline/strike만 있고 인라인 코드(code) 버튼이
// 빠져 있음(BasicTextStyleButton 자체는 code를 지원하는데 getFormattingToolbarItems가
// 안 넣어둠 — @blocknote/react 소스로 확인). strike 버튼 바로 뒤에 끼워 넣어 노션과
// 같은 위치(B/I/U/S 다음)에 노출.
export function CustomFormattingToolbar(props) {
  const items = getFormattingToolbarItems(props.blockTypeSelectItems);
  const strikeIdx = items.findIndex((el) => el.key === 'strikeStyleButton');
  const withCode = [
    ...items.slice(0, strikeIdx + 1),
    <BasicTextStyleButton basicTextStyle="code" key="codeStyleButton" />,
    ...items.slice(strikeIdx + 1),
  ];
  return <FormattingToolbar {...props}>{withCode}</FormattingToolbar>;
}
