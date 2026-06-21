const User = require('../models/User');
const Project = require('../models/Project');       // 👈 Import Project
const projectQueue = require('../queues/projectQueue'); // 👈 BullMQ queue

async function subscribe(req, res) {
  const username = req.user?.username;

  if (!username) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // 1. Update user subscription status
    const user = await User.findOneAndUpdate(
      { username, subscribe: false },
      { $set: { subscribe: true, subscriptionUpdatedAt: new Date() } },
      { new: true, projection: { password: 0, __v: 0 } }
    );

    if (!user) {
      const existingUser = await User.findOne({ username }).select('subscribe');
      if (!existingUser) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (existingUser.subscribe === true) {
        return res.status(200).json({
          success: true,
          message: 'Already subscribed',
          subscribe: true
        });
      }
      return res.status(400).json({ error: 'Unable to process subscription' });
    }

    // 2. Find all projects owned by this user
    const projects = await Project.find({ username });
    console.log(`[Subscribe] Found ${projects.length} projects for user ${username}`);

    // 3. For each project, push an 'update' job to orchestrator with subscribed: true
    for (const project of projects) {
      try {
        await projectQueue.add('update', {
          action: 'update',
          projectId: project.id,
          subscribed: true,   // 👈 tells orchestrator to create dedicated container
        });
        console.log(`[Subscribe] Queued update for project ${project.id}`);
      } catch (queueError) {
        console.error(`[Subscribe] Failed to queue job for project ${project.id}:`, queueError);
        // Continue with other projects even if one fails
      }
    }

    console.log(`✅ Subscription completed for user: ${user.username}`);

    return res.status(200).json({
      success: true,
      message: 'Subscription activated',
      subscribe: true,
      user: { id: user._id, username: user.username, subscribe: user.subscribe }
    });
  } catch (error) {
    console.error('Subscription error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = subscribe;