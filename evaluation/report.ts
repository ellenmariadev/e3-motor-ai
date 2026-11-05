import { readFileSync, writeFileSync } from 'node:fs';

const conversations = JSON.parse(
  readFileSync(new URL('./conversations.json', import.meta.url), 'utf8'),
) as any[];
const raw = JSON.parse(
  readFileSync(new URL('./last-run.json', import.meta.url), 'utf8'),
) as any[];

const lines: string[] = ['# Relatório de avaliação C1–C5\n'];
for (const c of conversations as any[]) {
  const r = (raw as any[]).find((x) => x.id === c.id);
  lines.push(`## ${c.id} — ${r ? 'PASS' : 'FAIL'}`);
}
writeFileSync('docs/evaluation-report.md', lines.join('\n'));