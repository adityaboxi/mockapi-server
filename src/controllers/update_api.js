const Project = require('../models/Project');
const ProjectApiHistory = require('../models/ProjectApiHistory');
const SystemEventLog = require('../models/SystemEventLog');
const { storeMockDefinition } = require('../utils/redisMock');
const { addMockSyncJob } = require('../queues/mockSyncQueue');

function buildActualFullUrl(protocol, host, projectId, version, urlPath, pathParams, queryParams) {
  let resolvedPath = urlPath || '';
  pathParams.forEach(({ key, value }) => {
    resolvedPath = resolvedPath.replace(new RegExp(`:${key}`, 'g'), value || `{${key}}`);
  });
  if (resolvedPath.startsWith('/')) resolvedPath = resolvedPath.slice(1);
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

async function update_api(req, res) {
  const { project_id, urlpath, apihistorydata, airesponse } = req.body;
  const username = req.user?.username;

  // 🔍 LOG the received request body
  console.log('[update-api] Request body:', JSON.stringify(req.body, null, 2));

  if (!project_id || !urlpath || !apihistorydata) {
    return res.status(400).json({ error: 'Missing required fields: project_id, urlpath, apihistorydata' });
  }

  // 🔍 LOG the full apihistorydata object
  console.log('[update-api] apihistorydata received:', JSON.stringify(apihistorydata, null, 2));

  try {
    const project = await Project.findOne({ id: project_id });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (!project.members.includes(username)) {
      project.members.push(username);
      await project.save();
    }

    const projectHistory = await ProjectApiHistory.findOne({ projectCode: project.invitationCode });
    if (!projectHistory) {
      return res.status(404).json({ error: 'No API history found. Use /add-api first.' });
    }

    if (!projectHistory.accessByUsernames.includes(username)) {
      projectHistory.accessByUsernames.push(username);
    }

    const endpointIndex = projectHistory.endpoints.findIndex(ep => ep.baseUrlPath === urlpath);
    if (endpointIndex === -1) {
      return res.status(404).json({ error: 'URL path not found. Use /add-api to create it.' });
    }

    const endpoint = projectHistory.endpoints[endpointIndex];
    const existingVersions = endpoint.versions || [];
    const lastNum = existingVersions.length > 0
      ? parseInt(existingVersions[existingVersions.length - 1].version.replace('v', ''), 10)
      : 0;
    const newVersion = `v${lastNum + 1}`;

    // Destructure all fields, including new ones
    const {
      protocol = 'https',
      method = 'GET',
      pathParams = [],
      queryParams = [],
      requestBody = null,
      responseBody = null,
      isAuthEnabled = false,
      authScheme = 'BearerAuth',
      latency = 0,
      rateLimit = 0,
      headers = [],
      responseHeaders = [],
      cookies = [],
      statusCode = 200,
      expectedToken = '',      // ✨ new
      expectedApiKey = '',     // ✨ new
    } = apihistorydata;

    // 🔍 LOG the destructured fields (especially expectedToken, expectedApiKey, cookies)
    console.log('[update-api] Destructured fields:', {
      protocol, method, pathParams, queryParams,
      isAuthEnabled, authScheme, latency, rateLimit, statusCode,
      headers, responseHeaders, cookies,
      expectedToken, expectedApiKey
    });

    const mongoId = project._id.toString();
    const host = process.env.HOST;
    const actualFullUrl = buildActualFullUrl(protocol, host, mongoId, newVersion, urlpath, pathParams, queryParams);

    const newVersionObj = {
      protocol,
      method,
      urlPath: urlpath,
      pathParams,
      queryParams,
      requestBody,
      responseBody,
      version: newVersion,
      actualFullUrl,
      airesponse: airesponse || false,
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
      updatedAt: new Date(),
    };

    // 🔍 LOG the newVersionObj that will be stored and synced
    console.log('[update-api] newVersionObj (saved & synced):', JSON.stringify(newVersionObj, null, 2));

    endpoint.versions.push(newVersionObj);
    endpoint.updatedAt = new Date();
    await projectHistory.save();

    // ─── Sync mock server ───────────────────────────────────────────────────
    const definitionData = {
      projectId: mongoId,
      version: newVersion,
      method,
      urlpath,
      apihistorydata: newVersionObj,
    };
    await storeMockDefinition(mongoId, newVersion, method, urlpath, definitionData);
    await addMockSyncJob('set', definitionData);

    // ─── Log + emit ─────────────────────────────────────────────────────────
    const newLog = await SystemEventLog.create({
      projectId: project.id,          // ✅ use the custom string ID (e.g., "adiisme_haj")
      method: method.toUpperCase(),
      url: urlpath,
      action: 'updated',
      version: newVersion,
      username,
      statusCode: 200,
      createdAt: new Date(),
    });

    if (req.io) {
      req.io.to(project_id).emit('new_api_log', newLog.toObject());
    }

    return res.status(200).json({
      success: true,
      message: `New version ${newVersion} added to endpoint '${urlpath}'`,
      version: newVersion,
      actualFullUrl,
    });

  } catch (error) {
    console.error('[update-api] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = update_api;