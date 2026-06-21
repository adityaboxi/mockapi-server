const Project = require('../models/Project');
const { redisClient } = require('../config/redis');
const mongoose = require('mongoose');
const projectQueue = require('../queues/projectQueue');

async function updateProjectStatus(req, res) {
  const { projectId } = req.params;
  const { isActive } = req.body;
  const username = req.user?.username;
  const role = req.user?.role;

  if (typeof isActive !== 'boolean') {
    return res.status(400).json({ error: "isActive must be boolean" });
  }
  if (!username) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    if (!redisClient.isOpen) await redisClient.connect();

    let queryFilter = { id: projectId };
    if (mongoose.Types.ObjectId.isValid(projectId)) {
      queryFilter = { $or: [{ id: projectId }, { _id: projectId }] };
    }

    const project = await Project.findOne(queryFilter);
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (project.username !== username && role !== 'admin') {
      return res.status(403).json({ error: "Only project creators or admins can change status" });
    }

    project.isActive = isActive;
    await project.save();

    // Push toggle job (does not affect subscription)
    await projectQueue.add('toggle', {
      action: 'toggle',
      projectId: project.id,
      isActive: isActive,
    }, { jobId: `toggle:${project.id}:${isActive}` });
    console.log(`[ProjectQueue] Toggle job enqueued for ${project.id} (isActive: ${isActive})`);

    await redisClient.del(`user:projects:${project.username}`);
    for (const member of project.members) {
      await redisClient.del(`user:projects:${member}`);
    }

    if (req.io) {
      const roomName = project.id;
      req.io.to(roomName).emit('project_status_changed', {
        projectId: project.id,
        isActive: project.isActive
      });
      console.log(`[Socket] Project status changed emitted to room: ${roomName}`);
    }

    return res.json({ success: true, project });
  } catch (error) {
    console.error("Update project status error:", error);
    return res.status(500).json({ error: "Failed to update status" });
  }
}

module.exports = updateProjectStatus;