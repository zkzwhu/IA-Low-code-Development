// 控制台输出
export function addConsoleLog(msg, type = "info") {
    const consoleDiv = document.getElementById("consoleOutput");
    if (!consoleDiv) return;
    const line = document.createElement("div");
    line.className = "log-line";
    const prefix = type === "error" ? "❌ " : (type === "run" ? "🚀 " : "📌 ");
    line.innerHTML = `<span style="color:#aaffdd;">[${new Date().toLocaleTimeString()}]</span> ${prefix}${msg}`;
    consoleDiv.appendChild(line);
    line.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

export function clearConsole() {
    const consoleDiv = document.getElementById("consoleOutput");
    if (consoleDiv) {
        consoleDiv.innerHTML = '<div class="log-line">✨ 控制台已清空</div>';
    }
}

// 根据模式过滤日志并显示
export function displayLogs(logs) {
    clearConsole();
    const mode = state.consoleMode;
    if (mode === 'detail') {
        logs.forEach(log => addConsoleLog(log, "run"));
    } else {
        const filtered = logs.filter(line => {
            return line.includes("==========") ||
                   line.includes("打印:") ||
                   line.includes("错误") ||
                   line.includes("警告");
        });
        if (filtered.length === 0) filtered.push("执行完成，无输出日志");
        filtered.forEach(log => addConsoleLog(log, "run"));
    }
}

export function escapeHtml(str) {
    return String(str).replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}


// 简易可视化弹窗（替代 prompt/confirm）
export function showModal({ title, bodyHtml, okText = "确定", cancelText = "取消", showCancel = true, onOk = null, onCancel = null }) {
    const mask = document.getElementById("modalMask");
    const titleEl = document.getElementById("modalTitle");
    const bodyEl = document.getElementById("modalBody");
    const footerEl = document.getElementById("modalFooter");
    const closeBtn = document.getElementById("modalCloseBtn");
    const okBtn = document.getElementById("modalOkBtn");
    const cancelBtn = document.getElementById("modalCancelBtn");
    if (!mask || !titleEl || !bodyEl || !okBtn || !cancelBtn || !closeBtn) {
        // 兜底：没有弹窗容器就退回 alert
        alert(String(title || "") + "\n\n" + String(bodyHtml || "").replace(/<[^>]+>/g, ""));
        return;
    }

    titleEl.textContent = title || "提示";
    bodyEl.innerHTML = bodyHtml || "";
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;
    cancelBtn.style.display = showCancel ? "" : "none";

    const cleanup = () => {
        mask.style.display = "none";
        okBtn.onclick = null;
        cancelBtn.onclick = null;
        closeBtn.onclick = null;
        mask.onclick = null;
    };

    okBtn.onclick = () => {
        const res = onOk ? onOk({ mask, bodyEl }) : true;
        if (res !== false) cleanup();
    };
    const doCancel = () => {
        if (onCancel) onCancel();
        cleanup();
    };
    cancelBtn.onclick = doCancel;
    closeBtn.onclick = doCancel;
    mask.onclick = (e) => { if (e.target === mask) doCancel(); };

    mask.style.display = "flex";
}