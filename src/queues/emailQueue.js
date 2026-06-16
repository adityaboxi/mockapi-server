// Located in: src/queues/emailQueue.js

const { Queue, Worker } = require('bullmq');
const { sendOTPEmail } = require('../services/emailService');

// No fallback – REDIS_URL must be defined in .env
const redisConnectionOptions = {
  connection: {
    url: process.env.REDIS_URL,
    maxRetriesPerRequest: null
  }
};

const emailQueue = new Queue('emailQueue', redisConnectionOptions);

const emailWorker = new Worker(
  'emailQueue',
  async (job) => {
    console.log(`[Worker] Processing job ${job.id}...`);
    
    if (job.name === 'sendOTP') {
      const { email, otp, username } = job.data;
      const emailResult = await sendOTPEmail(email, otp, username);
      
      if (!emailResult.success) {
        throw new Error(emailResult.error);
      }
    }
  },
  redisConnectionOptions
);

emailWorker.on('completed', (job) => console.log(`[Worker] 🎉 Job ${job.id} finished.`));
emailWorker.on('failed', (job, err) => console.error(`[Worker] 💥 Job ${job.id} failed: ${err.message}`));

module.exports = { emailQueue };