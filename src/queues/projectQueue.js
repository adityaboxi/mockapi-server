const { Queue } = require('bullmq');

const REDIS_URL = process.env.REDIS_URL;

const projectQueue = new Queue('projectQueue', {
  connection: {
    url: REDIS_URL,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    // This is the recommended way to configure TLS for ioredis (BullMQ v5)
    tls: {
      rejectUnauthorized: false,   // required for Upstash
    },
  },
});

module.exports = projectQueue;