// Computes CSP hashes for the inline <script> blocks that ship in the static HTML files.
//
// With a hash (or nonce) present in script-src, browsers ignore 'unsafe-inline' for script-src,
// so an injected inline script cannot execute. Inline event handlers (onclick=..) are governed by
// script-src-attr, which keeps 'unsafe-inline' until the handlers are migrated.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const INLINE_SCRIPT = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
// Data blocks (JSON-LD, templates) are not executed, so they do not need a hash.
const NON_EXECUTABLE_TYPES = /^(application\/(ld\+json|json)|text\/(template|plain)|text\/x-template)/i;

function listHtmlFiles(root) {
  try {
    return fs.readdirSync(root)
      .filter(name => name.toLowerCase().endsWith('.html'))
      .map(name => path.join(root, name));
  } catch (error) {
    return [];
  }
}

function extractInlineScripts(html) {
  const blocks = [];
  let match;
  INLINE_SCRIPT.lastIndex = 0;
  while ((match = INLINE_SCRIPT.exec(html)) !== null) {
    const attributes = match[1] || '';
    const body = match[2] || '';
    if (/\bsrc\s*=/i.test(attributes)) continue;
    const typeMatch = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i);
    if (typeMatch && NON_EXECUTABLE_TYPES.test(typeMatch[1].trim())) continue;
    if (!body.trim()) continue;
    blocks.push(body);
  }
  return blocks;
}

function hashSource(source) {
  return `'sha256-${crypto.createHash('sha256').update(source, 'utf8').digest('base64')}'`;
}

let cached = null;

function collectInlineScriptHashes(root) {
  if (cached) return cached;
  const hashes = new Set();
  listHtmlFiles(root).forEach(file => {
    let html = '';
    try {
      html = fs.readFileSync(file, 'utf8');
    } catch (error) {
      return;
    }
    extractInlineScripts(html).forEach(body => hashes.add(hashSource(body)));
  });
  cached = [...hashes];
  return cached;
}

module.exports = { collectInlineScriptHashes, extractInlineScripts, hashSource, listHtmlFiles };
