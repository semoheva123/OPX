// Server-side PDF for financial and retention reports.
//
// PDFKit draws glyphs left to right, so Arabic is shaped into presentation forms and each line is
// reversed before drawing. Latin runs (numbers, USDT, wallet addresses) keep their own direction.
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { ArabicShaper } = require('arabic-persian-reshaper');

const FONT_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
const FONT_REGULAR = path.join(FONT_DIR, 'DejaVuSans.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');

const COLORS = {
  ink: '#0f172a',
  muted: '#64748b',
  line: '#e2e8f0',
  brand: '#0ea5e9',
  positive: '#059669',
  negative: '#e11d48',
  surface: '#f8fafc'
};

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
// PDFKit draws left to right, so a mixed line is split into maximal runs: Arabic runs are shaped
// and the run order is reversed (right-to-left), while Latin runs (numbers, USDT, ids) keep their
// own left-to-right order as a single block.
const LATIN_CHAR = /[A-Za-z0-9@._:\-+%$#*()\[\]/]/;

function shapeArabic(text) {
  return ArabicShaper.convertArabic(String(text));
}

function segmentLine(value) {
  const segments = [];
  let buffer = '';
  let mode = null;
  const flush = () => {
    if (!buffer) return;
    const trailing = mode === 'latin' ? (buffer.match(/\s+$/) || [''])[0] : '';
    const body = trailing ? buffer.slice(0, buffer.length - trailing.length) : buffer;
    if (body) segments.push({ mode, text: body });
    if (trailing) segments.push({ mode: 'space', text: ' ' });
    buffer = '';
    mode = null;
  };
  for (const char of String(value)) {
    const nextMode = LATIN_CHAR.test(char) ? 'latin' : /\s/.test(char) ? 'space' : 'rtl';
    if (nextMode === 'latin') {
      if (mode && mode !== 'latin') flush();
      mode = 'latin';
      buffer += char;
    } else if (nextMode === 'space') {
      if (mode === 'latin') buffer += char;
      else {
        flush();
        segments.push({ mode: 'space', text: ' ' });
      }
    } else {
      if (mode !== 'rtl') flush();
      mode = 'rtl';
      buffer += char;
    }
  }
  flush();
  return segments;
}

function bidiLine(text) {
  const value = String(text ?? '');
  if (!ARABIC.test(value)) return value;
  const segments = segmentLine(value);
  const rendered = segments
    .map(segment => (segment.mode === 'rtl' ? shapeArabic(segment.text) : segment.text))
    .reverse();
  return rendered.join('').replace(/\s+/g, ' ').trim();
}

function formatMoney(value) {
  const number = Number(value);
  return `${(Number.isFinite(number) ? number : 0).toFixed(2)} USDT`;
}

function formatNumber(value) {
  const number = Number(value);
  return (Number.isFinite(number) ? number : 0).toLocaleString('en-US');
}

function fontSizeFor(doc) {
  return doc._font?.size || 10;
}

function createDocument(options = {}) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 42,
    bufferPages: true,
    info: {
      Title: options.title || 'OPERIX Report',
      Author: 'OPERIX',
      Creator: 'OPERIX Admin Console'
    }
  });
  doc.registerFont('regular', FONT_REGULAR);
  doc.registerFont('bold', FONT_BOLD);
  doc.font('regular');
  return doc;
}

function drawRtlParagraph(doc, text, options = {}) {
  const { size = 10, bold = false, color = COLORS.ink, align = 'right', gap = 6 } = options;
  doc.font(bold ? 'bold' : 'regular').fontSize(size).fillColor(color);
  const line = bidiLine(text);
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const height = doc.heightOfString(line, { width, align });
  doc.text(line, { width, align });
  doc.moveDown(gap / size);
  return height;
}

function drawHeader(doc, report) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.rect(doc.page.margins.left, doc.page.margins.top, width, 74).fill(COLORS.surface);
  doc.font('bold').fontSize(18).fillColor(COLORS.ink);
  doc.text(bidiLine(report.title), doc.page.margins.left + 14, doc.page.margins.top + 16, { width: width - 28, align: 'right' });
  doc.font('regular').fontSize(9).fillColor(COLORS.muted);
  doc.text(bidiLine(`OPERIX · ${report.subtitle}`), doc.page.margins.left + 14, doc.page.margins.top + 44, { width: width - 28, align: 'right' });
  doc.text(`Generated: ${new Date(report.generatedAt).toISOString().replace('T', ' ').slice(0, 19)} UTC`, doc.page.margins.left + 14, doc.page.margins.top + 56, { width: width - 28, align: 'left' });
  doc.y = doc.page.margins.top + 92;
}

function drawSection(doc, title) {
  doc.moveDown(0.6);
  doc.font('bold').fontSize(12).fillColor(COLORS.brand);
  doc.text(bidiLine(title), { align: 'right' });
  doc.moveDown(0.3);
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.margins.left + width, doc.y).strokeColor(COLORS.line).stroke();
  doc.moveDown(0.4);
}

function drawKeyValueRows(doc, rows) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  rows.forEach(row => {
    const y = doc.y;
    // RTL row: the label sits in the right half, the numeric value in the left half.
    const half = width / 2;
    doc.font('regular').fontSize(9.5).fillColor(COLORS.muted);
    const label = bidiLine(row.label);
    doc.text(label, left + half, y, { width: half, align: 'right' });
    const labelHeight = doc.heightOfString(label, { width: half });
    doc.font('bold').fontSize(9.5).fillColor(row.tone === 'negative' ? COLORS.negative : row.tone === 'positive' ? COLORS.positive : COLORS.ink);
    const value = row.raw ? String(row.value) : formatMoney(row.value);
    doc.text(value, left, y, { width: half * 0.9, align: 'left' });
    const valueHeight = doc.heightOfString(value, { width: half * 0.9 });
    doc.y = y + Math.max(labelHeight, valueHeight) + 4;
    doc.moveTo(left, doc.y - 1).lineTo(left + width, doc.y - 1).strokeColor(COLORS.line).stroke();
  });
  doc.moveDown(0.4);
}

function drawTable(doc, { headers, rows, widths }) {
  const left = doc.page.margins.left;
  const totalWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const columnWidths = widths || headers.map(() => totalWidth / headers.length);
  const padding = 4;
  const drawRow = (cells, bold) => {
    const y = doc.y;
    let maxHeight = 0;
    // First column on the right: the table reads right to left like the rest of the document.
    cells.forEach((cell, index) => {
      const reversedIndex = cells.length - 1 - index;
      const x = left + columnWidths.slice(0, reversedIndex).reduce((sum, value) => sum + value, 0);
      doc.font(bold ? 'bold' : 'regular').fontSize(8.2).fillColor(bold ? COLORS.ink : COLORS.muted);
      const rendered = bidiLine(String(cell ?? ''));
      doc.text(rendered, x + padding, y + padding, { width: columnWidths[index] - padding * 2, align: 'center' });
      maxHeight = Math.max(maxHeight, doc.heightOfString(rendered, { width: columnWidths[index] - padding * 2 }));
    });
    doc.y = y + maxHeight + padding * 2;
    doc.moveTo(left, doc.y).lineTo(left + totalWidth, doc.y).strokeColor(COLORS.line).stroke();
  };
  drawRow(headers, true);
  rows.forEach(cells => {
    if (doc.y > doc.page.height - doc.page.margins.bottom - 40) doc.addPage();
    drawRow(cells, false);
  });
  doc.moveDown(0.6);
}

function drawFooter(doc, report) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const bottom = doc.page.height - doc.page.margins.bottom + 12;
    doc.font('regular').fontSize(7.5).fillColor(COLORS.muted);
    doc.text(bidiLine(`${report.title} · صفحة ${index + 1} من ${range.count}`), doc.page.margins.left, bottom, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: 'right',
      lineBreak: false
    });
  }
}

function buildFinancialReportDocument({ accounting, days, generatedAt = new Date() }) {
  const report = {
    title: 'التقرير المالي',
    subtitle: `الفترة: آخر ${days} يومًا`,
    generatedAt
  };
  const doc = createDocument({ title: 'OPERIX Financial Report' });
  drawHeader(doc, report);
  const period = accounting.period || {};
  const obligations = accounting.obligations || {};
  const reconciliation = accounting.reconciliation || {};

  drawSection(doc, 'التدفقات النقدية');
  drawKeyValueRows(doc, [
    { label: 'الإيداعات المؤكدة', value: period.verifiedDepositInflow, tone: 'positive' },
    { label: 'المسحوبات المنفذة', value: period.confirmedWithdrawalCash, tone: 'negative' },
    { label: 'صافي التدفق النقدي', value: period.externalNetCashFlow, tone: Number(period.externalNetCashFlow) >= 0 ? 'positive' : 'negative' },
    { label: 'إيرادات رسوم السحب', value: period.withdrawalFeeIncome, tone: 'positive' },
    { label: 'إيرادات رسوم الإيداع', value: period.depositSurchargeIncome, tone: 'positive' },
    { label: 'إيراد الترقيات', value: period.tierRevenueUsdt, tone: 'positive' },
    { label: 'المكافآت الممنوحة', value: period.rewardCreditsUsdt, tone: 'negative' },
    { label: 'المساهمة التشغيلية التقديرية', value: period.estimatedContributionBeforeOperatingCosts, tone: Number(period.estimatedContributionBeforeOperatingCosts) >= 0 ? 'positive' : 'negative' }
  ]);

  drawSection(doc, 'الالتزامات تجاه المستخدمين');
  drawKeyValueRows(doc, [
    { label: 'أرصدة المحافظ', value: obligations.walletBalances },
    { label: 'أصول الخزائن المقفلة', value: obligations.lockedVaultPrincipal },
    { label: 'عوائد الخزائن المتوقعة', value: obligations.expectedVaultIncentives },
    { label: 'أصول التخزين النشط', value: obligations.activeStakingPrincipal },
    { label: 'عوائد التخزين المتوقعة', value: obligations.expectedStakingIncentives },
    { label: 'إجمالي الالتزامات', value: obligations.totalTrackedCustomerObligations }
  ]);

  drawSection(doc, 'المطابقة والرقابة');
  drawKeyValueRows(doc, [
    { label: 'عدد المعاملات في الفترة', value: period.transactionsInPeriod ?? reconciliation.transactionsInPeriod, raw: true },
    { label: 'قيود دفتر الأستاذ', value: reconciliation.ledgerEntriesInPeriod, raw: true },
    { label: 'معاملات بلا قيد مطابق', value: reconciliation.unmatchedFinancialTransactions, raw: true, tone: Number(reconciliation.unmatchedFinancialTransactions) > 0 ? 'negative' : 'positive' },
    { label: 'معاملات مكافآت غير مصنفة', value: reconciliation.unclassifiedRewardTransactions, raw: true, tone: Number(reconciliation.unclassifiedRewardTransactions) > 0 ? 'negative' : 'positive' },
    { label: 'عمليات الإيداع', value: period.depositCount, raw: true },
    { label: 'عمليات السحب', value: period.paidWithdrawalCount, raw: true }
  ]);

  const daily = Array.isArray(accounting.daily) ? accounting.daily.slice(-30) : [];
  if (daily.length) {
    drawSection(doc, 'الحركة اليومية (آخر 30 يومًا)');
    drawTable(doc, {
      headers: ['التاريخ', 'إيداعات', 'مسحوبات', 'عمليات'],
      widths: [110, 150, 150, 100],
      rows: daily.map(row => [row.date, formatMoney(row.deposits), formatMoney(row.paidWithdrawals), formatNumber(row.count)])
    });
  }

  drawSection(doc, 'ملاحظة');
  drawRtlParagraph(doc, 'هذا التقرير مُولد آليًا من بيانات المنصة اللحظية لأغراض المتابعة التشغيلية، ولا يُعد تقريرًا ماليًا مدققًا.', { size: 8.5, color: COLORS.muted });

  drawFooter(doc, report);
  return doc;
}

function buildRetentionReportDocument({ retention, generatedAt = new Date() }) {
  const report = {
    title: 'تقرير الاحتفاظ والمجموعات',
    subtitle: `آخر ${retention.weeks} أسابيع · من ${retention.periodStart} إلى ${retention.periodEnd}`,
    generatedAt
  };
  const doc = createDocument({ title: 'OPERIX Retention Report' });
  drawHeader(doc, report);
  const totals = retention.totals || {};

  drawSection(doc, 'المؤشرات العامة');
  drawKeyValueRows(doc, [
    { label: 'مستخدمون ضمن المجموعات', value: totals.cohortUsers, raw: true },
    { label: 'عدد المجموعات', value: totals.cohorts, raw: true },
    { label: 'المستخدمون النشطون هذا الأسبوع', value: totals.weeklyActiveUsers, raw: true },
    { label: 'احتفاظ الأسبوع الأول', value: `${Number(totals.week1RetentionRate || 0).toFixed(2)}%`, raw: true }
  ]);

  if (Array.isArray(retention.cohorts) && retention.cohorts.length) {
    drawSection(doc, 'مصفوفة الاحتفاظ حسب أسبوع التسجيل');
    const maxCells = Math.min(8, Math.max(...retention.cohorts.map(row => row.retention.length)));
    drawTable(doc, {
      headers: ['المجموعة', 'الحجم', ...Array.from({ length: maxCells }, (unused, index) => `أ${index}`), 'إيداعات'],
      widths: [78, 46, ...Array.from({ length: maxCells }, () => 40), 78],
      rows: retention.cohorts.map(row => {
        const cells = Array.from({ length: maxCells }, (unused, index) => {
          const cell = row.retention[index];
          return cell ? `${cell.rate.toFixed(0)}%` : '—';
        });
        return [row.cohort, formatNumber(row.size), ...cells, formatMoney(row.totalDeposits)];
      })
    });
  }

  drawSection(doc, 'ملاحظة');
  drawRtlParagraph(doc, 'النشاط يُحتسب من تسجيل الدخول ومن إنشاء معاملة خلال الأسبوع، وأسبوع التسجيل يُعتبر نشاطًا أساسيًا.', { size: 8.5, color: COLORS.muted });

  drawFooter(doc, report);
  return doc;
}

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

async function buildFinancialReportPdf(params) {
  return toBuffer(buildFinancialReportDocument(params));
}

async function buildRetentionReportPdf(params) {
  return toBuffer(buildRetentionReportDocument(params));
}

module.exports = {
  buildFinancialReportPdf,
  buildRetentionReportPdf,
  buildFinancialReportDocument,
  buildRetentionReportDocument,
  shapeArabic,
  bidiLine,
  formatMoney
};
