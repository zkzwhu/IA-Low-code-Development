function createServiceError(message, code = 'REQUEST_ERROR') {
    const error = new Error(message || '请求失败，请稍后重试。');
    error.code = code;
    return error;
}

async function parseJsonResponse(response) {
    try {
        return await response.json();
    } catch (error) {
        return {};
    }
}

async function requestProjectApi(url, options = {}) {
    const response = await fetch(url, {
        credentials: 'same-origin',
        ...options
    });
    const result = await parseJsonResponse(response);
    if (!response.ok) {
        throw createServiceError(
            result?.message || '请求失败，请稍后重试。',
            result?.error_code || `HTTP_${response.status}`
        );
    }
    return result;
}

export async function listUserProjects(projectType) {
    const query = projectType ? `?type=${encodeURIComponent(projectType)}` : '';
    const result = await requestProjectApi(`/api/user-projects${query}`, {
        method: 'GET',
        cache: 'no-store'
    });
    return Array.isArray(result?.projects) ? result.projects : [];
}

export async function getUserProject(projectId) {
    const result = await requestProjectApi(`/api/user-projects/${encodeURIComponent(String(projectId))}`, {
        method: 'GET',
        cache: 'no-store'
    });
    return result?.project || null;
}

export async function saveUserProject({ projectId = null, projectType, name, data } = {}) {
    const result = await requestProjectApi('/api/user-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            project_id: projectId,
            project_type: projectType,
            name,
            data
        })
    });
    return result?.project || null;
}
