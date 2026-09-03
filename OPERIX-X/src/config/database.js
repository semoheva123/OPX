const mongoose = require('mongoose');

async function connectDatabase() {
  const mongoUri = process.env.MONGO_URI || process.env.DATABASE_URL;
  if (!mongoUri) throw new Error('MONGO_URI or DATABASE_URL is required');
  await mongoose.connect(mongoUri);
  console.log('✅ تم الاتصال بقاعدة بيانات MongoDB بنجاح');
}

async function closeDatabase() {
  await mongoose.connection.close(false);
}

module.exports = { connectDatabase, closeDatabase };
