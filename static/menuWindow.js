import { addConsoleLog, showModal } from './appUtils.js';

function resetView() {
    // 重置视图功能（可扩展）
    addConsoleLog("重置视图（示例功能）", "info");
}

function showHelp() {
    showModal({
        title: "帮助",
        bodyHtml: `
            <div style="line-height:1.7;">
                <div><strong>拖拽</strong>：左侧组件拖到画布创建节点</div>
                <div><strong>选中</strong>：点击节点任意区域选中，在右侧修改属性</div>
                <div><strong>连线</strong>：从端口拖拽到目标节点建立连接</div>
                <div><strong>移动端口</strong>：Shift+拖动端口可调整位置</div>
                <div><strong>循环体</strong>：循环节点“循环体端口”连线到目标节点=加入循环体</div>
            </div>
        `,
        okText: "知道了",
        showCancel: false
    });
}

function showAbout() {
    showModal({
        title: "关于",
        bodyHtml: `<div>智慧农业低代码平台（演示版）<br/>支持：拖拽节点、连线、分支/循环可视化编辑、节点重命名等。</div>`,
        okText: "关闭",
        showCancel: false
    });
}

export function initWindowMenu() {
    const resetBtn = document.getElementById("resetViewBtn");
    const helpBtn = document.getElementById("helpBtn");
    const aboutBtn = document.getElementById("aboutBtn");
    if (resetBtn) resetBtn.onclick = resetView;
    if (helpBtn) helpBtn.onclick = showHelp;
    if (aboutBtn) aboutBtn.onclick = showAbout;
}
