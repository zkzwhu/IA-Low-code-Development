const STORAGE_KEY = 'ia.lowcode.projects.v1';
const MAX_RECENT_PROJECTS = 24;
const DEMO_WORKFLOW_PROJECT_ID = 'workflow-demo-smart-agriculture';
const DEMO_SCREEN_PROJECT_ID = 'screen-demo-smart-agriculture';

function getNowIso() {
    return new Date().toISOString();
}

function buildEmptyStore() {
    return {
        projects: [],
        version: 1
    };
}

function normalizeProjectRecord(record) {
    if (!record || typeof record !== 'object') return null;

    return {
        id: String(record.id || ''),
        type: record.type === 'screen' ? 'screen' : 'workflow',
        name: String(record.name || '未命名项目'),
        data: record.data && typeof record.data === 'object' ? record.data : {},
        createdAt: String(record.createdAt || getNowIso()),
        updatedAt: String(record.updatedAt || record.createdAt || getNowIso()),
        lastOpenedAt: String(record.lastOpenedAt || record.updatedAt || record.createdAt || getNowIso())
    };
}

function loadStore() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return buildEmptyStore();

        const parsed = JSON.parse(raw);
        const projects = Array.isArray(parsed?.projects)
            ? parsed.projects.map(normalizeProjectRecord).filter(Boolean)
            : [];
        return {
            version: 1,
            projects
        };
    } catch (error) {
        return buildEmptyStore();
    }
}

function saveStore(store) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        projects: Array.isArray(store?.projects) ? store.projects.slice(0, MAX_RECENT_PROJECTS * 8) : []
    }));
}

function upsertProjectRecord(nextRecord) {
    const store = loadStore();
    const normalized = normalizeProjectRecord(nextRecord);
    if (!normalized || !normalized.id) return null;

    const index = store.projects.findIndex(project => project.id === normalized.id);
    if (index >= 0) {
        store.projects[index] = normalized;
    } else {
        store.projects.push(normalized);
    }

    saveStore(store);
    return normalized;
}

function createProjectId(type) {
    const randomPart = Math.random().toString(36).slice(2, 8);
    return `${type}-${Date.now()}-${randomPart}`;
}

function buildDemoWorkflowProject() {
    const variableOverviewId = 'demo-variable-overview';
    const variableAlertsId = 'demo-variable-alerts';
    const variableRecommendationsId = 'demo-variable-recommendations';

    return {
        id: DEMO_WORKFLOW_PROJECT_ID,
        type: 'workflow',
        name: '智慧农业演示工程-工作流',
        data: {
            nodes: [
                {
                    id: 100,
                    type: 'start',
                    x: 80,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '开始',
                        nextNodeId: 101,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 101,
                    type: 'analytics_summary',
                    x: 320,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '生成总览概况',
                        analysisType: 'overview',
                        deviceId: 'SmartAgriculture_thermometer',
                        hours: 48,
                        limit: 8,
                        targetVariableId: variableOverviewId,
                        nextNodeId: 102,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 102,
                    type: 'output',
                    x: 560,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '输出总览',
                        variableId: variableOverviewId,
                        nextNodeId: 103,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 103,
                    type: 'analytics_summary',
                    x: 320,
                    y: 280,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '生成风险告警',
                        analysisType: 'alerts',
                        deviceId: 'SmartAgriculture_thermometer',
                        hours: 24,
                        limit: 6,
                        targetVariableId: variableAlertsId,
                        nextNodeId: 104,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 104,
                    type: 'output',
                    x: 560,
                    y: 280,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '输出告警',
                        variableId: variableAlertsId,
                        nextNodeId: 105,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 105,
                    type: 'analytics_summary',
                    x: 320,
                    y: 440,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '生成决策建议',
                        analysisType: 'recommendations',
                        deviceId: 'SmartAgriculture_thermometer',
                        hours: 24,
                        limit: 6,
                        targetVariableId: variableRecommendationsId,
                        nextNodeId: 106,
                        portPositions: {},
                        breakpoint: false
                    }
                },
                {
                    id: 106,
                    type: 'output',
                    x: 560,
                    y: 440,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '输出建议',
                        variableId: variableRecommendationsId,
                        nextNodeId: null,
                        portPositions: {},
                        breakpoint: false
                    }
                }
            ],
            next_id: 107,
            workflow_variables: [
                {
                    id: variableOverviewId,
                    name: '农业总览文本',
                    dataType: 'string',
                    defaultValue: '该变量用于承接智慧农业总览分析结果。'
                },
                {
                    id: variableAlertsId,
                    name: '农业告警文本',
                    dataType: 'string',
                    defaultValue: '该变量用于承接智慧农业风险告警结果。'
                },
                {
                    id: variableRecommendationsId,
                    name: '农业决策建议文本',
                    dataType: 'string',
                    defaultValue: '该变量用于承接智慧农业辅助决策建议。'
                }
            ],
            workflow_ports: [
                {
                    id: 'demo-port-overview',
                    name: 'overviewText',
                    dataType: 'string',
                    nodeId: 102,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-alerts',
                    name: 'alertsText',
                    dataType: 'string',
                    nodeId: 104,
                    field: 'outputValue'
                },
                {
                    id: 'demo-port-recommendations',
                    name: 'recommendationsText',
                    dataType: 'string',
                    nodeId: 106,
                    field: 'outputValue'
                }
            ]
        }
    };
}

function buildDemoScreenProject() {
    return {
        id: DEMO_SCREEN_PROJECT_ID,
        type: 'screen',
        name: '智慧农业演示工程-大屏',
        data: {
            page: {
                width: 1440,
                height: 900,
                background: '#eef3ef'
            },
            components: [
                {
                    id: 1,
                    type: 'text',
                    x: 72,
                    y: 56,
                    width: 520,
                    height: 96,
                    props: {
                        text: '智慧农业演示工程',
                        fontSize: 42,
                        color: '#173b31',
                        fontWeight: '700',
                        textAlign: 'left',
                        backgroundColor: 'transparent',
                        source: { mode: 'manual', workflowProjectId: '', workflowPortId: '' }
                    }
                },
                {
                    id: 2,
                    type: 'text',
                    x: 76,
                    y: 160,
                    width: 840,
                    height: 88,
                    props: {
                        text: '首页会自动生成这套演示工程，可直接打开工作流与大屏进行展示和继续编辑。',
                        fontSize: 24,
                        color: '#4e6a61',
                        fontWeight: '600',
                        textAlign: 'left',
                        backgroundColor: 'transparent',
                        source: { mode: 'manual', workflowProjectId: '', workflowPortId: '' }
                    }
                },
                {
                    id: 3,
                    type: 'agri-sensor',
                    x: 76,
                    y: 290,
                    width: 420,
                    height: 400,
                    props: {
                        title: '传感器数据',
                        dataMode: 'api',
                        apiPath: '/api/agriculture/sensor',
                        refreshInterval: 30,
                        sensors: [
                            { name: '温度传感器', value: '24.6', unit: '°C', status: '正常' },
                            { name: '湿度传感器', value: '68', unit: '%', status: '正常' },
                            { name: '光照传感器', value: '18500', unit: 'Lux', status: '正常' },
                            { name: '土壤湿度', value: '45', unit: '%', status: '正常' }
                        ]
                    }
                },
                {
                    id: 4,
                    type: 'text',
                    x: 544,
                    y: 296,
                    width: 780,
                    height: 136,
                    props: {
                        text: '农业总览文本',
                        fontSize: 22,
                        color: '#173b31',
                        fontWeight: '600',
                        textAlign: 'left',
                        backgroundColor: '#ffffff',
                        source: {
                            mode: 'workflow-port',
                            workflowProjectId: DEMO_WORKFLOW_PROJECT_ID,
                            workflowPortId: 'demo-port-overview'
                        }
                    }
                },
                {
                    id: 5,
                    type: 'text',
                    x: 544,
                    y: 460,
                    width: 780,
                    height: 120,
                    props: {
                        text: '农业告警文本',
                        fontSize: 20,
                        color: '#5a3a1a',
                        fontWeight: '600',
                        textAlign: 'left',
                        backgroundColor: '#fff6e6',
                        source: {
                            mode: 'workflow-port',
                            workflowProjectId: DEMO_WORKFLOW_PROJECT_ID,
                            workflowPortId: 'demo-port-alerts'
                        }
                    }
                },
                {
                    id: 6,
                    type: 'text',
                    x: 544,
                    y: 612,
                    width: 780,
                    height: 120,
                    props: {
                        text: '农业决策建议文本',
                        fontSize: 20,
                        color: '#173b31',
                        fontWeight: '600',
                        textAlign: 'left',
                        backgroundColor: '#edf8ef',
                        source: {
                            mode: 'workflow-port',
                            workflowProjectId: DEMO_WORKFLOW_PROJECT_ID,
                            workflowPortId: 'demo-port-recommendations'
                        }
                    }
                }
            ],
            next_id: 7
        }
    };
}

function getRecentSortValue(project) {
    return Math.max(
        Date.parse(project?.lastOpenedAt || '') || 0,
        Date.parse(project?.updatedAt || '') || 0,
        Date.parse(project?.createdAt || '') || 0
    );
}

export function createProjectRecord({ type = 'workflow', name = '未命名项目', data = {} } = {}) {
    const now = getNowIso();
    const record = {
        id: createProjectId(type),
        type,
        name,
        data,
        createdAt: now,
        updatedAt: now,
        lastOpenedAt: now
    };
    return upsertProjectRecord(record);
}

export function getProjectById(projectId) {
    if (!projectId) return null;
    return loadStore().projects.find(project => project.id === String(projectId)) || null;
}

export function saveProjectData(projectId, { name, data, touchOpen = true } = {}) {
    const existing = getProjectById(projectId);
    if (!existing) return null;

    const now = getNowIso();
    return upsertProjectRecord({
        ...existing,
        name: typeof name === 'string' && name.trim() ? name.trim() : existing.name,
        data: data && typeof data === 'object' ? data : existing.data,
        updatedAt: now,
        lastOpenedAt: touchOpen ? now : existing.lastOpenedAt
    });
}

export function touchProject(projectId) {
    const existing = getProjectById(projectId);
    if (!existing) return null;

    return upsertProjectRecord({
        ...existing,
        lastOpenedAt: getNowIso()
    });
}

export function listProjectsByType(type) {
    return loadStore().projects
        .filter(project => project.type === type)
        .sort((a, b) => getRecentSortValue(b) - getRecentSortValue(a));
}

export function listRecentProjects(limit = 8) {
    return loadStore().projects
        .sort((a, b) => getRecentSortValue(b) - getRecentSortValue(a))
        .slice(0, Math.max(1, limit));
}

export function removeProject(projectId) {
    const store = loadStore();
    store.projects = store.projects.filter(project => project.id !== String(projectId));
    saveStore(store);
}

export function renameProject(projectId, nextName) {
    const existing = getProjectById(projectId);
    if (!existing) return null;

    return upsertProjectRecord({
        ...existing,
        name: String(nextName || existing.name).trim() || existing.name,
        updatedAt: getNowIso()
    });
}

export function ensureDemoProjects() {
    if (!getProjectById(DEMO_WORKFLOW_PROJECT_ID)) {
        upsertProjectRecord(buildDemoWorkflowProject());
    }
    if (!getProjectById(DEMO_SCREEN_PROJECT_ID)) {
        upsertProjectRecord(buildDemoScreenProject());
    }
}
