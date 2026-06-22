const { Queue } = require('bullmq');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const projectQueue = new Queue('projectQueue', {
  connection: {
    url: REDIS_URL,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // ❌ Remove `tls` – the URL scheme handles it
  },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: { age: 86400, count: 1000 },
  },
});

module.exports = projectQueue;