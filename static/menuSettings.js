import { state, setConsoleMode } from './appStore.js';
import { addConsoleLog, showModal } from './appUtils.js';

function showConsoleSetting() {
    showModal({
        title: "控制台输出模式",
        bodyHtml: `
            <div class="prop-group">
                <label class="prop-label">选择输出模式</label>
                <select class="prop-select" id="consoleModeSelect" title="选择控制台输出模式">
                    <option value="detail" ${state.consoleMode === 'detail' ? 'selected' : ''}>详细过程</option>
                    <option value="result" ${state.consoleMode === 'result' ? 'selected' : ''}>仅结果</option>
                </select>
            </div>
        `,
        okText: "应用",
        onOk: ({ bodyEl }) => {
            const sel = bodyEl.querySelector("#consoleModeSelect");
            const mode = sel ? sel.value : state.consoleMode;
            setConsoleMode(mode);
            addConsoleLog(`控制台模式已切换为: ${mode === 'detail' ? '详细过程' : '仅结果'}`, "info");
        }
    });
}

function showTips() {
    showModal({
        title: "使用提示",
        bodyHtml: `
            <div style="line-height:1.7;">
                <div><strong>1)</strong> 拖拽左侧组件到画布创建节点</div>
                <div><strong>2)</strong> 点击节点可在右侧修改属性/重命名（同类型不重名）</div>
                <div><strong>3)</strong> 从端口拖拽连线创建连接</div>
                <div><strong>4)</strong> <strong>Shift+拖动端口</strong> 可把端口移动到节点任意位置</div>
                <div><strong>5)</strong> 循环节点：从“循环体端口”连线到目标节点，可将其加入循环体列表</div>
            </div>
        `,
        okText: "知道了",
        showCancel: false
    });
}

export function initSettingsMenu() {
    document.getElementById("consoleSettingBtn").onclick = showConsoleSetting;
    const tipsBtn = document.getElementById("tipsSettingBtn");
    if (tipsBtn) tipsBtn.onclick = showTips;
}
