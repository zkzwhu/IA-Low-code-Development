
import { getProjectById, listProjectsByType } from './projectRepository.js';
import { getWorkflowRuntime } from './workflowRuntimeStore.js';

const IMPORT_STORAGE_KEY = 'ia-editor-import-payload';
const SOURCE_MODE_MANUAL = 'manual';
const SOURCE_MODE_WORKFLOW_PORT = 'workflow-port';
const DEFAULT_PAGE = { width: 1440, height: 900, background: '#f5f7fb' };

const COMPONENT_LIBRARY = [
    {
        type: 'text',
        icon: '📝',
        title: '文本展示',
        description: '显示固定文本，或绑定已有工作流中的字符串/整型端口。'
    },
    {
        type: 'image',
        icon: '🖼️',
        title: '图片展示',
        description: '上传图片，或绑定已有工作流中的字符串端口作为图片地址。'
    }
];

const state = {
    components: new Map(),
    nextId: 1,
    selectedId: null,
    page: { ...DEFAULT_PAGE }
};

const refs = {
    library: document.getElementById('screenComponentLibrary'),
    canvasArea: document.getElementById('screenCanvasArea'),
    stage: document.getElementById('screenStage'),
    propContent: document.getElementById('screenPropContent'),
    importBtn: document.getElementById('importScreenBtn'),
    exportBtn: document.getElementById('exportScreenBtn'),
    runBtn: document.getElementById('runScreenBtn'),
    importInput: document.getElementById('screenImportInput')
};

let dragState = null;
let panState = null;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getTextJustifyContent(textAlign) {
    if (textAlign === 'center') return 'center';
    if (textAlign === 'right') return 'flex-end';
    return 'flex-start';
}

function getQuery() {
    const params = new URLSearchParams(window.location.search);
    return { entry: params.get('entry') || '' };
}

function getSelectedComponent() {
    return state.selectedId != null ? state.components.get(state.selectedId) || null : null;
}

function createDefaultSource() {
    return {
        mode: SOURCE_MODE_MANUAL,
        workflowProjectId: '',
        workflowPortId: ''
    };
}

function normalizeSource(rawSource) {
    return {
        mode: rawSource?.mode === SOURCE_MODE_WORKFLOW_PORT ? SOURCE_MODE_WORKFLOW_PORT : SOURCE_MODE_MANUAL,
        workflowProjectId: typeof rawSource?.workflowProjectId === 'string' ? rawSource.workflowProjectId : '',
        workflowPortId: typeof rawSource?.workflowPortId === 'string' ? rawSource.workflowPortId : ''
    };
}

function createTextComponent(x, y) {
    return {
        id: state.nextId++,
        type: 'text',
        x,
        y,
        width: 300,
        height: 96,
        props: {
            text: '新建文本组件',
            fontSize: 34,
            color: '#1f2937',
            fontWeight: '700',
            textAlign: 'left',
            backgroundColor: 'transparent',
            source: createDefaultSource()
        }
    };
}

function createImageComponent(x, y) {
    return {
        id: state.nextId++,
        type: 'image',
        x,
        y,
        width: 320,
        height: 220,
        props: {
            src: '',
            alt: '图片展示组件',
            objectFit: 'cover',
            borderRadius: 20,
            source: createDefaultSource()
        }
    };
}

function createComponent(type, x, y) {
    if (type === 'text') return createTextComponent(x, y);
    if (type === 'image') return createImageComponent(x, y);
    return null;
}

function normalizeComponent(rawComponent) {
    const baseId = Number.isFinite(Number(rawComponent?.id)) ? Number(rawComponent.id) : state.nextId++;
    const type = rawComponent?.type === 'image' ? 'image' : 'text';
    const component = type === 'image' ? createImageComponent(80, 80) : createTextComponent(80, 80);

    component.id = baseId;
    component.x = Number.isFinite(Number(rawComponent?.x)) ? Number(rawComponent.x) : component.x;
    component.y = Number.isFinite(Number(rawComponent?.y)) ? Number(rawComponent.y) : component.y;
    component.width = Number.isFinite(Number(rawComponent?.width)) ? Number(rawComponent.width) : component.width;
    component.height = Number.isFinite(Number(rawComponent?.height)) ? Number(rawComponent.height) : component.height;
    component.props = {
        ...component.props,
        ...(rawComponent?.props || {}),
        source: normalizeSource(rawComponent?.props?.source)
    };
    return component;
}

function getSupportedPortTypes(componentType) {
    return componentType === 'image' ? ['string'] : ['string', 'int'];
}

function getPortTypeLabel(dataType) {
    return dataType === 'int' ? '整型' : '字符串';
}

function getWorkflowPortsForProject(projectId) {
    const project = getProjectById(projectId);
    if (!project || project.type !== 'workflow') return [];

    return Array.isArray(project.data?.workflow_ports)
        ? project.data.workflow_ports.map((port, index) => ({
            id: String(port?.id || `workflow-port-${index}`),
            name: String(port?.name || `端口${index + 1}`),
            dataType: port?.dataType === 'int' ? 'int' : 'string'
        }))
        : [];
}

function getWorkflowProjectRuntimeContext(projectId) {
    const project = getProjectById(projectId);
    if (!project || project.type !== 'workflow') return null;

    const nodes = Array.isArray(project.data?.nodes) ? project.data.nodes : [];
    const variables = Array.isArray(project.data?.workflow_variables) ? project.data.workflow_variables : [];
    const ports = Array.isArray(project.data?.workflow_ports) ? project.data.workflow_ports : [];

    const variableMap = new Map();
    for (const variable of variables) {
        const variableId = String(variable?.id || '');
        if (!variableId) continue;
        const dataType = variable?.dataType === 'int' ? 'int' : 'string';
        variableMap.set(variableId, {
            id: variableId,
            name: String(variable?.name || variableId),
            dataType,
            defaultValue: dataType === 'int'
                ? (Number.isFinite(Number(variable?.defaultValue)) ? Number(variable.defaultValue) : 0)
                : String(variable?.defaultValue ?? '')
        });
    }

    return {
        project,
        nodesById: new Map(nodes.map(node => [Number(node?.id), node])),
        ports,
        variableMap
    };
}

function resolveVariableDefaultValue(variable) {
    if (!variable) return '';
    return variable.dataType === 'int'
        ? (Number.isFinite(Number(variable.defaultValue)) ? Number(variable.defaultValue) : 0)
        : String(variable.defaultValue ?? '');
}

function resolveWorkflowPortRuntimeValue(projectId, portId) {
    const context = getWorkflowProjectRuntimeContext(projectId);
    if (!context) return { ok: false, reason: 'missing-project' };

    const port = context.ports.find(item => String(item?.id || '') === String(portId));
    if (!port) return { ok: false, reason: 'missing-port', project: context.project };

    const runtime = getWorkflowRuntime(projectId);
    const runtimeById = runtime?.portValuesById && typeof runtime.portValuesById === 'object'
        ? runtime.portValuesById
        : null;
    const runtimeByName = runtime?.portValuesByName && typeof runtime.portValuesByName === 'object'
        ? runtime.portValuesByName
        : null;
    const portIdKey = String(port.id || '');
    const portNameKey = String(port.name || '').trim();

    if (runtimeById && Object.prototype.hasOwnProperty.call(runtimeById, portIdKey)) {
        return {
            ok: true,
            value: runtimeById[portIdKey],
            source: 'runtime',
            updatedAt: runtime.updatedAt,
            project: context.project,
            port
        };
    }

    if (runtimeByName && portNameKey && Object.prototype.hasOwnProperty.call(runtimeByName, portNameKey)) {
        return {
            ok: true,
            value: runtimeByName[portNameKey],
            source: 'runtime',
            updatedAt: runtime.updatedAt,
            project: context.project,
            port
        };
    }

    const nodeId = Number(port?.nodeId);
    const node = context.nodesById.get(nodeId);
    if (!node) {
        return { ok: false, reason: 'missing-node', project: context.project, port };
    }

    const field = String(port?.field || '');
    if (field === 'outputValue') {
        const variableId = node?.properties?.variableId;
        const variable = context.variableMap.get(String(variableId || ''));
        if (!variable) {
            return { ok: false, reason: 'missing-variable', project: context.project, port, node };
        }

        return {
            ok: true,
            value: resolveVariableDefaultValue(variable),
            source: 'variable-default',
            project: context.project,
            port,
            node,
            variable
        };
    }

    return {
        ok: true,
        value: node?.properties?.[field] ?? '',
        source: 'node-property',
        project: context.project,
        port,
        node
    };
}

function getCompatibleWorkflowPorts(componentType, projectId) {
    const supported = new Set(getSupportedPortTypes(componentType));
    return getWorkflowPortsForProject(projectId).filter(port => supported.has(port.dataType));
}

function ensureComponentSource(component) {
    const normalized = normalizeSource(component?.props?.source);
    component.props.source = normalized;
    return normalized;
}

function primeWorkflowSource(component) {
    const source = ensureComponentSource(component);
    const projects = listProjectsByType('workflow');
    if (!projects.length) {
        source.workflowProjectId = '';
        source.workflowPortId = '';
        return source;
    }

    if (!projects.some(project => project.id === source.workflowProjectId)) {
        source.workflowProjectId = projects[0].id;
    }

    const compatiblePorts = getCompatibleWorkflowPorts(component.type, source.workflowProjectId);
    if (!compatiblePorts.some(port => port.id === source.workflowPortId)) {
        source.workflowPortId = compatiblePorts[0]?.id || '';
    }

    return source;
}
function resolveWorkflowBinding(component) {
    const source = normalizeSource(component?.props?.source);
    if (source.mode !== SOURCE_MODE_WORKFLOW_PORT) {
        return { mode: SOURCE_MODE_MANUAL, valid: false, source };
    }

    const project = getProjectById(source.workflowProjectId);
    if (!project || project.type !== 'workflow') {
        return { mode: SOURCE_MODE_WORKFLOW_PORT, valid: false, reason: 'missing-project', source };
    }

    const port = getWorkflowPortsForProject(project.id).find(item => item.id === source.workflowPortId) || null;
    if (!port) {
        return { mode: SOURCE_MODE_WORKFLOW_PORT, valid: false, reason: 'missing-port', project, source };
    }

    if (!getSupportedPortTypes(component.type).includes(port.dataType)) {
        return { mode: SOURCE_MODE_WORKFLOW_PORT, valid: false, reason: 'unsupported-type', project, port, source };
    }

    const runtimeValue = resolveWorkflowPortRuntimeValue(project.id, port.id);

    return {
        mode: SOURCE_MODE_WORKFLOW_PORT,
        valid: true,
        project,
        port,
        source,
        label: `${project.name} / ${port.name}`,
        token: `{{${project.name}.${port.name}}}`,
        runtimeValue
    };
}

function getSourceStatusText(component) {
    const binding = resolveWorkflowBinding(component);
    if (binding.mode !== SOURCE_MODE_WORKFLOW_PORT) return '当前使用组件内手动填写的内容。';
    if (binding.valid) {
        const typeHint = `当前端口类型：${getPortTypeLabel(binding.port.dataType)}。`;
        let runtimeHint = ' 当前还无法解析出端口值，请检查工作流中的输出节点与变量绑定。';
        if (binding.runtimeValue?.ok) {
            const valueText = String(binding.runtimeValue.value ?? '') || '空值';
            runtimeHint = binding.runtimeValue.source === 'runtime'
                ? ` 当前显示最近一次运行值：${valueText}。`
                : ` 当前显示默认值：${valueText}。`;
        }
        if (component.type === 'image') {
            return `${typeHint}${runtimeHint} 运行生成网页时会把该字符串端口值视为图片 URL 或 Base64 地址。`;
        }
        return `${typeHint}${runtimeHint} 文本组件支持字符串与整型端口。`;
    }
    if (binding.reason === 'missing-project') return '绑定的工作流项目不存在，请重新选择。';
    if (binding.reason === 'missing-port') return '绑定的工作流端口不存在，请重新选择。';
    if (binding.reason === 'unsupported-type') return `当前组件不支持 ${getPortTypeLabel(binding.port?.dataType)} 端口，请重新选择。`;
    return '请先选择一个有效的工作流端口。';
}

function getTextRenderState(component) {
    const binding = resolveWorkflowBinding(component);
    if (binding.valid) {
        return {
            text: binding.runtimeValue?.ok ? String(binding.runtimeValue.value ?? '') : binding.token,
            note: `${binding.label} · ${getPortTypeLabel(binding.port.dataType)}`
        };
    }

    if (binding.mode === SOURCE_MODE_WORKFLOW_PORT) {
        return {
            text: '请选择可用的工作流端口',
            note: '仅支持字符串 / 整型端口'
        };
    }

    return { text: component.props.text || '', note: '' };
}

function getImageRenderState(component) {
    const binding = resolveWorkflowBinding(component);
    if (binding.valid) {
        if (binding.runtimeValue?.ok && String(binding.runtimeValue.value ?? '').trim()) {
            return {
                kind: 'image',
                src: String(binding.runtimeValue.value),
                note: `${binding.label} · ${getPortTypeLabel(binding.port.dataType)}`
            };
        }
        return {
            kind: 'binding',
            title: '已绑定工作流图片源',
            note: binding.runtimeValue?.ok
                ? `${binding.label} · 当前值为空`
                : `${binding.label} · 当前无法解析端口值`
        };
    }

    if (binding.mode === SOURCE_MODE_WORKFLOW_PORT) {
        return {
            kind: 'binding',
            title: '请选择字符串端口',
            note: '图片组件仅支持字符串端口作为图片地址'
        };
    }

    if (component.props.src) {
        return { kind: 'image', src: component.props.src };
    }

    return {
        kind: 'placeholder',
        title: '上传图片',
        note: '或切换为工作流端口作为图片源'
    };
}

function getPreviewDataAttributes(component) {
    const binding = resolveWorkflowBinding(component);
    if (!binding.valid) return '';

    return [
        `data-source-mode="${SOURCE_MODE_WORKFLOW_PORT}"`,
        `data-workflow-project-id="${escapeHtml(binding.project.id)}"`,
        `data-workflow-project-name="${escapeHtml(binding.project.name)}"`,
        `data-workflow-port-id="${escapeHtml(binding.port.id)}"`,
        `data-workflow-port-name="${escapeHtml(binding.port.name)}"`,
        `data-workflow-port-type="${escapeHtml(binding.port.dataType)}"`
    ].join(' ');
}

function loadScreenData(data) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.components)) {
        throw new Error('无效的大屏应用数据');
    }

    state.components.clear();
    state.nextId = 1;
    state.page = {
        width: Number.isFinite(Number(data.page?.width)) ? Number(data.page.width) : DEFAULT_PAGE.width,
        height: Number.isFinite(Number(data.page?.height)) ? Number(data.page.height) : DEFAULT_PAGE.height,
        background: typeof data.page?.background === 'string' ? data.page.background : DEFAULT_PAGE.background
    };

    let maxId = 0;
    for (const rawComponent of data.components) {
        const component = normalizeComponent(rawComponent);
        maxId = Math.max(maxId, component.id);
        state.components.set(component.id, component);
    }

    state.nextId = Number.isFinite(Number(data.next_id ?? data.nextId))
        ? Number(data.next_id ?? data.nextId)
        : (maxId + 1 || 1);

    if (state.nextId <= maxId) {
        state.nextId = maxId + 1;
    }

    state.selectedId = null;
}

function exportScreenData() {
    return {
        page: { ...state.page },
        components: Array.from(state.components.values()).map(component => ({
            id: component.id,
            type: component.type,
            x: component.x,
            y: component.y,
            width: component.width,
            height: component.height,
            props: {
                ...component.props,
                source: normalizeSource(component.props.source)
            }
        })),
        next_id: state.nextId
    };
}

function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function addComponentAt(type, x, y) {
    const component = createComponent(type, x, y);
    if (!component) return;
    state.components.set(component.id, component);
    state.selectedId = component.id;
    renderAll();
}

function removeSelectedComponent() {
    if (state.selectedId == null) return;
    state.components.delete(state.selectedId);
    state.selectedId = null;
    renderAll();
}

function updateStageAppearance() {
    refs.stage.style.width = `${state.page.width}px`;
    refs.stage.style.height = `${state.page.height}px`;
    refs.stage.style.background = state.page.background;
}

function renderLibrary() {
    refs.library.innerHTML = COMPONENT_LIBRARY.map(item => `
        <article class="component-card" draggable="true" data-component-type="${item.type}">
            <div class="component-card-head">
                <span class="component-card-icon">${escapeHtml(item.icon || '◻')}</span>
                <strong>${escapeHtml(item.title)}</strong>
            </div>
            <p>${escapeHtml(item.description)}</p>
        </article>
    `).join('');
}
function renderStage() {
    updateStageAppearance();

    const markup = Array.from(state.components.values()).map(component => {
        const commonStyle = [
            `left:${component.x}px`,
            `top:${component.y}px`,
            `width:${component.width}px`,
            `height:${component.height}px`
        ].join(';');

        if (component.type === 'image') {
            const imageState = getImageRenderState(component);
            const imageHtml = imageState.kind === 'image'
                ? `<img class="image-fill" src="${escapeHtml(imageState.src)}" alt="${escapeHtml(component.props.alt || '')}" style="object-fit:${escapeHtml(component.props.objectFit || 'cover')}; border-radius:${Number(component.props.borderRadius) || 0}px;">`
                : `
                    <div class="image-placeholder">
                        <div>
                            <div class="image-placeholder-title">${escapeHtml(imageState.title)}</div>
                            <div class="image-placeholder-note">${escapeHtml(imageState.note || '')}</div>
                        </div>
                    </div>
                `;

            return `
                <div class="screen-component image-component ${state.selectedId === component.id ? 'selected' : ''}" data-component-id="${component.id}" style="${commonStyle}">
                    ${imageHtml}
                </div>
            `;
        }

        const textState = getTextRenderState(component);
        const textStyle = [
            `font-size:${Number(component.props.fontSize) || 32}px`,
            `color:${component.props.color || '#1f2937'}`,
            `font-weight:${component.props.fontWeight || '700'}`,
            `background:${component.props.backgroundColor || 'transparent'}`,
            `justify-content:${getTextJustifyContent(component.props.textAlign)}`,
            `text-align:${component.props.textAlign || 'left'}`
        ].join(';');

        return `
            <div class="screen-component text-component ${state.selectedId === component.id ? 'selected' : ''}" data-component-id="${component.id}" style="${commonStyle};${textStyle}">
                <div class="text-component-content">
                    <div class="text-main-content">${escapeHtml(textState.text)}</div>
                    ${textState.note ? `<div class="text-source-note">${escapeHtml(textState.note)}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');

    refs.stage.innerHTML = markup;
}

function renderSourceSection(component) {
    const source = normalizeSource(component.props.source);
    const workflowProjects = listProjectsByType('workflow');
    const compatiblePorts = source.workflowProjectId
        ? getCompatibleWorkflowPorts(component.type, source.workflowProjectId)
        : [];
    const binding = resolveWorkflowBinding(component);
    const supportedTypesLabel = getSupportedPortTypes(component.type).map(getPortTypeLabel).join(' / ');

    return `
        <section class="prop-section">
            <h3>数据源</h3>
            <div>
                <label class="prop-label" for="sourceModeInput">来源类型</label>
                <select class="prop-select" id="sourceModeInput">
                    <option value="${SOURCE_MODE_MANUAL}" ${source.mode === SOURCE_MODE_MANUAL ? 'selected' : ''}>手动输入</option>
                    <option value="${SOURCE_MODE_WORKFLOW_PORT}" ${source.mode === SOURCE_MODE_WORKFLOW_PORT ? 'selected' : ''}>工作流端口</option>
                </select>
            </div>
            ${source.mode === SOURCE_MODE_WORKFLOW_PORT ? `
                <div class="prop-grid">
                    <div>
                        <label class="prop-label" for="sourceWorkflowProjectInput">工作流项目</label>
                        <select class="prop-select" id="sourceWorkflowProjectInput" ${workflowProjects.length ? '' : 'disabled'}>
                            ${workflowProjects.length
                                ? workflowProjects.map(project => `<option value="${project.id}" ${project.id === source.workflowProjectId ? 'selected' : ''}>${escapeHtml(project.name)}</option>`).join('')
                                : '<option value="">暂无已保存工作流</option>'}
                        </select>
                    </div>
                    <div>
                        <label class="prop-label" for="sourceWorkflowPortInput">项目端口</label>
                        <select class="prop-select" id="sourceWorkflowPortInput" ${(compatiblePorts.length && workflowProjects.length) ? '' : 'disabled'}>
                            ${compatiblePorts.length
                                ? compatiblePorts.map(port => `<option value="${port.id}" ${port.id === source.workflowPortId ? 'selected' : ''}>${escapeHtml(port.name)} · ${getPortTypeLabel(port.dataType)}</option>`).join('')
                                : '<option value="">暂无可用端口</option>'}
                        </select>
                    </div>
                </div>
                <p class="prop-hint">${escapeHtml(getSourceStatusText(component))}</p>
                <div class="source-summary">
                    <span class="source-summary-label">支持类型</span>
                    <span>${escapeHtml(supportedTypesLabel)}</span>
                    ${binding.valid ? `<span class="source-summary-chip">${escapeHtml(binding.label)}</span>` : ''}
                </div>
            ` : `
                <p class="prop-hint">当前使用组件内手动填写的内容，切换到工作流端口后可直接绑定已有工作流项目端口。</p>
            `}
        </section>
    `;
}

function renderTextSettings(component) {
    const source = normalizeSource(component.props.source);
    const textState = getTextRenderState(component);

    return `
        <section class="prop-section">
            <h3>文本设置</h3>
            ${source.mode === SOURCE_MODE_MANUAL ? `
                <div>
                    <label class="prop-label" for="textValueInput">显示文本</label>
                    <textarea class="prop-textarea" id="textValueInput">${escapeHtml(component.props.text || '')}</textarea>
                </div>
            ` : `
                <div>
                    <label class="prop-label">绑定预览</label>
                    <div class="source-preview-box">${escapeHtml(textState.text)}</div>
                </div>
            `}
            <div class="prop-grid">
                <div>
                    <label class="prop-label" for="textFontSizeInput">字号</label>
                    <input class="prop-input" id="textFontSizeInput" type="number" min="12" max="160" value="${Number(component.props.fontSize) || 32}">
                </div>
                <div>
                    <label class="prop-label" for="textFontWeightInput">字重</label>
                    <select class="prop-select" id="textFontWeightInput">
                        <option value="400" ${String(component.props.fontWeight) === '400' ? 'selected' : ''}>常规</option>
                        <option value="600" ${String(component.props.fontWeight) === '600' ? 'selected' : ''}>中等</option>
                        <option value="700" ${String(component.props.fontWeight) === '700' ? 'selected' : ''}>加粗</option>
                    </select>
                </div>
                <div>
                    <label class="prop-label" for="textColorInput">文字颜色</label>
                    <input class="prop-input" id="textColorInput" type="color" value="${component.props.color || '#1f2937'}">
                </div>
                <div>
                    <label class="prop-label" for="textAlignInput">对齐方式</label>
                    <select class="prop-select" id="textAlignInput">
                        <option value="left" ${component.props.textAlign === 'left' ? 'selected' : ''}>左对齐</option>
                        <option value="center" ${component.props.textAlign === 'center' ? 'selected' : ''}>居中</option>
                        <option value="right" ${component.props.textAlign === 'right' ? 'selected' : ''}>右对齐</option>
                    </select>
                </div>
            </div>
            <div>
                <label class="prop-label" for="textBackgroundInput">背景颜色</label>
                <input class="prop-input" id="textBackgroundInput" type="color" value="${normalizeColorValue(component.props.backgroundColor)}">
            </div>
        </section>
    `;
}

function renderImageSettings(component) {
    const source = normalizeSource(component.props.source);

    return `
        <section class="prop-section">
            <h3>图片设置</h3>
            ${source.mode === SOURCE_MODE_MANUAL ? `
                <div>
                    <label class="prop-label" for="imageUploadInput">上传图片</label>
                    <input class="prop-input" id="imageUploadInput" type="file" accept="image/*">
                </div>
            ` : `
                <p class="prop-hint">当前图片来自工作流端口，端口值会在运行生成网页时作为图片 URL 或 Base64 地址使用。</p>
            `}
            <div>
                <label class="prop-label" for="imageAltInput">图片说明</label>
                <input class="prop-input" id="imageAltInput" type="text" value="${escapeHtml(component.props.alt || '')}">
            </div>
            <div class="prop-grid">
                <div>
                    <label class="prop-label" for="imageFitInput">填充方式</label>
                    <select class="prop-select" id="imageFitInput">
                        <option value="cover" ${component.props.objectFit === 'cover' ? 'selected' : ''}>cover</option>
                        <option value="contain" ${component.props.objectFit === 'contain' ? 'selected' : ''}>contain</option>
                        <option value="fill" ${component.props.objectFit === 'fill' ? 'selected' : ''}>fill</option>
                    </select>
                </div>
                <div>
                    <label class="prop-label" for="imageRadiusInput">圆角</label>
                    <input class="prop-input" id="imageRadiusInput" type="number" min="0" max="80" value="${Number(component.props.borderRadius) || 0}">
                </div>
            </div>
            ${source.mode === SOURCE_MODE_MANUAL && component.props.src ? `<img class="preview-thumb" src="${component.props.src}" alt="${escapeHtml(component.props.alt || '')}">` : ''}
        </section>
    `;
}
function renderProperties() {
    const component = getSelectedComponent();

    if (!component) {
        refs.propContent.innerHTML = `
            <section class="prop-section">
                <h3>页面设置</h3>
                <p class="prop-hint">未选中组件时，可以直接配置大屏页面尺寸与背景颜色。</p>
                <div class="prop-grid">
                    <div>
                        <label class="prop-label" for="pageWidthInput">画布宽度</label>
                        <input class="prop-input" id="pageWidthInput" type="number" min="320" max="3840" value="${state.page.width}">
                    </div>
                    <div>
                        <label class="prop-label" for="pageHeightInput">画布高度</label>
                        <input class="prop-input" id="pageHeightInput" type="number" min="240" max="2160" value="${state.page.height}">
                    </div>
                </div>
                <div>
                    <label class="prop-label" for="pageBackgroundInput">背景颜色</label>
                    <input class="prop-input" id="pageBackgroundInput" type="color" value="${state.page.background}">
                </div>
            </section>
            <section class="prop-section">
                <h3>使用方式</h3>
                <p class="prop-hint">从左侧拖拽组件到画布中。文本组件可绑定字符串/整型工作流端口，图片组件可绑定字符串工作流端口。点击右上角“运行生成网页”会在新标签页中打开网页预览。</p>
            </section>
        `;
        bindPagePropertyInputs();
        return;
    }

    refs.propContent.innerHTML = `
        <section class="prop-section">
            <h3>位置与尺寸</h3>
            <div class="prop-grid">
                <div>
                    <label class="prop-label" for="compXInput">X</label>
                    <input class="prop-input" id="compXInput" type="number" value="${component.x}">
                </div>
                <div>
                    <label class="prop-label" for="compYInput">Y</label>
                    <input class="prop-input" id="compYInput" type="number" value="${component.y}">
                </div>
                <div>
                    <label class="prop-label" for="compWidthInput">宽度</label>
                    <input class="prop-input" id="compWidthInput" type="number" min="40" value="${component.width}">
                </div>
                <div>
                    <label class="prop-label" for="compHeightInput">高度</label>
                    <input class="prop-input" id="compHeightInput" type="number" min="40" value="${component.height}">
                </div>
            </div>
        </section>
        ${renderSourceSection(component)}
        ${component.type === 'text' ? renderTextSettings(component) : renderImageSettings(component)}
        <section class="prop-section">
            <h3>组件操作</h3>
            <button class="danger-btn" id="deleteComponentBtn" type="button">删除当前组件</button>
        </section>
    `;

    bindComponentPropertyInputs(component);
}

function normalizeColorValue(color) {
    if (!color || color === 'transparent') return '#ffffff';
    return color;
}

function bindPagePropertyInputs() {
    const widthInput = document.getElementById('pageWidthInput');
    const heightInput = document.getElementById('pageHeightInput');
    const backgroundInput = document.getElementById('pageBackgroundInput');

    if (widthInput) {
        widthInput.addEventListener('input', () => {
            state.page.width = clamp(Number(widthInput.value) || DEFAULT_PAGE.width, 320, 3840);
            renderStage();
        });
        widthInput.addEventListener('change', renderProperties);
    }

    if (heightInput) {
        heightInput.addEventListener('input', () => {
            state.page.height = clamp(Number(heightInput.value) || DEFAULT_PAGE.height, 240, 2160);
            renderStage();
        });
        heightInput.addEventListener('change', renderProperties);
    }

    if (backgroundInput) {
        backgroundInput.addEventListener('input', () => {
            state.page.background = backgroundInput.value || DEFAULT_PAGE.background;
            renderStage();
        });
        backgroundInput.addEventListener('change', renderProperties);
    }
}

function bindComponentPropertyInputs(component) {
    const bindNumeric = (id, targetKey, minValue, maxValue = Number.MAX_SAFE_INTEGER) => {
        const element = document.getElementById(id);
        if (!element) return;
        element.addEventListener('input', () => {
            component[targetKey] = clamp(Number(element.value) || 0, minValue, maxValue);
            constrainComponentToStage(component);
            renderStage();
        });
        element.addEventListener('change', renderProperties);
    };

    bindNumeric('compXInput', 'x', 0, state.page.width);
    bindNumeric('compYInput', 'y', 0, state.page.height);
    bindNumeric('compWidthInput', 'width', 40, state.page.width);
    bindNumeric('compHeightInput', 'height', 40, state.page.height);

    const deleteBtn = document.getElementById('deleteComponentBtn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', removeSelectedComponent);
    }

    const source = ensureComponentSource(component);
    const sourceModeInput = document.getElementById('sourceModeInput');
    const projectInput = document.getElementById('sourceWorkflowProjectInput');
    const portInput = document.getElementById('sourceWorkflowPortInput');

    if (sourceModeInput) {
        sourceModeInput.addEventListener('change', () => {
            source.mode = sourceModeInput.value === SOURCE_MODE_WORKFLOW_PORT ? SOURCE_MODE_WORKFLOW_PORT : SOURCE_MODE_MANUAL;
            if (source.mode === SOURCE_MODE_WORKFLOW_PORT) {
                primeWorkflowSource(component);
            }
            renderAll();
        });
    }

    if (projectInput) {
        projectInput.addEventListener('change', () => {
            source.workflowProjectId = projectInput.value;
            source.workflowPortId = '';
            primeWorkflowSource(component);
            renderAll();
        });
    }

    if (portInput) {
        portInput.addEventListener('change', () => {
            source.workflowPortId = portInput.value;
            renderAll();
        });
    }

    if (component.type === 'text') {
        const textInput = document.getElementById('textValueInput');
        const fontSizeInput = document.getElementById('textFontSizeInput');
        const fontWeightInput = document.getElementById('textFontWeightInput');
        const colorInput = document.getElementById('textColorInput');
        const alignInput = document.getElementById('textAlignInput');
        const backgroundInput = document.getElementById('textBackgroundInput');

        if (textInput) {
            textInput.addEventListener('input', () => {
                component.props.text = textInput.value;
                renderStage();
            });
        }
        if (fontSizeInput) {
            fontSizeInput.addEventListener('input', () => {
                component.props.fontSize = clamp(Number(fontSizeInput.value) || 32, 12, 160);
                renderStage();
            });
        }
        if (fontWeightInput) {
            fontWeightInput.addEventListener('change', () => {
                component.props.fontWeight = fontWeightInput.value;
                renderStage();
            });
        }
        if (colorInput) {
            colorInput.addEventListener('input', () => {
                component.props.color = colorInput.value;
                renderStage();
            });
        }
        if (alignInput) {
            alignInput.addEventListener('change', () => {
                component.props.textAlign = alignInput.value;
                renderStage();
            });
        }
        if (backgroundInput) {
            backgroundInput.addEventListener('input', () => {
                component.props.backgroundColor = backgroundInput.value;
                renderStage();
            });
        }
        return;
    }

    const uploadInput = document.getElementById('imageUploadInput');
    const altInput = document.getElementById('imageAltInput');
    const fitInput = document.getElementById('imageFitInput');
    const radiusInput = document.getElementById('imageRadiusInput');

    if (uploadInput) {
        uploadInput.addEventListener('change', async () => {
            const [file] = uploadInput.files || [];
            if (!file) return;
            component.props.src = await readFileAsDataUrl(file);
            renderAll();
        });
    }
    if (altInput) {
        altInput.addEventListener('input', () => {
            component.props.alt = altInput.value;
            renderStage();
        });
    }
    if (fitInput) {
        fitInput.addEventListener('change', () => {
            component.props.objectFit = fitInput.value;
            renderStage();
        });
    }
    if (radiusInput) {
        radiusInput.addEventListener('input', () => {
            component.props.borderRadius = clamp(Number(radiusInput.value) || 0, 0, 80);
            renderStage();
        });
    }
}

function constrainComponentToStage(component) {
    component.width = clamp(component.width, 40, state.page.width);
    component.height = clamp(component.height, 40, state.page.height);
    component.x = clamp(component.x, 0, Math.max(0, state.page.width - component.width));
    component.y = clamp(component.y, 0, Math.max(0, state.page.height - component.height));
}

function renderAll() {
    renderStage();
    renderProperties();
}

function getPointInStage(clientX, clientY) {
    const rect = refs.stage.getBoundingClientRect();
    return {
        x: clamp(clientX - rect.left, 0, state.page.width),
        y: clamp(clientY - rect.top, 0, state.page.height)
    };
}

function setCanvasPanActive(active) {
    refs.canvasArea.classList.toggle('panning', active);
}
function bindLibraryDragAndDrop() {
    refs.library.addEventListener('dragstart', (event) => {
        const card = event.target.closest('[data-component-type]');
        if (!card) return;
        event.dataTransfer.setData('text/plain', card.getAttribute('data-component-type') || '');
        event.dataTransfer.effectAllowed = 'copy';
    });

    refs.canvasArea.addEventListener('dragover', (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    });

    refs.canvasArea.addEventListener('drop', (event) => {
        event.preventDefault();
        const type = event.dataTransfer.getData('text/plain');
        if (!type) return;
        const point = getPointInStage(event.clientX, event.clientY);
        addComponentAt(type, clamp(point.x - 80, 0, state.page.width - 40), clamp(point.y - 40, 0, state.page.height - 40));
    });
}

function bindStageInteractions() {
    refs.stage.addEventListener('mousedown', (event) => {
        if (event.button === 0 && event.altKey) {
            panState = {
                startX: event.clientX,
                startY: event.clientY,
                scrollLeft: refs.canvasArea.scrollLeft,
                scrollTop: refs.canvasArea.scrollTop
            };
            dragState = null;
            setCanvasPanActive(true);
            event.preventDefault();
            return;
        }

        const componentEl = event.target.closest('[data-component-id]');
        if (!componentEl) {
            state.selectedId = null;
            renderProperties();
            renderStage();
            return;
        }

        const componentId = Number(componentEl.getAttribute('data-component-id'));
        const component = state.components.get(componentId);
        if (!component) return;

        state.selectedId = componentId;
        renderProperties();
        renderStage();

        if (event.button !== 0) return;

        const point = getPointInStage(event.clientX, event.clientY);
        dragState = {
            id: componentId,
            offsetX: point.x - component.x,
            offsetY: point.y - component.y
        };

        event.preventDefault();
    });

    document.addEventListener('mousemove', (event) => {
        if (panState) {
            refs.canvasArea.scrollLeft = panState.scrollLeft - (event.clientX - panState.startX);
            refs.canvasArea.scrollTop = panState.scrollTop - (event.clientY - panState.startY);
            return;
        }

        if (!dragState) return;
        const component = state.components.get(dragState.id);
        if (!component) return;

        const point = getPointInStage(event.clientX, event.clientY);
        component.x = point.x - dragState.offsetX;
        component.y = point.y - dragState.offsetY;
        constrainComponentToStage(component);
        renderStage();
    });

    document.addEventListener('mouseup', () => {
        if (panState) {
            panState = null;
            setCanvasPanActive(false);
        }
        const shouldRefreshProps = Boolean(dragState);
        dragState = null;
        if (shouldRefreshProps) {
            renderProperties();
        }
    });

    document.addEventListener('keydown', (event) => {
        if ((event.key === 'Delete' || event.key === 'Backspace') && state.selectedId != null) {
            const target = event.target;
            const isEditingField = target && (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.tagName === 'SELECT' ||
                target.isContentEditable
            );
            if (isEditingField) return;
            event.preventDefault();
            removeSelectedComponent();
        }
    });
}

function buildPreviewHtml() {
    const componentHtml = Array.from(state.components.values()).map(component => {
        if (component.type === 'image') {
            const imageState = getImageRenderState(component);
            const previewDataAttrs = getPreviewDataAttributes(component);
            const imageContent = imageState.kind === 'image'
                ? `<img src="${escapeHtml(imageState.src)}" alt="${escapeHtml(component.props.alt || '')}" style="width:100%;height:100%;object-fit:${escapeHtml(component.props.objectFit || 'cover')};border-radius:${Number(component.props.borderRadius) || 0}px;">`
                : `
                    <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:18px;background:linear-gradient(145deg,#edf4f8 0%,#e4edf4 100%);color:#66788a;text-align:center;font:16px/1.6 Segoe UI,sans-serif;">
                        <div>
                            <div style="font-weight:700;margin-bottom:8px;">${escapeHtml(imageState.title)}</div>
                        </div>
                    </div>
                `;

            return `
                <div ${previewDataAttrs} style="position:absolute;left:${component.x}px;top:${component.y}px;width:${component.width}px;height:${component.height}px;overflow:hidden;">
                    ${imageContent}
                </div>
            `;
        }

        const textState = getTextRenderState(component);
        const previewDataAttrs = getPreviewDataAttributes(component);
        return `
            <div ${previewDataAttrs} style="position:absolute;left:${component.x}px;top:${component.y}px;width:${component.width}px;height:${component.height}px;display:flex;align-items:center;justify-content:${getTextJustifyContent(component.props.textAlign)};padding:14px 18px;line-height:1.5;font-size:${Number(component.props.fontSize) || 32}px;color:${component.props.color || '#1f2937'};font-weight:${component.props.fontWeight || '700'};text-align:${component.props.textAlign || 'left'};background:${component.props.backgroundColor || 'transparent'};">
                <div style="width:100%;white-space:pre-wrap;word-break:break-word;">
                    <div>${escapeHtml(textState.text)}</div>
                </div>
            </div>
        `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>大屏应用预览</title>
    <style>
        * { box-sizing: border-box; }
        body {
            margin: 0;
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            padding: 24px;
            background: linear-gradient(160deg, #eaf1f5 0%, #f8fbfd 100%);
            font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        .screen-page {
            position: relative;
            width: ${state.page.width}px;
            height: ${state.page.height}px;
            background: ${state.page.background};
            overflow: hidden;
            box-shadow: 0 24px 60px rgba(19, 31, 43, 0.18);
            border-radius: 24px;
        }
    </style>
</head>
<body>
    <div class="screen-page">${componentHtml}</div>
</body>
</html>`;
}

function runPreview() {
    const html = buildPreviewHtml();
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsDataURL(file);
    });
}

async function importFromFile(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    loadScreenData(data);
    renderAll();
}
function loadImportedProjectFromSession() {
    const payloadText = sessionStorage.getItem(IMPORT_STORAGE_KEY);
    if (!payloadText) return false;

    sessionStorage.removeItem(IMPORT_STORAGE_KEY);

    try {
        const payload = JSON.parse(payloadText);
        const data = payload?.data;
        if (!data || !Array.isArray(data.components)) {
            return false;
        }
        loadScreenData(data);
        return true;
    } catch (error) {
        return false;
    }
}

function seedDemoProject() {
    state.components.clear();
    state.nextId = 1;
    state.page = { ...DEFAULT_PAGE };

    const title = createTextComponent(88, 72);
    title.width = 460;
    title.height = 110;
    title.props.text = '低代码大屏应用';
    title.props.fontSize = 42;
    title.props.fontWeight = '700';
    title.props.color = '#123b54';

    const subtitle = createTextComponent(92, 180);
    subtitle.width = 540;
    subtitle.height = 96;
    subtitle.props.text = '从左侧拖入组件，编辑属性后点击右上角运行生成网页。也可以将组件绑定到已有工作流端口。';
    subtitle.props.fontSize = 24;
    subtitle.props.fontWeight = '600';
    subtitle.props.color = '#486070';

    const image = createImageComponent(820, 140);
    image.width = 420;
    image.height = 300;

    state.components.set(title.id, title);
    state.components.set(subtitle.id, subtitle);
    state.components.set(image.id, image);
}

function initializeProject() {
    const { entry } = getQuery();
    if (loadImportedProjectFromSession()) return;

    if (entry === 'create') {
        state.components.clear();
        state.nextId = 1;
        state.page = { ...DEFAULT_PAGE };
        state.selectedId = null;
        return;
    }

    seedDemoProject();
}

function bindTopbarActions() {
    refs.importBtn.addEventListener('click', () => {
        refs.importInput.click();
    });

    refs.importInput.addEventListener('change', async () => {
        const [file] = refs.importInput.files || [];
        if (!file) return;

        try {
            await importFromFile(file);
        } catch (error) {
            window.alert(`导入失败：${error.message}`);
        } finally {
            refs.importInput.value = '';
        }
    });

    refs.exportBtn.addEventListener('click', () => {
        downloadJson('screen_app.json', exportScreenData());
    });

    refs.runBtn.addEventListener('click', runPreview);
}

function bindExternalRefresh() {
    window.addEventListener('focus', renderAll);
    window.addEventListener('storage', (event) => {
        if (event.key === 'ia.lowcode.workflow.runtime.v1' || event.key === 'ia.lowcode.projects.v1') {
            renderAll();
        }
    });
}

function init() {
    renderLibrary();
    initializeProject();
    bindLibraryDragAndDrop();
    bindStageInteractions();
    bindTopbarActions();
    bindExternalRefresh();
    renderAll();
}

init();
