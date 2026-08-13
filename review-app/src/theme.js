import { lightDefaultTheme } from '@blocknote/mantine';

// 대시보드 팔레트를 하드코딩하지 않고 index.html :root 변수를 그대로 참조 — BlockNote가 이
// 값을 CSS 커스텀 프로퍼티로 그대로 옮겨 쓰기 때문에 var(...) 문자열도 유효하게 동작하고,
// 나중에 대시보드 팔레트가 바뀌어도 이 파일을 손댈 필요가 없음. 다크모드가 없는 대시보드라
// {light,dark} 대신 단일 테마 객체를 넘겨 시스템 다크모드와 무관하게 고정시킴.
export const reviewTheme = {
  ...lightDefaultTheme,
  colors: {
    ...lightDefaultTheme.colors,
    editor: { text: 'var(--text)', background: 'var(--surface)' },
    menu: { text: 'var(--text)', background: 'var(--surface)' },
    tooltip: { text: 'var(--text)', background: 'var(--surface)' },
    hovered: { text: 'var(--text)', background: 'var(--minix-lt)' },
    selected: { text: '#FFFFFF', background: 'var(--minix)' },
    disabled: { text: 'var(--text-3)', background: 'var(--surface-2)' },
    border: 'var(--border)',
    sideMenu: 'var(--text-3)',
  },
  borderRadius: 8,
  fontFamily:
    "'Pretendard Variable',Pretendard,-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','Segoe UI',sans-serif",
};
