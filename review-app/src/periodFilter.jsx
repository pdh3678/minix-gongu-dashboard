import { useEffect, useMemo, useRef, useState } from 'react';

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));

// ym("yyyy-MM")이 선택된 연/월(둘 다 ''=전체)에 맞는지. 연/월 둘 다 전체면 ym 없는 항목도
// 포함하되, 하나라도 구체적으로 고르면 ym 없는 항목은 제외(요청 사양).
export function reviewMatchesPeriod(ym, year, month) {
  if (!year && !month) return true;
  if (!ym) return false;
  const parts = String(ym).split('-');
  const y = parts[0], m = parts[1];
  if (year && y !== year) return false;
  if (month && m !== month) return false;
  return true;
}

// 실제 존재하는 회고들의 ym에서 연도만 뽑아 내림차순(최신 연도 먼저) 정렬 — 하드코딩 없음.
export function extractYears(reviews) {
  const set = new Set();
  reviews.forEach((r) => {
    const y = String(r.ym || '').split('-')[0];
    if (/^\d{4}$/.test(y)) set.add(y);
  });
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}

function Dropdown({ label, value, options, onSelect }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown, true);
    return () => document.removeEventListener('mousedown', onDocMouseDown, true);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    // 대시보드 다른 페이지의 "기간 필터" 버튼과 시각적으로만 동일하게 CSS를 새로 만듦
    // (review-app/src/styles.css의 .rv2-dd*) — .ym-dd/.ym-dd-pop 클래스를 그대로 쓰면
    // index.html의 전역 document 클릭 리스너(document.addEventListener('click', ...
    // _closeAllYmDd()))가 "패널 밖 클릭"으로 오인해 React가 방금 연 팝오버의 open 클래스를
    // 같은 클릭의 버블링 단계에서 바로 지워버림 — React 상태는 열림인데 화면엔 아무것도 안
    // 보이는 상태가 됨(실측 확인). 클래스를 완전히 분리해 그 전역 리스너의 영향권 밖에 둠.
    <div className="rv2-dd" ref={wrapRef}>
      <button type="button" className="rv2-dd-btn" onClick={() => setOpen((v) => !v)}>
        {label}: {current ? current.label : '전체'}
      </button>
      {open && (
        <div className="rv2-period-pop">
          {options.map((o) => (
            <div
              key={o.value || 'all'}
              className={'rv2-period-opt' + (o.value === value ? ' sel' : '')}
              onClick={() => { onSelect(o.value); setOpen(false); }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PeriodFilter({ reviews, year, month, onChange }) {
  const years = useMemo(() => extractYears(reviews), [reviews]);
  const yearOptions = useMemo(() => [{ value: '', label: '전체' }, ...years.map((y) => ({ value: y, label: y + '년' }))], [years]);
  const monthOptions = useMemo(() => [{ value: '', label: '전체' }, ...MONTHS.map((m) => ({ value: m, label: String(+m) + '월' }))], []);

  return (
    <div className="rv2-period-filter">
      <span className="rv2-period-lbl">기간 필터</span>
      <Dropdown label="연도" value={year} options={yearOptions} onSelect={(v) => onChange(v, month)} />
      <Dropdown label="월" value={month} options={monthOptions} onSelect={(v) => onChange(year, v)} />
    </div>
  );
}
