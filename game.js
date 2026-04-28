'use strict';

// ── Canvas ─────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

// ── Grid ───────────────────────────────────────────────────────────────────────
const COLS = 9;
const ROWS = 9;

// Tile dimensions & grid screen-origin (recalculated in resize())
let TW = 80;   // tile pixel width  (diamond left↔right)
let TH = 40;   // tile pixel height (diamond top↔bottom)  = TW / 2
let OX = 0;    // screen X of the top vertex of tile (0,0)
let OY = 0;    // screen Y of the top vertex of tile (0,0)

// ── Isometric Coordinate Conversions ──────────────────────────────────────────

/**
 * Grid (col, row) → screen position of the tile's TOP VERTEX.
 *
 *   screen_x = OX + (col - row) * TW/2
 *   screen_y = OY + (col + row) * TH/2
 */
function gridToScreen(col, row) {
    return {
        x: OX + (col - row) * TW * 0.5,
        y: OY + (col + row) * TH * 0.5,
    };
}

/**
 * Screen (sx, sy) → fractional grid (col, row).
 * Derived by inverting gridToScreen:
 *
 *   col = (sx - OX)/TW + (sy - OY)/TH
 *   row = (sy - OY)/TH - (sx - OX)/TW
 *
 * Floor the results to obtain the integer tile index.
 */
function screenToGrid(sx, sy) {
    const rx = sx - OX;
    const ry = sy - OY;
    return {
        col: rx / TW + ry / TH,
        row: ry / TH - rx / TW,
    };
}

/** Centre of a tile's top surface in screen space (used for character positioning). */
function tileCenter(col, row) {
    const t = gridToScreen(col, row);
    return { x: t.x, y: t.y + TH * 0.5 };
}

function inBounds(col, row) {
    return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

// ── Resize ─────────────────────────────────────────────────────────────────────
function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    // Grid screen-width  = (COLS + ROWS - 2) * TW/2
    // Grid screen-height = (COLS + ROWS) * TH/2 + SW   where SW = TH*0.5 = TW*0.25
    //                    = TW * (COLS + ROWS + 1) / 4
    const fitByW = (canvas.width  - 48) * 2 / (COLS + ROWS - 2);
    const fitByH = (canvas.height - 96) * 4 / (COLS + ROWS + 1);
    const raw    = Math.floor(Math.min(fitByW, fitByH));
    TW = raw % 2 === 0 ? raw : raw - 1;
    TH = TW >> 1;

    OX = canvas.width * 0.5;
    OY = (canvas.height - TH * (COLS + ROWS + 1) * 0.5) * 0.5 + 16;

    // Sync player screen position after resize.
    const pc = tileCenter(player.col, player.row);
    player.x  = pc.x;
    player.y  = pc.y;
    const tc = tileCenter(player.targetCol, player.targetRow);
    player.tx = tc.x;
    player.ty = tc.y;
}
window.addEventListener('resize', resize);

// ── Tile Map ───────────────────────────────────────────────────────────────────
// 0 = sandy ground, 1 = dirt path
const tileMap = (() => {
    const m = Array.from({ length: ROWS }, () => new Uint8Array(COLS));
    for (let i = 0; i < COLS; i++) m[4][i] = 1;   // horizontal path
    for (let i = 0; i < ROWS; i++) m[i][4] = 1;   // vertical path
    return m;
})();

// Deterministic per-tile seeds for decorations (no Math.random at runtime)
const SEED = Array.from({ length: ROWS }, (_, r) =>
    Array.from({ length: COLS }, (_, c) => ((r * 97 + c * 61 + 13) % 100) / 100)
);

// Tile colour palettes: top face, left wall, right wall
const PAL = {
    0: { top: '#c8a06a', left: '#7a5530', right: '#9a6e3a' },   // sand
    1: { top: '#a07848', left: '#5c3820', right: '#7a5030' },   // dirt path
};

// ── Player ─────────────────────────────────────────────────────────────────────
const player = {
    col:       4, row:       4,
    targetCol: 4, targetRow: 4,
    x:  0, y:  0,           // current screen position (tile centre)
    tx: 0, ty: 0,           // target  screen position
    speed:  180,            // px / second
    moving: false,
    bobPhase: 0,            // drives walk / idle bob
};

// ── Input State ────────────────────────────────────────────────────────────────
let hoveredCol = -1;
let hoveredRow = -1;
let pulseT     = 0;         // drives target-marker pulse animation

// ── Drawing helpers ────────────────────────────────────────────────────────────

function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
    g.addColorStop(0, '#d4956a');
    g.addColorStop(0.5, '#a06030');
    g.addColorStop(1, '#1a0e06');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/**
 * Draw one isometric tile with 3 visible faces:
 *   top (diamond), left wall, right wall.
 *
 * Side-wall height SW = TH * 0.5.  Walls extend downward in screen space.
 *
 *   Top face vertices (top vertex at screen pos x,y):
 *     top   = (x,      y      )
 *     right = (x + hw, y + hh )
 *     front = (x,      y + TH )   ← nearest to viewer
 *     left  = (x - hw, y + hh )
 *
 *   Left wall  : left → front (top edge) and left+SW → front+SW (bottom edge)
 *   Right wall : right → front (top edge) and right+SW → front+SW (bottom edge)
 */
function drawTile(col, row, highlight) {
    const { x, y } = gridToScreen(col, row);
    const hw  = TW * 0.5;
    const hh  = TH * 0.5;
    const sw  = TH * 0.5;    // side wall height
    const pal = PAL[tileMap[row][col]] ?? PAL[0];

    const topColor   = highlight ? '#ddc070' : pal.top;
    const leftColor  = highlight ? '#a08828' : pal.left;
    const rightColor = highlight ? '#bfa030' : pal.right;

    // ── Left wall ─────────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(x - hw, y + hh);
    ctx.lineTo(x,      y + TH);
    ctx.lineTo(x,      y + TH + sw);
    ctx.lineTo(x - hw, y + hh + sw);
    ctx.closePath();
    ctx.fillStyle   = leftColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth   = 0.5;
    ctx.stroke();

    // ── Right wall ────────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(x + hw, y + hh);
    ctx.lineTo(x,      y + TH);
    ctx.lineTo(x,      y + TH + sw);
    ctx.lineTo(x + hw, y + hh + sw);
    ctx.closePath();
    ctx.fillStyle   = rightColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth   = 0.5;
    ctx.stroke();

    // ── Top face (drawn last — caps the walls cleanly) ────────────────────────
    ctx.beginPath();
    ctx.moveTo(x,       y);
    ctx.lineTo(x + hw,  y + hh);
    ctx.lineTo(x,       y + TH);
    ctx.lineTo(x - hw,  y + hh);
    ctx.closePath();
    ctx.fillStyle   = topColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth   = 0.5;
    ctx.stroke();
}

/** Deterministic tile decorations (rocks, tufts, cactus). */
function drawTileDetail(col, row) {
    const s = SEED[row][col];
    const t = tileMap[row][col];

    // Skip path tiles and the player's current tile
    if (t === 1) return;
    if (col === player.col && row === player.row) return;

    const { x, y } = gridToScreen(col, row);

    if (s > 0.76) {
        // Small rock
        const rx = x + (s * 2 - 1) * TW * 0.22;
        const ry = y + TH * 0.48 + s * TH * 0.18;
        ctx.fillStyle = '#8a7050';
        ctx.beginPath();
        ctx.ellipse(rx, ry, TW * 0.07, TH * 0.065, 0.4, 0, Math.PI * 2);
        ctx.fill();
    } else if (s < 0.13) {
        // Tiny cactus
        const cx = x + (s * 10 - 0.6) * TW * 0.09;
        const cy = y + TH * 0.52;
        const cw  = Math.max(0.8, TW * 0.022);
        ctx.strokeStyle = '#5a8838';
        ctx.lineWidth   = cw;
        ctx.lineCap     = 'round';
        // Stem
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx, cy - TH * 0.44);
        ctx.stroke();
        // Left arm
        ctx.beginPath();
        ctx.moveTo(cx, cy - TH * 0.28);
        ctx.lineTo(cx - TW * 0.07, cy - TH * 0.40);
        ctx.stroke();
        // Right arm
        ctx.beginPath();
        ctx.moveTo(cx, cy - TH * 0.18);
        ctx.lineTo(cx + TW * 0.065, cy - TH * 0.30);
        ctx.stroke();
    } else if (s > 0.60 && s < 0.67) {
        // Dry grass tufts
        const gx = x + (s - 0.6) * TW * 1.4 - TW * 0.06;
        const gy = y + TH * 0.5 + s * TH * 0.1;
        ctx.strokeStyle = '#9a8050';
        ctx.lineWidth   = Math.max(0.5, TW * 0.015);
        ctx.lineCap     = 'round';
        for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            ctx.moveTo(gx + i * TW * 0.025, gy);
            ctx.lineTo(gx + i * TW * 0.04 + (i - 0.5) * TW * 0.03,
                       gy - TH * 0.28);
            ctx.stroke();
        }
    }
}

/** Pulsing golden marker on the target tile. */
function drawTargetMarker(col, row) {
    const { x, y } = gridToScreen(col, row);
    const hw = TW * 0.5;
    const hh = TH * 0.5;
    const alpha = 0.42 + 0.42 * Math.sin(pulseT * 4.5);

    ctx.beginPath();
    ctx.moveTo(x,       y);
    ctx.lineTo(x + hw,  y + hh);
    ctx.lineTo(x,       y + TH);
    ctx.lineTo(x - hw,  y + hh);
    ctx.closePath();

    ctx.fillStyle   = `rgba(255, 216, 48, ${alpha * 0.28})`;
    ctx.strokeStyle = `rgba(255, 200, 24, ${alpha})`;
    ctx.lineWidth   = 2.5;
    ctx.fill();
    ctx.stroke();
}

/**
 * Draw the player as an isometric cowboy token.
 *
 * (cx, cy) = tile-centre in screen space.
 * bob      = small vertical offset for walk / idle animation.
 *
 * The body is an isometric box with 3 visible faces (top, left-front,
 * right-front).  In screen space "up" (−y) represents height (Z axis).
 *
 *   Ground diamond vertices at y:
 *     back  = (cx,      y − bd)    ← topmost in screen
 *     right = (cx + bw, y      )
 *     front = (cx,      y + bd )   ← bottommost, nearest viewer
 *     left  = (cx − bw, y      )
 *
 *   Top face: same shape shifted up by bH.
 */
function drawPlayer(cx, cy, bob) {
    const y  = cy + bob;
    const bw = TW * 0.14;    // body screen half-width
    const bd = TH * 0.17;    // body iso depth (front/back offset)
    const bH = TH * 0.92;    // body height (screen pixels, upward)
    const hR = TW * 0.11;    // head radius

    // Ground shadow
    ctx.beginPath();
    ctx.ellipse(cx, y + bd * 0.4, bw * 1.5, bd * 0.72, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fill();

    // ── Body — right-front face (lighter, faces viewer) ──────────────────────
    ctx.beginPath();
    ctx.moveTo(cx + bw, y - bH);          // top-right
    ctx.lineTo(cx,      y + bd - bH);     // top-front
    ctx.lineTo(cx,      y + bd);          // bottom-front
    ctx.lineTo(cx + bw, y);              // bottom-right
    ctx.closePath();
    ctx.fillStyle = '#c85030';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.28)';
    ctx.lineWidth   = 0.5;
    ctx.stroke();

    // ── Body — left-front face (darker) ──────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(cx - bw, y - bH);
    ctx.lineTo(cx,      y + bd - bH);
    ctx.lineTo(cx,      y + bd);
    ctx.lineTo(cx - bw, y);
    ctx.closePath();
    ctx.fillStyle = '#a03820';
    ctx.fill();
    ctx.stroke();

    // ── Body — top face (rhombus) ─────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(cx,      y - bd - bH);    // back apex
    ctx.lineTo(cx + bw, y - bH);         // right
    ctx.lineTo(cx,      y + bd - bH);    // front apex
    ctx.lineTo(cx - bw, y - bH);         // left
    ctx.closePath();
    ctx.fillStyle = '#e06840';
    ctx.fill();
    ctx.stroke();

    // ── Head ──────────────────────────────────────────────────────────────────
    const headY = y - bd - bH - hR * 1.05;
    ctx.beginPath();
    ctx.arc(cx, headY, hR, 0, Math.PI * 2);
    ctx.fillStyle = '#efc070';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth   = 0.5;
    ctx.stroke();

    // ── Cowboy hat brim ────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.ellipse(cx, headY - hR * 0.32, hR * 1.68, hR * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#4e2a10';
    ctx.fill();

    // ── Hat crown ─────────────────────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(cx - hR * 0.74, headY - hR * 0.32);
    ctx.lineTo(cx - hR * 0.56, headY - hR * 1.80);
    ctx.lineTo(cx + hR * 0.56, headY - hR * 1.80);
    ctx.lineTo(cx + hR * 0.74, headY - hR * 0.32);
    ctx.closePath();
    ctx.fillStyle = '#6a3e1c';
    ctx.fill();

    // ── Hat band ──────────────────────────────────────────────────────────────
    ctx.strokeStyle = '#d09038';
    ctx.lineWidth   = Math.max(0.8, hR * 0.22);
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - hR * 0.70, headY - hR * 0.54);
    ctx.lineTo(cx + hR * 0.70, headY - hR * 0.54);
    ctx.stroke();
}

/** Heads-up display: tile coords + instructions. */
function drawHUD() {
    const pad   = 10;
    const fSize = Math.max(12, Math.min(16, TW * 0.22));
    ctx.save();

    // Pill background
    ctx.fillStyle   = 'rgba(0,0,0,0.50)';
    ctx.strokeStyle = 'rgba(255,200,80,0.30)';
    ctx.lineWidth   = 1;
    const hudW = fSize * 11;
    const hudH = fSize * 2.8;
    ctx.beginPath();
    ctx.roundRect(pad, pad, hudW, hudH, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle    = '#ffd898';
    ctx.font         = `bold ${fSize}px monospace`;
    ctx.textBaseline = 'middle';
    ctx.fillText(
        `Tile  (${player.col}, ${player.row})`,
        pad + 10,
        pad + hudH * 0.32
    );

    ctx.fillStyle = 'rgba(255,210,140,0.70)';
    ctx.font      = `${fSize * 0.82}px monospace`;
    ctx.fillText(
        'Tap any tile to move',
        pad + 10,
        pad + hudH * 0.75
    );

    ctx.restore();
}

// ── Update ─────────────────────────────────────────────────────────────────────
let lastTime = 0;

function update(dt) {
    pulseT      += dt;
    player.bobPhase += dt * (player.moving ? 9 : 2.2);

    if (!player.moving) return;

    const dx   = player.tx - player.x;
    const dy   = player.ty - player.y;
    const dist = Math.hypot(dx, dy);
    const step = player.speed * dt;

    if (dist <= step) {
        // Arrived at target tile
        player.x   = player.tx;
        player.y   = player.ty;
        player.col = player.targetCol;
        player.row = player.targetRow;
        player.moving = false;
    } else {
        player.x += (dx / dist) * step;
        player.y += (dy / dist) * step;
    }
}

// ── Render ─────────────────────────────────────────────────────────────────────
function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawBackground();

    // Draw tiles in painter's order: ascending (col+row) diagonal = back→front.
    // For each diagonal d, iterate valid (col, row) pairs where col+row == d.
    for (let d = 0; d < COLS + ROWS - 1; d++) {
        const cMin = Math.max(0, d - ROWS + 1);
        const cMax = Math.min(COLS - 1, d);

        for (let c = cMin; c <= cMax; c++) {
            const r = d - c;
            const isHovered = c === hoveredCol && r === hoveredRow;
            const isTarget  = c === player.targetCol && r === player.targetRow
                              && player.moving;

            drawTile(c, r, isHovered);
            drawTileDetail(c, r);

            if (isTarget) drawTargetMarker(c, r);
        }
    }

    // Player — drawn last (flat grid: always on top of tiles)
    const bob = Math.sin(player.bobPhase) *
                (player.moving ? TH * 0.07 : TH * 0.028);
    drawPlayer(player.x, player.y, bob);

    drawHUD();
}

// ── Game Loop ──────────────────────────────────────────────────────────────────
function loop(timestamp) {
    const dt = Math.min(0.05, (timestamp - lastTime) / 1000);
    lastTime  = timestamp;
    update(dt);
    render();
    requestAnimationFrame(loop);
}

// ── Input ──────────────────────────────────────────────────────────────────────
function handlePointer(sx, sy) {
    const { col, row } = screenToGrid(sx, sy);
    const c = Math.floor(col);
    const r = Math.floor(row);
    if (!inBounds(c, r)) return;

    player.targetCol = c;
    player.targetRow = r;

    const tc     = tileCenter(c, r);
    player.tx    = tc.x;
    player.ty    = tc.y;
    player.moving = !(c === player.col && r === player.row);
}

function handleHover(sx, sy) {
    const { col, row } = screenToGrid(sx, sy);
    const c = Math.floor(col);
    const r = Math.floor(row);
    hoveredCol = inBounds(c, r) ? c : -1;
    hoveredRow = inBounds(c, r) ? r : -1;
}

// Mouse
canvas.addEventListener('click', e => {
    handlePointer(e.clientX, e.clientY);
});
canvas.addEventListener('mousemove', e => {
    handleHover(e.clientX, e.clientY);
});
canvas.addEventListener('mouseleave', () => {
    hoveredCol = -1;
    hoveredRow = -1;
});

// Touch
canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const t = e.changedTouches[0];
    handlePointer(t.clientX, t.clientY);
}, { passive: false });

canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    const t = e.changedTouches[0];
    handleHover(t.clientX, t.clientY);
}, { passive: false });

canvas.addEventListener('touchend', e => {
    e.preventDefault();
}, { passive: false });

// ── Boot ───────────────────────────────────────────────────────────────────────
resize();

// Place the player and sync screen coords after initial resize
const initCenter = tileCenter(player.col, player.row);
player.x  = initCenter.x;
player.y  = initCenter.y;
player.tx = initCenter.x;
player.ty = initCenter.y;

requestAnimationFrame(ts => {
    lastTime = ts;
    requestAnimationFrame(loop);
});
