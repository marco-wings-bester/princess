'use strict';

const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

const bgImg  = new Image();
bgImg.src    = 'bg.png';
let bgReady  = false;
bgImg.onload = () => { bgReady = true; };

const COLS = 20;
const ROWS = 20;

let TW = 80;
let TH = 40;
let OX = 0;
let OY = 0;

function gridToScreen(col, row) {
    return {
        x: OX + (col - row) * TW * 0.5,
        y: OY + (col + row) * TH * 0.5,
    };
}

function screenToGrid(sx, sy) {
    const rx = sx - OX, ry = sy - OY;
    return { col: rx / TW + ry / TH, row: ry / TH - rx / TW };
}

function inBounds(col, row) {
    return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

// Raw iso tile-centre independent of OX/OY
function tileRawCenter(col, row) {
    return {
        x: (col - row) * TW * 0.5,
        y: (col + row) * TH * 0.5 + TH * 0.5,
    };
}

// ── Player ─────────────────────────────────────────────────────────────────────
const player = {
    col: 10, row: 10,
    targetCol: 10, targetRow: 10,
    rawX: 0, rawY: 0,
    tRawX: 0, tRawY: 0,
    speed: 220,
    moving: false,
    bobPhase: 0,
};

// ── Camera ─────────────────────────────────────────────────────────────────────
function clampCamera() {
    const gridLeft   = OX - (ROWS - 1) * TW * 0.5;
    const gridRight  = OX + (COLS - 1) * TW * 0.5;
    const gridTop    = OY;
    const gridBottom = OY + (COLS + ROWS) * TH * 0.5;
    if (gridLeft   > 0)             OX -= gridLeft;
    if (gridRight  < canvas.width)  OX += canvas.width  - gridRight;
    if (gridTop    > 0)             OY -= gridTop;
    if (gridBottom < canvas.height) OY += canvas.height - gridBottom;
}

function updateCamera() {
    OX = canvas.width  * 0.5 - player.rawX;
    OY = canvas.height * 0.5 - player.rawY;
    clampCamera();
}

// ── Resize ─────────────────────────────────────────────────────────────────────
function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    // gridW = (COLS+ROWS-2)*TW/2 >= canvas.width  => TW >= 2W/(COLS+ROWS-2)
    // gridH = (COLS+ROWS)*TH/2   >= canvas.height => TW >= 4H/(COLS+ROWS)
    const minTW = Math.max(
        canvas.width  * 2 / (COLS + ROWS - 2),
        canvas.height * 4 / (COLS + ROWS)
    );
    const raw = Math.ceil(minTW);
    TW = raw % 2 === 0 ? raw : raw + 1;
    TH = TW >> 1;

    const c  = tileRawCenter(player.col,       player.row);
    const tc = tileRawCenter(player.targetCol, player.targetRow);
    player.rawX  = c.x;  player.rawY  = c.y;
    player.tRawX = tc.x; player.tRawY = tc.y;
    updateCamera();
}
window.addEventListener('resize', resize);

let hoveredCol = -1;
let hoveredRow = -1;
let pulseT     = 0;

// ── Drawing ────────────────────────────────────────────────────────────────────
function drawBackground() {
    ctx.fillStyle = '#c8a060';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (bgReady) {
        const gL = OX - (ROWS - 1) * TW * 0.5;
        const gT = OY;
        const gW = (COLS + ROWS - 2) * TW * 0.5;
        const gH = (COLS + ROWS)     * TH * 0.5;
        ctx.drawImage(bgImg, gL, gT, gW, gH);
    }
}

function drawTile(col, row, highlight) {
    const { x, y } = gridToScreen(col, row);
    if (x + TW < 0 || x - TW > canvas.width ||
        y + TH < 0 || y - TH > canvas.height) return;
    const hw = TW * 0.5, hh = TH * 0.5;
    ctx.beginPath();
    ctx.moveTo(x,      y);
    ctx.lineTo(x + hw, y + hh);
    ctx.lineTo(x,      y + TH);
    ctx.lineTo(x - hw, y + hh);
    ctx.closePath();
    if (highlight) {
        ctx.fillStyle   = 'rgba(255,220,80,0.30)';
        ctx.strokeStyle = 'rgba(255,200,60,0.80)';
        ctx.lineWidth   = 1.5;
        ctx.fill();
    } else {
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth   = 0.8;
    }
    ctx.stroke();
}

function drawTargetMarker(col, row) {
    const { x, y } = gridToScreen(col, row);
    const hw = TW * 0.5, hh = TH * 0.5;
    const alpha = 0.42 + 0.42 * Math.sin(pulseT * 4.5);
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x+hw, y+hh);
    ctx.lineTo(x, y+TH); ctx.lineTo(x-hw, y+hh);
    ctx.closePath();
    ctx.fillStyle   = `rgba(255,216,48,${alpha*0.28})`;
    ctx.strokeStyle = `rgba(255,200,24,${alpha})`;
    ctx.lineWidth   = 2.5;
    ctx.fill(); ctx.stroke();
}

function drawPlayer(bob) {
    const cx = canvas.width  * 0.5;
    const cy = canvas.height * 0.5 + bob;
    const bw = TW*0.14, bd = TH*0.17, bH = TH*0.92, hR = TW*0.11;

    ctx.beginPath();
    ctx.ellipse(cx, cy+bd*0.4, bw*1.5, bd*0.72, 0, 0, Math.PI*2);
    ctx.fillStyle='rgba(0,0,0,0.22)'; ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx+bw,cy-bH); ctx.lineTo(cx,cy+bd-bH);
    ctx.lineTo(cx,cy+bd); ctx.lineTo(cx+bw,cy); ctx.closePath();
    ctx.fillStyle='#c85030'; ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.28)'; ctx.lineWidth=0.5; ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx-bw,cy-bH); ctx.lineTo(cx,cy+bd-bH);
    ctx.lineTo(cx,cy+bd); ctx.lineTo(cx-bw,cy); ctx.closePath();
    ctx.fillStyle='#a03820'; ctx.fill(); ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx,cy-bd-bH); ctx.lineTo(cx+bw,cy-bH);
    ctx.lineTo(cx,cy+bd-bH); ctx.lineTo(cx-bw,cy-bH); ctx.closePath();
    ctx.fillStyle='#e06840'; ctx.fill(); ctx.stroke();

    const hy = cy-bd-bH-hR*1.05;
    ctx.beginPath(); ctx.arc(cx,hy,hR,0,Math.PI*2);
    ctx.fillStyle='#efc070'; ctx.fill();
    ctx.strokeStyle='rgba(0,0,0,0.2)'; ctx.lineWidth=0.5; ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(cx,hy-hR*0.32,hR*1.68,hR*0.42,0,0,Math.PI*2);
    ctx.fillStyle='#4e2a10'; ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx-hR*0.74,hy-hR*0.32); ctx.lineTo(cx-hR*0.56,hy-hR*1.80);
    ctx.lineTo(cx+hR*0.56,hy-hR*1.80); ctx.lineTo(cx+hR*0.74,hy-hR*0.32);
    ctx.closePath(); ctx.fillStyle='#6a3e1c'; ctx.fill();

    ctx.strokeStyle='#d09038'; ctx.lineWidth=Math.max(0.8,hR*0.22); ctx.lineCap='round';
    ctx.beginPath();
    ctx.moveTo(cx-hR*0.70,hy-hR*0.54); ctx.lineTo(cx+hR*0.70,hy-hR*0.54);
    ctx.stroke();
}

function drawHUD() {
    const pad=10, fSize=Math.max(12,Math.min(16,TW*0.18));
    ctx.save();
    ctx.fillStyle='rgba(0,0,0,0.50)'; ctx.strokeStyle='rgba(255,200,80,0.30)'; ctx.lineWidth=1;
    const hudW=fSize*11, hudH=fSize*2.8;
    ctx.beginPath(); ctx.roundRect(pad,pad,hudW,hudH,8); ctx.fill(); ctx.stroke();
    ctx.fillStyle='#ffd898'; ctx.font=`bold ${fSize}px monospace`; ctx.textBaseline='middle';
    ctx.fillText(`Tile  (${player.col}, ${player.row})`,pad+10,pad+hudH*0.32);
    ctx.fillStyle='rgba(255,210,140,0.70)'; ctx.font=`${fSize*0.82}px monospace`;
    ctx.fillText('Tap any tile to move',pad+10,pad+hudH*0.75);
    ctx.restore();
}

// ── Update ─────────────────────────────────────────────────────────────────────
let lastTime = 0;

function update(dt) {
    pulseT          += dt;
    player.bobPhase += dt * (player.moving ? 9 : 2.2);

    if (player.moving) {
        const dx = player.tRawX - player.rawX;
        const dy = player.tRawY - player.rawY;
        const dist = Math.hypot(dx, dy);
        const step = player.speed * dt;
        if (dist <= step) {
            player.rawX = player.tRawX; player.rawY = player.tRawY;
            player.col  = player.targetCol; player.row  = player.targetRow;
            player.moving = false;
        } else {
            player.rawX += (dx/dist)*step;
            player.rawY += (dy/dist)*step;
        }
    }
    updateCamera();
}

// ── Render ─────────────────────────────────────────────────────────────────────
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();

    for (let d = 0; d < COLS + ROWS - 1; d++) {
        for (let c = Math.max(0,d-ROWS+1); c <= Math.min(COLS-1,d); c++) {
            const r = d - c;
            const isHov = c===hoveredCol && r===hoveredRow;
            const isTgt = c===player.targetCol && r===player.targetRow && player.moving;
            drawTile(c, r, isHov);
            if (isTgt) drawTargetMarker(c, r);
        }
    }

    const bob = Math.sin(player.bobPhase) * (player.moving ? TH*0.07 : TH*0.028);
    drawPlayer(bob);
    drawHUD();
}

function loop(ts) {
    const dt = Math.min(0.05, (ts - lastTime) / 1000);
    lastTime = ts;
    update(dt); render();
    requestAnimationFrame(loop);
}

// ── Input ──────────────────────────────────────────────────────────────────────
function handlePointer(sx, sy) {
    const { col, row } = screenToGrid(sx, sy);
    const c = Math.floor(col), r = Math.floor(row);
    if (!inBounds(c, r)) return;
    player.targetCol = c; player.targetRow = r;
    const tc = tileRawCenter(c, r);
    player.tRawX = tc.x; player.tRawY = tc.y;
    player.moving = !(c===player.col && r===player.row);
}

function handleHover(sx, sy) {
    const { col, row } = screenToGrid(sx, sy);
    const c = Math.floor(col), r = Math.floor(row);
    hoveredCol = inBounds(c, r) ? c : -1;
    hoveredRow = inBounds(c, r) ? r : -1;
}

canvas.addEventListener('click',      e => handlePointer(e.clientX, e.clientY));
canvas.addEventListener('mousemove',  e => handleHover(e.clientX, e.clientY));
canvas.addEventListener('mouseleave', () => { hoveredCol=-1; hoveredRow=-1; });
canvas.addEventListener('touchstart', e => { e.preventDefault(); const t=e.changedTouches[0]; handlePointer(t.clientX,t.clientY); },{passive:false});
canvas.addEventListener('touchmove',  e => { e.preventDefault(); const t=e.changedTouches[0]; handleHover(t.clientX,t.clientY); },{passive:false});
canvas.addEventListener('touchend',   e => { e.preventDefault(); },{passive:false});

// ── Boot ───────────────────────────────────────────────────────────────────────
resize();
const initC  = tileRawCenter(player.col, player.row);
player.rawX  = initC.x; player.rawY  = initC.y;
player.tRawX = initC.x; player.tRawY = initC.y;
updateCamera();
requestAnimationFrame(ts => { lastTime = ts; requestAnimationFrame(loop); });
