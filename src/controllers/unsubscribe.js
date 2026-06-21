const User = require('../models/User');
const Project = require('../models/Project');            // 👈 Import Project model
const projectQueue = require('../queues/projectQueue'); // 👈 BullMQ queue

async function unsubscribe(req, res) {
  const username = req.user?.username;

  if (!username) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // 1. Update user subscription status
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (user.subscribe === false) {
      return res.status(400).json({ error: 'Not subscribed' });
    }

    user.subscribe = false;
    await user.save();

    // 2. Find all projects owned by this user
    const projects = await Project.find({ username });
    console.log(`[Unsubscribe] Found ${projects.length} projects for user ${username}`);

    // 3. For each project, push an 'update' job to orchestrator with subscribed: false
    for (const project of projects) {
      try {
        await projectQueue.add('update', {
          action: 'update',
          projectId: project.id,
          subscribed: false,   // 👈 tells orchestrator to remove dedicated container
        });
        console.log(`[Unsubscribe] Queued update for project ${project.id}`);
      } catch (queueError) {
        console.error(`[Unsubscribe] Failed to queue job for project ${project.id}:`, queueError);
        // Continue with other projects even if one fails
      }
    }

    console.log(`✅ Subscription cancelled for user: ${user.username}`);

    return res.status(200).json({
      success: true,
      message: 'Subscription cancelled',
      subscribe: false
    });
  } catch (error) {
    console.error('Unsubscription error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = unsubscribe;