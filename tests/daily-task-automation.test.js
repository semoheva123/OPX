const assert = require('node:assert/strict');
const dataAccess = require('../src/services/dataAccess');
const automation = require('../src/services/dailyTaskAutomation');

const originals = {
  entityUpsert: dataAccess.dailyTaskEntity.upsert,
  entityFind: dataAccess.dailyTaskEntity.find,
  assignmentFind: dataAccess.dailyTaskAssignment.find,
  assignmentFindOne: dataAccess.dailyTaskAssignment.findOne,
  assignmentUpsert: dataAccess.dailyTaskAssignment.upsert
};

(async () => {
  try {
    const curatedRows = [];
    dataAccess.dailyTaskEntity.find = async () => [];
    dataAccess.dailyTaskEntity.upsert = async (rows, options) => {
      assert.equal(options.onConflict, 'snapshot_date,entity_key');
      assert.equal(options.ignoreDuplicates, true, 'the first curated seed must not overwrite existing daily entity data');
      curatedRows.push(...rows);
      return rows;
    };
    const curatedPool = await automation.getDailyEntityPool('2031-05-31');
    assert.ok(curatedPool.length >= 100, 'a full task catalog should be available before the first cron refresh');
    assert.ok(['technology', 'ai', 'crypto', 'trading', 'finance'].every(category => curatedPool.some(entity => entity.category === category)), 'the first-run catalog must cover every supported category');
    assert.equal(curatedRows.length, curatedPool.length, 'the first-run curated pool should be persisted for later daily requests');
    assert.ok(curatedPool.every(entity => entity.summary && entity.entityKey), 'curated tasks must include a usable summary and stable entity key');

    const savedEntities = [];
    dataAccess.dailyTaskEntity.upsert = async (rows, options) => {
      savedEntities.push(...rows);
      assert.equal(options.onConflict, 'snapshot_date,entity_key');
      assert.equal(options.ignoreDuplicates, false, 'scheduled enrichment must update curated metadata with fresh provider data');
      return rows;
    };
    const fetcher = async url => ({
      ok: true,
      json: async () => {
        if (url.includes('api.coingecko.com')) {
          const page = Number(new URL(url).searchParams.get('page'));
          return [{ id: `coin-${page}`, name: `Coin ${page}`, symbol: `c${page}`, market_cap_rank: page, current_price: page, image: `https://assets.example.test/${page}.png` }];
        }
        const title = decodeURIComponent(url.split('/').pop());
        return { title, extract: `${title} offers technology and digital services.`, thumbnail: { source: `https://images.example.test/${encodeURIComponent(title)}.jpg` } };
      }
    });
    const generated = await automation.refreshDailyEntityPool({ now: new Date('2031-06-01T10:00:00.000Z'), fetcher });
    assert.ok(generated.some(entity => entity.category === 'crypto'));
    assert.ok(generated.some(entity => entity.category === 'ai'));
    assert.ok(generated.some(entity => entity.category === 'technology'));
    assert.equal(new Set(generated.map(entity => entity.entityKey)).size, generated.length, 'daily entity pool must contain unique entity keys');
    assert.equal(savedEntities.length, generated.length, 'fresh entities must be persisted for daily assignment');

    const assigned = [];
    const entities = [
      { entityKey: 'coin:recent', category: 'crypto', name: 'Recent Coin', summary: 'Summary', imageUrl: '', source: 'test' },
      { entityKey: 'ai:fresh', category: 'ai', name: 'Fresh AI', summary: 'Summary', imageUrl: '', source: 'test' },
      { entityKey: 'tech:fresh', category: 'technology', name: 'Fresh Tech', summary: 'Summary', imageUrl: '', source: 'test' },
      { entityKey: 'coin:fresh-1', category: 'crypto', name: 'Fresh Coin One', summary: 'Summary', imageUrl: '', source: 'test' },
      { entityKey: 'coin:fresh-2', category: 'crypto', name: 'Fresh Coin Two', summary: 'Summary', imageUrl: '', source: 'test' },
      { entityKey: 'ai:fresh-2', category: 'ai', name: 'Fresh AI Two', summary: 'Summary', imageUrl: '', source: 'test' }
    ];
    dataAccess.dailyTaskEntity.find = async () => entities;
    dataAccess.dailyTaskAssignment.find = async query => {
      if (query.userId === 'never-repeat-user' && !query.taskDate) return [...historicalAssignments, ...assigned.filter(item => item.userId === 'never-repeat-user')];
      if (query.userId === 'never-repeat-user' && query.taskDate?.$gte) return [...historicalAssignments.filter(item => item.taskDate >= query.taskDate.$gte && item.taskDate < query.taskDate.$lt), ...assigned.filter(item => item.userId === 'never-repeat-user' && item.taskDate >= query.taskDate.$gte && item.taskDate < query.taskDate.$lt)];
      if (query.tierCode) return assigned.filter(item => item.userId === query.userId && item.tierCode === query.tierCode && item.taskDate === query.taskDate);
      if (query.taskDate?.$gte) return [{ entityKey: 'coin:recent', taskDate: '2031-05-30' }];
      return [];
    };
    dataAccess.dailyTaskAssignment.upsert = async assignment => {
      if (!assigned.some(item => item.userId === assignment.userId && item.taskNumber === assignment.taskNumber && item.taskDate === assignment.taskDate)) {
        assigned.push({ ...assignment, id: `assignment-${assignment.userId}-${assignment.taskNumber}-${assignment.taskDate}` });
      }
    };
    dataAccess.dailyTaskAssignment.findOne = async query => assigned.find(item => item.userId === query.userId && item.tierCode === query.tierCode && item.taskDate === query.taskDate && item.taskNumber === query.taskNumber) || null;

    const result = await automation.assignDailyEvaluationEntities({ userId: 'test-user-auto', tierCode: 'A1', totalTaskCount: 4, date: '2031-06-01' });
    assert.equal(result.length, 3, 'admin task count must control the number of dynamic evaluations');
    assert.ok(result.every(item => item.entityKey !== 'coin:recent'), 'recently assigned entities must be excluded');
    assert.equal(new Set(result.map(item => item.entityKey)).size, 3, 'one user must not receive duplicate entities in the same daily plan');
    assert.ok(result.every(item => item.allowedTags.length > 0), 'assignments must include category-specific selectable tags');
    const secondLoad = await automation.assignDailyEvaluationEntities({ userId: 'test-user-auto', tierCode: 'A1', totalTaskCount: 4, date: '2031-06-01' });
    assert.deepEqual(secondLoad.map(item => item.id), result.map(item => item.id), 'reloading a plan must keep its generated assignments stable');

    const historicalAssignments = [
      { userId: 'never-repeat-user', tierCode: 'A1', taskDate: '2030-06-01', taskNumber: 2, entityKey: 'tech:historic', category: 'technology' },
      { userId: 'never-repeat-user', tierCode: 'A1', taskDate: '2030-06-02', taskNumber: 3, entityKey: 'ai:historic', category: 'ai' }
    ];
    dataAccess.dailyTaskAssignment.find = async query => {
      if (query.userId === 'never-repeat-user') {
        const allUserAssignments = [...historicalAssignments, ...assigned.filter(item => item.userId === 'never-repeat-user')];
        if (query.taskDate && query.taskDate.$gte) return allUserAssignments.filter(item => item.taskDate >= query.taskDate.$gte && item.taskDate < query.taskDate.$lt);
        if (!query.taskDate) return allUserAssignments;
        if (query.tierCode) return allUserAssignments.filter(item => item.taskDate === query.taskDate && item.tierCode === query.tierCode);
        return allUserAssignments.filter(item => item.taskDate === query.taskDate);
      }
      if (query.userId === 'test-user-auto' && query.tierCode) return assigned.filter(item => item.userId === query.userId && item.tierCode === query.tierCode && item.taskDate === query.taskDate);
      if (query.taskDate?.$gte) return [{ entityKey: 'coin:recent', taskDate: '2031-05-30' }];
      return [];
    };
    const priorPool = [
      { entityKey: 'tech:historic', category: 'technology', name: 'Historic Tech', summary: 'Summary', imageUrl: '', source: 'test' },
      { entityKey: 'ai:historic', category: 'ai', name: 'Historic AI', summary: 'Summary', imageUrl: '', source: 'test' },
      { entityKey: 'crypto:historic', category: 'crypto', name: 'Historic Coin', summary: 'Summary', imageUrl: '', source: 'test' },
      { entityKey: 'tech:brand-new', category: 'technology', name: 'Brand New Tech', summary: 'Summary', imageUrl: '', source: 'test' },
      { entityKey: 'ai:brand-new', category: 'ai', name: 'Brand New AI', summary: 'Summary', imageUrl: '', source: 'test' }
    ];
    dataAccess.dailyTaskEntity.find = async () => priorPool;
    const noRepeatResult = await automation.assignDailyEvaluationEntities({ userId: 'never-repeat-user', tierCode: 'A1', totalTaskCount: 3, date: '2031-06-01' });
    assert.equal(new Set(noRepeatResult.map(item => item.entityKey)).size, 2, 'historical assignments must be excluded forever from future daily task plans');
    assert.ok(noRepeatResult.every(item => !['tech:historic', 'ai:historic'].includes(item.entityKey)), 'reused historical entities must never reappear');

    console.log('daily task automation tests: ok');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    dataAccess.dailyTaskEntity.upsert = originals.entityUpsert;
    dataAccess.dailyTaskEntity.find = originals.entityFind;
    dataAccess.dailyTaskAssignment.find = originals.assignmentFind;
    dataAccess.dailyTaskAssignment.findOne = originals.assignmentFindOne;
    dataAccess.dailyTaskAssignment.upsert = originals.assignmentUpsert;
  }
})();
