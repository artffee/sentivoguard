const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
function walk(dir) {
  for (const e of fs.readdirSync(dir, {withFileTypes:true})) {
    if (['node_modules','.git','dist','out','build'].includes(e.name)) continue;
    const p = path.join(dir,e.name);
    if (e.isDirectory()) walk(p);
    else if (p.endsWith('.js')) execFileSync(process.execPath,['--check',p],{stdio:'inherit'});
  }
}
walk('.');
console.log('JavaScript syntax checks passed');
