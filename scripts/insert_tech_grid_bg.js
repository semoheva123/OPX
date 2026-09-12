const fs = require('fs');
const path = require('path');

const root = process.cwd();
const files = fs.readdirSync(root)
  .filter(name => name.endsWith('.html'))
  .sort();

let updated = 0;

for (const file of files) {
  const full = path.join(root, file);
  let html = fs.readFileSync(full, 'utf8');

  if (!html.includes('<div class="tech-grid-bg"></div>')) {
    html = html.replace(/<body[^>]*>/i, match => match + '\n<div class="tech-grid-bg"></div>');
    fs.writeFileSync(full, html);
    updated++;
  }
}

console.log('tech-grid-bg inserted into ' + updated + ' html files');
