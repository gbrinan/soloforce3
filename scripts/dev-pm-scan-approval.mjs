import fs from 'fs';
import path from 'path';
function walk(d, out=[]) {
  for (const e of fs.readdirSync(d, {withFileTypes:true})) {
    const p = path.join(d, e.name).replace(/\\/g, '/');
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}
const files = walk('src');
const patterns = ['createApproval', 'setApprovalNotifier', 'approval-request', 'sendApprovalRequestWithButtons'];
for (const f of files) {
  const c = fs.readFileSync(f, 'utf8').split('\n');
  c.forEach((l, i) => {
    for (const n of patterns) {
      if (l.includes(n)) {
        console.log(f + ':' + (i+1) + ':' + l.trim().slice(0, 220));
        break;
      }
    }
  });
}
