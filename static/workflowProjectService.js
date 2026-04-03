import { state, setCurrentProject, setDebugCurrentNodeId, setWorkflowPorts } from './appStore.js';
import { addConsoleLog } from './appUtils.js';
import { renderCanvas, resetCanvasHistory, setSelectedNode } from './nodeManager.js';
import { createProjectRecord, getProjectById, listProjectsByType, saveProjectData, touchProject } from './projectRepository.js';

const IMPORT_STORAGE_KEY = 'ia-editor-import-payload';
const AUTOSAVE_INTERVAL_MS = 1800;

let autoSaveTimer = null;
let beforeUnloadBound = false;
let lastSavedSnapshot = '';

function formatDatePart(value) {
    return String(value).padStart(2, '0');
}

function buildDefaultWorkflowName() {
    const now = new Date();
    return `智能工作流 ${now.getFullYear()}-${formatDatePart(now.getMonth() + 1)}-${formatDatePart(now.getDate())} ${formatDatePart(now.getHours())}:${formatDatePart(now.getMinutes())}`;
}

function normalizeWorkflowPort(port, index = 0) {
    const safeId = String(port?.id || `workflow-port-${Date.now()}-${index}`);
    return {
        id: safeId,
        name: String(port?.name || `端口${index + 1}`),
        dataType: port?.dataType === 'int' ? 'int' : 'string',
        nodeId: Number.isFinite(Number(port?.nodeId)) ? Number(port.nodeId) : null,
        field: typeof port?.field === 'string' ? port.field : ''
    };
}

function normalizeWorkflowData(data) {
    return {
        nodes: Array.isArray(data?.nodes) ? data.nodes : [],
        next_id: Number.isFinite(Number(data?.next_id)) ? Number(data.next_id) : 100,
        workflow_ports: Array.isArray(data?.workflow_ports)
            ? data.workflow_ports.map(normalizeWorkflowPort)
            : []
    };
}

export function getNodePortFieldOptions(nodeType) {
    if (nodeType === 'loop') {
        return [
            { field: 'loopBody', label: '循环体端口' },
            { field: 'nextNodeId', label: '后续端口' }
        ];
    }

    if (nodeType === 'branch') {
        return [
            { field: 'trueBody', label: '真分支端口' },
            { field: 'falseBody', label: '假分支端口' },
            { field: 'nextNodeId', label: '公共后续端口' }
        ];
    }

    return [
        { field: 'nextNodeId', label: '下一步端口' }
    ];
}

export function getNodePortFieldLabel(nodeType, field) {
    return getNodePortFieldOptions(nodeType).find(option => option.field === field)?.label || field;
}

export function serializeWorkflowProjectData() {
    return {
        nodes: Array.from(state.nodes.values()).map(node => ({
            ...node,
            properties: { ...(node.properties || {}) }
        })),
        next_id: state.nextId,
        workflow_ports: (state.workflowPorts || []).map(normalizeWorkflowPort)
    };
}

export function applyWorkflowProjectData(data) {
    const normalized = normalizeWorkflowData(data);

    state.nodes.clear();
    for (const node of normalized.nodes) {
        state.nodes.set(node.id, node);
    }

    state.nextId = normalized.next_id;
    setWorkflowPorts(normalized.workflow_ports);
    setDebugCurrentNodeId(null);
    resetCanvasHistory();
    renderCanvas();
    setSelectedNode(null);
}

function setCurrentProjectFromRecord(record) {
    if (!record) {
        setCurrentProject(null);
        return;
    }

    setCurrentProject({
        id: record.id,
        name: record.name,
        type: record.type
    });
}

function syncLastSavedSnapshot() {
    lastSavedSnapshot = JSON.stringify(serializeWorkflowProjectData());
}

export function saveCurrentWorkflowProject({ name = null, silent = false, touchOpen = true } = {}) {
    let record = state.currentProject?.id ? getProjectById(state.currentProject.id) : null;
    const nextName = typeof name === 'string' && name.trim()
        ? name.trim()
        : (state.currentProject?.name || record?.name || buildDefaultWorkflowName());

    if (!record) {
        record = createProjectRecord({
            type: 'workflow',
            name: nextName,
            data: serializeWorkflowProjectData()
        });
    } else {
        record = saveProjectData(record.id, {
            name: nextName,
            data: serializeWorkflowProjectData(),
            touchOpen
        });
    }

    if (!record) return null;

    setCurrentProjectFromRecord(record);
    syncLastSavedSnapshot();

    if (!silent) {
        addConsoleLog(`已保存本地工作流项目：${record.name}`, 'info');
    }

    return record;
}

export function createNewWorkflowProject({ name = null, announce = true } = {}) {
    const record = createProjectRecord({
        type: 'workflow',
        name: typeof name === 'string' && name.trim() ? name.trim() : buildDefaultWorkflowName(),
        data: normalizeWorkflowData({})
    });

    setCurrentProjectFromRecord(record);
    applyWorkflowProjectData(record.data);
    syncLastSavedSnapshot();

    if (announce) {
        addConsoleLog(`已创建本地工作流项目：${record.name}`, 'info');
    }

    return record;
}

export function importWorkflowProjectData(data, { name = null, announce = true } = {}) {
    const normalized = normalizeWorkflowData(data);
    const record = createProjectRecord({
        type: 'workflow',
        name: typeof name === 'string' && name.trim() ? name.trim() : buildDefaultWorkflowName(),
        data: normalized
    });

    setCurrentProjectFromRecord(record);
    applyWorkflowProjectData(normalized);
    syncLastSavedSnapshot();

    if (announce) {
        addConsoleLog(`已导入并保存本地工作流项目：${record.name}`, 'info');
    }

    return record;
}

export function openWorkflowProjectById(projectId, { announce = true } = {}) {
    const record = getProjectById(projectId);
    if (!record || record.type !== 'workflow') return null;

    touchProject(record.id);
    const touched = getProjectById(record.id) || record;
    setCurrentProjectFromRecord(touched);
    applyWorkflowProjectData(touched.data);
    syncLastSavedSnapshot();

    if (announce) {
        addConsoleLog(`已打开本地工作流项目：${touched.name}`, 'info');
    }

    return touched;
}

export function listWorkflowProjects() {
    return listProjectsByType('workflow');
}

export function initializeWorkflowProjectFromEntry() {
    const params = new URLSearchParams(window.location.search);
    const projectId = params.get('projectId');
    const entry = params.get('entry') || '';

    if (projectId) {
        const loaded = openWorkflowProjectById(projectId, { announce: true });
        if (loaded) return { source: 'project', project: loaded };
    }

    const rawPayload = sessionStorage.getItem(IMPORT_STORAGE_KEY);
    if (rawPayload) {
        sessionStorage.removeItem(IMPORT_STORAGE_KEY);
        try {
            const payload = JSON.parse(rawPayload);
            if (Array.isArray(payload?.data?.nodes)) {
                const imported = importWorkflowProjectData(payload.data, {
                    name: payload.filename ? payload.filename.replace(/\.json$/i, '') : null,
                    announce: true
                });
                return { source: 'import', project: imported };
            }
        } catch (error) {
            addConsoleLog('导入的工作流数据无效，已跳过。', 'error');
        }
    }

    if (entry === 'create') {
        const created = createNewWorkflowProject({ announce: true });
        return { source: 'create', project: created };
    }

    return { source: 'demo', project: null };
}

export function startWorkflowAutoSave() {
    stopWorkflowAutoSave();
    syncLastSavedSnapshot();

    autoSaveTimer = window.setInterval(() => {
        if (!state.currentProject?.id) return;
        const nextSnapshot = JSON.stringify(serializeWorkflowProjectData());
        if (nextSnapshot === lastSavedSnapshot) return;
        saveCurrentWorkflowProject({ silent: true, touchOpen: true });
    }, AUTOSAVE_INTERVAL_MS);

    if (!beforeUnloadBound) {
        const flush = () => {
            if (!state.currentProject?.id) return;
            const nextSnapshot = JSON.stringify(serializeWorkflowProjectData());
            if (nextSnapshot !== lastSavedSnapshot) {
                saveCurrentWorkflowProject({ silent: true, touchOpen: true });
            }
        };

        window.addEventListener('beforeunload', flush);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flush();
        });
        beforeUnloadBound = true;
    }
}

export function stopWorkflowAutoSave() {
    if (autoSaveTimer != null) {
        window.clearInterval(autoSaveTimer);
        autoSaveTimer = null;
    }
}
