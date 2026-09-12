const fs = require('fs');
const path = require('path');

const root = process.cwd();
const files = fs.readdirSync(root)
  .filter(name => name.endsWith('.html'))
  .sort();

const videoLayer = `<div class="tech-grid-bg"><video class="tech-grid-bg-video" autoplay muted loop playsinline poster="https://images.unsplash.com/photo-1641897037078-e91a4afcce94?auto=format&q=80&w=1800"><source src="/arx.mp4" type="video/mp4"></video></div>`;
const staticLayer = `<div class="tech-grid-bg"></div>`;

let updated = 0;

for (const file of files) {
  const full = path.join(root, file);
  let html = fs.readFileSync(full, 'utf8');

  if (file === 'index.html') {
    if (html.includes('<div class="tech-grid-bg">')) {
      html = html.replace(/<div class="tech-grid-bg">[\s\S]*?<\/div>/i, videoLayer);
    } else {
      html = html.replace(/<body[^>]*>/i, match => match + '\n' + videoLayer);
    }

    html = html.replace(/<source src="[^"]+\.mp4" type="video\/mp4">/i, `<source src="/arx.mp4" type="video/mp4">`);
    fs.writeFileSync(full, html);
    updated++;
  } else {
    html = html.replace(/<div class="tech-grid-bg"><video[^>]*class="tech-grid-bg-video"[^>]*>[\s\S]*?<\/video><\/div>/is, staticLayer);
    fs.writeFileSync(full, html);
  }
}

console.log('tech-grid-bg video layer installed only for index.html, normalized ' + files.length + ' html files');
