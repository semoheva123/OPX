const assert = require('node:assert/strict');
const dataAccess = require('../src/services/dataAccess');
const activityController = require('../src/controllers/activityController');

const originals = {
  findUser: dataAccess.user.findById,
  findLevel: dataAccess.vipLevel.findOne,
  findCompletion: dataAccess.dailyTaskCompletion.findOne,
  findCompletions: dataAccess.dailyTaskCompletion.find,
  findAssignment: dataAccess.dailyTaskAssignment.findOne,
  findSubmission: dataAccess.dailyTaskSubmission.findOne,
  createSubmission: dataAccess.dailyTaskSubmission.create,
  updateSubmission: dataAccess.dailyTaskSubmission.updateOne,
  rpc: dataAccess.callSupabaseRpc
};

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

(async () => {
  const saved = [];
  let rpcCalls = 0;
  let completionRows = [{ taskKey: 'A2-community', createdAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString() }];
  try {
    dataAccess.user.findById = async () => ({ id: 'user-1', tierCode: 'A2', wallet: { totalDeposits: 100 } });
    dataAccess.vipLevel.findOne = async () => ({ code: 'A2', tasks: 3, dailyTasks: [{ targetCategory: 'ai', targetName: 'Example AI' }] });
    dataAccess.dailyTaskCompletion.findOne = async () => null;
    dataAccess.dailyTaskCompletion.find = async () => completionRows;
    dataAccess.dailyTaskAssignment.findOne = async () => ({ id: 'assignment-1', category: 'ai', entityKey: 'wiki:example-ai', entityName: 'Example AI', allowedTags: ['الدقة', 'الخصوصية'] });
    dataAccess.dailyTaskSubmission.findOne = async () => null;
    dataAccess.dailyTaskSubmission.create = async submission => { saved.push(submission); return submission; };
    dataAccess.dailyTaskSubmission.updateOne = async () => ({ modifiedCount: 1 });
    dataAccess.callSupabaseRpc = async (name, args) => {
      rpcCalls++;
      assert.equal(name, 'operix_daily_task_complete_atomic');
      assert.equal(args.p_task_key, 'A2-task-02');
      return { grossAmount: 0.95, wallet: {} };
    };

    const validRequest = {
      user: { id: 'user-1' },
      body: {
        taskKey: 'A2-task-02',
        rating: 4,
        selectedTag: 'الدقة'
      }
    };
    const validResponse = responseRecorder();
    await activityController.submitDailyEvaluation(validRequest, validResponse);
    assert.equal(validResponse.statusCode, 200);
    assert.equal(validResponse.body.success, true);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].targetCategory, 'ai', 'the target must come from the admin configuration');
    assert.equal(saved[0].targetName, 'Example AI', 'the target must not be client-selected');
    assert.equal(saved[0].assignmentId, 'assignment-1');
    assert.equal(saved[0].selectedTag, 'الدقة');
    assert.equal(saved[0].rating, 4);
    assert.equal(saved[0].feedback, '', 'rating-only evaluations should not require or persist a note');
    assert.equal(rpcCalls, 1);

    const outOfSequenceResponse = responseRecorder();
    const savedBeforeSequenceError = saved.length;
    const rpcBeforeSequenceError = rpcCalls;
    completionRows = [];
    await activityController.submitDailyEvaluation({
      user: { id: 'user-1' },
      body: { taskKey: 'A2-task-02', rating: 4, selectedTag: 'الدقة' }
    }, outOfSequenceResponse);
    assert.equal(outOfSequenceResponse.statusCode, 409, 'a task cannot be submitted before its immediate predecessor');
    assert.equal(saved.length, savedBeforeSequenceError, 'out-of-sequence evaluations must not be saved');
    assert.equal(rpcCalls, rpcBeforeSequenceError, 'out-of-sequence evaluations must not call the reward RPC');

    const cooldownResponse = responseRecorder();
    const savedBeforeCooldown = saved.length;
    const rpcBeforeCooldown = rpcCalls;
    completionRows = [{ taskKey: 'A2-community', createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() }];
    await activityController.submitDailyEvaluation({
      user: { id: 'user-1' },
      body: { taskKey: 'A2-task-02', rating: 3, selectedTag: 'الدقة' }
    }, cooldownResponse);
    assert.equal(cooldownResponse.statusCode, 429, 'the next task remains blocked until 3 hours after the previous completion');
    assert.equal(saved.length, savedBeforeCooldown, 'cooldown-blocked evaluations must not be saved');
    assert.equal(rpcCalls, rpcBeforeCooldown, 'cooldown-blocked evaluations must not earn task rewards');

    completionRows = [{ taskKey: 'A2-community', createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000 - 1000).toISOString() }];
    const noNoteResponse = responseRecorder();
    await activityController.submitDailyEvaluation({
      user: { id: 'user-1' },
      body: { taskKey: 'A2-task-02', rating: 3, selectedTag: 'الدقة' }
    }, noNoteResponse);
    assert.equal(noNoteResponse.statusCode, 200, 'an evaluation with only stars and aspect should be accepted');
    assert.equal(saved.at(-1).feedback, '');
    assert.equal(rpcCalls, 2);

    const invalidResponse = responseRecorder();
    const savedBeforeInvalid = saved.length;
    const rpcCallsBeforeInvalid = rpcCalls;
    await activityController.submitDailyEvaluation({ ...validRequest, body: { ...validRequest.body, rating: 6 } }, invalidResponse);
    assert.equal(invalidResponse.statusCode, 400);
    assert.equal(saved.length, savedBeforeInvalid, 'invalid evaluations must not be saved');
    assert.equal(rpcCalls, rpcCallsBeforeInvalid, 'invalid evaluations must not earn task rewards');

    const invalidTagResponse = responseRecorder();
    const savedBeforeInvalidTag = saved.length;
    const rpcCallsBeforeInvalidTag = rpcCalls;
    await activityController.submitDailyEvaluation({ ...validRequest, body: { ...validRequest.body, selectedTag: 'وسم غير مسموح' } }, invalidTagResponse);
    assert.equal(invalidTagResponse.statusCode, 400, 'tags must match the task category');
    assert.equal(saved.length, savedBeforeInvalidTag, 'invalid tag submissions must not be saved');
    assert.equal(rpcCalls, rpcCallsBeforeInvalidTag, 'an invalid category tag must not earn a reward');

    console.log('daily evaluation submission tests: ok');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    dataAccess.user.findById = originals.findUser;
    dataAccess.vipLevel.findOne = originals.findLevel;
    dataAccess.dailyTaskCompletion.findOne = originals.findCompletion;
    dataAccess.dailyTaskCompletion.find = originals.findCompletions;
    dataAccess.dailyTaskAssignment.findOne = originals.findAssignment;
    dataAccess.dailyTaskSubmission.findOne = originals.findSubmission;
    dataAccess.dailyTaskSubmission.create = originals.createSubmission;
    dataAccess.dailyTaskSubmission.updateOne = originals.updateSubmission;
    dataAccess.callSupabaseRpc = originals.rpc;
  }
})();
