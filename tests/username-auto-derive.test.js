const assert = require('node:assert/strict');

const dataAccessPath = require.resolve('../src/services/dataAccess');
const officialCommunityPath = require.resolve('../src/services/officialCommunity');

const created = { payload: null };

require.cache[dataAccessPath] = {
  exports: {
    user: {
      findOne: async (query) => {
        if (query && query.email) return null;
        if (query && query.username) return null;
        return null;
      },
      create: async (payload) => {
        created.payload = payload;
        return { id: 'user-1', _id: 'user-1', ...payload };
      }
    },
    session: {},
    securityEvent: {},
    notification: {},
    isSupabaseRuntime: () => false
  }
};

require.cache[officialCommunityPath] = {
  exports: {
    followOfficialCommunityAccount: async () => true
  }
};

const { register } = require('../src/controllers/authController');

(async () => {
  const req = {
    body: {
      email: 'User.Name+123@Example.com',
      password: 'password123',
      acceptTerms: true
    },
    app: { locals: { resend: null } }
  };

  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.payload = data;
      return this;
    }
  };

  await register(req, res);

  assert.equal(res.statusCode, 201, 'should allow registration without explicit username');
  assert.ok(created.payload && created.payload.username, 'username should match the registered email');
  assert.equal(created.payload.username, 'user.name+123@example.com');
  console.log('username auto-derive test: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
