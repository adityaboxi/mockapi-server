const Project = require('../models/Project');
const ProjectApiHistory = require('../models/ProjectApiHistory');
const SystemEventLog = require('../models/SystemEventLog');
const { deleteMockDefinition } = require('../utils/redisMock');
const { addMockSyncJob } = require('../queues/mockSyncQueue');

async function delete_api_version(req, res) {
  const { versionId } = req.params;
  const { projectId } = req.query;
  const username = req.user?.username;
  const role = req.user?.role;

  console.log('[delete-api-version] Request received:', { versionId, projectId, username, role });

  if (!username || role === 'guest') {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!versionId || !projectId) {
    return res.status(400).json({ error: 'Missing versionId or projectId' });
  }

  try {
    const project = await Project.findOne({ id: projectId });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const isCreator = project.username === username;
    const isAdmin = role === 'admin';
    if (!isCreator && !isAdmin) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    const projectHistory = await ProjectApiHistory.findOne({ projectCode: project.invitationCode });
    if (!projectHistory) return res.status(404).json({ error: 'No API history found' });

    // ─── Find the version ───────────────────────────────────────────────────
    let targetEndpointIndex = -1;
    let targetVersionIndex  = -1;
    let deletedVersion      = null;
    let endpointBasePath    = null;
    let method              = null;

    outer: for (let i = 0; i < projectHistory.endpoints.length; i++) {
      const endpoint = projectHistory.endpoints[i];
      for (let j = 0; j < endpoint.versions.length; j++) {
        const v = endpoint.versions[j];
        const matchesId       = v._id?.toString() === versionId;
        const matchesVersion  = v.version === versionId;
        const matchesComposite = `${endpoint.baseUrlPath}_${v.version}` === versionId;

        if (matchesId || matchesVersion || matchesComposite) {
          targetEndpointIndex = i;
          targetVersionIndex  = j;
          deletedVersion      = v;
          endpointBasePath    = endpoint.baseUrlPath;
          method              = v.method;
          break outer;
        }
      }
    }

    if (targetEndpointIndex === -1) {
      console.log('[delete-api-version] Version not found');
      return res.status(404).json({ error: 'Version not found' });
    }

    console.log('[delete-api-version] Found version to delete:', {
      version: deletedVersion.version,
      method,
      endpointBasePath,
      _id: deletedVersion._id,
    });

    // ─── Remove version (and endpoint if now empty) ─────────────────────────
    projectHistory.endpoints[targetEndpointIndex].versions.splice(targetVersionIndex, 1);
    if (projectHistory.endpoints[targetEndpointIndex].versions.length === 0) {
      projectHistory.endpoints.splice(targetEndpointIndex, 1);
    }
    await projectHistory.save();

    // ─── Sync mock server ───────────────────────────────────────────────────
    const mongoId = project._id.toString();
    console.log('[delete-api-version] Deleting from mock server:', {
      projectId: mongoId,
      version: deletedVersion.version,
      method,
      urlpath: endpointBasePath,
    });
    await deleteMockDefinition(mongoId, deletedVersion.version, method, endpointBasePath);
    await addMockSyncJob('delete', {
      projectId: mongoId,
      version: deletedVersion.version,
      method,
      urlpath: endpointBasePath,
    });

    // ─── Log + emit ─────────────────────────────────────────────────────────
    const newLog = await SystemEventLog.create({
      projectId: project.id,           // ✅ use custom string ID (matches room name)
      method,
      url: endpointBasePath,
      action: 'deleted',
      version: deletedVersion.version,
      username,
      statusCode: 200,
      createdAt: new Date(),
    });
    console.log('[delete-api-version] Log created:', newLog._id);

    if (req.io) {
      req.io.to(project.id).emit('new_api_log', newLog.toObject());
      console.log('[delete-api-version] Emitted socket event to room:', project.id);
    }

    return res.status(200).json({ success: true, message: 'Version deleted successfully' });

  } catch (error) {
    console.error('[delete-api-version] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = delete_api_version;