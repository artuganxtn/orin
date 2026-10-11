const fs = require('fs');
const lines = fs.readFileSync('C:/Users/dipnr/.gemini/antigravity-ide/brain/0be85b14-cfd3-4d27-83c5-fb2d0d65670d/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
for (let i = lines.length - 1; i >= 0; i--) {
  const l = lines[i];
  if (!l.trim()) continue;
  try {
    const obj = JSON.parse(l);
    if (obj.type === 'PLANNER_RESPONSE' && obj.content && obj.content.includes('| Row | Method | Path | Target Postgres Table |')) {
      const idx = obj.content.indexOf('| Row | Method | Path | Target Postgres Table |');
      console.log(obj.content.slice(idx, idx + 4000));
      break;
    }
  } catch (e) {}
}
