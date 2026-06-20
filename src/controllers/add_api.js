const Project = require('../models/Project');
const ProjectApiHistory = require('../models/ProjectApiHistory');
const SystemEventLog = require('../models/SystemEventLog');
const { storeMockDefinition } = require('../utils/redisMock');
const { addMockSyncJob } = require('../queues/mockSyncQueue');

function buildActualFullUrl(protocol, host, projectId, version, urlPath, pathParams, queryParams) {
  if (!host) {
    console.warn('[buildActualFullUrl] Host is missing – using localhost fallback');
    host = 'localhost:4000';
  }
  let resolvedPath = urlPath || '';
  pathParams.forEach(param => {
    const placeholder = `:${param.key}`;
    const value = param.value || `{${param.key}}`;
    resolvedPath = resolvedPath.replace(new RegExp(placeholder, 'g'), value);
  });
  if (resolvedPath.startsWith('/')) resolvedPath = resolvedPath.substring(1);
  let fullUrl = `${protocol}://${host}/${projectId}/${version}/${resolvedPath}`;
  if (queryParams && queryParams.length > 0) {
    const queryString = queryParams
      .filter(q => q.key && q.value)
      .map(q => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`)
      .join('&');
    if (queryString) fullUrl += `?${queryString}`;
  }
  return fullUrl;
}

async function add_api(req, res) {
  console.log('[add-api] Request received');
  console.log('[add-api] Body:', JSON.stringify(req.body, null, 2));

  const { project_id, urlpath, apihistorydata, airesponse } = req.body;
  const username = req.user?.username;

  if (!project_id || !urlpath || !apihistorydata) {
    console.error('[add-api] Missing required fields');
    return res.status(400).json({ error: 'Missing required fields: project_id, urlpath, apihistorydata' });
  }

  // 🔥 Coerce airesponse to a boolean (in case it arrives as string "true"/"false")
  const aiResponseBool = airesponse === true || airesponse === 'true';
  console.log(`[add-api] airesponse received: ${airesponse} → coerced to: ${aiResponseBool}`);

  // 🔍 LOG the full apihistorydata object to see what the frontend sent
  console.log('[add-api] apihistorydata received:', JSON.stringify(apihistorydata, null, 2));

  try {
    const project = await Project.findOne({ id: project_id });
    if (!project) {
      console.error('[add-api] Project not found:', project_id);
      return res.status(404).json({ error: 'Project not found' });
    }

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

    // Destructure all fields
    const {
      protocol,
      method,
      pathParams = [],
      queryParams = [],
      requestBody = null,
      responseBody = null,
      isAuthEnabled = false,
      authScheme = 'BearerAuth',    // 👈 Add default here to avoid undefined
      latency = 0,
      rateLimit = 0,
      headers = [],
      responseHeaders = [],
      cookies = [],
      statusCode = 200,
      expectedToken = '',
      expectedApiKey = '',
    } = apihistorydata;

    // 🔍 LOG the destructured values (including the coerced airesponse)
    console.log('[add-api] Destructured fields:', {
      protocol, method, pathParams, queryParams,
      isAuthEnabled, authScheme, latency, rateLimit, statusCode,
      headers, responseHeaders, cookies,
      expectedToken, expectedApiKey,
      airesponse: aiResponseBool   // 👈 Log the coerced value
    });

    const host = process.env.HOST || 'localhost:4000';
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
      airesponse: aiResponseBool,   // ✅ store the coerced boolean
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

    // 🔍 LOG the final object being stored
    console.log('[add-api] newVersionObj (will be saved and synced):', JSON.stringify(newVersionObj, null, 2));

    const newEndpoint = {
      baseUrlPath: urlpath,
      versions: [newVersionObj],
      accessBy: [username],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    projectHistory.endpoints.push(newEndpoint);
    await projectHistory.save();

    // Sync to mock server
    const definitionData = {
      projectId: project._id.toString(),
      version,
      method,
      urlpath,
      apihistorydata: newVersionObj
    };
    await storeMockDefinition(project._id.toString(), version, method, urlpath, definitionData);
    await addMockSyncJob('set', definitionData);

    const newLog = await SystemEventLog.create({
      projectId: project_id,
      method: method.toUpperCase(),
      url: urlpath,
      action: 'created',
      version: version,
      username: username,
      statusCode: 201,
      createdAt: new Date()
    });

    if (req.io) {
      req.io.to(project_id).emit('new_api_log', newLog.toObject());
      console.log(`[Socket] Emitted new_api_log to room: ${project_id}`);
    }

    console.log('[add-api] Successfully created endpoint:', urlpath, 'version:', version);
    console.log('[add-api] actualFullUrl =', actualFullUrl);
    res.status(201).json({
      success: true,
      message: `New API endpoint '${urlpath}' created with version ${version}`,
      actualFullUrl
    });
  } catch (error) {
    console.error('[add-api] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = add_api;