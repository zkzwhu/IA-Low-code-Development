const IMPORT_STORAGE_KEY = 'ia-editor-import-payload';
const DEFAULT_PAGE = {
    width: 1440,
    height: 900,
    background: '#f5f7fb'
};

const COMPONENT_LIBRARY = [
    {
        type: 'text',
        title: '文本显示',
        description: '可编辑文本内容、字号、颜色和尺寸。'
    },
    {
        type: 'image',
        title: '图片展示',
        description: '上传图片并在大屏中展示。'
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
    return {
        entry: params.get('entry') || ''
    };
}

function getSelectedComponent() {
    return state.selectedId != null ? state.components.get(state.selectedId) || null : null;
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
            backgroundColor: 'transparent'
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
            borderRadius: 20
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
    const component = type === 'image'
        ? createImageComponent(80, 80)
        : createTextComponent(80, 80);

    component.id = baseId;
    component.x = Number.isFinite(Number(rawComponent?.x)) ? Number(rawComponent.x) : component.x;
    component.y = Number.isFinite(Number(rawComponent?.y)) ? Number(rawComponent.y) : component.y;
    component.width = Number.isFinite(Number(rawComponent?.width)) ? Number(rawComponent.width) : component.width;
    component.height = Number.isFinite(Number(rawComponent?.height)) ? Number(rawComponent.height) : component.height;
    component.props = {
        ...component.props,
        ...(rawComponent?.props || {})
    };
    return component;
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
            props: { ...component.props }
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
            <strong>${escapeHtml(item.title)}</strong>
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
            const imageHtml = component.props.src
                ? `<img class="image-fill" src="${component.props.src}" alt="${escapeHtml(component.props.alt || '')}" style="object-fit:${escapeHtml(component.props.objectFit || 'cover')}; border-radius:${Number(component.props.borderRadius) || 0}px;">`
                : '<div class="image-placeholder">点击右侧属性面板上传图片</div>';

            return `
                <div class="screen-component image-component ${state.selectedId === component.id ? 'selected' : ''}" data-component-id="${component.id}" style="${commonStyle}">
                    ${imageHtml}
                </div>
            `;
        }

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
                <div class="text-component-content">${escapeHtml(component.props.text || '')}</div>
            </div>
        `;
    }).join('');

    refs.stage.innerHTML = markup;
}

function renderProperties() {
    const component = getSelectedComponent();

    if (!component) {
        refs.propContent.innerHTML = `
            <section class="prop-section">
                <h3>页面设置</h3>
                <p class="prop-hint">未选中组件时，可以直接配置大屏页面尺寸和背景色。</p>
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
                <p class="prop-hint">从左侧拖拽组件到画布中。文本组件支持直接编辑文字，图片组件支持上传图片。点击右上角“运行生成网页”会在新标签页中打开实际网页。</p>
            </section>
        `;

        bindPagePropertyInputs();
        return;
    }

    const commonSection = `
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
    `;

    let typeSection = '';
    if (component.type === 'text') {
        typeSection = `
            <section class="prop-section">
                <h3>文本设置</h3>
                <div>
                    <label class="prop-label" for="textValueInput">显示文本</label>
                    <textarea class="prop-textarea" id="textValueInput">${escapeHtml(component.props.text || '')}</textarea>
                </div>
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
    } else {
        typeSection = `
            <section class="prop-section">
                <h3>图片设置</h3>
                <div>
                    <label class="prop-label" for="imageUploadInput">上传图片</label>
                    <input class="prop-input" id="imageUploadInput" type="file" accept="image/*">
                </div>
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
                ${component.props.src ? `<img class="preview-thumb" src="${component.props.src}" alt="${escapeHtml(component.props.alt || '')}">` : ''}
            </section>
        `;
    }

    refs.propContent.innerHTML = `
        ${commonSection}
        ${typeSection}
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
            const imageContent = component.props.src
                ? `<img src="${component.props.src}" alt="${escapeHtml(component.props.alt || '')}" style="width:100%;height:100%;object-fit:${escapeHtml(component.props.objectFit || 'cover')};border-radius:${Number(component.props.borderRadius) || 0}px;">`
                : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#e8eef3;color:#66788a;font:16px/1.6 Segoe UI,sans-serif;">未上传图片</div>';

            return `
                <div style="position:absolute;left:${component.x}px;top:${component.y}px;width:${component.width}px;height:${component.height}px;overflow:hidden;">
                    ${imageContent}
                </div>
            `;
        }

        return `
            <div style="position:absolute;left:${component.x}px;top:${component.y}px;width:${component.width}px;height:${component.height}px;display:flex;align-items:center;justify-content:${getTextJustifyContent(component.props.textAlign)};padding:14px 18px;line-height:1.5;font-size:${Number(component.props.fontSize) || 32}px;color:${component.props.color || '#1f2937'};font-weight:${component.props.fontWeight || '700'};text-align:${component.props.textAlign || 'left'};background:${component.props.backgroundColor || 'transparent'};white-space:pre-wrap;">
                <div style="width:100%;">${escapeHtml(component.props.text || '')}</div>
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
    subtitle.height = 90;
    subtitle.props.text = '从左侧拖入组件，编辑属性后点击右上角运行生成网页。';
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

function init() {
    renderLibrary();
    initializeProject();
    bindLibraryDragAndDrop();
    bindStageInteractions();
    bindTopbarActions();
    renderAll();
}

init();
