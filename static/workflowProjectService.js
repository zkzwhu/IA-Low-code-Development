import { state, setCurrentProject, setDebugCurrentNodeId, setWorkflowPorts, setWorkflowVariables } from './appStore.js';
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

function buildVariableId(index = 0) {
    return `workflow-variable-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
}

function buildPortId(index = 0) {
    return `workflow-port-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeWorkflowVariable(variable, index = 0) {
    const dataType = variable?.dataType === 'int' ? 'int' : (variable?.dataType === 'csv' ? 'csv' : 'string');
    const defaultValue = dataType === 'int'
        ? (Number.isFinite(Number(variable?.defaultValue)) ? Number(variable.defaultValue) : 0)
        : String(variable?.defaultValue ?? '');

    return {
        id: String(variable?.id || buildVariableId(index)),
        name: String(variable?.name || `变量${index + 1}`),
        dataType,
        defaultValue
    };
}

export function getWorkflowVariableById(variableId) {
    if (!variableId) return null;
    return (state.workflowVariables || []).find(variable => variable.id === String(variableId)) || null;
}

function getOutputVariableForNodeId(nodeId) {
    const node = state.nodes.get(Number(nodeId));
    const variableId = node?.type === 'output' ? node.properties?.variableId : null;
    return getWorkflowVariableById(variableId);
}

function derivePortDataType(port) {
    if (port?.field === 'outputValue') {
        const variable = getOutputVariableForNodeId(port?.nodeId);
        if (variable) return variable.dataType;
    }
    return port?.dataType === 'int' ? 'int' : (port?.dataType === 'csv' ? 'csv' : 'string');
}

export function normalizeWorkflowPort(port, index = 0) {
    const normalized = {
        id: String(port?.id || buildPortId(index)),
        name: String(port?.name || `端口${index + 1}`),
        dataType: port?.dataType === 'int' ? 'int' : (port?.dataType === 'csv' ? 'csv' : 'string'),
        nodeId: Number.isFinite(Number(port?.nodeId)) ? Number(port.nodeId) : null,
        field: typeof port?.field === 'string' ? port.field : ''
    };
    normalized.dataType = derivePortDataType(normalized);
    return normalized;
}

function normalizeWorkflowData(data) {
    return {
        nodes: Array.isArray(data?.nodes) ? data.nodes : [],
        next_id: Number.isFinite(Number(data?.next_id)) ? Number(data.next_id) : 100,
        workflow_ports: Array.isArray(data?.workflow_ports)
            ? data.workflow_ports.map(normalizeWorkflowPort)
            : [],
        workflow_variables: Array.isArray(data?.workflow_variables)
            ? data.workflow_variables.map(normalizeWorkflowVariable)
            : []
    };
}

export function getNodePortFieldOptions(nodeType) {
    if (nodeType === 'output') {
        return [
            { field: 'outputValue', label: '输出值' }
        ];
    }

    return [];
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
        workflow_ports: (state.workflowPorts || []).map(normalizeWorkflowPort),
        workflow_variables: (state.workflowVariables || []).map(normalizeWorkflowVariable)
    };
}

export function applyWorkflowProjectData(data) {
    const normalized = normalizeWorkflowData(data);

    state.nodes.clear();
    for (const node of normalized.nodes) {
        state.nodes.set(node.id, node);
    }

    state.nextId = normalized.next_id;
    setWorkflowVariables(normalized.workflow_variables);
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

    applyWorkflowProjectData({});
    setCurrentProject(null);
    syncLastSavedSnapshot();
    return { source: 'blank', project: null };
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
    if (autoSaveTimer) {
        window.clearInterval(autoSaveTimer);
        autoSaveTimer = null;
    }
}
