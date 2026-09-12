const fs = require('fs');
const path = require('path');

const layer = `
/* ===== Safe CSS-only motion layer for OPERIX ===== */
html{overflow-x:hidden}body{overflow-x:hidden;overscroll-behavior-x:none}
body::before{content:'';position:fixed;inset:-12%;z-index:-1;pointer-events:none;background-image:radial-gradient(circle at 68% 12%, rgba(247,185,85,0.12), transparent 16%), radial-gradient(circle at 18% 78%, rgba(69,214,176,0.08), transparent 12%), radial-gradient(circle at 56% 96%, rgba(34,211,238,0.08), transparent 18%);background-size:130% 130%;background-position:center center;transform:scale(1.08);opacity:0.75}
@supports (animation-timeline: scroll()){body::before{animation:operixParallaxFloat linear both;animation-timeline:scroll(root block);animation-range:0% 100%}}
@supports (animation-timeline: view()){.company-intro{animation:operixHeroScaleFade 1000ms cubic-bezier(.22,1,.36,1) both;animation-timeline:view();animation-range:entry 0% cover 85%}.product-preview{animation:operixPreviewScale 1000ms cubic-bezier(.22,1,.36,1) both;animation-timeline:view();animation-range:entry 0% cover 82%}.intro-reveal,.intro-feature,.about-panel,.glass-card,.opx-market-card{animation:operixRevealFadeUp 850ms cubic-bezier(.22,1,.36,1) both;animation-timeline:view();animation-range:entry 0% cover 78%}.intro-feature{animation-delay:80ms}.about-panel{animation-delay:150ms}.opx-market-card{animation-delay:120ms}}
@keyframes operixHeroScaleFade{from{opacity:0.78;transform:scale(0.985)}to{opacity:1;transform:scale(1)}}
@keyframes operixPreviewScale{from{opacity:0;transform:translateY(16px) scale(0.96);filter:blur(4px)}to{opacity:1;transform:translateY(0) scale(1);filter:blur(0)}}
@keyframes operixRevealFadeUp{from{opacity:0;transform:translateY(28px) scale(0.98)}to{opacity:1;transform:translateY(0) scale(1)}}
@keyframes operixParallaxFloat{0%{transform:scale(1.08) translateY(-4%);opacity:0.65}50%{transform:scale(1.12) translateY(2%);opacity:0.75}100%{transform:scale(1.16) translateY(5%);opacity:0.82}}
@media (max-width: 640px){body{overflow-x:hidden}}
@media (prefers-reduced-motion: reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`;

const root = process.cwd();
const files = fs.readdirSync(root)
  .filter(name => name.endsWith('.html'))
  .sort();

for (const file of files) {
  const full = path.join(root, file);
  let html = fs.readFileSync(full, 'utf8');

  const marker = '/* ===== Safe CSS-only motion layer for OPERIX ===== */';
  const markerStart = html.indexOf(marker);

  if (markerStart >= 0) {
    const styleClose = html.lastIndexOf('</style>');
    if (styleClose >= 0) {
      html = html.slice(0, markerStart) + html.slice(styleClose);
    }
  }

  const styleClose = html.lastIndexOf('</style>');
  if (styleClose >= 0) {
    html = html.slice(0, styleClose) + layer + html.slice(styleClose);
  } else if (html.includes('</head>')) {
    const headClose = html.indexOf('</head>');
    html = html.slice(0, headClose) + `<style>${layer}</style>` + html.slice(headClose);
  } else {
    html += `<style>${layer}</style>`;
  }

  fs.writeFileSync(full, html);
}

console.log('applied motion layer to ' + files.length + ' html files');
