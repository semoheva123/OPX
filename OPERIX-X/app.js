/* ==========================================================================
    OPERIX Ultimate - Main Application Logic (app.js)
   ========================================================================== */

let currentUserTier = 'A1';
let soundEnabled = true;
let currentUserData = null; // الاحتفاظ ببيانات المستخدم محلياً لسهولة الوصول
let hasPendingDeposit = false; // متغير لتتبع وجود طلب إيداع معلق
let taskCountdownTimer = null;
let taskBoardFilter = 'all';
let growthChartPoints = [];
let unreadNotificationCount = null;
let notificationPollTimer = null;
let profileSyncTimer = null;
let realtimeClient = null;
let realtimeChannel = null;
let realtimeEventSource = null;

function isStandaloneApp() {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true || new URLSearchParams(window.location.search).get('source') === 'pwa';
}

let tiersData = [
    { code: 'A1', name: 'المستوى A1 المعتمد', price: 50, tasks: 33, dailyProfit: 2.50, monthlyProfit: 75.00, yearlyProfit: 912.50, badgeColor: 'from-amber-500/20 to-amber-700/20 border-amber-500/40 text-amber-400' },
    { code: 'A2', name: 'المستوى A2 المتقدم', price: 150, tasks: 35, dailyProfit: 8.00, monthlyProfit: 240.00, yearlyProfit: 2920.00, badgeColor: 'from-blue-500/20 to-cyan-700/20 border-blue-500/40 text-blue-400' },
    { code: 'A3', name: 'المستوى A3 الخبير', price: 350, tasks: 40, dailyProfit: 20.00, monthlyProfit: 600.00, yearlyProfit: 7300.00, badgeColor: 'from-purple-500/20 to-indigo-700/20 border-purple-500/40 text-purple-400' },
    { code: 'A4', name: 'المستوى A4 المحترف', price: 750, tasks: 45, dailyProfit: 45.00, monthlyProfit: 1350.00, yearlyProfit: 16425.00, badgeColor: 'from-rose-500/20 to-pink-700/20 border-rose-500/40 text-rose-400' },
    { code: 'A5', name: 'المستوى A5 الخارق (VIP)', price: 1500, tasks: 50, dailyProfit: 100.00, monthlyProfit: 3000.00, yearlyProfit: 36500.00, badgeColor: 'from-emerald-500/20 to-teal-700/20 border-emerald-500/40 text-emerald-400' }
];

const tierLimits = { 'A1': 33, 'A2': 35, 'A3': 40, 'A4': 45, 'A5': 50 };

// تهيئة التطبيق عند اكتمال تحميل عناصر الصفحة
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref');
    
    if (refCode) {
        const regInput = document.getElementById('regReferralCode');
        if (regInput) {
            regInput.value = refCode.toUpperCase();
            localStorage.setItem('operix_ref_code', refCode.toUpperCase());
        }
        switchAuthTab('register');
    } else if (localStorage.getItem('operix_ref_code') || localStorage.getItem('ag_ref_code')) {
        const regInput = document.getElementById('regReferralCode');
        if (regInput) regInput.value = localStorage.getItem('operix_ref_code') || localStorage.getItem('ag_ref_code');
    }

    loadTiers();
    loadOpxPricing();
    loadLiveTicker();
    loadGameConfig();
    loadPlatformStatus();
    initPushNotifications();
    loadUserProfile();
    changeLanguage(localStorage.getItem('ag_language') || 'ar');
    document.getElementById('aiInput')?.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendAiMessage(); } });
    const passwordInput = document.getElementById('regPassword');
    const passwordConfirmInput = document.getElementById('regPasswordConfirm');
    const updatePasswordFeedback = () => {
        const password = passwordInput?.value || '';
        const score = (password.length >= 8 ? 25 : 0) + (/[a-zA-Z]/.test(password) ? 25 : 0) + (/\d/.test(password) ? 25 : 0) + (/[^a-zA-Z\d]/.test(password) ? 25 : 0);
        const strength = document.getElementById('registerPasswordStrength');
        const hint = document.getElementById('registerPasswordHint');
        if (strength) { strength.style.width = `${score}%`; strength.className = `h-full rounded-full transition-all ${score >= 75 ? 'bg-emerald-400' : score >= 50 ? 'bg-amber-400' : score ? 'bg-rose-400' : 'bg-slate-700'}`; }
        if (hint) hint.innerText = score >= 75 ? 'كلمة المرور قوية.' : 'استخدم 8 أحرف على الأقل مع حروف وأرقام ورمز.';
        const match = document.getElementById('registerPasswordMatch');
        if (match) { match.innerText = passwordConfirmInput?.value ? (password === passwordConfirmInput.value ? 'كلمتا المرور متطابقتان.' : 'كلمتا المرور غير متطابقتين.') : ''; match.className = `block text-[10px] mt-1 ${passwordConfirmInput?.value && password === passwordConfirmInput.value ? 'text-emerald-300' : 'text-rose-300'}`; }
    };
    passwordInput?.addEventListener('input', updatePasswordFeedback);
    passwordConfirmInput?.addEventListener('input', updatePasswordFeedback);
});

let gameConfig = { spinMin: 1, spinMax: 10, boxMin: 5, boxMax: 25, referralsPerCycle: 25 };

async function loadGameConfig() {
    try {
        const response = await fetch('/api/games/config');
        const data = await response.json();
        if (!response.ok || !data.settings) throw new Error('config unavailable');
        gameConfig = { ...gameConfig, ...data.settings };
        const gameReferralRequirement = document.getElementById('gameReferralRequirement');
        if (gameReferralRequirement) gameReferralRequirement.innerText = `${gameConfig.referralsPerCycle} إحالة نشطة = دورة`;
        const status = document.getElementById('gameConfigStatus');
        const wheelRange = document.getElementById('wheelRewardRange');
        const boxRange = document.getElementById('boxRewardRange');
        if (status) status.innerText = `كل ${gameConfig.referralsPerCycle} إحالة نشطة = دورة واحدة لكل لعبة. السقف اليومي: $${gameConfig.dailyGameRewardCap}.`;
        if (wheelRange) wheelRange.innerText = `مكافأة عشوائية بين ${gameConfig.spinMin} و${gameConfig.spinMax} USDT`;
        if (boxRange) boxRange.innerText = `مكافأة مخفية بين ${gameConfig.boxMin} و${gameConfig.boxMax} USDT`;
    } catch (error) {
        const status = document.getElementById('gameConfigStatus');
        if (status) status.innerText = 'تعذر تحديث قيم المكافآت حاليًا.';
    }
}

async function loadPlatformStatus() {
    const status = document.getElementById('platformStatus');
    const homeStatus = document.getElementById('homePlatformStatus');
    if (!status && !homeStatus) return;
    try {
        const response = await fetch('/api/health');
        if (!response.ok) throw new Error('health unavailable');
        if (status) { status.innerText = 'الخدمة: متصلة'; status.className = 'text-[10px] text-emerald-400'; }
        if (homeStatus) { homeStatus.innerText = 'الخدمة متصلة'; homeStatus.className = 'text-[10px] font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2.5 py-1'; }
    } catch (error) {
        if (status) { status.innerText = 'الخدمة: غير متاحة'; status.className = 'text-[10px] text-rose-300'; }
        if (homeStatus) { homeStatus.innerText = 'الخدمة تحت التحقق'; homeStatus.className = 'text-[10px] font-bold text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-full px-2.5 py-1'; }
    }
}

async function loadGameHistory() {
    const list = document.getElementById('gameHistoryList');
    const token = localStorage.getItem('token');
    if (!list || !token) return;
    try {
        const response = await fetch('/api/games/history', { headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'history unavailable');
        const labels = { 'Lucky Spin Wheel': 'عجلة الحظ', 'Mystery Box': 'الصندوق المجهول' };
        list.innerHTML = data.history?.length ? data.history.map(item => `<div class="flex justify-between items-center border-b border-slate-800 pb-2"><span><i class="fa-solid ${item.walletAddress === 'Lucky Spin Wheel' ? 'fa-dharmachakra text-amber-400' : 'fa-box-open text-purple-400'} ml-1"></i>${labels[item.walletAddress] || item.walletAddress}</span><span class="text-emerald-400 font-bold">+$${Number(item.amount).toFixed(2)} <small class="text-slate-600">${new Date(item.createdAt).toLocaleDateString('ar')}</small></span></div>`).join('') : '<span class="text-slate-500">لا توجد مكافآت ألعاب مسجلة بعد.</span>';
    } catch (error) {
        list.innerHTML = '<span class="text-rose-300">تعذر تحميل سجل الألعاب.</span>';
    }
}

async function loadGameStats() {
    const list = document.getElementById('gameStatsList');
    const token = localStorage.getItem('token');
    if (!list || !token) return;
    try {
        const response = await fetch('/api/games/stats', { headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        const labels = { 'Lucky Spin Wheel': 'عجلة الحظ', 'Mystery Box': 'الصندوق المجهول' };
        list.innerHTML = data.stats?.length ? data.stats.map(item => `<div class="bg-slate-950 border border-slate-800 rounded-xl p-3"><b class="block text-white">${labels[item._id] || item._id}</b><span class="block mt-1">المحاولات: ${item.plays} • المكافآت: <strong class="text-emerald-300">$${Number(item.total || 0).toFixed(2)}</strong></span><span class="text-[9px] text-slate-600">آخر استخدام: ${item.lastPlayed ? new Date(item.lastPlayed).toLocaleString('ar') : '-'}</span></div>`).join('') : '<span>لم تستخدم الألعاب بعد.</span>';
    } catch (error) { list.innerText = 'تعذر تحميل إحصاءات الألعاب'; }
}

function showGameResult(title, amount, balance) {
    const modal = document.getElementById('gameResultModal');
    if (!modal) return;
    document.getElementById('gameResultTitle').innerText = title;
    document.getElementById('gameResultAmount').innerText = `+$${Number(amount).toFixed(2)} USDT`;
    document.getElementById('gameResultBalance').innerText = `الرصيد الجديد: $${Number(balance?.balance || 0).toFixed(2)} USDT`;
    modal.classList.remove('hide');
}

function closeGameResult() {
    const modal = document.getElementById('gameResultModal');
    if (modal) modal.classList.add('hide');
}

let liveTickerEvents = [];
let liveTickerIndex = 0;
let liveTickerTimer = null;
let liveTickerRefreshTimer = null;
let homeSummaryRetryTimer = null;

async function loadLiveTicker() {
    const message = document.getElementById('liveTickerMessage');
    if (!message) return;
    try {
        const response = await fetch('/api/live-activity');
        const data = await response.json();
        liveTickerEvents = Array.isArray(data.events) ? data.events : [];
        if (!liveTickerEvents.length) {
            message.innerText = 'لا توجد نشاطات مالية حقيقية مسجلة حتى الآن';
            return;
        }
        renderLiveTickerEvent();
        if (liveTickerTimer) clearInterval(liveTickerTimer);
        liveTickerTimer = setInterval(renderLiveTickerEvent, 5000);
        if (!liveTickerRefreshTimer) liveTickerRefreshTimer = setInterval(loadLiveTicker, 30000);
    } catch (error) {
        message.innerText = 'تعذر تحديث نشاط المنصة حاليًا';
    }
}

function renderLiveTickerEvent() {
    const message = document.getElementById('liveTickerMessage');
    const event = liveTickerEvents[liveTickerIndex % liveTickerEvents.length];
    if (!message || !event) return;
    const amount = `$${Number(event.amount).toFixed(2)} USDT`;
    const labels = {
        deposit: `تم إيداع ${amount} في حساب مستخدم`,
        withdraw: `تم طلب سحب ${amount} من حساب مستخدم`,
        reward: `حصل مستخدم على مكافأة ${amount}`,
        staking_reward: `حصل مستخدم على عائد تخزين ${amount}`,
        referral_commission: `حصل مستخدم على عمولة إحالة ${amount}`,
        upgrade_deduction: `تم تفعيل مستوى جديد بقيمة ${amount}`,
        referral: 'انضم مستخدم جديد عبر إحالة إلى المنصة'
    };
    message.innerText = labels[event.type] || 'تم تسجيل نشاط جديد في المنصة';
    const track = document.getElementById('liveTickerTrack');
    if (track) {
        track.classList.remove('operix-news-track');
        void track.offsetWidth;
        track.classList.add('operix-news-track');
    }
    liveTickerIndex += 1;
}

async function loadTiers() {
    const container = document.getElementById('tiersListContainer');
    if (container) container.innerHTML = '<div class="glass-card p-5 rounded-3xl text-center text-xs text-slate-400">جارٍ تحميل المستويات من الخادم...</div>';
    try {
        const response = await fetch('/api/vip-levels');
        if (!response.ok) throw new Error('Failed to load tiers');
        const levels = await response.json();
        if (Array.isArray(levels) && levels.length) tiersData = levels;
    } catch (error) {
        if (container) container.innerHTML = '<div class="glass-card p-5 rounded-3xl text-center space-y-3"><p class="text-xs text-rose-300">تعذر تحميل المستويات من الخادم.</p><button type="button" onclick="loadTiers()" class="gold-gradient text-slate-950 font-bold rounded-xl px-4 py-2 text-xs">إعادة المحاولة</button></div>';
        return;
    }
    renderTiersList();
    updateNextTierPanel();
    if (currentUserData?.teamStats) updateTeamTreeData(currentUserData.teamStats);
}

function updateNextTierPanel() { const title = document.getElementById('nextTierTitle'); const requirements = document.getElementById('nextTierRequirements'); if (!title || !requirements) return; const index = tiersData.findIndex(tier => tier.code === currentUserTier); const next = tiersData[index + 1]; if (!next) { title.innerText = 'أنت في أعلى مستوى'; requirements.innerHTML = '<span class="col-span-2 text-emerald-300">لا توجد ترقية أعلى حاليًا.</span>'; return; } const active = Number(currentUserData?.teamStats?.activeReferrals || 0); const goal = index * 10 + 10; const cost = Math.max(0, Number(next.price || 0) - Number(tiersData[index]?.price || 0)); title.innerText = `الترقية التالية: ${next.code}`; requirements.innerHTML = `<span class="bg-slate-950 rounded-xl p-2">الإحالات النشطة: <b class="text-amber-300">${active}/${goal}</b></span><span class="bg-slate-950 rounded-xl p-2">فرق السعر: <b class="text-emerald-300">$${cost.toFixed(2)}</b></span><span class="bg-slate-950 rounded-xl p-2">المهام اليومية: <b class="text-white">${next.tasks}</b></span><span class="bg-slate-950 rounded-xl p-2">العائد التقديري: <b class="text-emerald-300">$${Number(next.dailyProfit || 0).toFixed(2)}</b></span>`; }
async function loadUpgradeHistory() { const list = document.getElementById('upgradeHistoryList'); const token = localStorage.getItem('token'); if (!list || !token) return; try { const response = await fetch('/api/user/upgrade-history', { headers: { Authorization: `Bearer ${token}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error); list.innerHTML = data.history?.length ? data.history.map(item => `<div class="flex justify-between items-center border-b border-slate-800 pb-2"><span>${escapeAiHtml(item.walletAddress || 'ترقية')}<small class="block text-[9px] text-slate-600">${new Date(item.createdAt).toLocaleString('ar')}</small></span><b class="text-amber-300">-$${Number(item.amount || 0).toFixed(2)}</b></div>`).join('') : '<span>لا توجد ترقيات مسجلة بعد.</span>'; } catch (error) { list.innerText = 'تعذر تحميل سجل الترقيات'; } }

/* --- 1. إدارة المستويات (Tiers) --- */
function renderTiersList() {
    const container = document.getElementById('tiersListContainer');
    if (!container) return;
    const isEnglish = localStorage.getItem('ag_language') === 'en';
    const tierText = isEnglish ? {
        upgrade: 'Exclusive upgrade', dailyTasks: 'Daily tasks', dailyReturn: 'Expected daily return', monthly: 'Monthly return', yearly: 'Yearly return',
        current: 'Your current tier', enabled: 'Tier currently active', upgradeTo: 'Upgrade to', tier: 'Tier', usdt: 'USDT', taskPerDay: 'tasks/day'
    } : {
        upgrade: 'ترقية حصرية', dailyTasks: 'المهام اليومية', dailyReturn: 'الربح اليومي المتوقع', monthly: 'الربح الشهري', yearly: 'الربح السنوي',
        current: 'مستواك الحالي ✓', enabled: 'المستوى مفعل حالياً', upgradeTo: 'ترقية إلى', tier: 'المستوى', usdt: 'USDT', taskPerDay: 'مهمة/يوم'
    };

    container.innerHTML = tiersData.map(tier => {
        const currentTier = tiersData.find(item => item.code === currentUserTier);
        const tierIndex = tiersData.findIndex(item => item.code === tier.code);
        const currentIndex = tiersData.findIndex(item => item.code === currentUserTier);
        const isCurrent = currentUserTier === tier.code;
        const isActivated = isCurrent && Number(currentUserData?.wallet?.totalDeposits || 0) > 0;
        const cost = isCurrent ? (isActivated ? 0 : tier.price) : Math.max(0, tier.price - Number(currentTier?.price || 0));
        const activeReferrals = Number(currentUserData?.teamStats?.activeReferrals || 0);
        const requiredReferrals = Math.max(0, tierIndex * 10);
        const referralsMet = activeReferrals >= requiredReferrals;
        const isNextTier = tierIndex === currentIndex + 1;
        const canAct = !isActivated && (isCurrent || (isNextTier && referralsMet));
        const status = isCurrent ? (isActivated ? 'مفعل حاليًا' : 'يحتاج إيداعًا للتفعيل') : tierIndex < currentIndex ? 'مكتمل سابقًا' : !isNextTier ? 'أكمل المستوى السابق أولًا' : referralsMet ? 'متاح للترقية' : `تحتاج ${requiredReferrals - activeReferrals} إحالة نشطة إضافية`;
        return `
            <div class="glass-card p-5 rounded-3xl border relative overflow-hidden bg-gradient-to-br ${tier.badgeColor} shadow-xl space-y-4">
                ${isActivated ? `<span class="absolute top-3 left-3 bg-amber-500 text-slate-950 text-[10px] font-black px-2.5 py-0.5 rounded-full shadow">${tierText.current}</span>` : ''}
                
                <div class="flex justify-between items-center">
                    <div>
                        <span class="text-[10px] font-extrabold uppercase tracking-wider text-slate-300">${tierText.upgrade}</span>
                        <h3 class="text-lg font-black text-white">${isEnglish ? `Tier ${tier.code}` : tier.name}</h3>
                    </div>
                    <div class="text-left">
                        <span class="text-2xl font-black text-amber-400">${tier.price}</span>
                        <span class="text-xs font-bold text-slate-300"> ${tierText.usdt}</span>
                    </div>
                </div>

                <div class="flex justify-between text-[10px] text-slate-400"><span>${status}</span><span class="text-amber-400">الإحالات: ${activeReferrals}/${requiredReferrals}</span></div>

                <div class="grid grid-cols-2 gap-2 text-xs border-y border-slate-800/80 py-3">
                    <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/50">
                        <span class="text-slate-400 block text-[10px]">${tierText.dailyTasks}</span>
                        <b class="text-white text-sm">${tier.tasks} ${tierText.taskPerDay}</b>
                    </div>
                    <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/50">
                        <span class="text-slate-400 block text-[10px]">${tierText.dailyReturn}</span>
                        <b class="text-emerald-400 text-sm">$${tier.dailyProfit.toFixed(2)}</b>
                    </div>
                    <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/50">
                        <span class="text-slate-400 block text-[10px]">${tierText.monthly}</span>
                        <b class="text-emerald-400 text-sm">$${tier.monthlyProfit.toFixed(2)}</b>
                    </div>
                    <div class="bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/50">
                        <span class="text-slate-400 block text-[10px]">${tierText.yearly}</span>
                        <b class="text-emerald-400 text-sm">$${tier.yearlyProfit.toFixed(2)}</b>
                    </div>
                </div>

                <button type="button" onclick="upgradeToSpecificTier('${tier.code}')" ${canAct ? '' : 'disabled'} class="w-full py-3 ${canAct ? 'gold-gradient text-slate-950 font-black shadow-lg active:scale-95' : 'bg-slate-800 text-slate-500 cursor-not-allowed'} rounded-xl text-xs transition-all">
                    ${isActivated ? tierText.enabled : isCurrent ? (isEnglish ? 'Activate' : 'تفعيل') : canAct ? `${tierText.upgradeTo} ${tier.code} - $${cost}` : status}
                </button>
            </div>
        `;
    }).join('');
}

function updateTierDisplay() {
    const cardTierName = document.getElementById('lblCardTierName');
    const userTierBadge = document.getElementById('lblUserTierBadge');
    const profileTierBadge = document.getElementById('lblProfileTierBadge');
    const isEnglish = localStorage.getItem('ag_language') === 'en';
    if(cardTierName) cardTierName.innerText = isEnglish ? `Tier ${currentUserTier}` : `المستوى ${currentUserTier}`;
    if(userTierBadge) userTierBadge.innerText = isEnglish ? `Tier ${currentUserTier}` : `المستوى ${currentUserTier}`;
    if(profileTierBadge) {
        const icon = profileTierBadge.querySelector('i');
        profileTierBadge.innerHTML = `${icon ? icon.outerHTML : ''} ${isEnglish ? `Tier ${currentUserTier}` : `مستوى ${currentUserTier}`}`;
    }
    updateNextTierPanel();
}

let opxInternalUsdPrice = 0.10;
let opxMaxUpgradeDiscountShare = 0.70;
async function loadOpxPricing() { try { const response = await fetch('/api/opx-price'); const data = await response.json(); if (response.ok && Number(data.internalUsdPrice) > 0) { opxInternalUsdPrice = Number(data.internalUsdPrice); opxMaxUpgradeDiscountShare = Number(data.maxUpgradeDiscountShare) || opxMaxUpgradeDiscountShare; } } catch (error) { /* Keep the documented local price as fallback. */ } }
async function upgradeToSpecificTier(targetTier) {
    const token = localStorage.getItem('token');
    const target = tiersData.find(tier => tier.code === targetTier);
    const current = tiersData.find(tier => tier.code === currentUserTier);
    const currentIndex = tiersData.findIndex(tier => tier.code === currentUserTier);
    const targetIndex = tiersData.findIndex(tier => tier.code === targetTier);
    const activeReferrals = Number(currentUserData?.teamStats?.activeReferrals || 0);
    const requiredReferrals = Math.max(0, targetIndex * 10);
    const upgradeCost = targetIndex === currentIndex ? Number(target?.price || 0) : Math.max(0, Number(target?.price || 0) - Number(current?.price || 0));
    if (!target || !token) {
        showToast('يرجى تسجيل الدخول وانتظار تحميل المستويات');
        return;
    }
    if (targetIndex > currentIndex + 1) {
        showToast('يجب إكمال المستويات بالترتيب');
        return;
    }
    if (activeReferrals < requiredReferrals) {
        showToast(`تحتاج إلى ${requiredReferrals - activeReferrals} إحالة نشطة إضافية للترقية`);
        switchTab('team');
        return;
    }
    const opxRequired = (upgradeCost * opxMaxUpgradeDiscountShare / opxInternalUsdPrice).toFixed(4);
    const minUsdtRequired = (upgradeCost * (1 - opxMaxUpgradeDiscountShare)).toFixed(2);
    const confirmed = await showPlatformConfirm(`تأكيد ${targetIndex === currentIndex ? 'تفعيل' : 'الترقية إلى'} ${target.name}؟\nالتكلفة: $${upgradeCost.toFixed(2)}\nيمكن حرق حتى ${opxRequired} OPX (السعر الداخلي $${opxInternalUsdPrice.toFixed(2)})، مع دفع $${minUsdtRequired} USDT نقدية على الأقل.\nسيتم حرق OPX نهائيًا ولا يمكن عكس العملية.\nالإحالات النشطة: ${activeReferrals}/${requiredReferrals}`, 'تأكيد المستوى');
    if (!confirmed) return;
    try {
        const res = await fetch('/api/user/upgrade', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ targetTier })
        });
        const data = await res.json();

        if (res.ok) {
            currentUserTier = data.tierCode || targetTier;
            updateTierDisplay();
            renderTiersList();
            changeLanguage(localStorage.getItem('ag_language') || 'ar');
            showToast(`مبروك! تمت الترقية بنجاح إلى المستوى ${currentUserTier}`, 'upgrade');
            if (data.wallet) updateWalletData(data.wallet);
            await loadUserProfile();
        } else {
            showToast('❌ ' + (data.error || 'فشلت عملية الترقية'));
        }
    } catch (err) {
        showToast('❌ خطأ في الاتصال بالخادم');
    }
}

function renderHomeSummaryFallback() {
    if (!currentUserData) return;
    const fallbackHealthChecks = {
        email: Boolean(currentUserData.emailVerified),
        twoFactor: Boolean(currentUserData.twoFactorEnabled),
        wallet: Boolean((currentUserData.walletAddress || currentUserData.withdrawWallet || '').trim()),
        deposit: Number(currentUserData.wallet?.totalDeposits) > 0,
        activity: false
    };
    renderHomeSummary({
        todayEarned: 0,
        health: Object.values(fallbackHealthChecks).filter(Boolean).length * 20,
        healthChecks: fallbackHealthChecks,
        referralCount: currentUserData.teamStats?.l1 || 0,
        completedTasks: currentUserData.todayCompletedTasks || 0,
        timeline: [{ type: 'registered', date: currentUserData.createdAt || new Date(), title: 'إنشاء الحساب' }],
        recentActivity: []
    });
}

async function loadHomeSummary() {
    const token = localStorage.getItem('token');
    if (!token || !document.getElementById('homePulseMessage')) return;
    try {
        const response = await fetch('/api/user/home-summary', { headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json();
        if (!response.ok || !data.summary) throw new Error('summary unavailable');
        if (homeSummaryRetryTimer) { clearTimeout(homeSummaryRetryTimer); homeSummaryRetryTimer = null; }
        renderHomeSummary(data.summary);
    } catch (error) {
        renderHomeSummaryFallback();
        document.getElementById('homePulseMessage').innerText = 'بيانات الحساب الأساسية معروضة، تعذر تحديث النشاط التفصيلي.';
        const sinceVisit = document.getElementById('homeSinceVisit');
        if (sinceVisit) sinceVisit.innerText = 'لا تتوفر تحديثات جديدة للتحقق منها الآن.';
        if (!homeSummaryRetryTimer && localStorage.getItem('token')) homeSummaryRetryTimer = setTimeout(() => { homeSummaryRetryTimer = null; loadHomeSummary(); }, 1500);
    }
}

async function refreshHomeDashboard() {
    const icon = document.getElementById('homeRefreshIcon');
    if (icon) icon.classList.add('fa-spin');
    await Promise.all([loadUserProfile(), loadLiveTicker()]);
    if (icon) icon.classList.remove('fa-spin');
}

function renderHomeSummary(summary) {
    const completedTasks = Number(summary.completedTasks || 0);
    const taskLimit = tierLimits[currentUserTier] || 33;
    const taskProgress = Math.min(100, Math.round((completedTasks / taskLimit) * 100));
    const pulse = document.getElementById('homePulseMessage');
    const pulseMeta = document.getElementById('homePulseMeta');
    if (pulse) pulse.innerText = summary.todayEarned > 0 ? `حسابك نشط اليوم وحققت $${summary.todayEarned.toFixed(2)} من الأرباح.` : 'لم تسجل أرباحًا اليوم بعد. لديك فرصة لبدء مهامك.';
    if (pulseMeta) pulseMeta.innerText = `${completedTasks} من ${taskLimit} مهمة مكتملة اليوم`;

    const goal = document.getElementById('homeNextGoal');
    const goalMeta = document.getElementById('homeGoalMeta');
    const goalProgress = document.getElementById('homeGoalProgress');
    if (goal) goal.innerText = completedTasks < taskLimit ? `أكمل ${taskLimit - completedTasks} مهمة للوصول إلى هدف اليوم.` : 'أكملت هدف المهام اليومية.';
    if (goalMeta) goalMeta.innerText = `${taskProgress}% من هدف اليوم`;
    if (goalProgress) goalProgress.style.width = `${taskProgress}%`;

    const lastVisitKey = 'ag_last_home_visit';
    const lastVisit = Number(localStorage.getItem(lastVisitKey) || 0);
    const newEvents = (summary.recentActivity || []).filter(event => new Date(event.createdAt).getTime() > lastVisit);
    const sinceVisit = document.getElementById('homeSinceVisit');
    if (sinceVisit) sinceVisit.innerText = lastVisit ? (newEvents.length ? `حدث ${newEvents.length} نشاط جديد في حسابك منذ آخر زيارة.` : 'لم يحدث تغيير جديد في حسابك منذ آخر زيارة.') : 'هذه أول زيارة مسجلة من هذا الجهاز.';
    localStorage.setItem(lastVisitKey, Date.now().toString());

    const healthScore = Number(summary.health || 0);
    const healthLabel = document.getElementById('homeHealthScore');
    const healthProgress = document.getElementById('homeHealthProgress');
    const healthMessage = document.getElementById('homeHealthMessage');
    const healthChecks = summary.healthChecks || {};
    const missingChecks = [];
    if (healthLabel) healthLabel.innerText = `${healthScore}%`;
    if (healthProgress) healthProgress.style.width = `${healthScore}%`;
    if (healthMessage) {
        if (!healthChecks.twoFactor) missingChecks.push('فعّل المصادقة الثنائية');
        if (!healthChecks.wallet) missingChecks.push('ثبّت عنوان محفظة السحب');
        if (!healthChecks.deposit) missingChecks.push('أكمل أول إيداع لتفعيل الحساب');
        if (!healthChecks.activity) missingChecks.push('سجّل أول نشاط مالي معتمد');
        healthMessage.innerText = missingChecks.length ? `المتبقي: ${missingChecks.join('، ')}.` : 'حسابك مكتمل الإعدادات الأساسية.';
    }
    const readiness = document.getElementById('homeAccountReadiness');
    if (readiness) readiness.innerText = missingChecks.length ? `أكمل ${missingChecks.length} خطوة لرفع جاهزية الحساب.` : 'حسابك جاهز للعمليات الأساسية.';

    const earnings = summary.earnings || {};
    const earnedToday = document.getElementById('homeEarnedToday');
    const earnedWeek = document.getElementById('homeEarnedWeek');
    const earnedMonth = document.getElementById('homeEarnedMonth');
    if (earnedToday) earnedToday.innerText = `$${Number(earnings.today || summary.todayEarned || 0).toFixed(2)}`;
    if (earnedWeek) earnedWeek.innerText = `$${Number(earnings.week || 0).toFixed(2)}`;
    if (earnedMonth) earnedMonth.innerText = `$${Number(earnings.month || 0).toFixed(2)}`;
    const pending = summary.pendingByType || {};
    const pendingText = summary.pendingTransactions ? `معلق: ${pending.deposits || 0} إيداع، ${pending.withdrawals || 0} سحب` : 'لا توجد طلبات معلقة.';
    const pendingStatus = document.getElementById('homePendingStatus');
    const pendingDetail = document.getElementById('homePendingStatusDetail');
    if (pendingStatus) pendingStatus.innerText = summary.pendingTransactions ? `${summary.pendingTransactions} طلب معلق` : '';
    if (pendingDetail) pendingDetail.innerText = pendingText;
    const syncStatus = document.getElementById('homeSyncStatus');
    if (syncStatus) syncStatus.innerText = `آخر مزامنة: ${new Date().toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}`;

    const opportunities = [];
    if (completedTasks < taskLimit) opportunities.push(`أكمل ${taskLimit - completedTasks} مهمة متبقية اليوم`);
    if (!currentUserData?.twoFactorEnabled) opportunities.push({ text: 'فعّل المصادقة الثنائية لحماية السحب', action: "switchTab('profile')" });
    if (completedTasks < taskLimit) opportunities[0] = { text: `أكمل ${taskLimit - completedTasks} مهمة متبقية اليوم`, action: "switchTab('travel')" };
    if (!(currentUserData?.walletAddress || currentUserData?.withdrawWallet || '').trim()) opportunities.push({ text: 'ثبّت عنوان محفظة السحب من قسم حسابي', action: "switchTab('profile')" });
    if (summary.referralCount < 6) opportunities.push({ text: `لديك ${6 - summary.referralCount} إحالات للوصول إلى دورة الألعاب`, action: "switchTab('team')" });
    if (summary.nextLevel) opportunities.push({ text: `راجع متطلبات الترقية إلى ${summary.nextLevel.code}`, action: "switchTab('tiers')" });
    const opportunitiesElement = document.getElementById('homeOpportunities');
    if (opportunitiesElement) opportunitiesElement.innerHTML = opportunities.slice(0, 4).map(opportunity => `<button onclick="${opportunity.action}" class="w-full flex items-center justify-between gap-2 text-right hover:text-amber-400 transition-colors"><span><i class="fa-solid fa-arrow-left text-amber-400 ml-1"></i>${opportunity.text}</span><i class="fa-solid fa-chevron-left text-slate-600"></i></button>`).join('') || '<span class="text-slate-500">لا توجد فرص معلقة حاليًا.</span>';

    const typeLabels = { registered: 'إنشاء الحساب', deposit: 'إيداع', reward: 'مكافأة', staking_reward: 'عائد تخزين', referral_commission: 'عمولة إحالة', withdraw: 'سحب', upgrade_deduction: 'ترقية', token_burn: 'حرق OPX' };
    const timelineElement = document.getElementById('homeTimeline');
    if (timelineElement) timelineElement.innerHTML = (summary.timeline || []).map(event => `<div class="flex justify-between border-b border-slate-800 pb-1"><span>${typeLabels[event.type] || event.title}</span><span class="text-slate-600">${new Date(event.date).toLocaleDateString('ar')}</span></div>`).join('') || '<span class="text-slate-500">سيظهر خط الحساب بعد تسجيل أول نشاط.</span>';
}

/* --- 2. الإشعارات والأصوات والنوافذ التنبيهية --- */
async function initPushNotifications() {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
            const registration = await navigator.serviceWorker.register('/sw.js?v=20260904-2');
            registration.update();
            if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
            navigator.serviceWorker.addEventListener('message', event => { if (event.data?.type === 'OPERIX_NOTIFICATION') { fetchUnreadNotifications(true); } });
            const token = localStorage.getItem('token');
            if (token) {
                const subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qAYIHBQJN2XH7k8KJY'
                });
                await fetch('/api/push/subscribe', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(subscription)
                });
            }
        } catch (e) {}
    }
}

async function fetchUnreadNotifications(isLiveUpdate = false) {
    const token = localStorage.getItem('token');
    const badge = document.getElementById('notificationBadge');
    if (!token || !badge) return;
    try {
        const response = await fetch('/api/notifications', { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) return;
        const data = await response.json();
        const count = Number(data.unread || 0);
        if (isLiveUpdate && unreadNotificationCount !== null && count > unreadNotificationCount) {
            showToast(`لديك ${count - unreadNotificationCount} إشعار جديد`, 'default');
        }
        unreadNotificationCount = count;
        badge.innerText = count > 99 ? '99+' : count;
        badge.classList.toggle('hidden', count === 0);
    } catch (error) { }
}

function startRealtimeStream() {
    const token = localStorage.getItem('token');
    if (!token || !currentUserData?._id) return;
    if (isStandaloneApp()) return;
    if (!window.Ably) return startRealtimeSse(token);
    if (realtimeClient) return;
    realtimeClient = new Ably.Realtime({
        authUrl: '/api/realtime/token',
        authHeaders: { Authorization: `Bearer ${token}` },
        disconnectedRetryTimeout: 5000,
        suspendedRetryTimeout: 10000
    });
    realtimeClient.connection.on('failed', state => { console.error('Ably user connection failed:', state.reason); startRealtimeSse(token); });
    realtimeClient.connection.on('suspended', state => console.warn('Ably user connection suspended:', state.reason));
    realtimeChannel = realtimeClient.channels.get(`operix:user:${currentUserData._id}`);
    realtimeChannel.subscribe('notification_created', () => fetchUnreadNotifications(true));
    realtimeChannel.subscribe('user_data_changed', event => {
        const reason = event.data?.reason;
        loadUserProfile();
        if (document.getElementById('view-vault') && !document.getElementById('view-vault').classList.contains('hide')) loadInvestmentVaults();
        if (reason === 'vip_level_updated' || reason === 'vip_level_deleted') loadTiers();
        if (reason === 'game_settings_updated') loadGameConfig();
        showToast('تم تحديث بيانات حسابك تلقائيًا');
    });
    realtimeChannel.subscribe('account_status_changed', event => {
        const data = event.data || {};
        showToast(data.message || 'تم تحديث حالة الحساب');
        loadUserProfile();
    });
}

function startRealtimeSse(token = localStorage.getItem('token')) {
    if (!token || !window.EventSource || realtimeEventSource) return;
    realtimeEventSource = new EventSource(`/api/realtime/stream?token=${encodeURIComponent(token)}`);
    const refresh = () => loadUserProfile();
    realtimeEventSource.addEventListener('user_data_changed', event => { refresh(); if (event.data) showToast('تم تحديث بيانات حسابك تلقائيًا'); });
    realtimeEventSource.addEventListener('account_status_changed', event => { try { showToast(JSON.parse(event.data).message || 'تم تحديث حالة الحساب'); } catch (error) {} refresh(); });
    realtimeEventSource.addEventListener('notification_created', () => fetchUnreadNotifications(true));
    realtimeEventSource.onerror = () => { if (realtimeEventSource?.readyState === EventSource.CLOSED) { realtimeEventSource.close(); realtimeEventSource = null; setTimeout(() => startRealtimeSse(token), 5000); } };
}

function startNotificationPolling() {
    fetchUnreadNotifications();
    if (notificationPollTimer) clearInterval(notificationPollTimer);
    notificationPollTimer = setInterval(() => fetchUnreadNotifications(true), 15000);
    if (profileSyncTimer) clearInterval(profileSyncTimer);
    profileSyncTimer = setInterval(() => loadUserProfile(), 15000);
}

async function stopRealtimeStream() {
    if (realtimeEventSource) {
        realtimeEventSource.close();
        realtimeEventSource = null;
    }
    const client = realtimeClient;
    realtimeClient = null;
    realtimeChannel = null;
    if (!client) return;
    try {
        const closeResult = client.close();
        if (closeResult && typeof closeResult.catch === 'function') await closeResult.catch(() => {});
    } catch (error) { }
}

function playBeep(type = 'default') {
    if(!soundEnabled) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        if(type === 'upgrade') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(400, ctx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.2);
        } else if(type === 'win') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(523.25, ctx.currentTime);
            osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1);
        } else {
            osc.type = 'sine';
            osc.frequency.value = 600;
        }

        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.2);
    } catch(e) {}
}

function showToast(msg, soundType = 'default') {
    playBeep(soundType);
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.innerText = msg;
    toast.classList.remove('hide');
    setTimeout(() => toast.classList.add('hide'), 3500);
}

function showPlatformConfirm(message, title = 'تأكيد العملية') {
    return new Promise(resolve => {
        const modal = document.getElementById('platformConfirmModal');
        if (!modal) return resolve(false);
        const titleElement = document.getElementById('platformConfirmTitle');
        const messageElement = document.getElementById('platformConfirmMessage');
        const accept = document.getElementById('platformConfirmAccept');
        const cancel = document.getElementById('platformConfirmCancel');
        titleElement.innerText = title;
        messageElement.innerText = message;
        modal.classList.remove('hide');
        const close = result => { modal.classList.add('hide'); accept.onclick = null; cancel.onclick = null; resolve(result); };
        accept.onclick = () => close(true);
        cancel.onclick = () => close(false);
    });
}

function toggleSound(el) { soundEnabled = el.checked; }

/* --- 3. إدارة تسجيل الدخول والتعريف (Auth) --- */
function switchAuthTab(tab) {
    if(tab === 'login') {
        document.getElementById('loginForm').classList.remove('hide');
        document.getElementById('registerForm').classList.add('hide');
        document.getElementById('tabLoginBtn').className = "flex-1 py-2.5 text-sm font-bold rounded-xl bg-amber-500 text-slate-950 transition-all";
        document.getElementById('tabRegisterBtn').className = "flex-1 py-2.5 text-sm font-bold rounded-xl text-slate-400 transition-all";
    } else {
        document.getElementById('loginForm').classList.add('hide');
        document.getElementById('registerForm').classList.remove('hide');
        document.getElementById('tabRegisterBtn').className = "flex-1 py-2.5 text-sm font-bold rounded-xl purple-gradient text-white transition-all";
        document.getElementById('tabLoginBtn').className = "flex-1 py-2.5 text-sm font-bold rounded-xl text-slate-400 transition-all";
    }
}

function openForgotPasswordModal() {
    const loginEmail = document.getElementById('loginEmail').value;
    if(loginEmail) {
        document.getElementById('resetEmail').value = loginEmail;
    }
    document.getElementById('forgotPasswordModal').classList.remove('hide');
    document.getElementById('resetRequestForm').classList.remove('hide');
    document.getElementById('resetConfirmForm').classList.add('hide');
}

function closeForgotPasswordModal() {
    document.getElementById('forgotPasswordModal').classList.add('hide');
}

async function handleResetRequest(e) {
    e.preventDefault();
    const email = document.getElementById('resetEmail').value.trim();
    const btn = document.getElementById('btnSendOtp');

    if(!email) {
        showToast('يرجى إدخال البريد الإلكتروني');
        return;
    }

    btn.disabled = true;
    btn.innerText = 'جاري الإرسال...';

    try {
        const res = await fetch('/api/auth/forgot-password', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ email })
        });
        const data = await res.json();
        if(res.ok) {
            showToast('✅ تم إرسال رمز التحقق إلى بريدك الإلكتروني بنجاح', 'win');
            document.getElementById('resetRequestForm').classList.add('hide');
            document.getElementById('resetConfirmForm').classList.remove('hide');
        } else {
            showToast('❌ ' + (data.error || 'فشل إرسال الرمز'));
        }
    } catch(err) {
        showToast('❌ خطأ في الاتصال بالخادم');
    } finally {
        btn.disabled = false;
        btn.innerText = 'إرسال رمز التحقق';
    }
}

async function handleResetConfirm(e) {
    e.preventDefault();
    const email = document.getElementById('resetEmail').value.trim();
    const otp = document.getElementById('resetOtp').value.trim();
    const newPassword = document.getElementById('resetNewPassword').value;
    const btn = document.getElementById('btnResetSubmit');

    if(!otp || !newPassword) {
        showToast('يرجى ملء جميع الحقول المطلوبة');
        return;
    }

    btn.disabled = true;
    btn.innerText = 'جاري التحديث...';

    try {
        const res = await fetch('/api/auth/reset-password', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ email, otp, newPassword })
        });
        const data = await res.json();
        if(res.ok) {
            showToast('🎉 تم تغيير كلمة المرور بنجاح! يمكنك الآن تسجيل الدخول', 'win');
            closeForgotPasswordModal();
            document.getElementById('loginEmail').value = email;
            document.getElementById('loginPassword').value = '';
        } else {
            showToast('❌ ' + (data.error || 'رمز التحقق غير صحيح أو منتهي الصلاحية'));
        }
    } catch(err) {
        showToast('❌ خطأ في الاتصال بالخادم');
    } finally {
        btn.disabled = false;
        btn.innerText = 'تحديث كلمة المرور والدخول';
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn = document.getElementById('btnLoginSubmit');

    btn.disabled = true;
    btn.innerText = 'جاري الدخول...';

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({email, password})
        });
        const data = await res.json();
        if(res.ok && data.token) {
            localStorage.setItem('token', data.token);
            showToast('تم تسجيل الدخول بنجاح وحماية المحفظة');
            loadUserProfile();
        } else {
            showToast(data.error || 'خطأ في تسجيل الدخول');
        }
    } catch(err) {
        showToast('خطأ في الاتصال بالخادم');
    } finally {
        btn.disabled = false;
        btn.innerText = 'دخول المنصة';
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const passwordConfirm = document.getElementById('regPasswordConfirm').value;
    const referralCode = document.getElementById('regReferralCode').value.trim();
    const btn = document.getElementById('btnRegisterSubmit');

    if (password !== passwordConfirm) { showToast('كلمتا المرور غير متطابقتين'); return; }

    btn.disabled = true;
    btn.innerText = 'جاري إنشاء الحساب...';

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({email, password, referralCode, acceptTerms: document.getElementById('regTermsConsent')?.checked === true})
        });
        const data = await res.json();
        if(res.ok) {
            localStorage.removeItem('operix_ref_code');
            localStorage.removeItem('ag_ref_code');
            showToast('تم إنشاء الحساب والمحفظة بنجاح، يرجى الدخول');
            switchAuthTab('login');
            document.getElementById('loginEmail').value = email;
        } else {
            showToast(data.error || 'خطأ في التسجيل');
        }
    } catch(err) {
        showToast('خطأ في الاتصال');
    } finally {
        btn.disabled = false;
        btn.innerText = 'إنشاء حساب ومحفظة خاصة';
    }
}

async function resendEmailVerification() {
    const email = document.getElementById('loginEmail')?.value.trim();
    if (!email) return showToast('أدخل بريدك الإلكتروني أولًا');
    try {
        const response = await fetch('/api/auth/resend-verification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
        const data = await response.json();
        showToast(data.message || data.error || 'تمت معالجة الطلب');
    } catch (error) { showToast('تعذر الاتصال بالخادم'); }
}

async function resendEmailVerificationFromProfile() {
    const button = document.getElementById('btnVerifyEmailProfile');
    const email = currentUserData?.email;
    if (!email || button?.disabled) return;
    if (button) { button.disabled = true; button.innerText = 'جارٍ إرسال رابط التوثيق...'; }
    try {
        const response = await fetch('/api/auth/resend-verification', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
        const data = await response.json();
        showToast(data.message || data.error || 'تمت معالجة الطلب');
    } catch (error) { showToast('تعذر الاتصال بالخادم'); }
    finally { if (button) { button.disabled = false; button.innerText = 'إرسال رابط توثيق البريد الإلكتروني'; } }
}

/* --- 4. محفظة المستخدم والملف الشخصي تحديث وتطبيق --- */
function updateWalletData(wallet) {
    if(!wallet) return;

    // دعم إمكانية إرسال كائن Wallet أو قيم مباشرة
    const balanceVal = wallet.balance !== undefined ? wallet.balance : wallet;
    const depositBalanceVal = wallet.depositBalance !== undefined ? wallet.depositBalance : (currentUserData?.depositBalance || 0);
    const profitBalanceVal = wallet.profitBalance !== undefined ? wallet.profitBalance : (currentUserData?.profitBalance || 0);
    const depositsVal = wallet.totalDeposits !== undefined ? wallet.totalDeposits : (currentUserData?.wallet?.totalDeposits || 0);
    const withdrawnVal = wallet.totalWithdrawn !== undefined ? wallet.totalWithdrawn : (currentUserData?.wallet?.totalWithdrawn || 0);
    const opxBalanceVal = currentUserData?.OPX_balance !== undefined ? currentUserData.OPX_balance : 0;

    const balance = Number(balanceVal || 0).toFixed(2);
    const depositBal = Number(depositBalanceVal || 0).toFixed(2);
    const profitBal = Number(profitBalanceVal || 0).toFixed(2);
    const deposits = Number(depositsVal || 0).toFixed(2);
    const withdrawn = Number(withdrawnVal || 0).toFixed(2);

    // تحديث كائن البيانات المحفوط بالذاكرة
    if (currentUserData) {
        if (!currentUserData.wallet) currentUserData.wallet = {};
        currentUserData.wallet.balance = parseFloat(balance);
        currentUserData.wallet.depositBalance = parseFloat(depositBal);
        currentUserData.wallet.profitBalance = parseFloat(profitBal);
        currentUserData.wallet.totalDeposits = parseFloat(deposits);
        currentUserData.wallet.totalWithdrawn = parseFloat(withdrawn);
        currentUserData.OPX_balance = Number(opxBalanceVal || 0);
        currentUserData.totalEarned = parseFloat(balance);
        currentUserData.totalWithdrawn = parseFloat(withdrawn);
    }

    // عناصر المحفظة بالواجهة الرئيسية
    const lblBalance = document.getElementById('lblWalletBalance');
    const lblDepBalance = document.getElementById('lblDepositBalance');
    const lblProfBalance = document.getElementById('lblProfitBalance');
    const lblOPXBalance = document.getElementById('lblOPXBalance');
    const lblDeposits = document.getElementById('lblTotalDeposits');
    const lblWithdrawn = document.getElementById('lblTotalWithdrawn');

    if (lblBalance) lblBalance.innerText = balance;
    if (lblDepBalance) lblDepBalance.innerText = `${depositBal} USDT`;
    if (lblProfBalance) lblProfBalance.innerText = `${profitBal} USDT`;
    if (lblOPXBalance) lblOPXBalance.innerText = `${Number(opxBalanceVal || 0).toFixed(4)} OPX`;
    if (lblDeposits) lblDeposits.innerText = `${deposits} USDT`;
    if (lblWithdrawn) lblWithdrawn.innerText = `${withdrawn} USDT`;

    // عناصر الواجهة في الملف الشخصي (Profile)
    const lblProfileEarned = document.getElementById('lblProfileTotalEarnings');
    const lblProfileWithdrawn = document.getElementById('lblProfileTotalWithdrawn');

    if (lblProfileEarned) lblProfileEarned.innerText = `$${balance}`;
    if (lblProfileWithdrawn) lblProfileWithdrawn.innerText = `$${withdrawn}`;
}

function drawOpxProjectionChart() {
    const canvas = document.getElementById('opxProjectionChart');
    if (!canvas) return;
    const context = canvas.getContext('2d');
    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 112;
    const scale = window.devicePixelRatio || 1;
    canvas.width = width * scale;
    canvas.height = height * scale;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, width, height);
    const values = Array.from({ length: 9 }, (_, index) => 0.10 * Math.pow(1.03, index));
    const padding = { top: 10, right: 8, bottom: 16, left: 8 };
    const maxValue = values[values.length - 1];
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const points = values.map((value, index) => ({ x: padding.left + chartWidth * index / (values.length - 1), y: padding.top + chartHeight - value / maxValue * chartHeight }));
    context.strokeStyle = 'rgba(34, 211, 238, 0.16)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(padding.left, height - padding.bottom);
    context.lineTo(width - padding.right, height - padding.bottom);
    context.stroke();
    context.beginPath();
    points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.strokeStyle = '#22d3ee';
    context.lineWidth = 2;
    context.stroke();
    context.fillStyle = '#67e8f9';
    points.forEach(point => { context.beginPath(); context.arc(point.x, point.y, 2.5, 0, Math.PI * 2); context.fill(); });
    context.fillStyle = '#64748b';
    context.font = '10px sans-serif';
    context.fillText('$0.10', padding.left, height - 3);
    context.fillText(`$${maxValue.toFixed(3)}`, Math.max(padding.left, width - 46), 10);
}

async function loadInvestmentVaults() {
    const list = document.getElementById('investmentVaultList');
    const token = localStorage.getItem('token');
    if (!list || !token) return;
    const available = Number(currentUserData?.USDT_balance || 0);
    const availableElement = document.getElementById('vaultAvailableBalance');
    if (availableElement) availableElement.innerText = `${available.toFixed(4)} USDT`;
    try {
        const response = await fetch('/api/investment-vault/my', { headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر تحميل الخزائن');
        list.innerHTML = data.vaults?.length ? data.vaults.map(vault => {
            const maturity = new Date(vault.maturityDate);
            const matured = ['matured'].includes(vault.status);
            const status = vault.status === 'active' ? `مجمّدة حتى ${maturity.toLocaleDateString('ar')}` : vault.status === 'matured' ? 'مستحقة للاسترداد' : vault.status === 'claimed' ? 'تم الاسترداد' : 'فتح اضطراري';
            const action = matured ? `<button type="button" onclick="claimInvestmentVault('${vault._id}')" class="rounded-lg bg-emerald-500/15 px-3 py-2 text-[10px] font-bold text-emerald-300">استرداد</button>` : '';
            return `<div class="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-3"><div><b class="block text-sm text-white">${Number(vault.amount || 0).toFixed(4)} USDT</b><span class="text-[10px] text-slate-500">${vault.durationDays} يومًا · ${status}</span><small class="block text-[10px] text-amber-300">عائد متوقع: ${Number(vault.expectedReturnRate || 0).toFixed(2)}% (${Number(vault.expectedProfit || 0).toFixed(4)} USDT، غير مضمون)</small>${vault.penaltyAmount ? `<small class="block text-[10px] text-rose-300">غرامة: ${Number(vault.penaltyAmount).toFixed(4)} USDT</small>` : ''}</div>${action}</div>`;
        }).join('') : '<p class="py-4 text-center text-[11px] text-slate-500">لا توجد خزائن نشطة بعد.</p>';
    } catch (error) { list.innerHTML = `<p class="py-4 text-center text-[11px] text-rose-300">${escapeAiHtml(error.message)}</p>`; }
}

async function loadVaultContracts() {
    const select = document.getElementById('vaultDurationInput');
    const hint = document.getElementById('vaultContractHint');
    const token = localStorage.getItem('token');
    if (!select || !token) return;
    try {
        const response = await fetch('/api/investment-vault/contracts', { headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر تحميل عقود الخزنة');
        select.innerHTML = data.contracts?.length ? data.contracts.map(contract => `<option value="${Number(contract.durationDays)}" data-rate="${Number(contract.expectedReturnRate || 0)}">${Number(contract.durationDays)} يومًا${contract.label ? ` - ${escapeAiHtml(contract.label)}` : ''} · عائد متوقع ${Number(contract.expectedReturnRate || 0).toFixed(2)}%</option>`).join('') : '<option value="">لا توجد عقود متاحة</option>';
        const updateHint = () => { const option = select.options[select.selectedIndex]; if (hint && option) hint.innerText = `العائد المتوقع لهذا العقد: ${Number(option.dataset.rate || 0).toFixed(2)}%، وهو تقديري وغير مضمون.`; };
        select.onchange = updateHint;
        updateHint();
    } catch (error) { select.innerHTML = '<option value="">تعذر تحميل العقود</option>'; if (hint) hint.innerText = error.message; }
}

async function createInvestmentVault(event) {
    event.preventDefault();
    const token = localStorage.getItem('token');
    const amount = Number(document.getElementById('vaultAmountInput')?.value);
    const durationDays = Number(document.getElementById('vaultDurationInput')?.value);
    if (!token || !Number.isFinite(amount) || amount < 10) return showToast('أدخل مبلغًا لا يقل عن 10 USDT');
    const confirmed = await showPlatformConfirm(`سيتم تجميد ${amount.toFixed(4)} USDT لمدة ${durationDays} يومًا. لا يمكن الاسترداد قبل الاستحقاق. هل تتابع؟`, 'تأكيد تجميد السيولة');
    if (!confirmed) return;
    try {
        const response = await fetch('/api/investment-vault/create', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ amount, durationDays }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر إنشاء الخزنة');
        currentUserData.USDT_balance = Number(data.USDT_balance || 0);
        updateWalletData(data.wallet);
        document.getElementById('vaultAmountInput').value = '';
        await loadInvestmentVaults();
        showToast(data.message || 'تم تجميد السيولة بنجاح');
    } catch (error) { showToast(`❌ ${error.message}`); }
}

async function claimInvestmentVault(vaultId) {
    const token = localStorage.getItem('token');
    if (!token || !await showPlatformConfirm('سيتم إعادة رأس المال المستحق إلى رصيد USDT القابل للسحب. هل تتابع؟', 'تأكيد الاسترداد')) return;
    try {
        const response = await fetch('/api/investment-vault/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ vaultId }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر استرداد الخزنة');
        currentUserData.USDT_balance = Number(data.USDT_balance || 0);
        updateWalletData(data.wallet);
        await loadInvestmentVaults();
        showToast(data.message || 'تم استرداد الخزنة');
    } catch (error) { showToast(`❌ ${error.message}`); }
}

function updateProfileUI() {
    if (!currentUserData) return;

    updateProfileAvatar(currentUserData.profileImage);
    updateVerificationStatus(currentUserData.twoFactorEnabled);
    updateKycProfileUI();
    updateProfileSecuritySummary();

    // البريد واسم المستخدم
    const displayNameEl = document.getElementById('lblProfileDisplayName');
    const emailEl = document.getElementById('lblProfileEmail');
    if (displayNameEl) displayNameEl.innerText = (currentUserData.email || '').split('@')[0] || 'User';
    if (emailEl) emailEl.innerText = currentUserData.email || '';

    // كود ورابط الدعوة
    const refCode = currentUserData.referralCode || 'OPERIX99';
    const dynamicRefLink = `${window.location.origin}/?ref=${encodeURIComponent(refCode)}`;
    const refInputEl = document.getElementById('profileReferralLink');
    if (refInputEl) refInputEl.value = dynamicRefLink;

    // المبالغ
    const totalEarned = (currentUserData.wallet && currentUserData.wallet.balance !== undefined) ? currentUserData.wallet.balance : (currentUserData.totalEarned || 0);
    const totalWithdrawn = (currentUserData.wallet && currentUserData.wallet.totalWithdrawn !== undefined) ? currentUserData.wallet.totalWithdrawn : (currentUserData.totalWithdrawn || 0);

    const totalEarnedEl = document.getElementById('lblProfileTotalEarnings');
    const totalWithdrawnEl = document.getElementById('lblProfileTotalWithdrawn');

    if (totalEarnedEl) totalEarnedEl.innerText = `$${parseFloat(totalEarned).toFixed(2)}`;
    if (totalWithdrawnEl) totalWithdrawnEl.innerText = `$${parseFloat(totalWithdrawn).toFixed(2)}`;
}

function updateKycProfileUI() {
    const statusBadge = document.getElementById('kycProfileStatusBadge');
    const infoText = document.getElementById('kycProfileInfo');
    const fullNameInput = document.getElementById('kycFullNameInput');
    const documentTypeInput = document.getElementById('kycDocumentTypeInput');
    const documentNumberInput = document.getElementById('kycDocumentNumberInput');
    const countryInput = document.getElementById('kycCountryInput');
    const documentUrlInput = document.getElementById('kycDocumentUrlInput');
    const submitButton = document.getElementById('btnSubmitUserKyc');
    if (!statusBadge && !infoText && !fullNameInput && !documentTypeInput && !documentNumberInput && !countryInput && !documentUrlInput && !submitButton) return;

    const status = currentUserData?.kycStatus || 'not_started';
    const lookup = {
        not_started: { label: 'لم يبدأ', className: 'bg-slate-800 text-slate-300' },
        pending: { label: 'قيد المراجعة', className: 'bg-amber-500/15 text-amber-300 border border-amber-500/20' },
        verified: { label: 'معتمد', className: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20' },
        rejected: { label: 'مرفوض', className: 'bg-rose-500/15 text-rose-300 border border-rose-500/20' }
    };

    if (statusBadge) {
        const config = lookup[status] || lookup.not_started;
        statusBadge.className = `text-[10px] font-bold px-2.5 py-1 rounded-full ${config.className}`;
        statusBadge.innerText = config.label;
    }

    const statusText = {
        not_started: 'قم بإرسال البيانات لتوثيق حسابك ومراجعتها من الإدارة.',
        pending: 'تم إرسال طلبك بنجاح. جاري مراجعة الوثائق من الإدارة.',
        verified: 'تم اعتماد حسابك بنجاح. يمكنك استخدام جميع ميزات المنصة بدون قيود.',
        rejected: 'تم رفض الوثائق الحالية. أعد إرسال بيانات جديدة أو عدّل الوثيقة وقدمها مجددًا.'
    };
    if (infoText) infoText.innerText = statusText[status] || statusText.not_started;

    if (fullNameInput) fullNameInput.value = currentUserData?.kycFullName || '';
    if (documentTypeInput) documentTypeInput.value = currentUserData?.kycDocumentType || '';
    if (documentNumberInput) documentNumberInput.value = currentUserData?.kycDocumentNumber || '';
    if (countryInput) countryInput.value = currentUserData?.kycCountry || '';
    if (documentUrlInput) documentUrlInput.value = currentUserData?.kycDocumentUrl || '';
    if (submitButton) {
        const locked = status === 'pending' || status === 'verified';
        submitButton.disabled = locked;
        submitButton.classList.toggle('opacity-50', locked);
        submitButton.classList.toggle('cursor-not-allowed', locked);
        submitButton.innerText = status === 'verified' ? 'تم اعتماد التوثيق' : status === 'pending' ? 'طلب التوثيق قيد المراجعة' : 'إرسال طلب التوثيق';
    }
}

function updateProfileSecuritySummary() {
    const checks = [
        { id: 'profileEmailStatus', done: Boolean(currentUserData?.emailVerified), text: 'البريد: موثق', pending: 'البريد: غير موثق' },
        { id: 'profileTwoFactorStatus', done: Boolean(currentUserData?.twoFactorEnabled), text: '2FA: مفعلة', pending: '2FA: غير مفعلة' },
        { id: 'profileWalletStatus', done: Boolean((currentUserData?.walletAddress || currentUserData?.withdrawWallet || '').trim()), text: 'المحفظة: مثبتة', pending: 'المحفظة: غير مثبتة' },
        { id: 'profileKycStatus', done: currentUserData?.kycStatus === 'verified', text: 'KYC: معتمد', pending: `KYC: ${currentUserData?.kycStatus === 'pending' ? 'قيد المراجعة' : currentUserData?.kycStatus === 'rejected' ? 'مرفوض' : 'لم يبدأ'}` }
    ];
    const completed = checks.filter(check => check.done).length;
    const percent = Math.round((completed / checks.length) * 100);
    const progress = document.getElementById('profileCompletionProgress');
    const percentLabel = document.getElementById('profileCompletionPercent');
    const completionLabel = document.getElementById('profileCompletionLabel');
    if (progress) progress.style.width = `${percent}%`;
    if (percentLabel) percentLabel.innerText = `${percent}%`;
    if (completionLabel) completionLabel.innerText = `${completed} من ${checks.length} خطوات مكتملة`;
    checks.forEach(check => {
        const element = document.getElementById(check.id);
        if (!element) return;
        element.innerText = check.done ? check.text : check.pending;
        element.className = `rounded-xl border px-2.5 py-2 ${check.done ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300' : 'border-rose-500/20 bg-rose-500/5 text-rose-300'}`;
    });
}

async function submitUserKyc() {
    const token = localStorage.getItem('token');
    if (!token) return showToast('يجب تسجيل الدخول أولاً');

    const fullName = document.getElementById('kycFullNameInput')?.value.trim() || '';
    const documentType = document.getElementById('kycDocumentTypeInput')?.value || '';
    const documentNumber = document.getElementById('kycDocumentNumberInput')?.value.trim() || '';
    const country = document.getElementById('kycCountryInput')?.value.trim() || '';
    const documentUrl = document.getElementById('kycDocumentUrlInput')?.value.trim() || '';
    const documentFile = document.getElementById('kycDocumentFileInput')?.files?.[0];

    try {
        let documentImage = '';
        if (documentFile) {
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(documentFile.type)) return showToast('يرجى اختيار صورة JPG أو PNG أو WebP');
            if (documentFile.size > 650 * 1024) return showToast('حجم صورة الوثيقة يجب ألا يتجاوز 650 كيلوبايت');
            documentImage = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error('تعذر قراءة صورة الوثيقة'));
                reader.readAsDataURL(documentFile);
            });
        }

        const response = await fetch('/api/user/kyc/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ fullName, documentType, documentNumber, country, documentUrl, documentImage })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'فشل إرسال طلب KYC');

        currentUserData = { ...(currentUserData || {}), ...data.user, kycStatus: data.user?.kycStatus || 'pending' };
        updateProfileUI();
        showToast(data.message || 'تم إرسال طلب التوثيق بنجاح', 'win');
    } catch (error) {
        showToast(`❌ ${error.message}`);
    }
}

function updateVerificationStatus() {
    const status = document.getElementById('lblVerificationStatus');
    if (!status) return;
    const isComplete = Boolean(currentUserData?.emailVerified && currentUserData?.twoFactorEnabled && (currentUserData?.walletAddress || currentUserData?.withdrawWallet || '').trim() && currentUserData?.kycStatus === 'verified');
    status.className = isComplete
        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold px-3 py-1 rounded-full'
        : 'bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-bold px-3 py-1 rounded-full';
    status.innerHTML = isComplete
        ? '<i class="fa-solid fa-circle-check mr-1"></i> إعداد الحساب مكتمل'
        : '<i class="fa-solid fa-circle-xmark mr-1"></i> يحتاج إكمال الإعداد';
}

function updateTwoFactorStatus(isEnabled) {
    const label = document.getElementById('twoFactorStatusText');
    if (!label) return;
    label.innerText = isEnabled ? 'مفعلة' : 'غير مفعلة';
    label.className = isEnabled ? 'text-emerald-300 font-normal mr-1' : 'text-rose-300 font-normal mr-1';
}

function updateProfileAvatar(profileImage) {
    const image = document.getElementById('profileAvatarImage');
    const fallback = document.getElementById('profileAvatarFallback');
    if (!image || !fallback) return;
    if (profileImage) {
        image.src = profileImage;
        image.classList.remove('hidden');
        fallback.classList.add('hidden');
    } else {
        image.removeAttribute('src');
        image.classList.add('hidden');
        fallback.classList.remove('hidden');
    }
}

function previewProfileImage(event) {
    const file = event.target.files?.[0];
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        showToast('يرجى اختيار صورة JPG أو PNG أو WebP');
        event.target.value = '';
        return;
    }
    if (file.size > 2 * 1024 * 1024) {
        showToast('حجم الصورة يجب ألا يتجاوز 2 ميجابايت');
        event.target.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = () => saveProfileImage(reader.result);
    reader.readAsDataURL(file);
}

async function saveProfileImage(profileImage) {
    try {
        const response = await fetch('/api/user/profile-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: JSON.stringify({ profileImage })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'فشل حفظ الصورة');
        currentUserData.profileImage = data.profileImage;
        updateProfileAvatar(data.profileImage);
        showToast('✅ تم حفظ الصورة الشخصية ويمكنك تغييرها لاحقًا', 'win');
    } catch (error) {
        showToast(`❌ ${error.message}`);
    } finally {
        const input = document.getElementById('profileImageInput');
        if (input) input.value = '';
    }
}

function updateGameCredits(user = currentUserData) {
    if (!user) return;
    const wheelCredits = document.getElementById('lblWheelCredits');
    const mysteryBoxCredits = document.getElementById('lblMysteryBoxCredits');
    const wheelButton = document.getElementById('btnLuckySpin');
    const boxButton = document.getElementById('btnMysteryBox');
    const hasWheelCredits = Number(user.wheelCredits || 0) > 0;
    const hasBoxCredits = Number(user.mysteryBoxCredits || 0) > 0;
    if (wheelCredits) wheelCredits.innerText = user.wheelCredits || 0;
    if (mysteryBoxCredits) mysteryBoxCredits.innerText = user.mysteryBoxCredits || 0;
    [
        [wheelButton, hasWheelCredits],
        [boxButton, hasBoxCredits]
    ].forEach(([button, enabled]) => {
        if (!button) return;
        button.disabled = !enabled;
        button.classList.toggle('opacity-50', !enabled);
        button.classList.toggle('cursor-not-allowed', !enabled);
        button.setAttribute('aria-disabled', String(!enabled));
    });
    const wheelStatus = document.getElementById('wheelGameStatus');
    const boxStatus = document.getElementById('boxGameStatus');
    const referralsPerCycle = Number(gameConfig.referralsPerCycle || 25);
    if (wheelStatus) wheelStatus.innerText = Number(user.wheelCredits || 0) > 0 ? 'الدورة متاحة الآن.' : `تحتاج إلى ${referralsPerCycle} إحالة نشطة للحصول على دورة.`;
    if (boxStatus) boxStatus.innerText = Number(user.mysteryBoxCredits || 0) > 0 ? 'الدورة متاحة الآن.' : `تحتاج إلى ${referralsPerCycle} إحالة نشطة للحصول على دورة.`;
}

function lockWalletUI(address) {
    if (!address) return;
    
    const profileInput = document.getElementById('profileWalletAddress');
    const withdrawInput = document.getElementById('withdrawWallet');
    const saveBtn = document.getElementById('btnSaveProfileWallet');
    const statusProfile = document.getElementById('walletStatusContainerProfile');
    const statusWithdraw = document.getElementById('walletStatusContainerWithdraw');

    if (profileInput) {
        profileInput.value = address;
        profileInput.disabled = true;
    }
    if (withdrawInput) {
        withdrawInput.value = address;
        withdrawInput.disabled = true;
    }
    if (saveBtn) {
        saveBtn.style.display = 'none';
    }

    const badgeHTML = `
        <div class="flex items-center gap-1.5 text-emerald-400 font-bold text-xs mt-2 bg-emerald-950/40 p-2.5 rounded-xl border border-emerald-500/30">
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>العنوان مفعل ومثبت بشكل دائم (قفل حماية 24 ساعة نشط)</span>
        </div>
    `;

    if (statusProfile) statusProfile.innerHTML = badgeHTML;
    if (statusWithdraw) statusWithdraw.innerHTML = badgeHTML;
}

async function loadUserProfile() {
    const token = localStorage.getItem('token');
    if(!token) {
        document.getElementById('loadingView').classList.add('hide');
        const hasReferral = new URLSearchParams(window.location.search).has('ref') || localStorage.getItem('operix_ref_code') || localStorage.getItem('ag_ref_code');
        document.getElementById('companyIntroView')?.classList.toggle('hide', Boolean(hasReferral));
        document.getElementById('authView').classList.toggle('hide', !hasReferral);
        if (hasReferral) switchAuthTab('register');
        document.getElementById('appNavBar').classList.add('hide');
        return;
    }
    try {
        const res = await fetch('/api/user/profile', {
            headers: {'Authorization': `Bearer ${token}`}
        });
        const data = await res.json();
        if(res.ok && data.user) {
            currentUserData = data.user;
            await loadHomeSummary();
            updateGameCredits(data.user);
            loadGameHistory();
            updateProfileAvatar(data.user.profileImage);
            document.getElementById('loadingView').classList.add('hide');
            document.getElementById('authView').classList.add('hide');
            document.getElementById('appView').classList.remove('hide');
            document.getElementById('liveTickerBar').classList.remove('hide');
            document.getElementById('appNavBar').classList.remove('hide');
            maybeShowOnboarding();
            try {
                startNotificationPolling();
                startRealtimeStream();
            } catch (error) {
                console.error('Realtime initialization failed:', error);
            }
            
            document.getElementById('lblUserEmail').innerText = data.user.email;
            document.getElementById('lblCompletedTasks').innerText = data.user.todayCompletedTasks || 0;
            document.getElementById('lblReferralCode').innerText = data.user.referralCode || 'OPERIX99';
            const twoFactorToggle = document.getElementById('toggle2FA');
            if (twoFactorToggle) twoFactorToggle.checked = Boolean(data.user.twoFactorEnabled);
            updateTwoFactorStatus(Boolean(data.user.twoFactorEnabled));
            const emailVerificationStatus = document.getElementById('lblEmailVerificationStatus');
            if (emailVerificationStatus) {
                emailVerificationStatus.className = data.user.emailVerified ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] font-bold px-3 py-1 rounded-full' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-bold px-3 py-1 rounded-full';
                emailVerificationStatus.innerHTML = data.user.emailVerified ? '<i class="fa-solid fa-envelope-circle-check mr-1"></i> البريد موثق' : '<i class="fa-solid fa-envelope mr-1"></i> البريد غير موثق';
            }
            const verifyEmailButton = document.getElementById('btnVerifyEmailProfile');
            if (verifyEmailButton) verifyEmailButton.classList.toggle('hidden', Boolean(data.user.emailVerified));
            
            const savedAddress = data.user.withdrawWallet || data.user.walletAddress;
            if (savedAddress && savedAddress.trim() !== '') {
                lockWalletUI(savedAddress);
            }

            currentUserTier = data.user.tierCode || 'A1';
            updateWalletData(data.user.wallet || data.user);
            updateProfileUI();

            updateTeamTreeData(data.user.teamStats || { l1: 0, l2: 0, l3: 0, total: 0 });

            let maxTasks = tierLimits[currentUserTier] || 33;
            document.getElementById('lblMaxTasks').innerText = maxTasks;
            let percent = ((data.user.todayCompletedTasks || 0) / maxTasks) * 100;
            document.getElementById('taskProgressBar').style.width = `${percent > 100 ? 100 : percent}%`;
            document.getElementById('lblProgressPercent').innerText = `${Math.round(percent > 100 ? 100 : percent)}%`;
            updateTaskAvailability(data.user.todayCompletedTasks || 0, maxTasks);
            startTaskResetCountdown();
            loadAccountGrowth();
            
            updateTierDisplay();
            renderTiersList();

            // الفحص التلقائي لطلبات الإيداع المعلقة
            await checkPendingDepositStatus();
        } else if (res.status === 401 || res.status === 403) {
            showToast(data.error || 'انتهت جلسة الدخول، يرجى تسجيل الدخول مجددًا');
            await logout();
        } else {
            document.getElementById('loadingView').classList.add('hide');
            if (!currentUserData) showToast(data.error || 'تعذر تحميل بيانات الحساب. ستبقى جلسة الدخول محفوظة.');
        }
    } catch(err) {
        document.getElementById('loadingView').classList.add('hide');
        if (!currentUserData) {
            showToast('تعذر الاتصال بالخادم. ستتم إعادة المحاولة تلقائيًا.');
            setTimeout(() => { if (!currentUserData && localStorage.getItem('token')) loadUserProfile(); }, 1500);
        }
    }
}

function onboardingState() {
    return [
        { label: 'تأكيد البريد الإلكتروني', done: Boolean(currentUserData?.emailVerified), action: () => { closeOnboarding(); switchTab('profile'); document.getElementById('btnVerifyEmailProfile')?.click(); } },
        { label: 'تفعيل المصادقة الثنائية', done: Boolean(currentUserData?.twoFactorEnabled), action: () => { closeOnboarding(); switchTab('profile'); } },
            { label: 'تثبيت محفظة السحب', done: Boolean((currentUserData?.walletAddress || currentUserData?.withdrawWallet || '').trim()), action: () => { closeOnboarding(); switchTab('profile'); document.getElementById('profileWalletAddress')?.focus(); } },
        { label: 'إكمال توثيق الهوية KYC', done: currentUserData?.kycStatus === 'verified', action: () => { closeOnboarding(); switchTab('profile'); document.getElementById('kycFullNameInput')?.focus(); } }
    ];
}

function maybeShowOnboarding() {
    if (!currentUserData || localStorage.getItem('operix_onboarding_seen') === '1') return;
    renderOnboarding();
    document.getElementById('onboardingModal')?.classList.remove('hide');
}

function renderOnboarding() {
    const steps = onboardingState();
    const completed = steps.filter(step => step.done).length;
    const progress = document.getElementById('onboardingProgress');
    const label = document.getElementById('onboardingProgressLabel');
    const container = document.getElementById('onboardingSteps');
    if (progress) progress.style.width = `${Math.round((completed / steps.length) * 100)}%`;
    if (label) label.innerText = `${completed} من ${steps.length} خطوات مكتملة`;
    if (container) container.innerHTML = steps.map((step, index) => `<button type="button" onclick="onboardingState()[${index}].action()" class="w-full flex items-center gap-3 rounded-2xl border ${step.done ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-slate-800 bg-slate-950/45'} p-3 text-right"><span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${step.done ? 'bg-emerald-400/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}"><i class="fa-solid ${step.done ? 'fa-check' : 'fa-arrow-left'} text-xs"></i></span><span class="text-xs font-bold ${step.done ? 'text-emerald-200' : 'text-slate-200'}">${step.label}</span></button>`).join('');
}

function continueOnboarding() {
    const nextStep = onboardingState().find(step => !step.done);
    if (nextStep) return nextStep.action();
    closeOnboarding();
}

function closeOnboarding() {
    localStorage.setItem('operix_onboarding_seen', '1');
    document.getElementById('onboardingModal')?.classList.add('hide');
}

function showAuthView(tab = 'login') {
    document.getElementById('companyIntroView')?.classList.add('hide');
    document.getElementById('authView')?.classList.remove('hide');
    switchAuthTab(tab);
    document.getElementById('loginEmail')?.focus();
}

async function loadAccountGrowth() {
    const token = localStorage.getItem('token');
    const canvas = document.getElementById('accountGrowthChart');
    const emptyState = document.getElementById('growthChartEmpty');
    if (!token || !canvas) return;

    try {
        const response = await fetch('/api/user/growth', { headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json();
        growthChartPoints = Array.isArray(data.points) ? data.points : [];
        drawAccountGrowthChart(growthChartPoints);
        if (emptyState) emptyState.classList.toggle('hide', growthChartPoints.length > 1);
    } catch (error) {
        growthChartPoints = [];
        drawAccountGrowthChart([]);
        if (emptyState) emptyState.classList.remove('hide');
    }
}

function drawAccountGrowthChart(points) {
    const canvas = document.getElementById('accountGrowthChart');
    if (!canvas) return;
    const context = canvas.getContext('2d');
    const width = canvas.clientWidth || 320;
    const height = canvas.clientHeight || 160;
    const scale = window.devicePixelRatio || 1;
    canvas.width = width * scale;
    canvas.height = height * scale;
    context.setTransform(scale, 0, 0, scale, 0, 0);
    context.clearRect(0, 0, width, height);
    if (points.length < 2) return;

    const values = points.map(point => Math.max(0, Number(point.balance) || 0));
    const maxValue = Math.max(...values, 1);
    const padding = { top: 12, right: 10, bottom: 18, left: 10 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;
    const coordinates = values.map((value, index) => ({
        x: padding.left + (chartWidth * index) / (values.length - 1),
        y: padding.top + chartHeight - (value / maxValue) * chartHeight
    }));

    context.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    context.lineWidth = 1;
    for (let line = 0; line < 3; line += 1) {
        const y = padding.top + (chartHeight * line) / 2;
        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();
    }

    const fill = context.createLinearGradient(0, padding.top, 0, height);
    fill.addColorStop(0, 'rgba(16, 185, 129, 0.32)');
    fill.addColorStop(1, 'rgba(16, 185, 129, 0)');
    context.beginPath();
    context.moveTo(coordinates[0].x, height - padding.bottom);
    coordinates.forEach(point => context.lineTo(point.x, point.y));
    context.lineTo(coordinates[coordinates.length - 1].x, height - padding.bottom);
    context.closePath();
    context.fillStyle = fill;
    context.fill();

    context.beginPath();
    coordinates.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
    context.strokeStyle = '#34d399';
    context.lineWidth = 2.5;
    context.stroke();
    const last = coordinates[coordinates.length - 1];
    context.beginPath();
    context.arc(last.x, last.y, 4, 0, Math.PI * 2);
    context.fillStyle = '#34d399';
    context.fill();

    const start = document.getElementById('growthChartStart');
    const current = document.getElementById('growthChartCurrent');
    if (start) start.innerText = `البداية: $${values[0].toFixed(2)}`;
    if (current) current.innerText = `الرصيد الحالي: $${values[values.length - 1].toFixed(2)}`;
}

window.addEventListener('resize', () => drawAccountGrowthChart(growthChartPoints));
window.addEventListener('resize', drawOpxProjectionChart);
document.addEventListener('DOMContentLoaded', drawOpxProjectionChart);

function updateTaskAvailability(completed, maximum) {
    const button = document.getElementById('btnCompleteTask');
    const finished = completed >= maximum;
    if (button) {
        button.disabled = finished;
        button.innerText = finished ? 'اكتملت مهام اليوم' : 'بدء المهمة اليومية';
        button.classList.toggle('opacity-50', finished);
        button.classList.toggle('cursor-not-allowed', finished);
    }
    const remaining = document.getElementById('lblRemainingTasks');
    if (remaining) remaining.innerText = Math.max(0, maximum - completed);
    renderTaskBoard(completed, maximum);
}

function setTaskFilter(filter) {
    taskBoardFilter = filter;
    ['all', 'priority', 'operations'].forEach(item => {
        const button = document.getElementById(`taskFilter${item.charAt(0).toUpperCase()}${item.slice(1)}`);
        if (!button) return;
        button.className = item === filter ? 'task-filter-active rounded-xl border py-2 text-[10px] font-bold' : 'rounded-xl border border-slate-800 py-2 text-[10px] font-bold text-slate-400';
    });
    renderTaskBoard(Number(currentUserData?.todayCompletedTasks || 0), tierLimits[currentUserTier] || 33);
}

function renderTaskBoard(completed, maximum) {
    const board = document.getElementById('taskBoard');
    if (!board) return;
    const tasks = [
        { id: 'email', category: 'priority', icon: 'fa-envelope-circle-check', title: 'أكد بريدك الإلكتروني', description: 'ارفع جاهزية الحساب واستقبل تنبيهات العمليات المهمة.', done: Boolean(currentUserData?.emailVerified), action: "switchTab('profile'); document.getElementById('btnVerifyEmailProfile')?.click()" },
        { id: 'twoFactor', category: 'priority', icon: 'fa-shield-halved', title: 'فعّل المصادقة الثنائية', description: 'أضف طبقة حماية قبل السحب والعمليات الحساسة.', done: Boolean(currentUserData?.twoFactorEnabled), action: "switchTab('profile'); document.getElementById('toggle2FA')?.focus()" },
        { id: 'wallet', category: 'priority', icon: 'fa-wallet', title: 'ثبّت محفظة السحب', description: 'أدخل عنوانًا صحيحًا لتجهيز مسار السحب الآمن.', done: Boolean((currentUserData?.walletAddress || currentUserData?.withdrawWallet || '').trim()), action: "switchTab('profile'); document.getElementById('profileWalletAddress')?.focus()" },
        { id: 'kyc', category: 'priority', icon: 'fa-id-card', title: 'أكمل توثيق الهوية', description: 'أرسل بيانات KYC لرفع جاهزية الحساب للعمليات الحساسة.', done: currentUserData?.kycStatus === 'verified', action: "switchTab('profile'); document.getElementById('kycFullNameInput')?.focus()" },
        { id: 'daily', category: 'operations', icon: 'fa-bolt', title: 'نفّذ المهمة اليومية التالية', description: 'أنجز خطوة تشغيلية واحدة وسجّل تقدمك في خطة اليوم.', done: completed >= maximum, action: 'completeTask()' }
    ];
    const visibleTasks = tasks.filter(task => taskBoardFilter === 'all' || task.category === taskBoardFilter);
    board.innerHTML = visibleTasks.map(task => `<article class="task-card rounded-2xl p-3 transition-all"><div class="flex items-start gap-3"><span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${task.done ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/12 text-amber-300'}"><i class="fa-solid ${task.icon} text-sm"></i></span><div class="min-w-0 flex-1"><div class="flex items-start justify-between gap-2"><div><h4 class="text-xs font-bold text-white">${task.title}</h4><p class="mt-1 text-[10px] leading-5 text-slate-500">${task.description}</p></div><span class="shrink-0 text-[10px] font-bold ${task.done ? 'text-emerald-300' : 'text-amber-300'}">${task.done ? 'مكتملة' : task.category === 'priority' ? 'أولوية' : 'اليوم'}</span></div><button ${task.id === 'daily' ? 'id="btnCompleteTask"' : ''} ${task.done ? 'disabled' : `onclick="${task.action}"`} class="mt-3 rounded-xl border px-3 py-2 text-[10px] font-bold ${task.done ? 'cursor-not-allowed border-emerald-500/15 bg-emerald-500/5 text-emerald-300' : 'border-amber-500/25 bg-amber-500/10 text-amber-300 hover:border-amber-400/50'}">${task.done ? 'تم التحقق من الخطوة' : task.id === 'daily' ? 'بدء المهمة' : 'فتح الإجراء'} <i class="fa-solid ${task.done ? 'fa-check' : 'fa-arrow-left'} mr-1"></i></button></div></div></article>`).join('');
}

function startTaskResetCountdown() {
    if (taskCountdownTimer) clearInterval(taskCountdownTimer);
    const update = () => {
        const now = new Date();
        const nextDay = new Date(now);
        nextDay.setUTCHours(24, 0, 0, 0);
        const remaining = Math.max(0, nextDay - now);
        const hours = Math.floor(remaining / 3600000);
        const minutes = Math.floor((remaining % 3600000) / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        const countdown = document.getElementById('taskResetCountdown');
        if (countdown) countdown.innerText = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        if (remaining === 0 && currentUserData) loadUserProfile();
    };
    update();
    taskCountdownTimer = setInterval(update, 1000);
}

async function saveProfileWallet() {
    const token = localStorage.getItem('token');
    const walletAddress = document.getElementById('profileWalletAddress').value.trim();

    if (!walletAddress) {
        showToast('يرجى إدخال عنوان محفظة صحيح');
        return;
    }

    try {
        const res = await fetch('/api/user/wallet-address', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ walletAddress })
        });

        const data = await res.json();
        if (res.ok && (data.success || data.message)) {
            lockWalletUI(walletAddress);
            showToast('✅ تم تثبيت المحفظة وتفعيل قفل الحماية (24 ساعة)', 'win');
        } else {
            showToast('❌ ' + (data.error || 'فشل حفظ العنوان'));
        }
    } catch (err) {
        showToast('❌ خطأ في الاتصال بالخادم');
    }
}

/* --- 5. شجرة الفريق والرتب --- */
function updateTeamTreeData(stats) {
    const l1 = stats.l1 || 0;
    const l2 = stats.l2 || 0;
    const l3 = stats.l3 || 0;
    const total = stats.total || (l1 + l2 + l3);
    const activeReferrals = Number(stats.activeReferrals || 0);

    document.getElementById('lblTeamL1Count').innerText = `${l1} شخص`;
    document.getElementById('lblTeamL2Count').innerText = `${l2} شخص`;
    document.getElementById('lblTeamL3Count').innerText = `${l3} شخص`;
    document.getElementById('lblTotalTeamCount').innerText = `إجمالي الفريق: ${total}`;

    const dailyEarnings = (l1 * 0.01) + (l2 * 0.005) + (l3 * 0.0025);
    document.getElementById('lblDailyTeamEarnings').innerText = `${dailyEarnings.toFixed(4)} $ / يوم`;

    const currentTierIndex = tiersData.findIndex(tier => tier.code === currentUserTier);
    const nextTier = tiersData[currentTierIndex + 1];
    const nextGoal = nextTier ? (currentTierIndex + 1) * 10 : currentTierIndex * 10;
    const referralProgress = nextGoal ? Math.min(100, Math.round((activeReferrals / nextGoal) * 100)) : 100;
    const activeLabel = document.getElementById('lblActiveReferrals');
    const goalLabel = document.getElementById('lblNextTierReferralGoal');
    const progress = document.getElementById('teamReferralProgress');
    const referralMessage = document.getElementById('teamReferralMessage');
    if (activeLabel) activeLabel.innerText = `الإحالات النشطة: ${activeReferrals}`;
    if (goalLabel) goalLabel.innerText = nextTier ? `الهدف التالي: ${nextGoal}` : 'تم بلوغ أعلى مستوى';
    if (progress) progress.style.width = `${referralProgress}%`;
    if (referralMessage) referralMessage.innerText = nextTier
        ? (activeReferrals >= nextGoal ? `اكتمل شرط الإحالات للترقية إلى ${nextTier.code}.` : `تحتاج إلى ${nextGoal - activeReferrals} إحالة نشطة للترقية إلى ${nextTier.code}.`)
        : 'لا توجد ترقية أعلى من مستواك الحالي.';

    updateRankStatus(1, total, 60, 'rankTier1', 'badgeRank1Status');
    updateRankStatus(2, total, 120, 'rankTier2', 'badgeRank2Status');
    updateRankStatus(3, total, 240, 'rankTier3', 'badgeRank3Status');
    updateRankStatus(4, total, 500, 'rankTier4', 'badgeRank4Status');
}

let teamNetworkData = [];
let selectedTeamLevel = 1;
function setTeamLevel(level) { selectedTeamLevel = level; [1, 2, 3].forEach(item => { const button = document.getElementById(`teamFilter${item}`); if (button) button.className = item === level ? 'team-filter-active border rounded-lg py-2 text-[10px] font-bold' : 'border border-slate-800 rounded-lg py-2 text-[10px] text-slate-400 font-bold'; }); renderTeamLevel(); }
async function loadTeamNetwork() { const list = document.getElementById('teamMembersList'); const token = localStorage.getItem('token'); if (!list || !token) return; list.innerHTML = '<p class="text-[11px] text-slate-500 text-center py-4">جاري تحديث شبكة الفريق...</p>'; try { const response = await fetch('/api/user/team-network', { headers: { Authorization: `Bearer ${token}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'تعذر تحميل الشبكة'); teamNetworkData = data.levels || []; renderTeamLevel(); } catch (error) { list.innerHTML = `<p class="text-[11px] text-rose-300 text-center py-4">${escapeAiHtml(error.message)}</p>`; } }
function renderTeamLevel() { const level = teamNetworkData.find(item => item.level === selectedTeamLevel); const list = document.getElementById('teamMembersList'); const summary = document.getElementById('teamLevelSummary'); const term = (document.getElementById('teamSearchInput')?.value || '').toLowerCase(); if (!list || !summary) return; const members = (level?.members || []).filter(member => member.email.toLowerCase().includes(term)); summary.innerText = `إجمالي المستوى: ${level?.total || 0} • نشطة: ${level?.active || 0}`; list.innerHTML = members.length ? members.map(member => `<div class="team-member flex items-center justify-between gap-3 rounded-xl p-3"><div><b class="block text-xs text-slate-200">${escapeAiHtml(member.email)}</b><span class="text-[10px] text-slate-500">مستوى ${escapeAiHtml(member.tierCode || 'A1')} • ${new Date(member.createdAt).toLocaleDateString('ar')}</span></div><span class="text-[10px] font-bold ${member.active ? 'text-emerald-300' : 'text-slate-500'}">${member.active ? 'نشطة' : member.isBanned ? 'محظورة' : 'غير مفعلة'}</span></div>`).join('') : '<p class="text-[11px] text-slate-500 text-center py-4">لا توجد إحالات في هذا المستوى.</p>'; }

function updateRankStatus(rankId, currentTotal, targetCount, cardId, badgeId) {
    const card = document.getElementById(cardId);
    const badge = document.getElementById(badgeId);
    if (!card || !badge) return;

    if (currentTotal >= targetCount) {
        card.className = "p-3 rounded-2xl bg-emerald-950/30 border border-emerald-500/50 flex justify-between items-center transition-all shadow-lg";
        badge.className = "text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40";
        badge.innerHTML = '<i class="fa-solid fa-check ml-1"></i> تم الإنجاز 🎉';
    } else {
        card.className = "p-3 rounded-2xl bg-slate-950 border border-slate-800 flex justify-between items-center transition-all opacity-80";
        badge.className = "text-[10px] font-bold px-2.5 py-1 rounded-full bg-slate-900 text-slate-400 border border-slate-800";
        badge.innerHTML = `${currentTotal} / ${targetCount}`;
    }
}

/* --- 6. المهام والألعاب والمستشار الذكي --- */
async function completeTask() {
    const btn = document.getElementById('btnCompleteTask');
    const token = localStorage.getItem('token');
    if (!btn || !token) return;
    
    btn.disabled = true;
    try {
        const res = await fetch('/api/tasks/complete', {
            method: 'POST',
            headers: {'Authorization': `Bearer ${token}`}
        });
        const data = await res.json();
        if(res.ok) {
            if (currentUserData) { currentUserData.USDT_balance = data.USDT_balance; currentUserData.OPX_balance = data.OPX_balance; }
            showToast('تم إنجاز المهمة وإضافة الأرباح لمحفظتك!', 'win');
            if (data.wallet) updateWalletData(data.wallet);
            await loadUserProfile();
        } else {
            showToast(data.error || 'لا يمكن إنجاز المهمة');
        }
    } catch(err) {
        showToast('خطأ في الاتصال');
    } finally {
        updateTaskAvailability(Number(currentUserData?.todayCompletedTasks || 0), tierLimits[currentUserTier] || 33);
    }
}

async function triggerLuckySpin() {
    const token = localStorage.getItem('token');
    const wheel = document.getElementById('spinWheelVisual');
    const button = document.getElementById('btnLuckySpin');
    if (button?.disabled) return;
    if (button) button.disabled = true;
    if (wheel) {
        wheel.style.transform = `rotate(${Math.floor(Math.random() * 1000 + 720)}deg)`;
    }

    try {
        const res = await fetch('/api/spin/wheel', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (res.ok && data.success) {
            setTimeout(async () => {
                if (currentUserData) { currentUserData.USDT_balance = data.USDT_balance; currentUserData.OPX_balance = data.OPX_balance; }
                showGameResult('تم تدوير العجلة بنجاح', data.reward, data.wallet);
                if (data.wallet) updateWalletData(data.wallet);
                if (currentUserData) currentUserData.wheelCredits = Math.max(0, (currentUserData.wheelCredits || 0) - 1);
                updateGameCredits();
                await loadUserProfile();
                await loadGameHistory();
            }, 1000);
        } else {
            showToast('❌ ' + (data.error || 'حدث خطأ عند تدوير العجلة'));
        }
    } catch (err) {
        showToast('❌ خطأ في الاتصال بالخادم');
    } finally {
        if (button) button.disabled = !(Number(currentUserData?.wheelCredits || 0) > 0);
    }
}

async function openMysteryBox() {
    const token = localStorage.getItem('token');
    const button = document.getElementById('btnMysteryBox');
    const box = document.getElementById('mysteryBoxVisual');
    if (button?.disabled) return;
    if (button) button.disabled = true;
    if (box) box.classList.add('box-reveal');
    try {
        const res = await fetch('/api/spin/mystery-box', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();

        if (res.ok && data.success) {
            if (currentUserData) { currentUserData.USDT_balance = data.USDT_balance; currentUserData.OPX_balance = data.OPX_balance; }
            showGameResult('تم فتح الصندوق بنجاح', data.reward, data.wallet);
            if (data.wallet) updateWalletData(data.wallet);
            if (currentUserData) currentUserData.mysteryBoxCredits = Math.max(0, (currentUserData.mysteryBoxCredits || 0) - 1);
            updateGameCredits();
            await loadUserProfile();
            await loadGameHistory();
        } else {
            showToast('❌ ' + (data.error || 'حدث خطأ عند فتح الصندوق'));
        }
    } catch (err) {
        showToast('❌ خطأ في الاتصال بالخادم');
    } finally {
        if (button) button.disabled = !(Number(currentUserData?.mysteryBoxCredits || 0) > 0);
        if (box) setTimeout(() => box.classList.remove('box-reveal'), 900);
    }
}

async function sendAiMessage() {
    const input = document.getElementById('aiInput');
    const chatBox = document.getElementById('aiChatBox');
    const query = input.value.trim();
    const token = localStorage.getItem('token');
    const sendButton = document.getElementById('aiSendButton');

    if (!query || sendButton?.disabled) return;
    if (sendButton) { sendButton.disabled = true; sendButton.classList.add('opacity-50'); }

    aiLastQuestion = query;
    aiConversation.push({ role: 'user', content: query });
    chatBox.innerHTML += `<div class="bg-blue-950/40 p-3 rounded-xl border border-blue-900 text-white text-right">أنت: ${escapeAiHtml(query)}</div>`;
    input.value = '';
    chatBox.scrollTop = chatBox.scrollHeight;

    const loadingId = 'ai-loading-' + Date.now();
    chatBox.innerHTML += `<div id="${loadingId}" class="bg-slate-900 p-3 rounded-xl border border-slate-800 text-slate-400 animate-pulse">OPERIX AI: جاري التفكير والتحليل...</div>`;
    chatBox.scrollTop = chatBox.scrollHeight;

    try {
        const res = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ message: query, mode: aiMode, history: aiConversation.slice(-9, -1) }),
            signal: AbortSignal.timeout(65000)
        });

        const data = await res.json();
        const loadingEl = document.getElementById(loadingId);

        if (res.ok && data.reply) {
            aiConversation.push({ role: 'assistant', content: data.reply });
            const action = data.suggestedAction ? `<button onclick="switchTab('${data.suggestedAction.tab}')" class="mt-2 text-[10px] text-amber-400 hover:underline">${escapeAiHtml(data.suggestedAction.label)} <i class="fa-solid fa-arrow-left mr-1"></i></button>` : '';
            const tools = `<div class="mt-2 flex gap-3 text-[10px] text-slate-500"><button onclick="copyAiText(this)" title="نسخ الرد"><i class="fa-regular fa-copy"></i> نسخ</button><button onclick="retryAiMessage()" title="إعادة المحاولة"><i class="fa-solid fa-rotate-right"></i> إعادة</button></div>`;
            if (loadingEl) loadingEl.outerHTML = `<div class="ai-response bg-slate-900 p-3 rounded-xl border border-slate-800 text-slate-300">OPERIX AI: <span>${escapeAiHtml(data.reply)}</span>${action}${tools}<small class="block text-[9px] text-slate-600 mt-1">المصدر: ${escapeAiHtml(data.source || 'المستشار')}</small></div>`;
            document.getElementById('aiSourceStatus').innerText = `المصدر: ${data.source || 'المستشار'} • آخر تحديث: ${new Date().toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}`;
            playBeep('win');
        } else {
            if (loadingEl) loadingEl.outerHTML = `<div class="bg-rose-950/40 p-3 rounded-xl border border-rose-900 text-rose-300">OPERIX AI: ${escapeAiHtml(data.reply || data.error || 'عذراً، حدث خطأ في معالجة الطلب.')}</div>`;
        }
    } catch (err) {
        const loadingEl = document.getElementById(loadingId);
        if (loadingEl) {
            loadingEl.outerHTML = `<div class="bg-rose-950/40 p-3 rounded-xl border border-rose-900 text-rose-300">OPERIX AI: انتهت مهلة الرد. تحقق من اتصال الخادم ثم حاول مجددًا.</div>`;
        }
    }
    if (sendButton) { sendButton.disabled = false; sendButton.classList.remove('opacity-50'); }
    chatBox.scrollTop = chatBox.scrollHeight;
}

let aiConversation = [];
let aiLastQuestion = '';
let aiMode = 'platform';

function escapeAiHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character])); }
function askAiQuick(question) { document.getElementById('aiInput').value = question; sendAiMessage(); }
function setAiMode(mode) {
    aiMode = mode;
    ['platform', 'account', 'support'].forEach(name => {
        const button = document.getElementById(`aiMode${name[0].toUpperCase()}${name.slice(1)}`);
        if (button) button.className = `py-2 rounded-lg ${name === mode ? 'bg-amber-500 text-slate-950' : 'bg-slate-900 text-slate-400'} text-[10px] font-bold`;
    });
}
function retryAiMessage() { if (aiLastQuestion) { document.getElementById('aiInput').value = aiLastQuestion; sendAiMessage(); } }
function copyAiText(button) { const response = button.closest('.ai-response')?.querySelector('span')?.innerText; if (response) executeCopyProcess(response); }
function clearAiChat() { aiConversation = []; aiLastQuestion = ''; const chatBox = document.getElementById('aiChatBox'); if (chatBox) chatBox.innerHTML = '<div class="bg-slate-900 p-3 rounded-xl border border-slate-800 text-slate-300">تم مسح المحادثة. كيف يمكنني مساعدتك؟</div>'; }

/* --- 7. النسخ، الأمان والجلسات --- */
function copyProfileReferral() {
    const copyInput = document.getElementById('profileReferralLink');
    if (!copyInput || !copyInput.value) {
        const fallbackCode = document.getElementById('lblReferralCode') ? document.getElementById('lblReferralCode').innerText : 'OPERIX99';
        const dynamicLink = `${window.location.origin}/?ref=${encodeURIComponent(fallbackCode)}`;
        executeCopyProcess(dynamicLink);
        return;
    }
    executeCopyProcess(copyInput.value);
}

function copyPlatformWalletAddress() {
    const walletInput = document.getElementById('platformWalletAddress');
    if (!walletInput || !walletInput.value) return;
    executeCopyProcess(walletInput.value);
}

function executeCopyProcess(textToCopy) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(textToCopy).then(() => {
            showToast("تم النسخ بنجاح! 🚀", 'win');
        }).catch(() => {
            fallbackCopyText(textToCopy);
        });
    } else {
        fallbackCopyText(textToCopy);
    }
}

function fallbackCopyText(text) {
    const tempInput = document.createElement("input");
    tempInput.value = text;
    document.body.appendChild(tempInput);
    tempInput.select();
    tempInput.setSelectionRange(0, 99999);
    try {
        document.execCommand('copy');
        showToast("تم النسخ بنجاح! 🚀", 'win');
    } catch (err) {
        showToast("تعذر النسخ التلقائي، يرجى النسخ يدوياً");
    }
    document.body.removeChild(tempInput);
}

// نوافذ الأمان والحساب
function openChangePasswordModal() {
    const modal = document.getElementById('changePasswordModal');
    if (modal) modal.classList.remove('hide');
    else openForgotPasswordModal();
}

function closeChangePasswordModal() {
    const modal = document.getElementById('changePasswordModal');
    if (modal) modal.classList.add('hide');
}

function toggle2FASetting(checkbox) {
    const isEnabled = checkbox.checked;
    if (isEnabled) {
        checkbox.checked = false;
        setupGoogleAuthenticator();
        return;
    }
    const token = localStorage.getItem('token');
    fetch('/api/user/2fa/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ enabled: isEnabled })
    }).then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'فشل حفظ إعداد المصادقة');
        if (currentUserData) currentUserData.twoFactorEnabled = data.enabled;
        updateVerificationStatus(data.enabled);
        updateTwoFactorStatus(data.enabled);
        showToast(data.message, isEnabled ? 'win' : 'default');
    }).catch(error => {
        checkbox.checked = !isEnabled;
        showToast(`❌ ${error.message}`);
    });
}

async function setupGoogleAuthenticator() {
    try {
        const setupResponse = await fetch('/api/user/2fa/setup', {
            method: 'POST', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        });
        const setup = await setupResponse.json();
        if (!setupResponse.ok) throw new Error(setup.error || 'تعذر إعداد المصادقة');
        document.getElementById('authenticatorQrCode').src = setup.qrCode;
        document.getElementById('authenticatorSecret').innerText = setup.secret;
        document.getElementById('authenticatorConfirmCode').value = '';
        document.getElementById('authenticatorSetupModal').classList.remove('hide');
    } catch (error) {
        showToast(`❌ ${error.message}`);
    }
}

function closeAuthenticatorSetup() {
    const modal = document.getElementById('authenticatorSetupModal');
    if (modal) modal.classList.add('hide');
}

async function confirmGoogleAuthenticator(event) {
    event.preventDefault();
    const button = document.getElementById('btnConfirmAuthenticator');
    const code = document.getElementById('authenticatorConfirmCode').value.trim();
    button.disabled = true;
    button.innerText = 'جاري التحقق...';
    try {
        const response = await fetch('/api/user/2fa/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: JSON.stringify({ code })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'الرمز غير صحيح');
        currentUserData.twoFactorEnabled = true;
        document.getElementById('toggle2FA').checked = true;
        updateVerificationStatus(true);
        updateTwoFactorStatus(true);
        closeAuthenticatorSetup();
        showToast('✅ تم ربط Google Authenticator وتوثيق الحساب', 'win');
    } catch (error) {
        showToast(`❌ ${error.message}`);
    } finally {
        button.disabled = false;
        button.innerText = 'تأكيد وتفعيل المصادقة';
    }
}

async function handleChangePasswordSubmit(event) {
    event.preventDefault();
    const currentPassword = document.getElementById('currentPasswordInput').value;
    const newPassword = document.getElementById('newPasswordInput').value;
    const token = localStorage.getItem('token');
    try {
        const response = await fetch('/api/user/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'فشل تغيير كلمة المرور');
        closeChangePasswordModal();
        event.target.reset();
        showToast(`✅ ${data.message}`, 'win');
    } catch (error) {
        showToast(`❌ ${error.message}`);
    }
}

function openActiveSessionsModal() {
    const modal = document.getElementById('activeSessionsModal');
    if (modal) {
        modal.classList.remove('hide');
        fetchActiveSessions();
    }
    else showToast("جهازك الحالي هو الجلسة النشطة الوحيدة ✅");
}

async function fetchActiveSessions() {
    const list = document.getElementById('activeSessionsList');
    const token = localStorage.getItem('token');
    if (!list || !token) return;
    try {
        const response = await fetch('/api/auth/sessions', { headers: { 'Authorization': `Bearer ${token}` } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر تحميل الجلسات');
        list.innerHTML = data.sessions?.length ? data.sessions.map(session => `<div class="p-3 bg-slate-950 border border-slate-800 rounded-xl flex justify-between items-center gap-3"><div class="min-w-0"><b class="text-white block">${escapeAiHtml(getBrowserNameFromUserAgent(session.userAgent))}${session.isCurrent ? ' (هذا الجهاز)' : ''}</b><span class="text-[10px] text-slate-400">${session.isCurrent ? 'نشط الآن' : 'جلسة أخرى'}</span><span class="text-[10px] text-slate-500 block mt-1">آخر نشاط: ${escapeAiHtml(new Date(session.lastSeenAt).toLocaleString('ar'))} · ${escapeAiHtml(session.ip || 'غير معروف')}</span></div>${session.isCurrent ? '<span class="w-2 h-2 bg-emerald-400 rounded-full shrink-0"></span>' : `<button type="button" onclick="revokeActiveSession('${escapeAiHtml(session.jti)}')" class="text-[10px] text-rose-300 border border-rose-500/20 rounded-lg px-2 py-1 shrink-0">إنهاء</button>`}</div>`).join('') : '<div class="p-3 bg-slate-950 border border-slate-800 rounded-xl text-slate-400">لا توجد جلسات نشطة</div>';
    } catch (error) { list.innerHTML = `<div class="p-3 bg-slate-950 border border-rose-500/20 rounded-xl text-rose-300">${escapeAiHtml(error.message)}</div>`; }
}

function getBrowserNameFromUserAgent(userAgent = '') {
    if (userAgent.includes('Edg/')) return 'Microsoft Edge';
    if (userAgent.includes('Chrome/')) return 'Google Chrome';
    if (userAgent.includes('Firefox/')) return 'Mozilla Firefox';
    if (userAgent.includes('Safari/')) return 'Safari';
    return 'متصفح غير معروف';
}

function getBrowserName() {
    const userAgent = navigator.userAgent;
    if (userAgent.includes('Edg/')) return 'Microsoft Edge';
    if (userAgent.includes('Chrome/')) return 'Google Chrome';
    if (userAgent.includes('Firefox/')) return 'Mozilla Firefox';
    if (userAgent.includes('Safari/')) return 'Safari';
    return 'المتصفح الحالي';
}

function closeActiveSessionsModal() {
    const modal = document.getElementById('activeSessionsModal');
    if (modal) modal.classList.add('hide');
}

async function terminateOtherSessions() {
    const token = localStorage.getItem('token');
    try {
        const response = await fetch('/api/auth/logout-other-sessions', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر إنهاء الجلسات');
        showToast(data.message, 'win');
        fetchActiveSessions();
    } catch (error) { showToast(`❌ ${error.message}`); }
}

async function revokeActiveSession(jti) {
    const token = localStorage.getItem('token');
    try {
        const response = await fetch(`/api/auth/sessions/${encodeURIComponent(jti)}/revoke`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر إنهاء الجلسة');
        showToast(data.message, 'win');
        fetchActiveSessions();
    } catch (error) { showToast(`❌ ${error.message}`); }
}

/* --- 8. التنقل والمودالات (Modals) --- */
function switchTab(tabName) {
    ['home', 'tiers', 'vault', 'travel', 'ai', 'spin', 'team', 'profile'].forEach(t => {
        const el = document.getElementById(`view-${t}`);
        if(el) el.classList.add('hide');
        const nav = document.getElementById(`nav-${t}`);
        if(nav) { nav.className = "app-nav-item flex flex-col items-center flex-1 text-slate-400 transition-all"; nav.removeAttribute('aria-current'); }
    });
    
    const targetView = document.getElementById(`view-${tabName}`);
    if(targetView) { targetView.classList.remove('hide'); targetView.classList.add('app-tab-view'); }
    
    const activeNav = document.getElementById(`nav-${tabName}`);
    if(activeNav) { activeNav.className = "app-nav-item is-active flex flex-col items-center flex-1 text-amber-500 transition-all"; activeNav.setAttribute('aria-current', 'page'); }

    if (tabName === 'profile') {
        updateProfileUI();
    }
    if (tabName === 'tiers') {
        loadUpgradeHistory();
        updateNextTierPanel();
    }
    if (tabName === 'vault') {
        loadVaultContracts();
        loadInvestmentVaults();
    }
    if (tabName === 'spin') {
        loadGameHistory();
        loadGameStats();
    }
    if (tabName === 'travel') {
        const maximum = tierLimits[currentUserTier] || 33;
        updateTaskAvailability(Number(currentUserData?.todayCompletedTasks || 0), maximum);
        startTaskResetCountdown();
    }
    if (tabName === 'team') {
        loadTeamNetwork();
    }
}

async function loadTeamReferrals() {
    const list = document.getElementById('teamMembersList');
    const token = localStorage.getItem('token');
    if (!list || !token) return;
    try {
        const response = await fetch('/api/user/referrals', { headers: { Authorization: `Bearer ${token}` } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر تحميل الفريق');
        list.innerHTML = data.referrals?.length ? data.referrals.map(member => { const active = !member.isBanned && Number(member.wallet?.totalDeposits || 0) > 0; return `<div class="team-member flex items-center justify-between gap-3 rounded-xl p-3"><div><b class="block text-xs text-slate-200">${escapeAiHtml(member.email)}</b><span class="text-[10px] text-slate-500">مستوى ${escapeAiHtml(member.tierCode || 'A1')} • ${new Date(member.createdAt).toLocaleDateString('ar')}</span></div><span class="text-[10px] font-bold ${active ? 'text-emerald-300' : 'text-slate-500'}">${active ? 'نشطة' : member.isBanned ? 'محظورة' : 'غير مفعلة'}</span></div>`; }).join('') : '<p class="text-[11px] text-slate-500 text-center py-4">لم تسجل إحالات مباشرة بعد.</p>';
    } catch (error) { list.innerHTML = `<p class="text-[11px] text-rose-300 text-center py-4">${escapeAiHtml(error.message)}</p>`; }
}

// دالة فحص وجود طلب إيداع معلق
async function checkPendingDepositStatus() {
    const token = localStorage.getItem('token');
    if (!token) return false;
    try {
        const res = await fetch('/api/transactions/my-history', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        const transactions = data.transactions || data.history || [];

        // التحقق مما إذا كان هناك طلب إيداع بحالة معلقة
        hasPendingDeposit = transactions.some(tx => 
            tx.type === 'deposit' && (tx.status === 'pending' || tx.status === 'processing' || tx.status === 'قيد المعالجة')
        );
        return hasPendingDeposit;
    } catch (err) {
        return false;
    }
}

async function openDepositModal() { 
    document.getElementById('depositModal').classList.remove('hide');
    await loadDepositAddress();
    const btn = document.getElementById('btnConfirmDeposit');
    
    // فحص الطلبات المعلقة عند فتح المودال
    await checkPendingDepositStatus();

    if (hasPendingDeposit) {
        if (btn) {
            btn.disabled = true;
            btn.innerText = 'لديك طلب إيداع سابق قيد المعالجة';
            btn.className = "w-full py-3 bg-slate-800 text-slate-500 font-bold rounded-xl text-xs cursor-not-allowed";
        }
        showToast('⚠️ لديك طلب إيداع سابق قيد المعالجة، يرجى انتظار قبوله أولاً');
    } else {
        if (btn) {
            btn.disabled = false;
            btn.innerText = 'تأكيد طلب الإيداع';
            btn.className = "w-full py-3 gold-gradient text-slate-950 font-black rounded-xl text-xs shadow-lg active:scale-95 transition-all";
        }
    }
}

function closeDepositModal() { document.getElementById('depositModal').classList.add('hide'); }
async function openNotificationsModal() {
    document.getElementById('notificationsModal').classList.remove('hide');
    const list = document.getElementById('notificationsList');
    try {
        const response = await fetch('/api/notifications', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'تعذر تحميل الإشعارات');
        list.innerHTML = data.notifications?.length ? data.notifications.map(item => `<button onclick="markNotificationRead('${item._id}')" class="w-full text-right p-3 rounded-xl border ${item.readAt ? 'border-slate-800 bg-slate-950/60' : 'border-amber-500/30 bg-amber-500/5'}"><b class="block text-white">${escapeAiHtml(item.title)}</b><span class="block text-[10px] text-slate-400 mt-1">${escapeAiHtml(item.body)}</span><small class="text-[9px] text-slate-600">${new Date(item.createdAt).toLocaleString('ar')}</small></button>`).join('') : '<p class="text-xs text-slate-400 text-center py-4">لا توجد إشعارات جديدة حالياً.</p>';
    } catch (error) { list.innerHTML = `<p class="text-xs text-rose-300 text-center py-4">${escapeAiHtml(error.message)}</p>`; }
}
function closeNotificationsModal() { document.getElementById('notificationsModal').classList.add('hide'); }
async function markNotificationRead(id) { await fetch(`/api/notifications/${id}/read`, { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }); fetchUnreadNotifications(); openNotificationsModal(); }
async function markAllNotificationsRead() { await fetch('/api/notifications/read-all', { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }); fetchUnreadNotifications(); openNotificationsModal(); }
async function openSupportModal() { document.getElementById('supportModal').classList.remove('hide'); await loadSupportTickets(); }
function closeSupportModal() { document.getElementById('supportModal').classList.add('hide'); }
async function loadSupportTickets() { const list = document.getElementById('supportTicketsList'); try { const response = await fetch('/api/support', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }); const data = await response.json(); if (!response.ok) throw new Error(data.error); list.innerHTML = data.tickets?.length ? data.tickets.map(ticket => `<div class="p-2.5 border border-slate-800 rounded-xl"><div class="flex justify-between gap-2"><b class="text-slate-200">${escapeAiHtml(ticket.subject)}</b><span class="text-cyan-300">${escapeAiHtml(ticket.status)}</span></div><p class="mt-1">${escapeAiHtml(ticket.adminReply || 'بانتظار رد فريق الدعم')}</p></div>`).join('') : 'لا توجد تذاكر دعم بعد.'; } catch (error) { list.innerText = error.message || 'تعذر تحميل التذاكر'; } }
async function createSupportTicket(event) { event.preventDefault(); const subject = document.getElementById('supportSubject').value; const message = document.getElementById('supportMessage').value; const response = await fetch('/api/support', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }, body: JSON.stringify({ subject, message }) }); const data = await response.json(); if (!response.ok) return showToast(data.error || 'تعذر إنشاء التذكرة'); event.target.reset(); showToast(data.message || 'تم إنشاء التذكرة'); loadSupportTickets(); }
async function applyCoupon() { const input = document.getElementById('couponCodeInput'); const code = input?.value.trim(); if (!code) return showToast('أدخل رمز الكوبون'); const response = await fetch('/api/coupons/apply', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }, body: JSON.stringify({ code }) }); const data = await response.json(); if (!response.ok) return showToast(data.error || 'تعذر تطبيق الكوبون'); input.value = ''; showToast(data.message || 'تم تطبيق الكوبون'); loadUserProfile(); }
function openWithdrawModal() { document.getElementById('withdrawModal').classList.remove('hide'); }
function closeWithdrawModal() { document.getElementById('withdrawModal').classList.add('hide'); }

async function loadDepositAddress() {
    try {
        const network = document.getElementById('depositNetwork').value;
        const res = await fetch('/api/wallet/deposit-config');
        const data = await res.json();
        document.getElementById('platformWalletAddress').value = data.addresses?.[network] || 'العنوان غير مضبوط حالياً';
    } catch (err) {
        document.getElementById('platformWalletAddress').value = 'تعذر تحميل العنوان';
    }
}

async function confirmDeposit() {
    if (hasPendingDeposit) {
        showToast('❌ لا يمكنك تقديم طلب إيداع جديد حتى يتم قبول أو رفض الطلب المعلق الحالي');
        return;
    }

    const token = localStorage.getItem('token');
    const amount = parseFloat(document.getElementById('depositAmount').value) || 50;
    const network = document.getElementById('depositNetwork').value;
    const txHash = document.getElementById('depositTxHash').value.trim();
    const btn = document.getElementById('btnConfirmDeposit');

    btn.disabled = true;
    btn.innerText = 'جاري الإرسال...';

    try {
        const res = await fetch('/api/wallet/deposit', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`},
            body: JSON.stringify({ amount, network, txHash })
        });
        const data = await res.json();
        if(res.ok) {
            hasPendingDeposit = true; // قفل الإيداع فور إرسال الطلب
            showToast(`تم شحن ${amount}$ بنجاح`, 'win');
            closeDepositModal();
            if (data.wallet) updateWalletData(data.wallet);
            await loadUserProfile();
        } else {
            showToast('❌ ' + (data.error || 'خطأ في عملية الإيداع'));
            btn.disabled = false;
            btn.innerText = 'تأكيد طلب الإيداع';
        }
    } catch(err) {
        showToast('❌ خطأ في الاتصال بالخادم');
        btn.disabled = false;
        btn.innerText = 'تأكيد طلب الإيداع';
    }
}

async function sendWithdraw2FACode() {
    const token = localStorage.getItem('token');
    try {
        const res = await fetch('/api/user/2fa/send-code', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (res.ok) {
            showToast('✅ تم إرسال رمز التحقق الثنائي (2FA) إلى بريدك الإلكتروني', 'win');
        } else {
            showToast('❌ ' + (data.error || 'فشل إرسال الرمز'));
        }
    } catch (err) {
        showToast('❌ خطأ في الاتصال بالخادم');
    }
}

function updateHybridWithdrawFee() {
    const amountInput = document.getElementById('withdrawAmount');
    const feeSummary = document.getElementById('withdrawFeeSummary');
    if (!amountInput || !feeSummary) return;
    const amount = Number(amountInput.value);
    if (!Number.isFinite(amount) || amount <= 0) {
        feeSummary.innerHTML = 'الرسوم: 5% + 2$ • الحد الأدنى: 20$';
        return;
    }
    const feeAmount = Number((amount * 0.05 + 2).toFixed(2));
    const netAmount = Number(Math.max(0, amount - feeAmount).toFixed(2));
    feeSummary.innerHTML = `الرسوم: <span class="text-amber-300 font-bold">$${feeAmount.toFixed(2)}</span> • صافي الدفع: <span class="text-emerald-300 font-bold">$${netAmount.toFixed(2)}</span> • الحد الأدنى: <span class="text-slate-300">20$</span>`;
}

async function submitWithdraw() {
    const amount = parseFloat(document.getElementById('withdrawAmount').value);
    const walletAddress = document.getElementById('withdrawWallet').value.trim();
    const twoFactorCode = document.getElementById('withdraw2faCode').value.trim();
    const token = localStorage.getItem('token');
    const btn = document.getElementById('btnSubmitWithdraw');

    if (!Number.isFinite(amount) || amount < 20) {
        showToast('الحد الأدنى للسحب هو 20$ USDT');
        return;
    }

    if (currentUserData?.kycStatus !== 'verified') {
        const kycStatus = currentUserData?.kycStatus || 'not_started';
        showToast(kycStatus === 'pending' ? 'طلب توثيق هويتك قيد المراجعة. انتظر الاعتماد قبل السحب.' : kycStatus === 'rejected' ? 'تم رفض توثيق هويتك. حدّث وثائق KYC قبل السحب.' : 'يجب توثيق هويتك قبل طلب السحب.');
        switchTab('profile');
        return;
    }

    if (!walletAddress) {
        showToast('يرجى تثبيت عنوان المحفظة أولاً من الملف الشخصي');
        return;
    }

    if (!twoFactorCode) {
        showToast('يرجى إدخال رمز التحقق الثنائي (2FA)');
        return;
    }

    btn.disabled = true;
    try {
        const idempotencyKey = sessionStorage.getItem('operix_withdraw_key') || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
        sessionStorage.setItem('operix_withdraw_key', idempotencyKey);
        const res = await fetch('/api/wallet/withdraw', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'Idempotency-Key': idempotencyKey},
            body: JSON.stringify({ amount, walletAddress, twoFactorCode })
        });
        const data = await res.json();
        if(res.ok) {
            showToast('تم تقديم طلب السحب وخصم المبلغ من محفظتك بنجاح');
            closeWithdrawModal();
            sessionStorage.removeItem('operix_withdraw_key');
            if (data.wallet) updateWalletData(data.wallet);
            await loadUserProfile(); // مزامنة وتحديث قيم الرصيد في الأماكن كافة فور نجاح الطلب
        } else {
            showToast(data.error || 'رصيد المحفظة لا يكفي أو رمز 2FA غير صحيح');
        }
    } catch(err) {
        showToast('خطأ في الاتصال');
    } finally {
        btn.disabled = false;
    }
}

async function openHistoryModal() {
    document.getElementById('historyModal').classList.remove('hide');
    const listEl = document.getElementById('historyList');
    listEl.innerHTML = `
        <div class="text-center py-6 text-gray-400">
            <i class="fas fa-spinner fa-spin text-2xl mb-2 text-amber-400"></i>
            <p class="text-xs">جاري مزامنة السجل المالي مع الخادم...</p>
        </div>
    `;
    
    const token = localStorage.getItem('token');
    try {
        const res = await fetch('/api/transactions/my-history', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        const transactions = data.transactions || data.history || [];

        if (res.ok && (data.success || Array.isArray(transactions)) && transactions.length > 0) {
            listEl.innerHTML = transactions.map(tx => {
                const isPositive = tx.type === 'deposit' || tx.type === 'reward' || tx.type === 'commission';
                const typeLabels = {
                    'deposit': 'إيداع رقمي',
                    'withdraw': 'طلب سحب',
                    'reward': 'مكافأة ترويجية',
                    'commission': 'عمولة فريق يومية'
                };
                const statusBadge = tx.status === 'approved' || tx.status === 'completed'
                    ? '<span class="text-emerald-400 text-[10px] font-bold bg-emerald-500/10 px-2 py-0.5 rounded-full">مكتمل</span>'
                    : tx.status === 'rejected'
                    ? '<span class="text-rose-400 text-[10px] font-bold bg-rose-500/10 px-2 py-0.5 rounded-full">مرفوض</span>'
                    : '<span class="text-amber-400 text-[10px] font-bold bg-amber-500/10 px-2 py-0.5 rounded-full">قيد المعالجة</span>';

                return `
                    <div class="bg-slate-950 p-3 rounded-xl border border-slate-800 flex justify-between items-center mb-2">
                        <div class="flex items-center space-x-3 space-x-reverse">
                            <div class="w-8 h-8 rounded-full flex items-center justify-center ${isPositive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}">
                                <i class="fas ${isPositive ? 'fa-arrow-down' : 'fa-arrow-up'} text-xs"></i>
                            </div>
                            <div>
                                <span class="font-bold text-white block text-xs">${typeLabels[tx.type] || tx.type}</span>
                                <span class="text-[10px] text-slate-400">${new Date(tx.createdAt).toLocaleString('ar-EG')}</span>
                            </div>
                        </div>
                        <div class="text-left">
                            <span class="font-bold ${isPositive ? 'text-emerald-400' : 'text-amber-400'} block text-xs">
                                ${isPositive ? '+' : '-'}${Number(tx.amount).toFixed(2)}$
                            </span>
                            ${statusBadge}
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            listEl.innerHTML = `
                <div class="text-center py-8 text-gray-400">
                    <i class="fas fa-receipt text-3xl mb-2 opacity-50"></i>
                    <p class="text-xs">لا توجد معاملات مالية مسجلة بعد</p>
                </div>
            `;
        }
    } catch (err) {
        listEl.innerHTML = `
            <div class="text-center py-6 text-rose-400">
                <i class="fas fa-exclamation-circle text-2xl mb-1"></i>
                <p class="text-xs">تعذر الاتصال بالخادم لجلب السجل</p>
            </div>
        `;
    }
}

function closeHistoryModal() {
    document.getElementById('historyModal').classList.add('hide');
}

function copyReferral() {
    const code = document.getElementById('lblReferralCode') ? document.getElementById('lblReferralCode').innerText : 'OPERIX99';
    executeCopyProcess(code);
}

async function logout() {
    const token = localStorage.getItem('token');
    if (token) {
        try { await fetch('/api/auth/logout', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } }); } catch (error) { }
    }
    await stopRealtimeStream();
    localStorage.removeItem('token');
    if (notificationPollTimer) clearInterval(notificationPollTimer);
    notificationPollTimer = null;
    if (profileSyncTimer) clearInterval(profileSyncTimer);
    profileSyncTimer = null;
    unreadNotificationCount = null;
    currentUserData = null;
    hasPendingDeposit = false;
    document.getElementById('loadingView').classList.add('hide');
    document.getElementById('appView').classList.add('hide');
    document.getElementById('authView').classList.add('hide');
    document.getElementById('companyIntroView')?.classList.remove('hide');
    document.getElementById('liveTickerBar').classList.add('hide');
    document.getElementById('appNavBar').classList.add('hide');
    showToast('تم تسجيل الخروج وحفظ محفظتك بأمان');
}

function changeLanguage(language) {
    const commonTranslations = {
        'جاري تحميل OPERIX...': 'Loading OPERIX...', 'مباشر': 'LIVE',
        'تسجيل الدخول': 'Log in', 'حساب جديد': 'Create account', 'البريد الإلكتروني': 'Email',
        'كلمة المرور': 'Password', 'نسيت كلمة المرور؟': 'Forgot password?', 'دخول المنصة': 'Log in',
        'كود الإحالة (اختياري)': 'Referral code (optional)', 'إنشاء حساب ومحفظة خاصة': 'Create account and wallet',
        'الرئيسية': 'Home', 'المستويات': 'Tiers', 'الألعاب': 'Games', 'المهام': 'Tasks', 'الفريق': 'Team', 'حسابي': 'Account',
        'إجمالي رصيد المحفظة': 'Total wallet balance', 'رصيد الإيداع': 'Deposit balance',
        'رصيد الأرباح (للسحب)': 'Profit balance (withdrawable)', 'إجمالي الإيداعات': 'Total deposits',
        'إجمالي المسحوبات': 'Total withdrawals', 'إيداع': 'Deposit', 'سحب': 'Withdraw', 'السجل': 'History',
        'مهام اليوم الحالية': "Today's tasks", 'نسبة الإنجاز': 'Completion rate',
        'إنجاز مهمة بنقرة واحدة ✨': 'Complete a task in one click ✨', 'المستويات الاستثمارية': 'Investment tiers',
        'اختر المستوى المناسب لزيادة عوائدك اليومية': 'Choose a tier to increase your daily returns',
        'مركز مهام OPERIX': 'OPERIX task center', 'أنجز مهامك اليومية وتابع تقدمك ومكافآتك داخل المنصة.': 'Complete your daily tasks and track your progress and rewards.',
        'تجدد المهام بعد': 'Tasks refresh in', 'انتهت مهام اليوم': "Today's tasks are complete",
        'عجلة الحظ والصناديق العشوائية': 'Lucky wheel and mystery boxes', 'تدوير العجلة': 'Spin the wheel',
        'فتح صندوق مجهول': 'Open mystery box', 'كود الإحالة الخاص بك': 'Your referral code',
        'إجمالي الفريق: 0': 'Total team: 0', 'الأرباح اليومية المقدرة:': 'Estimated daily earnings:',
        'إجمالي الأرباح المكتسبة': 'Total earnings', 'السحوبات الناجحة': 'Successful withdrawals',
        'رابط الدعوة السريع': 'Quick referral link', 'محفظة السحب المعتمدة': 'Approved withdrawal wallet',
        'الأمان والحماية': 'Security', 'إعدادات المنصة والدعم': 'Platform settings and support',
        'الأصوات والتنبيهات': 'Sounds and alerts', 'لغة التطبيق': 'Application language',
        'شروط الاستخدام': 'Terms of use', 'سياسة الخصوصية': 'Privacy policy',
        'تسجيل الخروج من الحساب': 'Log out of account', 'نسخ': 'Copy'
    };
    const translations = {
        ar: {
            displayName: 'User', email: 'user@domain.com', earnings: 'إجمالي الأرباح المكتسبة', withdrawn: 'السحوبات الناجحة',
            referral: 'رابط الدعوة السريع', copy: 'نسخ', walletTitle: 'محفظة السحب المعتمدة', walletLabel: 'عنوان المحفظة (TRC20 / BEP20)',
            security: 'الأمان والحماية', changePassword: 'تغيير كلمة المرور', twoFactor: 'المصادقة الثنائية (2FA)',
            sessions: 'الأجهزة والجلسات النشطة', preferences: 'إعدادات المنصة والدعم', sounds: 'الأصوات والتنبيهات', language: 'لغة التطبيق',
            support: 'الدعم الفني المباشر (Telegram)', terms: 'شروط الاستخدام', privacy: 'سياسة الخصوصية', logout: 'تسجيل الخروج من الحساب'
        },
        en: {
            displayName: 'User', email: 'user@domain.com', earnings: 'Total earnings', withdrawn: 'Successful withdrawals',
            referral: 'Quick referral link', copy: 'Copy', walletTitle: 'Approved withdrawal wallet', walletLabel: 'Wallet address (TRC20 / BEP20)',
            security: 'Security', changePassword: 'Change password', twoFactor: 'Two-factor authentication (2FA)',
            sessions: 'Active devices and sessions', preferences: 'Platform settings and support', sounds: 'Sounds and alerts', language: 'Application language',
            support: 'Technical support (Telegram)', terms: 'Terms of use', privacy: 'Privacy policy', logout: 'Log out of account'
        }
    };
    const selected = translations[language] || translations.ar;
    localStorage.setItem('ag_language', language);
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: node => ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.parentElement?.tagName)
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT
    });
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(node => {
        const text = node.nodeValue.trim();
        if (!text || !commonTranslations[text]) return;
        node.nodeValue = node.nodeValue.replace(text, language === 'en' ? commonTranslations[text] : Object.keys(commonTranslations).find(key => commonTranslations[key] === text) || text);
    });
    const profile = document.getElementById('view-profile');
    if (!profile) return;
    const replace = (selector, value) => { const element = profile.querySelector(selector); if (element) element.innerText = value; };
    replace('#lblProfileDisplayName', currentUserData?.email?.split('@')[0] || selected.displayName);
    replace('#lblProfileEmail', currentUserData?.email || selected.email);
    replace('#profileEarningsLabel', selected.earnings);
    replace('#profileWithdrawnLabel', selected.withdrawn);
    const referralInput = document.getElementById('profileReferralLink');
    if (referralInput) referralInput.setAttribute('aria-label', selected.referral);
    const languageSelect = profile.querySelector('select');
    if (languageSelect) languageSelect.value = language;
    renderTiersList();
}

