const dataAccess = require('./dataAccess');

const RECENT_ENTITY_COOLDOWN_DAYS = 14;
const CATEGORY_ROTATION = ['technology', 'ai', 'crypto', 'trading', 'finance'];
const CATEGORY_LABELS = {
  technology: 'شركة تقنية',
  ai: 'منصة ذكاء اصطناعي',
  crypto: 'أصل رقمي',
  trading: 'منصة تداول',
  finance: 'خدمة مالية'
};
const CATEGORY_TAGS = {
  technology: ['سهولة الاستخدام', 'الأداء', 'الخصوصية', 'إمكانية الوصول', 'الاعتمادية', 'الدعم', 'القيمة'],
  ai: ['الدقة', 'الخصوصية', 'السلامة', 'سهولة الاستخدام', 'الشفافية', 'التحيز', 'إمكانية الوصول'],
  crypto: ['الأمان', 'الشفافية', 'المنفعة', 'اللامركزية', 'التقلب', 'الرسوم', 'الحوكمة'],
  trading: ['الرسوم', 'السيولة', 'الواجهة', 'الأمان', 'السرعة', 'الدعم', 'الوثوقية'],
  finance: ['الشفافية', 'الرسوم', 'الخصوصية', 'الراحة', 'الأمان', 'الدعم', 'القيمة']
};

const TECH_ENTITIES = [
  'Apple Inc.', 'Microsoft', 'NVIDIA', 'Amazon (company)', 'Alphabet Inc.', 'Meta Platforms', 'Samsung Electronics', 'Sony', 'Intel', 'Advanced Micro Devices', 'Cisco', 'Oracle Corporation', 'IBM', 'Dell', 'Adobe Inc.', 'Qualcomm', 'Taiwan Semiconductor Manufacturing Company', 'ASML Holding', 'Netflix', 'Spotify', 'Salesforce', 'SAP', 'Tencent', 'Alibaba Group', 'Xiaomi', 'Shopify', 'Uber', 'Airbnb', 'Cloudflare', 'Arm Holdings'
];
const AI_ENTITIES = [
  'ChatGPT', 'Google Gemini', 'Claude (language model)', 'Microsoft Copilot', 'Perplexity AI', 'Mistral AI', 'DeepSeek', 'Grok (chatbot)', 'Meta AI', 'Llama (language model)', 'Midjourney', 'Stable Diffusion', 'GitHub Copilot', 'Adobe Firefly', 'Runway (company)', 'Cohere', 'Hugging Face', 'ElevenLabs', 'Suno (company)', 'Character.ai', 'Poe (chatbot)', 'NotebookLM', 'Replit', 'Cursor (code editor)', 'Canva Magic Studio', 'Amazon Q', 'IBM watsonx', 'Jasper (company)', 'Descript', 'Khanmigo'
];
const TRADING_ENTITIES = [
  'Binance', 'Coinbase', 'Kraken (company)', 'Bybit', 'OKX', 'eToro', 'TradingView', 'MetaTrader', 'Robinhood (company)', 'Interactive Brokers', 'Webull', 'Plus500', 'XTB', 'Saxo Bank', 'IG Group', 'Deribit', 'Bitget', 'Gate.io', 'Kraken (company)', 'Ftx'
];
const FINANCE_ENTITIES = [
  'PayPal', 'Stripe, Inc.', 'Visa Inc.', 'Mastercard', 'Wise (company)', 'Revolut', 'Payoneer', 'Block, Inc.', 'Plaid (company)', 'Klarna', 'Adyen', 'Nubank', 'Cash App', 'Remitly', 'Mercado Pago', 'Skrill', 'Western Union', 'MoneyGram', 'Chime (company)', 'SoFi'
];

const DAY_ENTITY_CACHE = new Map();
const ASSIGNMENT_CACHE = new Map();

function utcDateString(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function shiftUtcDate(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDateString(date);
}

function dayNumber(dateString) {
  return Math.floor(new Date(`${dateString}T00:00:00.000Z`).getTime() / 86400000);
}

function simpleHash(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

function safeHttpsImage(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'https:' ? parsed.toString().slice(0, 1000) : '';
  } catch {
    return '';
  }
}

function catalogFallback(category, title, date) {
  const entityKey = `${category}:wiki:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const summaries = {
    technology: `${title} — قيّم تجربة الاستخدام والاعتمادية والخصوصية وإمكانية الوصول استنادًا إلى معرفتك ومصادر موثوقة.`,
    ai: `${title} — قيّم الدقة والسلامة والخصوصية والشفافية والقيود استنادًا إلى تجربتك ومصادر موثوقة.`,
    trading: `${title} — قيّم الرسوم والسيولة وسهولة الاستخدام والأمان، ثم قرر ما إذا كانت المنصة مناسبة للمستوى المطلوب.`,
    finance: `${title} — قيّم الشفافية والرسوم والأمان وسهولة الاستخدام وجودة الدعم والراحة في الاستخدام.`
  };
  return {
    entityKey,
    category,
    name: title.replace(/ \(.+\)$/, ''),
    summary: summaries[category],
    imageUrl: '',
    source: 'curated-catalog',
    snapshotDate: date
  };
}

async function fetchJson(fetcher, url, timeoutMs = 12000) {
  const response = await fetcher(url, {
    headers: { 'User-Agent': 'OPERIX-Daily-Evaluations/1.0 (in-app research task)' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`Daily entity provider returned ${response.status}`);
  return response.json();
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { output[index] = await mapper(items[index], index); }
      catch { output[index] = null; }
    }
  });
  await Promise.all(workers);
  return output.filter(Boolean);
}

function rotatedSlice(items, date, count) {
  if (!items.length) return [];
  const offset = dayNumber(date) % items.length;
  return Array.from({ length: Math.min(count, items.length) }, (_, index) => items[(offset + index) % items.length]);
}

async function fetchWikipediaEntities(fetcher, category, titles, date) {
  const selectedTitles = rotatedSlice(titles, date, 18);
  return mapWithConcurrency(selectedTitles, 5, async title => {
    const fallback = catalogFallback(category, title, date);
    try {
      const page = await fetchJson(fetcher, `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
      if (!page?.extract) return fallback;
      return {
        ...fallback,
        name: String(page.title || fallback.name).slice(0, 160),
        summary: String(page.extract).replace(/\s+/g, ' ').trim().slice(0, 420) || fallback.summary,
        imageUrl: safeHttpsImage(page.thumbnail?.source),
        source: 'wikipedia'
      };
    } catch {
      return fallback;
    }
  });
}

async function fetchCryptoEntities(fetcher, date) {
  const pages = await Promise.all([1, 2, 3, 4].map(async page => {
    try {
      return await fetchJson(fetcher, `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false`);
    } catch (error) {
      console.warn(`CoinGecko daily entity page ${page} failed:`, error.message);
      return [];
    }
  }));
  const coins = pages.flat();
  try {
    const keyedCoins = coins.map((coin, index) => {
      const name = String(coin.name || '').trim();
      const symbol = String(coin.symbol || '').trim().toUpperCase();
      const marketRank = Number(coin.market_cap_rank || index + 1);
      const price = Number(coin.current_price);
      const priceText = Number.isFinite(price) ? ` السعر اللحظي في لقطة البيانات: $${price.toLocaleString('en-US', { maximumFractionDigits: 6 })}.` : '';
      const entity = {
        entityKey: `coingecko:${String(coin.id || '').toLowerCase()}`,
        category: 'crypto',
        name: `${name}${symbol ? ` (${symbol})` : ''}`.slice(0, 160),
        summary: `${name}${symbol ? ` (${symbol})` : ''} — أصل رقمي ضمن بيانات السوق، ترتيب القيمة السوقية وقت الالتقاط #${marketRank}.${priceText} بيانات وصفية فقط وليست توصية استثمارية.`.slice(0, 420),
        imageUrl: safeHttpsImage(coin.image),
        source: 'coingecko-markets',
        snapshotDate: date
      };
      return [entity.entityKey, entity];
    }).filter(([key, coin]) => key !== 'coingecko:' && coin.name.trim());
    return [...new Map(keyedCoins).values()];
  } catch (error) {
    console.warn('CoinGecko daily entity fetch failed:', error.message);
    return [];
  }
}

async function refreshDailyEntityPool(options = {}) {
  const date = utcDateString(options.now || new Date());
  if (DAY_ENTITY_CACHE.has(date)) return DAY_ENTITY_CACHE.get(date);
  if (DAY_ENTITY_CACHE.size > 3) DAY_ENTITY_CACHE.delete(DAY_ENTITY_CACHE.keys().next().value);
  const pending = (async () => {
    const fetcher = options.fetcher || global.fetch;
    const [technology, ai, crypto, trading, finance] = await Promise.all([
      fetchWikipediaEntities(fetcher, 'technology', TECH_ENTITIES, date),
      fetchWikipediaEntities(fetcher, 'ai', AI_ENTITIES, date),
      fetchCryptoEntities(fetcher, date),
      fetchWikipediaEntities(fetcher, 'trading', TRADING_ENTITIES, date),
      fetchWikipediaEntities(fetcher, 'finance', FINANCE_ENTITIES, date)
    ]);
    const entities = [...technology, ...ai, ...crypto, ...trading, ...finance];
    const unique = [...new Map(entities.filter(item => item.entityKey).map(item => [item.entityKey, item])).values()];
    if (!unique.length) throw new Error('No daily evaluation entities could be generated');
    await dataAccess.dailyTaskEntity.upsert(unique, { onConflict: 'snapshot_date,entity_key' });
    return unique;
  })();
  DAY_ENTITY_CACHE.set(date, pending);
  try { return await pending; }
  catch (error) { DAY_ENTITY_CACHE.delete(date); throw error; }
}

async function getDailyEntityPool(date) {
  let entities = await dataAccess.dailyTaskEntity.find({ snapshotDate: date }, { sort: { category: 1, entityKey: 1 }, limit: 500 });
  if (!entities.length) {
    await refreshDailyEntityPool({ now: new Date(`${date}T12:00:00.000Z`) });
    entities = await dataAccess.dailyTaskEntity.find({ snapshotDate: date }, { sort: { category: 1, entityKey: 1 }, limit: 500 });
  }
  return entities;
}

async function assignDailyEvaluationEntities({ userId, tierCode, totalTaskCount, date = utcDateString() }) {
  const evaluationCount = Math.max(0, Math.min(49, Number(totalTaskCount || 1) - 1));
  if (!evaluationCount) return [];
  const cacheKey = `${userId}:${tierCode}:${date}:${evaluationCount}`;
  if (ASSIGNMENT_CACHE.has(cacheKey)) return ASSIGNMENT_CACHE.get(cacheKey);
  const pending = (async () => {
    let assignments = await dataAccess.dailyTaskAssignment.find({ userId, tierCode, taskDate: date }, { sort: { taskNumber: 1 }, limit: 100 });
    if (assignments.length >= evaluationCount) return assignments.slice(0, evaluationCount);

    const recentDate = shiftUtcDate(date, -RECENT_ENTITY_COOLDOWN_DAYS);
    const [allHistoryAssignments, recentAssignments, todayAssignments, pool] = await Promise.all([
      dataAccess.dailyTaskAssignment.find({ userId }, { select: 'entityKey taskDate', limit: 20000 }),
      dataAccess.dailyTaskAssignment.find({ userId, taskDate: { $gte: recentDate, $lt: date } }, { select: 'entityKey taskDate', limit: 5000 }),
      dataAccess.dailyTaskAssignment.find({ userId, taskDate: date }, { select: 'entityKey', limit: 500 }),
      getDailyEntityPool(date)
    ]);
    const historyKeys = new Set((allHistoryAssignments || []).map(item => item.entityKey).filter(Boolean));
    const recentKeys = new Set((recentAssignments || []).map(item => item.entityKey).filter(Boolean));
    const usedKeys = new Set([
      ...historyKeys,
      ...recentKeys,
      ...(todayAssignments || []).map(item => item.entityKey).filter(Boolean),
      ...(assignments || []).map(item => item.entityKey).filter(Boolean)
    ]);
    const available = pool.filter(entity => entity.entityKey && !usedKeys.has(entity.entityKey));
    const targetCount = Math.min(evaluationCount, available.length);
    if (!targetCount) return [];

    const categoryBuckets = new Map(CATEGORY_ROTATION.map(category => [category, available.filter(entity => entity.category === category)]));
    const daySeed = dayNumber(date) + simpleHash(userId);

    for (let index = assignments.length; index < targetCount; index++) {
      const taskNumber = index + 2;
      const preferredCategory = CATEGORY_ROTATION[(daySeed + index) % CATEGORY_ROTATION.length];
      let assignment = null;
      let attempts = 0;
      while (!assignment && attempts < available.length) {
        let bucket = (categoryBuckets.get(preferredCategory) || []).filter(entity => !usedKeys.has(entity.entityKey));
        if (!bucket.length) bucket = available.filter(entity => entity.entityKey && !usedKeys.has(entity.entityKey));
        if (!bucket.length) break;
        const entity = bucket[(daySeed + taskNumber * 17 + attempts) % bucket.length];
        const record = {
          userId,
          tierCode,
          taskDate: date,
          taskNumber,
          category: entity.category,
          entityKey: entity.entityKey,
          entityName: entity.name,
          summary: entity.summary,
          imageUrl: safeHttpsImage(entity.imageUrl),
          allowedTags: getEvaluationTags(entity.category),
          source: entity.source || 'daily-entity-pool'
        };
        try {
          await dataAccess.dailyTaskAssignment.upsert(record, { onConflict: 'user_id,tier_code,task_date,task_number' });
          assignment = await dataAccess.dailyTaskAssignment.findOne({ userId, tierCode, taskDate: date, taskNumber });
        } catch (error) {
          if (error.code !== '23505') throw error;
        }
        if (!assignment) usedKeys.add(entity.entityKey);
        attempts++;
      }
      if (!assignment) break;
      usedKeys.add(assignment.entityKey);
      assignments.push(assignment);
    }
    return assignments.sort((left, right) => Number(left.taskNumber) - Number(right.taskNumber)).slice(0, targetCount);
  })();
  ASSIGNMENT_CACHE.set(cacheKey, pending);
  try { return await pending; }
  catch (error) { ASSIGNMENT_CACHE.delete(cacheKey); throw error; }
}

function getEvaluationTags(category) {
  return [...(CATEGORY_TAGS[category] || CATEGORY_TAGS.technology)];
}

function getCategoryLabel(category) {
  return CATEGORY_LABELS[category] || 'تقييم';
}

module.exports = {
  RECENT_ENTITY_COOLDOWN_DAYS,
  CATEGORY_TAGS,
  CATEGORY_LABELS,
  utcDateString,
  refreshDailyEntityPool,
  assignDailyEvaluationEntities,
  getEvaluationTags,
  getCategoryLabel
};
