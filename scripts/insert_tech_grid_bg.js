const fs = require('fs');
const path = require('path');

const root = process.cwd();
const files = fs.readdirSync(root)
  .filter(name => name.endsWith('.html'))
  .sort();

const staticLayer = `<div class="tech-grid-bg"></div>`;

for (const file of files) {
  const full = path.join(root, file);
  let html = fs.readFileSync(full, 'utf8');

  if (html.includes('<div class="tech-grid-bg"><video')) {
    html = html.replace(/<div class="tech-grid-bg"><video[^>]*class="tech-grid-bg-video"[^>]*>[\s\S]*?<\/video><\/div>/is, staticLayer);
  }

  if (!html.includes('<div class="tech-grid-bg"></div>')) {
    html = html.replace(/<body[^>]*>/i, match => match + '\n' + staticLayer);
  }

  fs.writeFileSync(full, html);
}

console.log('tech-grid-bg static layer normalized ' + files.length + ' html files');
