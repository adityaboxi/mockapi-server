const Project = require('../models/Project');
const ProjectApiHistory = require('../models/ProjectApiHistory');
const SystemEventLog = require('../models/SystemEventLog');
const { redisClient } = require('../config/redis');
const projectQueue = require('../queues/projectQueue');

async function deleteMockDefinitionsForProject(projectId) {
  if (!redisClient.isOpen) await redisClient.connect();
  const pattern = `mockapi:def:${projectId}:*`;
  let deletedCount = 0;
  for await (const key of redisClient.scanIterator({ MATCH: pattern, COUNT: 100 })) {
    await redisClient.del(key);
    deletedCount++;
  }
  return deletedCount;
}

async function delete_project(req, res) {
  const { projectId } = req.params;
  const username = req.user?.username;
  const role = req.user?.role;

  if (!username) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!projectId) {
    return res.status(400).json({ error: 'projectId is required' });
  }

  try {
    const project = await Project.findOne({ id: projectId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const isCreator = project.username === username;
    const isAdmin = role === 'admin';
    if (!isCreator && !isAdmin) {
      return res.status(403).json({ error: 'Only project creators or admins can delete this project' });
    }

    await ProjectApiHistory.deleteOne({ projectCode: project.invitationCode });
    await SystemEventLog.deleteMany({ projectId: project.id });

    const clearedKeys = await deleteMockDefinitionsForProject(project.id);

    if (!redisClient.isOpen) await redisClient.connect();
    await redisClient.del(`invitation:${project.invitationCode}`);

    const membersToInvalidate = new Set([project.username, ...project.members]);
    for (const member of membersToInvalidate) {
      await redisClient.del(`user:projects:${member}`);
    }

    await Project.deleteOne({ id: project.id });

    await projectQueue.add('delete', {
      action: 'delete',
      projectId: project.id,
    }, { jobId: `delete_${project.id}_${Date.now()}` });
    console.log(`[ProjectQueue] Delete job enqueued for ${project.id} (cleared ${clearedKeys} redis defs)`);

    if (req.io) {
      req.io.to(project.id).emit('project_deleted', { projectId: project.id });
    }

    return res.status(200).json({ success: true, message: `Project '${project.id}' deleted` });
  } catch (error) {
    console.error('[delete-project] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = delete_project;