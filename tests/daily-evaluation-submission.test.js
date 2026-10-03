const assert = require('node:assert/strict');
const dataAccess = require('../src/services/dataAccess');
const activityController = require('../src/controllers/activityController');

const originals = {
  findUser: dataAccess.user.findById,
  findLevel: dataAccess.vipLevel.findOne,
  findCompletion: dataAccess.dailyTaskCompletion.findOne,
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
  try {
    dataAccess.user.findById = async () => ({ id: 'user-1', tierCode: 'A2', wallet: { totalDeposits: 100 } });
    dataAccess.vipLevel.findOne = async () => ({ code: 'A2', dailyTasks: [{ targetCategory: 'ai', targetName: 'Example AI' }] });
    dataAccess.dailyTaskCompletion.findOne = async () => null;
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
        selectedTag: 'الدقة',
        feedback: 'كانت النتائج مفيدة في تجربتي، لكن ينبغي توضيح حدود الدقة في الإجابات.'
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
    assert.equal(rpcCalls, 1);

    const shortFeedbackResponse = responseRecorder();
    await activityController.submitDailyEvaluation({
      user: { id: 'user-1' },
      body: {
        taskKey: 'A2-task-02',
        rating: 4,
        selectedTag: 'الدقة',
        feedback: 'خدمة جيدة جدًا.'
      }
    }, shortFeedbackResponse);
    assert.equal(shortFeedbackResponse.statusCode, 200, 'brief but real feedback should be accepted without annoying the user');
    assert.equal(rpcCalls, 2, 'a brief valid evaluation should still trigger completion');

    const minimumLengthResponse = responseRecorder();
    await activityController.submitDailyEvaluation({
      user: { id: 'user-1' },
      body: {
        taskKey: 'A2-task-02',
        rating: 3,
        selectedTag: 'الدقة',
        feedback: 'ممتاز جدًا.'
      }
    }, minimumLengthResponse);
    assert.equal(minimumLengthResponse.statusCode, 200, 'the minimum short feedback threshold should remain user-friendly');
    assert.equal(rpcCalls, 3, 'minimum-length valid input should still succeed');

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
    dataAccess.dailyTaskAssignment.findOne = originals.findAssignment;
    dataAccess.dailyTaskSubmission.findOne = originals.findSubmission;
    dataAccess.dailyTaskSubmission.create = originals.createSubmission;
    dataAccess.dailyTaskSubmission.updateOne = originals.updateSubmission;
    dataAccess.callSupabaseRpc = originals.rpc;
  }
})();
