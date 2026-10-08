const assert = require('node:assert/strict');
const dataAccess = require('../src/services/dataAccess');
const activityController = require('../src/controllers/activityController');

const originals = {
  findUser: dataAccess.user.findById,
  findLevel: dataAccess.vipLevel.findOne,
  findCompletion: dataAccess.dailyTaskCompletion.findOne,
  findCompletions: dataAccess.dailyTaskCompletion.find,
  findAssignment: dataAccess.dailyTaskAssignment.findOne,
  findAssignments: dataAccess.dailyTaskAssignment.find,
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
  let completionRows = [];
  let assignmentCreatedAt = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
  const assignmentRows = () => [1, 2, 3].map(taskNumber => ({ taskNumber, createdAt: assignmentCreatedAt }));
  try {
    dataAccess.user.findById = async () => ({ id: 'user-1', tierCode: 'A2', wallet: { totalDeposits: 100 } });
    dataAccess.vipLevel.findOne = async () => ({ code: 'A2', tasks: 3, dailyTasks: [{ targetCategory: 'ai', targetName: 'Example AI' }] });
    dataAccess.dailyTaskCompletion.findOne = async () => null;
    dataAccess.dailyTaskCompletion.find = async () => completionRows;
    dataAccess.dailyTaskAssignment.findOne = async ({ taskNumber }) => ({ id: `assignment-${taskNumber}`, taskNumber, category: 'ai', entityKey: `wiki:example-ai-${taskNumber}`, entityName: `Example AI ${taskNumber}`, allowedTags: ['الدقة', 'الخصوصية'] });
    dataAccess.dailyTaskAssignment.find = async () => assignmentRows();
    dataAccess.dailyTaskSubmission.findOne = async () => null;
    dataAccess.dailyTaskSubmission.create = async submission => { saved.push(submission); return submission; };
    dataAccess.dailyTaskSubmission.updateOne = async () => ({ modifiedCount: 1 });
    dataAccess.callSupabaseRpc = async (name, args) => {
      rpcCalls++;
      assert.equal(name, 'operix_daily_task_complete_atomic');
      assert.match(args.p_task_key, /^A2-task-0[1-3]$/);
      return { grossAmount: 0.95, wallet: {} };
    };

    const validRequest = {
      user: { id: 'user-1' },
      body: {
        taskKey: 'A2-task-01',
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
    assert.equal(saved[0].targetName, 'Example AI 1', 'the target must not be client-selected');
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
    assert.equal(outOfSequenceResponse.statusCode, 409, 'paid evaluations remain sequential without requiring community completion');
    assert.equal(saved.length, savedBeforeSequenceError, 'out-of-sequence evaluations must not be saved');
    assert.equal(rpcCalls, rpcBeforeSequenceError, 'out-of-sequence evaluations must not call the reward RPC');

    const missingPreviousAssignmentResponse = responseRecorder();
    const originalFindOne = dataAccess.dailyTaskAssignment.findOne;
    dataAccess.dailyTaskAssignment.findOne = async ({ taskNumber }) => {
      if (taskNumber === 1) return null;
      return { id: `assignment-${taskNumber}`, taskNumber, category: 'ai', entityKey: `wiki:example-ai-${taskNumber}`, entityName: `Example AI ${taskNumber}`, allowedTags: ['الدقة', 'الخصوصية'] };
    };
    completionRows = [];
    await activityController.submitDailyEvaluation({
      user: { id: 'user-1' },
      body: { taskKey: 'A2-task-02', rating: 3, selectedTag: 'الدقة' }
    }, missingPreviousAssignmentResponse);
    assert.equal(missingPreviousAssignmentResponse.statusCode, 200, 'the first visible task must remain executable if the previous assignment is missing from the live plan');
    assert.equal(saved.at(-1).taskKey, 'A2-task-02');
    dataAccess.dailyTaskAssignment.findOne = originalFindOne;

    const accruedBacklogResponse = responseRecorder();
    completionRows = [{ taskKey: 'A2-task-01', createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString() }];
    await activityController.submitDailyEvaluation({
      user: { id: 'user-1' },
      body: { taskKey: 'A2-task-02', rating: 3, selectedTag: 'الدقة' }
    }, accruedBacklogResponse);
    assert.equal(accruedBacklogResponse.statusCode, 200, 'a task already accrued in the 2-hour release schedule can be completed immediately after its predecessor');
    assert.equal(saved.at(-1).taskKey, 'A2-task-02');

    assignmentCreatedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    completionRows = [{ taskKey: 'A2-task-01', createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() }];
    const notYetReleasedResponse = responseRecorder();
    const savedBeforeRelease = saved.length;
    const rpcBeforeRelease = rpcCalls;
    await activityController.submitDailyEvaluation({
      user: { id: 'user-1' },
      body: { taskKey: 'A2-task-02', rating: 3, selectedTag: 'الدقة' }
    }, notYetReleasedResponse);
    assert.equal(notYetReleasedResponse.statusCode, 429, 'a future task must remain locked until its plan-start release time');
    assert.equal(saved.length, savedBeforeRelease, 'not-yet-released evaluations must not be saved');
    assert.equal(rpcCalls, rpcBeforeRelease, 'not-yet-released evaluations must not call the reward RPC');

    assignmentCreatedAt = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    completionRows = [];
    const noCommunityPrerequisiteResponse = responseRecorder();
    await activityController.submitDailyEvaluation({
      user: { id: 'user-1' },
      body: { taskKey: 'A2-task-01', rating: 3, selectedTag: 'الدقة' }
    }, noCommunityPrerequisiteResponse);
    assert.equal(noCommunityPrerequisiteResponse.statusCode, 200, 'the first paid evaluation is immediately available without any community action');
    assert.equal(saved.at(-1).feedback, '');
    assert.equal(rpcCalls, 4, 'successful first-visible-task completions should still call the reward RPC');

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

    const staleDbSchemaResponse = responseRecorder();
    dataAccess.callSupabaseRpc = async () => {
      const error = new Error('column "selected_tag" of relation "daily_task_submissions" does not exist');
      error.code = '42703';
      throw error;
    };
    await activityController.submitDailyEvaluation({ ...validRequest, body: { ...validRequest.body, selectedTag: 'الدقة' } }, staleDbSchemaResponse);
    assert.equal(staleDbSchemaResponse.statusCode, 503, 'stale task schema must surface a migration-focused error');
    assert.match(String(staleDbSchemaResponse.body.error), /قاعدة البيانات|تحديث/i, 'stale task schema should explain the DB migration requirement');

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
    dataAccess.dailyTaskAssignment.find = originals.findAssignments;
    dataAccess.dailyTaskSubmission.findOne = originals.findSubmission;
    dataAccess.dailyTaskSubmission.create = originals.createSubmission;
    dataAccess.dailyTaskSubmission.updateOne = originals.updateSubmission;
    dataAccess.callSupabaseRpc = originals.rpc;
  }
})();
