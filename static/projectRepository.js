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
        cloudProjectId: record.cloudProjectId == null || record.cloudProjectId === ''
            ? ''
            : String(record.cloudProjectId),
        cloudUpdatedAt: String(record.cloudUpdatedAt || ''),
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

function buildDemoModelDefaultValue() {
    return JSON.stringify({
        status: 'ok',
        model_id: 'demo-agri-twin-default',
        model_name: '智慧农业抽象数据模型',
        screen_contract: {
            overview: {
                title: '智慧农业抽象数据模型',
                summary: '默认模型样例已就绪。运行工作流后，这里会替换为基于实时传感器历史数据构建的农业环境抽象模型。',
                sample_count: 192,
                updated_at: '2026-04-19 09:30:00',
                climate_archetype: '稳定适生型',
                risk_score: 68.5,
                confidence: 84.2,
                dominant_dimension: { label: '水分供给度', score: 82.4 },
                weakest_dimension: { label: '空气洁净度', score: 61.8 },
                latest_reading: { temperature: 24.6, humidity: 68.0, soil_humidity: 46.3, light_lux: 18600, timestamp: '2026-04-19 09:30:00' },
                dimension_bars: [
                    { label: '温热稳定度', score: 78.4, state: 'high', level: '良好' },
                    { label: '水分供给度', score: 82.4, state: 'high', level: '优秀' },
                    { label: '光照活跃度', score: 75.8, state: 'high', level: '良好' },
                    { label: '空气洁净度', score: 61.8, state: 'medium', level: '中等' },
                    { label: '生长韧性', score: 73.5, state: 'medium', level: '良好' }
                ]
            },
            climate_forecast: {
                microclimate_state: '稳定适生型',
                weather_summary: '未来 6 小时棚内温度小幅上升，湿度总体平稳，土壤湿度略有回落。',
                confidence: 84.2,
                cards: [
                    { key: 'temperature', label: '未来6小时温度', value: 25.8, unit: '°C', trend: '上升' },
                    { key: 'humidity', label: '未来6小时湿度', value: 67.0, unit: '%', trend: '平稳' },
                    { key: 'soil_humidity', label: '未来6小时土壤湿度', value: 43.9, unit: '%', trend: '下降' },
                    { key: 'light_lux', label: '未来6小时光照', value: 20400, unit: 'Lux', trend: '上升' }
                ]
            },
            yield_forecast: {
                yield_index: 76.4,
                estimated_yield_kg_per_mu: 470.8,
                yield_grade: '稳产潜力',
                narrative: '当前环境条件总体适宜，继续维持灌溉与通风协同策略可进一步提升产量稳定性。',
                factor_bars: [
                    { label: '热环境适配', score: 78.2, level: '良好' },
                    { label: '空气湿度适配', score: 74.1, level: '良好' },
                    { label: '土壤供水能力', score: 81.6, level: '优秀' },
                    { label: '光照活跃度', score: 72.5, level: '良好' }
                ]
            },
            decision_support: {
                risk_score: 68.5,
                yield_index: 76.4,
                decision_summary: '当前最优先动作为“择时补水”，以缓解土壤湿度未来 6 小时继续下滑的风险。',
                top_decision: { module: 'irrigation-controller', action: '择时补水', priority: 'P1', score: 81.2, reason: '预计未来 6 小时土壤湿度降至 43.9%。' },
                modules: [
                    { module: 'irrigation-controller', action: '择时补水', priority: 'P1', score: 81.2, reason: '预计未来 6 小时土壤湿度降至 43.9%。' },
                    { module: 'ventilation-controller', action: '保持低频通风', priority: 'P2', score: 54.6, reason: '温度略有上行，但仍处于适生区间。' },
                    { module: 'disease-risk-evaluator', action: '维持常规巡检', priority: 'P2', score: 42.8, reason: '湿度较平稳，病害风险可控。' }
                ]
            }
        }
    });
}

function buildDemoWorkflowProject() {
    const variableModelId = 'demo-variable-model';

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
                    type: 'abstract_data_model',
                    x: 320,
                    y: 120,
                    parentId: null,
                    localX: 0,
                    localY: 0,
                    properties: {
                        name: '构建农业环境抽象模型',
                        deviceId: 'SmartAgriculture_thermometer',
                        hours: 168,
                        minPoints: 24,
                        targetVariableId: variableModelId,
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
                        name: '输出农业模型',
                        variableId: variableModelId,
                        nextNodeId: null,
                        portPositions: {},
                        breakpoint: false
                    }
                }
            ],
            next_id: 103,
            workflow_variables: [
                {
                    id: variableModelId,
                    name: '农业环境抽象模型JSON',
                    dataType: 'string',
                    defaultValue: buildDemoModelDefaultValue()
                }
            ],
            workflow_ports: [
                {
                    id: 'demo-port-model',
                    name: 'agriTwinModel',
                    dataType: 'string',
                    nodeId: 102,
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
                    width: 980,
                    height: 96,
                    props: {
                        text: '运行工作流后，会基于传感器数据自动构建农业环境抽象模型，并驱动下方的建模、气候、产量和辅助决策组件联动更新。',
                        fontSize: 22,
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
                    width: 340,
                    height: 300,
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
                    type: 'agri-model',
                    x: 438,
                    y: 284,
                    width: 438,
                    height: 330,
                    props: {
                        title: '农业环境抽象模型',
                        jsonText: '{"status":"waiting"}',
                        source: {
                            mode: 'workflow-port',
                            workflowProjectId: DEMO_WORKFLOW_PROJECT_ID,
                            workflowPortId: 'demo-port-model'
                        }
                    }
                },
                {
                    id: 5,
                    type: 'agri-climate',
                    x: 894,
                    y: 284,
                    width: 454,
                    height: 330,
                    props: {
                        title: '气候趋势预测',
                        jsonText: '{"status":"waiting"}',
                        source: {
                            mode: 'workflow-port',
                            workflowProjectId: DEMO_WORKFLOW_PROJECT_ID,
                            workflowPortId: 'demo-port-model'
                        }
                    }
                },
                {
                    id: 6,
                    type: 'agri-yield',
                    x: 438,
                    y: 634,
                    width: 438,
                    height: 232,
                    props: {
                        title: '产量预测',
                        jsonText: '{"status":"waiting"}',
                        source: {
                            mode: 'workflow-port',
                            workflowProjectId: DEMO_WORKFLOW_PROJECT_ID,
                            workflowPortId: 'demo-port-model'
                        }
                    }
                },
                {
                    id: 7,
                    type: 'agri-decision',
                    x: 894,
                    y: 634,
                    width: 454,
                    height: 232,
                    props: {
                        title: '辅助决策',
                        jsonText: '{"status":"waiting"}',
                        source: {
                            mode: 'workflow-port',
                            workflowProjectId: DEMO_WORKFLOW_PROJECT_ID,
                            workflowPortId: 'demo-port-model'
                        }
                    }
                }
            ],
            next_id: 8
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
    const cloudProjectId = arguments[0]?.cloudProjectId;
    const cloudUpdatedAt = arguments[0]?.cloudUpdatedAt;
    const record = {
        id: createProjectId(type),
        type,
        name,
        data,
        cloudProjectId: cloudProjectId == null ? '' : String(cloudProjectId),
        cloudUpdatedAt: String(cloudUpdatedAt || ''),
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

export function findProjectByCloudId(type, cloudProjectId) {
    const normalizedCloudId = cloudProjectId == null || cloudProjectId === ''
        ? ''
        : String(cloudProjectId);
    if (!normalizedCloudId) return null;

    return loadStore().projects.find(project => (
        project.type === (type === 'screen' ? 'screen' : 'workflow')
        && String(project.cloudProjectId || '') === normalizedCloudId
    )) || null;
}

export function saveProjectData(projectId, { name, data, touchOpen = true } = {}) {
    const existing = getProjectById(projectId);
    if (!existing) return null;

    const now = getNowIso();
    const cloudProjectId = arguments[1]?.cloudProjectId;
    const cloudUpdatedAt = arguments[1]?.cloudUpdatedAt;
    return upsertProjectRecord({
        ...existing,
        name: typeof name === 'string' && name.trim() ? name.trim() : existing.name,
        data: data && typeof data === 'object' ? data : existing.data,
        cloudProjectId: cloudProjectId === undefined
            ? existing.cloudProjectId
            : (cloudProjectId == null ? '' : String(cloudProjectId)),
        cloudUpdatedAt: cloudUpdatedAt === undefined
            ? existing.cloudUpdatedAt
            : String(cloudUpdatedAt || ''),
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
