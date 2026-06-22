const { Queue } = require('bullmq');

const projectQueue = new Queue('projectQueue', {
  connection: {
    host: 'localhost',
    port: 6379,
  },
});

module.exports = projectQueue;