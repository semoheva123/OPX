const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const app = read('app.js');
const html = read('index.html');

assert.match(html, /id="withdrawalUpdateModal"[^>]*role="dialog"[^>]*aria-modal="true"/, 'announcement popup must be an accessible modal dialog');
assert.match(html, /id="withdrawalUpdateTitle"[^>]*>أصبحت طلبات السحب متاحة يوميًا/);
assert.match(html, /id="withdrawalUpdateBody"/);
assert.match(html, /كل أيام الأسبوع[\s\S]*?جميع المستويات/);
assert.match(html, /إجراءات الأمان مستمرة/);
assert.match(html, /id="withdrawalUpdateAcknowledge"[^>]*onclick="closeWithdrawalUpdatePopup\(\)"/);
assert.match(html, /onclick="closeWithdrawalUpdatePopup\(true\)"/, 'popup should offer a direct path to the withdrawal form');
assert.match(html, /withdrawal-update-backdrop[\s\S]*?prefers-reduced-motion/, 'popup styling must support small screens and reduced-motion preferences');

assert.match(app, /queueWithdrawalUpdatePopup\(data\.notifications \|\| \[\]\)/, 'notification polling must detect the stored announcement');
assert.match(app, /WITHDRAWAL_UPDATE_NOTIFICATION_TITLE = 'تحديث مهم: السحب متاح يوميًا'/);
assert.match(app, /item\?\.title === WITHDRAWAL_UPDATE_NOTIFICATION_TITLE/, 'the popup should find the announcement even if the inbox item was already read');
assert.doesNotMatch(app, /item\?\.title === WITHDRAWAL_UPDATE_NOTIFICATION_TITLE && !item\.readAt/, 'inbox read status must not suppress the first popup');
assert.match(app, /operix_withdrawal_update_seen:\$\{userId\}:\$\{noticeId\}/, 'popup should be limited to once per user and notice in a browser session');
assert.match(app, /operix_withdrawal_update_dismissed:\$\{userId\}:\$\{noticeId\}/, 'dismissal should be remembered between logins');
assert.match(app, /rewardsModal[\s\S]*onboardingModal[\s\S]*return;/, 'the announcement must wait until login/onboarding dialogs are dismissed');
assert.match(app, /window\.setTimeout\(showPendingWithdrawalUpdatePopup, 0\)/, 'queued update should open when existing dialogs close');
assert.match(app, /body\.textContent = isEnglish[\s\S]*?notice\?\.body/, 'announcement text must be localized safely as plain text');
assert.match(app, /modal\.dir = isEnglish \? 'ltr' : 'rtl'/, 'popup direction should follow the selected language');
assert.match(app, /fetch\(`\/api\/notifications\/\$\{encodeURIComponent\(notice\.id\)\}\/read`/, 'closing the popup should acknowledge the inbox notification');
assert.match(app, /if \(openWithdraw\) window\.setTimeout\(\(\) => openWithdrawModal\(\), 80\)/, 'the direct action should open the withdrawal form');
assert.match(app, /pendingWithdrawalUpdateNotification = null;[\s\S]*?activeWithdrawalUpdateNotification = null;/, 'logout must clear popup state between accounts');

console.log('Withdrawal update login popup tests passed');
