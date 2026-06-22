const Project = require('../models/Project');
const ProjectApiHistory = require('../models/ProjectApiHistory');
const SystemEventLog = require('../models/SystemEventLog');
const { storeMockDefinition } = require('../utils/redisMock');
const { addMockSyncJob } = require('../queues/mockSyncQueue');

// Allowed HTTP methods
const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function buildActualFullUrl(protocol, host, projectId, version, urlPath, pathParams, queryParams) {
  const resolvedPath = (urlPath || '')
    .split('/')
    .filter(Boolean)
    .map(segment => {
      const param = pathParams.find(p => `:${p.key}` === segment);
      return param ? param.value || `{${param.key}}` : segment;
    })
    .join('/');

  let fullUrl = `${protocol}://${host}/${projectId}/${version}/${resolvedPath}`;
  if (queryParams?.length) {
    const qs = queryParams
      .filter(q => q.key && q.value)
      .map(q => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`)
      .join('&');
    if (qs) fullUrl += `?${qs}`;
  }
  return fullUrl;
}

async function add_api(req, res) {
  const { project_id, urlpath, apihistorydata, airesponse } = req.body;
  const username = req.user?.username;

  // --- Required fields ---
  if (!project_id || !urlpath || !apihistorydata) {
    return res.status(400).json({ error: 'Missing required fields: project_id, urlpath, apihistorydata' });
  }

  const aiResponseBool = airesponse === true || airesponse === 'true';

  try {
    const project = await Project.findOne({ id: project_id });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (!project.members.includes(username)) {
      project.members.push(username);
      await project.save();
    }

    let projectHistory = await ProjectApiHistory.findOne({ projectCode: project.invitationCode });
    if (!projectHistory) {
      projectHistory = new ProjectApiHistory({
        projectID: project._id.toString(),
        projectCode: project.invitationCode,
        accessByUsernames: [username],
        endpoints: []
      });
    } else if (!projectHistory.accessByUsernames.includes(username)) {
      projectHistory.accessByUsernames.push(username);
    }

    if (projectHistory.endpoints.some(ep => ep.baseUrlPath === urlpath)) {
      return res.status(409).json({ error: 'URL path already exists. Use /update-api to add a new version.' });
    }

    // --- Destructure with defaults for arrays ---
    const {
      protocol,
      method,
      pathParams = [],
      queryParams = [],
      requestBody = null,
      responseBody = null,
      isAuthEnabled,
      authScheme,
      latency,
      rateLimit,
      headers = [],
      responseHeaders = [],
      cookies = [],
      statusCode,
      expectedToken = '',
      expectedApiKey = '',
    } = apihistorydata;

    // --- Validate required fields ---
    if (!protocol) return res.status(400).json({ error: 'protocol is required' });
    if (!method) return res.status(400).json({ error: 'method is required' });
    if (!ALLOWED_METHODS.includes(method.toUpperCase())) {
      return res.status(400).json({ error: `Invalid method. Allowed: ${ALLOWED_METHODS.join(', ')}` });
    }
    if (isAuthEnabled === undefined) return res.status(400).json({ error: 'isAuthEnabled is required' });
    if (!authScheme) return res.status(400).json({ error: 'authScheme is required' });
    if (latency === undefined) return res.status(400).json({ error: 'latency is required' });
    if (rateLimit === undefined) return res.status(400).json({ error: 'rateLimit is required' });
    if (statusCode === undefined) return res.status(400).json({ error: 'statusCode is required' });
    if (typeof statusCode !== 'number') {
      return res.status(400).json({ error: 'statusCode must be a number' });
    }

    const host = process.env.HOST;
    if (!host) return res.status(500).json({ error: 'HOST environment variable is not set' });

    const version = 'v1';
    const actualFullUrl = buildActualFullUrl(
      protocol, host, project._id.toString(), version, urlpath, pathParams, queryParams
    );

    const newVersionObj = {
      protocol,
      method,
      urlPath: urlpath,
      pathParams,
      queryParams,
      requestBody,
      responseBody,
      version,
      actualFullUrl,
      airesponse: aiResponseBool,
      isAuthEnabled,
      authScheme,
      latency,
      rateLimit,
      headers,
      responseHeaders,
      cookies,
      statusCode,
      expectedToken,
      expectedApiKey,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const newEndpoint = {
      baseUrlPath: urlpath,
      versions: [newVersionObj],
      accessBy: [username],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    projectHistory.endpoints.push(newEndpoint);
    await projectHistory.save();

    // ─── Sync to mock server (NO subscription field) ─────────────────────
    const definitionData = {
      projectId: project._id.toString(),
      version,
      method,
      urlpath,
      apihistorydata: newVersionObj,
    };

    await storeMockDefinition(project._id.toString(), version, method, urlpath, definitionData);
    await addMockSyncJob('set', definitionData);

    // ─── Log the event ─────────────────────────────────────────────────────
    const newLog = await SystemEventLog.create({
      projectId: project_id,
      method: method.toUpperCase(),
      url: urlpath,
      action: 'created',
      version: version,
      username,
      statusCode: 201,
      createdAt: new Date()
    });

    if (req.io) {
      req.io.to(project_id).emit('new_api_log', newLog.toObject());
    }

    return res.status(201).json({
      success: true,
      message: `New API endpoint '${urlpath}' created with version ${version}`,
      actualFullUrl
    });

  } catch (error) {
    console.error('[add-api] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = add_api;