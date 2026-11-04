// Title screen, HUD, menus, journal and map, settings, theme, install, analytics
// and the support callout.

import * as THREE from "three";
import { Game, ACHIEVEMENTS, KEY_NAMES } from "./game.js";
import { WONDERS, GATES, BOUNDARY, buildWorld } from "./world.js";

const $ = (id) => document.getElementById(id);

// localStorage wrapper that survives private mode / blocked storage
const store = {
    get(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    },
    set(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
    },
};

// Google Analytics event, if the GA script loaded (blockers, offline)
function track(name, params = {}) {
    if (typeof gtag === "function") gtag("event", name, params);
}

// ---- settings ----------------------------------------------------------------------------
const DEFAULTS = { sens: 1, invert: false, autolevel: true, camroll: false, quality: "high", time: "cycle", vol: 0.8, music: 0.6, autoQuality: true };
const settings = { ...DEFAULTS, ...store.get("highwake.settings", {}) };
const saveSettings = () => store.set("highwake.settings", settings);

// ---- theme (menus only; the sky has its own day and night) --------------------------------
function applyTheme() {
    const t = store.get("highwake.theme", null);
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
}
applyTheme();
$("btn-theme").addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    store.set("highwake.theme", cur === "dark" ? "light" : "dark");
    applyTheme();
});

// ---- UI ---------------------------------------------------------------------------------------
const ui = {
    toastQ: [],
    toast({ kicker = "", title = "", text = "", big = false }) {
        const el = document.createElement("div");
        el.className = "toast" + (big ? " big" : "");
        el.innerHTML = `${kicker ? `<small></small>` : ""}<b></b>${text ? "<span></span>" : ""}`;
        if (kicker) el.querySelector("small").textContent = kicker;
        el.querySelector("b").textContent = title;
        if (text) el.querySelector("span").textContent = text;
        const box = $("toasts");
        box.appendChild(el);
        while (box.children.length > 3) box.firstChild.remove();
        setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 700); }, big ? 7000 : 4800);
    },
    hint(text, ms = 5000) {
        const h = $("hint");
        h.textContent = text;
        h.classList.add("show");
        clearTimeout(this._hintT);
        this._hintT = setTimeout(() => h.classList.remove("show"), ms);
    },
    flash() {
        const f = $("flash");
        f.style.transition = "none"; f.style.opacity = 0.9;
        requestAnimationFrame(() => { f.style.transition = "opacity 3s"; f.style.opacity = 0; });
    },
    setKeys(keys) {
        const order = Object.keys(KEY_NAMES);
        $("keys").innerHTML = order.map((k) => `<div class="key${keys.includes(k) ? " got" : ""}" title="${KEY_NAMES[k]}"></div>`).join("") + `<span class="keys-label">${keys.length}/4 keys</span>`;
    },
    ending(title, text) {
        $("ending-title").textContent = title;
        $("ending-text").textContent = text;
        $("ending").hidden = false;
        setTimeout(() => ($("ending").hidden = true), 11000);
    },
    showPause(on) {
        $("pause").hidden = !on;
        document.body.classList.toggle("flying", !on);
    },
    saveSettings,
    refreshJournal() { renderJournal(); },
    openJournal(tab) { openJournal(tab); },
    hud(d) { drawHud(d); },
};

// ---- HUD ------------------------------------------------------------------------------------
const markerEls = [];
const compassStrip = $("compass-strip");
const PX_PER_DEG = 4;
(function buildCompass() {
    const names = { 0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW" };
    let html = "";
    for (let d = -360; d <= 720; d += 15) {
        const n = ((d % 360) + 360) % 360;
        const label = names[n] || (n % 30 === 0 ? String(n) : "·");
        html += `<span class="${names[n] && n % 90 === 0 ? "card" : ""}" style="left:${(d + 360) * PX_PER_DEG}px">${label}</span>`;
    }
    compassStrip.innerHTML = html;
})();

const v3 = new THREE.Vector3();
let hintShown = false;
function drawHud(d) {
    $("g-speed").textContent = Math.round(d.speed);
    $("g-alt").textContent = Math.round(d.alt).toLocaleString();
    $("b-throttle").style.setProperty("--v", `${Math.round(d.throttle * 100)}%`);
    $("b-boost").style.setProperty("--v", `${Math.round(d.boost * 100)}%`);
    const deg = ((d.heading * 180) / Math.PI + 360) % 360;
    const w = $("compass").clientWidth;
    compassStrip.style.transform = `translateX(${w / 2 - (deg + 360) * PX_PER_DEG}px)`;
    $("status-line").textContent = d.status;

    const W = innerWidth, H = innerHeight;
    // reticle: where the nose points
    v3.copy(d.aim).project(d.camera);
    $("reticle").style.left = `${(v3.x * 0.5 + 0.5) * W}px`;
    $("reticle").style.top = `${(-v3.y * 0.5 + 0.5) * H}px`;
    const st = $("stick");
    st.style.left = `${W / 2 + d.stick.x * 90}px`;
    st.style.top = `${H / 2 - d.stick.y * 90}px`;
    st.style.opacity = d.locked ? 0.85 : 0;

    if (!d.locked && !hintShown) { ui.hint("Click the sky to take the controls", 100000); hintShown = true; }
    if (d.locked && hintShown) { $("hint").classList.remove("show"); hintShown = false; }

    // screen markers
    const cam = d.camera;
    const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    let n = 0;
    for (const m of d.markers) {
        const dist = m.pos.distanceTo(cam.position);
        if (m.min && dist < m.min) continue;
        if (m.small && dist > 5000) continue;
        let el = markerEls[n];
        if (!el) { el = document.createElement("div"); el.innerHTML = "<i></i><span></span>"; $("markers").appendChild(el); markerEls.push(el); }
        n++;
        el.style.display = "";
        v3.copy(m.pos).project(cam);
        const behind = m.pos.clone().sub(cam.position).dot(camDir) < 0;
        let x = v3.x, y = v3.y;
        let edge = behind || Math.abs(x) > 0.95 || Math.abs(y) > 0.9;
        if (behind) { x = -x; y = -y; }
        if (edge) {
            const s = 0.92 / Math.max(Math.abs(x), Math.abs(y) / 0.88, 1e-3);
            x *= s; y *= s;
        }
        el.className = "marker" + (m.ring ? " ring" : "") + (edge ? " edge" : "");
        el.style.left = `${(x * 0.5 + 0.5) * W}px`;
        el.style.top = `${(-y * 0.5 + 0.5) * H}px`;
        el.querySelector("span").textContent = m.ring ? m.label : `${m.label} · ${dist > 1000 ? (dist / 1000).toFixed(1) + " km" : Math.round(dist) + " m"}`;
        el.style.opacity = m.small ? 0.7 : 1;
    }
    for (let i = n; i < markerEls.length; i++) markerEls[i].style.display = "none";
}

// ---- journal --------------------------------------------------------------------------------
function renderJournal() {
    if (!game?.save) return;
    const s = game.save;
    const got = ACHIEVEMENTS.filter((a) => s.ach[a.id]).length;
    $("tab-ach").innerHTML = `<p class="summary">${got} of ${ACHIEVEMENTS.length} achievements · ${game.keys().length} of 4 sky keys · arches ${s.gates.filter(Boolean).length}/${GATES.length}${s.best.gauntlet ? ` · best run ${s.best.gauntlet.toFixed(1)} s` : ""}</p><div class="ach-grid"></div>`;
    const grid = $("tab-ach").querySelector(".ach-grid");
    for (const a of ACHIEVEMENTS) {
        const el = document.createElement("div");
        el.className = "ach" + (s.ach[a.id] ? " got" : "");
        el.innerHTML = `<div class="ico" aria-hidden="true"></div><div><h3></h3><p></p></div>`;
        el.querySelector(".ico").textContent = a.icon;
        el.querySelector("h3").textContent = a.name + (a.key ? " · key" : "");
        el.querySelector("p").textContent = a.text;
        grid.appendChild(el);
    }
    const found = WONDERS.filter((w) => s.won[w.id]).length;
    $("tab-won").innerHTML = `<p class="summary">${found} of ${WONDERS.length} wonders discovered</p><div class="ach-grid"></div>`;
    const wg = $("tab-won").querySelector(".ach-grid");
    for (const w of WONDERS) {
        const el = document.createElement("div");
        el.className = "ach" + (s.won[w.id] ? " got" : "");
        el.innerHTML = `<div class="ico" aria-hidden="true">${s.won[w.id] ? "✺" : "?"}</div><div><h3></h3><p></p></div>`;
        el.querySelector("h3").textContent = s.won[w.id] ? w.name : "Undiscovered";
        el.querySelector("p").textContent = s.won[w.id] ? w.text : "Somewhere out in the high sky.";
        wg.appendChild(el);
    }
    drawMap();
}

let mapEntities = null;
function drawMap() {
    const cv = $("map");
    const g = cv.getContext("2d");
    const S = cv.width, scale = S / (BOUNDARY * 2.1);
    const X = (x) => S / 2 + x * scale, Z = (z) => S / 2 + z * scale;
    g.fillStyle = "#0c1726"; g.fillRect(0, 0, S, S);
    g.strokeStyle = "rgba(127,227,239,0.15)";
    g.beginPath(); g.arc(S / 2, S / 2, BOUNDARY * scale, 0, Math.PI * 2); g.stroke();
    mapEntities ||= buildWorld();
    for (const e of mapEntities) {
        if (e.kind !== "island") continue;
        const shade = Math.min(1, 0.35 + e.pos[1] / 6000);
        g.fillStyle = `rgba(${Math.round(90 * shade + 40)},${Math.round(150 * shade + 40)},${Math.round(110 * shade + 40)},0.9)`;
        g.beginPath(); g.ellipse(X(e.pos[0]), Z(e.pos[2]), e.r * scale, e.r * scale * e.sq, 0, 0, Math.PI * 2); g.fill();
        if (e.name) { g.fillStyle = "rgba(232,238,247,0.75)"; g.font = "15px Inter, sans-serif"; g.textAlign = "center"; g.fillText(e.name, X(e.pos[0]), Z(e.pos[2]) + e.r * scale + 16); }
    }
    g.font = "bold 16px Inter, sans-serif";
    for (const w of WONDERS) {
        if (!game.save.won[w.id]) continue;
        g.fillStyle = "#ffd27a";
        g.fillText("✺ " + w.name, X(w.pos[0]), Z(w.pos[2]) - 10);
    }
    GATES.forEach((gt, i) => {
        g.strokeStyle = game.save.gates[i] ? "#ffd27a" : "rgba(127,227,239,0.7)";
        g.lineWidth = 2;
        g.beginPath(); g.arc(X(gt.center[0]), Z(gt.center[2]), 6, 0, Math.PI * 2); g.stroke();
    });
    if (game.vessel) {
        const p = game.vessel.pos, f = game.vessel.fwd;
        const a = Math.atan2(f.z, f.x);
        g.save(); g.translate(X(p.x), Z(p.z)); g.rotate(a);
        g.fillStyle = "#fff";
        g.beginPath(); g.moveTo(12, 0); g.lineTo(-8, 7); g.lineTo(-4, 0); g.lineTo(-8, -7); g.closePath(); g.fill();
        g.restore();
    }
    g.fillStyle = "rgba(232,238,247,0.6)"; g.font = "14px Inter, sans-serif"; g.textAlign = "left";
    g.fillText("N ↑", 14, 24);
}

function openJournal(tab = "ach") {
    renderJournal();
    selectTab(tab);
    $("dlg-journal").showModal();
}
function selectTab(tab) {
    document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === tab)));
    ["ach", "won", "map"].forEach((t) => ($("tab-" + t).hidden = t !== tab));
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => selectTab(t.dataset.tab)));
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => b.closest("dialog").close()));

// ---- settings dialog ----------------------------------------------------------------------------
function bindSettings() {
    const bind = (id, key, kind = "value") => {
        const el = $(id);
        el[kind === "check" ? "checked" : "value"] = settings[key];
        el.addEventListener("input", () => {
            settings[key] = kind === "check" ? el.checked : kind === "num" ? parseFloat(el.value) : el.value;
            if (key === "quality") settings.autoQuality = false;
            saveSettings();
            if (key === "quality") game?.applyQuality();
            game?.applySettings();
        });
    };
    bind("s-sens", "sens", "num");
    bind("s-invert", "invert", "check");
    bind("s-autolevel", "autolevel", "check");
    bind("s-camroll", "camroll", "check");
    bind("s-quality", "quality");
    bind("s-time", "time");
    bind("s-vol", "vol", "num");
    bind("s-music", "music", "num");
}
bindSettings();

function confirmBox(text) {
    return new Promise((res) => {
        $("confirm-text").textContent = text;
        const d = $("dlg-confirm");
        const done = (v) => { d.close(); res(v); };
        $("confirm-yes").onclick = () => done(true);
        $("confirm-no").onclick = () => done(false);
        d.showModal();
    });
}
$("btn-reset").addEventListener("click", async () => {
    if (await confirmBox("Reset all achievements, keys and wonders? This can't be undone.")) game?.resetProgress();
});

// ---- screens and buttons ----------------------------------------------------------------------
let game = null;
const canvas = $("view");

function fly() {
    $("title").hidden = true;
    $("pause").hidden = true;
    $("hud").hidden = false;
    document.body.classList.add("flying");
    game.startFlight();
}

$("btn-fly").addEventListener("click", fly);
$("btn-resume").addEventListener("click", fly);
$("btn-controls").addEventListener("click", () => $("dlg-controls").showModal());
$("btn-p-controls").addEventListener("click", () => $("dlg-controls").showModal());
$("btn-settings").addEventListener("click", () => $("dlg-settings").showModal());
$("btn-p-settings").addEventListener("click", () => $("dlg-settings").showModal());
$("btn-journal").addEventListener("click", () => openJournal("ach"));
$("btn-p-journal").addEventListener("click", () => openJournal("ach"));
$("btn-info").addEventListener("click", () => $("dlg-info").showModal());
$("btn-respawn").addEventListener("click", () => { game.respawn(); fly(); });
canvas.addEventListener("click", () => {
    if (game?.state === "flying" && !document.pointerLockElement) game.input.lock();
});
document.addEventListener("pointerlockchange", () => {
    // losing the mouse mid-flight (Esc) pauses
    if (!document.pointerLockElement && game?.state === "flying" && game.input.wasLocked) game.pause();
    if (game) game.input.wasLocked = !!document.pointerLockElement;
});
addEventListener("keydown", (e) => {
    if (!game || game.state !== "paused" || document.querySelector("dialog[open]")) return;
    if (e.code === "Escape" || e.code === "Enter") { e.preventDefault(); fly(); }
});
document.addEventListener("visibilitychange", () => { if (document.hidden) game?.pause(); });

// ---- boot -----------------------------------------------------------------------------------------
async function boot() {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) {
        $("load-text").textContent = "Highwake needs WebGL 2. Try a recent Chrome, Edge, Firefox or Safari.";
        return;
    }
    try {
        game = new Game(canvas, ui, settings, track);
        await game.load((f, text) => {
            $("load-fill").style.width = `${Math.round(f * 100)}%`;
            $("load-text").textContent = text;
        });
    } catch (err) {
        console.error(err);
        $("load-text").textContent = navigator.onLine ? "Something went wrong raising the islands. Try reloading." : "You're offline, and Highwake hasn't been saved for offline play yet. Connect once and reload.";
        return;
    }
    $("loading").hidden = true;
    $("title-actions").hidden = false;
    const st = game.stats();
    $("title-progress").textContent = st.ach ? `${st.keys}/4 sky keys · ${st.ach}/${st.total} achievements · ${st.won}/8 wonders` : "";
    if (st.ach) $("btn-fly").textContent = "Continue flight";
    ui.setKeys(game.keys());
    $("btn-fly").focus();
    window.__game = game;
    const shot = new URLSearchParams(location.search).get("shot");
    if (shot) {
        document.body.classList.add("shot");
        $("title").hidden = true;
        game.debugShot(shot, new URLSearchParams(location.search).get("time"));
        document.title = "shot-ready";
    }
}
boot();

// ---- install (PWA) ---------------------------------------------------------------------------------
let deferredInstall = null;
addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstall = e;
    $("btn-install").hidden = false;
});
$("btn-install").addEventListener("click", async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    $("btn-install").hidden = true;
});
addEventListener("appinstalled", () => { $("btn-install").hidden = true; track("app_installed"); });

const params = new URLSearchParams(location.search);
const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
if ("serviceWorker" in navigator && (!isLocal || params.has("sw"))) {
    addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

// ---- Support callout (occasional, dismissible ask for financial support) -------
// Never on first visit; first appears once the app has actually been used
// (10 visits OR 3 distinct days), then resurfaces roughly every 24 days after
// "Maybe later". Stops popping up (the heart itself always stays) after 5
// "Maybe later"s, or for good after "Don't ask again" or clicking through.

const SUPPORT_DAY_MS = 20 * 60 * 60 * 1000;
const SUPPORT_FIRST_VISITS_THRESHOLD = 10;
const SUPPORT_FIRST_DAYS_THRESHOLD = 3;
const SUPPORT_RESHOW_INTERVAL_DAYS = 24;
const SUPPORT_MAX_MAYBE_LATER = 5;
const supportCallout = document.getElementById("support-callout");
const supportLink = document.getElementById("support");
const SK = (k) => "highwake." + k;

function trackSupportUsage() {
    if (store.get(SK("supportDismissedForever"), false) || store.get(SK("supportActed"), false)) return;

    const visits = store.get(SK("supportVisits"), 0) + 1;
    store.set(SK("supportVisits"), visits);

    let days = store.get(SK("supportDaysUsed"), 0);
    const today = new Date().toISOString().slice(0, 10);
    if (store.get(SK("supportLastDayUsed"), "") !== today) {
        days += 1;
        store.set(SK("supportDaysUsed"), days);
        store.set(SK("supportLastDayUsed"), today);
    }

    if (store.get(SK("supportMaybeLaterCount"), 0) >= SUPPORT_MAX_MAYBE_LATER) return;
    const lastShown = store.get(SK("supportLastShown"), 0);
    const due = lastShown === 0
        ? visits >= SUPPORT_FIRST_VISITS_THRESHOLD || days >= SUPPORT_FIRST_DAYS_THRESHOLD
        : Date.now() - lastShown >= SUPPORT_RESHOW_INTERVAL_DAYS * SUPPORT_DAY_MS;
    // A moment after opening, so it doesn't land on top of the app loading
    if (due) setTimeout(showSupportCallout, 1500);
}

function showSupportCallout() {
    if (document.body.classList.contains("flying")) return;
    supportCallout.classList.add("open");
    store.set(SK("supportLastShown"), Date.now());
    track("support_callout_shown");
    // Dismiss on outside click (doesn't count as "Maybe later" -- just closes it)
    setTimeout(() => document.addEventListener("click", supportOutsideClick), 0);
}

function supportOutsideClick(e) {
    if (supportCallout.contains(e.target) || supportLink.contains(e.target)) return;
    supportCallout.classList.remove("open");
    document.removeEventListener("click", supportOutsideClick);
}

function supportDismiss(mode) {
    supportCallout.classList.remove("open");
    document.removeEventListener("click", supportOutsideClick);
    if (mode === "forever") store.set(SK("supportDismissedForever"), true);
    else if (mode === "later") store.set(SK("supportMaybeLaterCount"), store.get(SK("supportMaybeLaterCount"), 0) + 1);
    else if (mode === "acted") store.set(SK("supportActed"), true);
    if (mode === "forever" || mode === "later") track("support_callout_dismiss", { choice: mode });
}

supportLink.addEventListener("click", () => {
    track("support_click", { source: "heart" });
    supportDismiss("acted");
});
supportCallout.querySelector('[data-support="acted"]').addEventListener("click", () =>
    track("support_click", { source: "callout" })
);
supportCallout.querySelectorAll("[data-support]").forEach((el) =>
    el.addEventListener("click", () => supportDismiss(el.dataset.support))
);
trackSupportUsage();
