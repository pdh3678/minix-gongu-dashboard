// 기존 바닐라 대시보드가 이미 갖고 있는 인증/네트워크 함수를 그대로 재사용(같은 window에
// 마운트되므로 별도 인증 구현 없이 bridge로 넘겨받아 씀) — GAS 엔드포인트/시트 구조는 그대로.
export async function listReviews(bridge) {
  const url = bridge.getGasUrl();
  if (!url || !bridge.getToken()) throw new Error('로그인이 필요합니다.');
  const j = await bridge.gasFetch(bridge.gasUrl(url) + '&review=list');
  if (j.error) throw new Error(j.error);
  return j.reviews || [];
}

export async function getReview(bridge, id) {
  const url = bridge.getGasUrl();
  const j = await bridge.gasFetch(bridge.gasUrl(url) + '&review=get&id=' + encodeURIComponent(id));
  if (j.error) throw new Error(j.error);
  return j.review;
}

export async function getReviewMetaQuick(bridge, id) {
  try {
    const url = bridge.getGasUrl();
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 6000);
    const res = await fetch(bridge.gasUrl(url) + '&review=meta&id=' + encodeURIComponent(id), { signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.success ? j : null;
  } catch (e) {
    return null; // 콜드스타트 등으로 실패하면 충돌 감지를 포기하고 저장은 계속 진행(기존 동작과 동일)
  }
}

export async function saveReview(bridge, doc, document) {
  const content = JSON.stringify(document);
  const j = await bridge.gasWrite('saveReview', {
    id: doc.id,
    title: doc.title,
    ym: doc.ym,
    owner: doc.owner,
    team: doc.team,
    part: doc.part,
    content,
  });
  // 성공 판정은 GAS 응답 기준 — .error가 없어도 success/updatedAt이 빠진 불완전한 응답이면
  // "가짜 성공" 토스트가 뜨지 않도록 실패로 취급.
  if (j.error) throw new Error(j.error);
  if (!j || !j.success || !j.updatedAt) throw new Error('서버 응답이 올바르지 않습니다.');
  return j; // {success, id, updatedAt, editedBy}
}

export async function deleteReview(bridge, id) {
  const j = await bridge.gasWrite('deleteReview', { id });
  if (j.error) throw new Error(j.error);
  return j;
}
