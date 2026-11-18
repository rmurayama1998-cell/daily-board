// Googleカレンダーの予定を、今日のボードの各日のメモへ入れる（GitHub Actions から30分おきに実行）
// 必要な Secrets：CAL_URL（iCal形式の非公開URL。複数なら改行で区切る）、BOARD_PASS（ボードの合言葉）
// 公開リポジトリなので、予定やメモの中身はログに出さない（件数だけ出す）
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const API = process.env.BOARD_API || html.match(/const API = '([^']+)'/)[1];
const PASS = process.env.BOARD_PASS || '';
const URLS = (process.env.CAL_URL || '').split(/\s+/).filter(Boolean);

const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const shift = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x)
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : x);

// ボードのページと同じ処理を使う（ページ側で確かめた分をそのまま使い回す）
const code = html.split('/* cal:begin */')[1].split('/* cal:end */')[0];
const { parseIcs, calLinesByDay, mergeCal } = new Function('pad', 'keyOf', code + ';return {parseIcs, calLinesByDay, mergeCal};')(pad, keyOf);

async function api(body) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ pass: PASS, ...body }) });
  const j = await r.json().catch(() => ({ error: 'HTTP ' + r.status }));
  if (j.error) throw new Error('ボードの保存先の応答：' + j.error);
  return j;
}

async function main() {
  if (!PASS || !URLS.length) { console.log('まだ設定前です：Secrets に CAL_URL と BOARD_PASS を登録すると動き始めます'); return; }   // 失敗の通知メールを出さない
  const events = [];
  for (const [i, url] of URLS.entries()) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`カレンダー${i + 1}を読めませんでした（HTTP ${r.status}）。CAL_URL を確認してください`);
    events.push(...parseIcs(await r.text()));
  }
  const today = keyOf(new Date()), byDay = calLinesByDay(events, parseKey(today), parseKey(shift(today, 61)));
  const { docs } = await api({ op: 'pull', since: 0 });
  const days = new Map(docs.filter(d => d.key.startsWith('days/') && d.json).map(d => [d.key.slice(5), JSON.parse(d.json)]));
  const ops = [];
  for (let i = 0; i <= 60; i++) {
    const k = shift(today, i), lines = byDay[k] || [], cur = days.get(k);
    if (!cur && !lines.length) continue;
    const d = cur ? JSON.parse(JSON.stringify(cur)) : {};
    d.p = d.p || {}; d.todos = d.todos || []; d.memo = d.memo || '';
    mergeCal(d, lines);
    if (!cur || canon(d) !== canon(cur)) ops.push({ key: 'days/' + k, json: canon(d) });
  }
  if (ops.length) await api({ op: 'write', ops });
  const n = Object.values(byDay).reduce((a, x) => a + x.length, 0);
  console.log(`カレンダー ${URLS.length}件・予定 ${n}件を確認し、${ops.length}日分のメモを更新しました`);
}

main().catch(e => { console.log('失敗：' + e.message); process.exit(1); });
