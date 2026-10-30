// Build the browser bundle: minify app.js into dist/app.min.js and record its hash.
//
// The script never fails the build: if terser is unavailable or the output does not parse, it
// leaves the source file in place and the server keeps serving /app.js from the repository root.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const sourcePath = path.join(root, 'app.js');
const outputDir = path.join(root, 'dist');
const outputPath = path.join(outputDir, 'app.min.js');
const manifestPath = path.join(outputDir, 'app-manifest.json');

function readSource() {
  return fs.readFileSync(sourcePath, 'utf8');
}

function parseCheck(file) {
  // Syntax check in a child process so a bad output never crashes the build host.
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

async function main() {
  const source = readSource();
  const sourceHash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 16);

  let terser;
  try {
    terser = require('terser');
  } catch (error) {
    console.warn('[build-client] terser is not installed; /app.js keeps serving the readable source.');
    return;
  }

  const result = await terser.minify(source, {
    compress: { passes: 2, drop_debugger: true },
    mangle: true,
    format: { comments: false },
    sourceMap: false
  });

  if (!result || typeof result.code !== 'string' || !result.code.length) {
    console.warn('[build-client] minifier returned no output; keeping the source file.');
    return;
  }

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, result.code);
  try {
    parseCheck(outputPath);
  } catch (error) {
    fs.rmSync(outputPath, { force: true });
    console.warn('[build-client] minified output failed the syntax check; keeping the source file.');
    return;
  }

  const manifest = {
    builtAt: new Date().toISOString(),
    sourceHash,
    file: path.basename(outputPath),
    bytes: Buffer.byteLength(result.code),
    sourceBytes: Buffer.byteLength(source)
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`[build-client] app.js ${manifest.sourceBytes} B -> ${manifest.bytes} B (${Math.round((1 - manifest.bytes / manifest.sourceBytes) * 100)}% smaller)`);
}

main().catch(error => {
  console.warn('[build-client] skipped:', error.message);
});
