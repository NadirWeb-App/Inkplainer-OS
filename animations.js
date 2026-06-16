/**
 * animations.js
 * Whiteboard Animator - Drawing Algorithm Engine
 * Version: 12.1
 * 
 * Contains animation styles and outline extraction helpers:
 * - Scanner, Contour, OutlineChunks, OutlineFill, IllustFill, OutlineOnly
 * - ChunkJump, Scribble
 * - SpecText, Specialized (9 variants)
 * 
 * Dependencies (from main app):
 * - window.state (canvas dimensions, bounds, settings)
 * - window.ctx (main canvas context)
 * - window.offscreen (offscreen canvas)
 * - window.hctx (hand canvas context)
 * - window.fillBg() (background fill function)
 * - window.drawHand() (hand drawing function)
 * - window.resScale(), resPointScale(), resSoftBlur() (resolution scaling)
 * - window.finishAnim() (animation completion handler)
 * - window.setProgress() (progress bar update)
 */

(function(window) {
  'use strict';

  console.log('🎨 Loading Animation Engine...');

function buildPresenceMap() {
  const cb = state.contentBounds;
  const W = cb.w, H = cb.h;
  const d = offscreen.getContext('2d', { willReadFrequently: true }).getImageData(cb.x, cb.y, W, H).data;
  const map = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y*W+x)*4;
    const a = d[i+3];
    if (a > 20 && (a < 250 || d[i] < 240 || d[i+1] < 240 || d[i+2] < 240))
      map[y*W+x] = 1;
  }
  return map;
}

// Reveal everything up to (and including) a given absolute Y on the main canvas
function revealUpToY(absY) {
  const cb = state.contentBounds;
  ctx.save(); fillBg(ctx);
  const h = Math.min(absY, cb.y + cb.h) - cb.y;
  if (h > 0) ctx.drawImage(offscreen, cb.x, cb.y, cb.w, h, cb.x, cb.y, cb.w, h);
  ctx.restore();
}

// Reveal everything revealed so far (stored as a bitmask of row bands)
// For styles that don't do simple top-down reveal, we maintain a
// separate "revealCanvas" and blit it.
function ensureRevealCanvas() {
  if (!state.revealCanvas) {
    state.revealCanvas = document.createElement('canvas');
    state.revealCanvas.width  = state.canvasW;
    state.revealCanvas.height = state.canvasH;
    // Start transparent — fillBg(ctx) in each tick already draws background + bgCanvas
    state.revealCanvas.getContext('2d').clearRect(0,0,state.canvasW,state.canvasH);
  }
}

// ── SCANNER (unchanged) ──
function setupScanner() { state.curX=0; state.curY=0; state.scanDir=1; }

function tickScanner(speed) {
  const cb=state.contentBounds, bandH=48;
  const absX=cb.x+state.curX, absY=cb.y+state.curY;
  const sw=Math.min(speed, cb.w-state.curX), sh=Math.min(bandH, cb.h-state.curY);
  ctx.drawImage(offscreen, absX,absY,sw,sh, absX,absY,sw,sh);
  state.curX += speed*state.scanDir;
  if (state.curX>=cb.w || state.curX<0) {
    ctx.drawImage(offscreen, cb.x,absY,cb.w,sh, cb.x,absY,cb.w,sh);
    state.curY += bandH;
    if (state.curY>=cb.h) { finishAnim(); return; }
    if (state.zigzag) { state.scanDir*=-1; state.curX=state.scanDir===1?0:cb.w-speed; }
    else { state.scanDir=1; state.curX=0; }
  }
  const tipX=cb.x+state.curX+(state.scanDir===1?0:speed);
  const tipY=cb.y+state.curY+bandH*0.5;
  hctx.clearRect(0,0,state.canvasW,state.canvasH);
  drawHand(hctx, tipX,tipY, state.scanDir, state.hand);
  setProgress((state.curY+(state.curX/cb.w)*bandH)/cb.h);
}

// ─────────────────────────────────────────────
// ── 1. CONTOUR  (FIXED)
//    Phase 1: Progressively draws the visible
//    edge of the image onto a dedicated edge
//    canvas as the hand traces it — you actually
//    SEE the outline appear stroke by stroke.
//    Phase 2: Fills the interior with zigzag
//    hatching rows, revealing the full image.
// ─────────────────────────────────────────────
function setupContour() {
  const cb  = state.contentBounds;
  const map = buildPresenceMap();
  const W = cb.w, H = cb.h;

  // Build an edge map: pixel is "edge" if it is content
  // AND has at least one non-content neighbour (4-connected).
  const edgeMap = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!map[y*W+x]) continue;
    const boundary =
      (x===0 || !map[y*W+(x-1)]) ||
      (x===W-1 || !map[y*W+(x+1)]) ||
      (y===0 || !map[(y-1)*W+x]) ||
      (y===H-1 || !map[(y+1)*W+x]);
    if (boundary) edgeMap[y*W+x] = 1;
  }

  // Collect edge pixels in a traversal order that looks like drawing:
  // walk top silhouette L→R, right silhouette T→B, bottom R→L, left B→T.
  const edgePts = [];
  // top edge (topmost content pixel per column)
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) { if (edgeMap[y*W+x]) { edgePts.push({x:cb.x+x, y:cb.y+y}); break; } }
  }
  // bottom edge (bottommost, R→L)
  for (let x = W-1; x >= 0; x--) {
    for (let y = H-1; y >= 0; y--) { if (edgeMap[y*W+x]) { edgePts.push({x:cb.x+x, y:cb.y+y}); break; } }
  }
  // left edge (leftmost, B→T to close loop)
  for (let y = H-1; y >= 0; y--) {
    for (let x = 0; x < W; x++) { if (edgeMap[y*W+x]) { edgePts.push({x:cb.x+x, y:cb.y+y}); break; } }
  }

  // Phase 2: fill waypoints — zigzag scan respecting content shape
  const STEP = Math.max(4, Math.round(H/55));
  const fillPts = [];
  let dir = 1;
  for (let ry = 0; ry < H; ry += STEP) {
    let lx = W, rx = 0;
    for (let y2 = ry; y2 < Math.min(ry+STEP,H); y2++)
      for (let x = 0; x < W; x++)
        if (map[y2*W+x]) { lx=Math.min(lx,x); rx=Math.max(rx,x); }
    if (lx > rx) { dir*=-1; continue; }
    const ay = cb.y + ry + STEP*0.5;
    const x1 = cb.x + (dir>0 ? lx : rx);
    const x2 = cb.x + (dir>0 ? rx : lx);
    const segs = Math.max(3, Math.floor((rx-lx)/28));
    for (let s = 0; s <= segs; s++) {
      const t = s/segs;
      fillPts.push({
        x: x1+(x2-x1)*t + (Math.random()-0.5)*4,
        y: ay + (Math.random()-0.5)*3,
        reveal_y: ay
      });
    }
    dir *= -1;
  }

  state.contourEdgePts  = edgePts;
  state.contourFillPts  = fillPts;
  state.contourPhase    = 1;  // 1 = outline, 2 = fill
  state.contourEdgeIdx  = 0;
  state.contourFillIdx  = 0;

  // Dedicated canvas that accumulates the drawn outline
  state.edgeCanvas = document.createElement('canvas');
  state.edgeCanvas.width  = state.canvasW;
  state.edgeCanvas.height = state.canvasH;
  // Start transparent — fillBg(ctx) in each tick handles background + previous layers
  state.edgeCanvas.getContext('2d').clearRect(0,0,state.canvasW,state.canvasH);

  // Sample the colour of each edge pixel from offscreen so we paint
  // the correct colour (important for PNGs / dark content)
  const ocd = offscreen.getContext('2d').getImageData(cb.x, cb.y, W, H).data;
  state.contourEdgeColors = edgePts.map(p => {
    const lx2 = p.x - cb.x, ly = p.y - cb.y;
    const i = (ly*W + lx2)*4;
    return `rgba(${ocd[i]},${ocd[i+1]},${ocd[i+2]},${(ocd[i+3]/255).toFixed(2)})`;
  });

  state.revealCanvas = null;
  ensureRevealCanvas();
}

function tickContour(speed) {
  const handSpeed = parseInt(document.getElementById('hand-speed-slider').value);

  if (state.contourPhase === 1) {
    // ── Phase 1: draw edge pixels onto edgeCanvas one by one ──
    // Advance by handSpeed (not reveal speed) so it's always slow/visible
    const step = Math.max(1, handSpeed);
    const ec   = state.edgeCanvas.getContext('2d');
    const pts  = state.contourEdgePts;

    for (let i = 0; i < step; i++) {
      if (state.contourEdgeIdx >= pts.length) break;
      const p = pts[state.contourEdgeIdx];
      const col = state.contourEdgeColors[state.contourEdgeIdx];
      // Paint a small dot at this edge position
      ec.fillStyle = col;
      ec.beginPath();
      ec.arc(p.x, p.y, 1.2, 0, Math.PI*2);
      ec.fill();
      state.contourEdgeIdx++;
    }

    // Composite: background + edgeCanvas
    ctx.save(); fillBg(ctx);
    ctx.drawImage(state.edgeCanvas, 0, 0);
    ctx.restore();

    const tip = pts[Math.min(state.contourEdgeIdx, pts.length-1)];
    const dir = state.contourEdgeIdx > 1
      ? (pts[state.contourEdgeIdx-1].x >= pts[Math.max(0,state.contourEdgeIdx-2)].x ? 1 : -1)
      : 1;
    hctx.clearRect(0,0,state.canvasW,state.canvasH);
    drawHand(hctx, tip.x, tip.y, dir, state.hand);
    setProgress((state.contourEdgeIdx / pts.length) * 0.35); // phase 1 = 0–35%

    if (state.contourEdgeIdx >= pts.length) {
      state.contourPhase = 2;
    }

  } else {
    // ── Phase 2: zigzag fill reveal — paced by handSpeed so it looks drawn ──
    const step  = Math.max(1, Math.round(handSpeed * 0.8));
    const pts   = state.contourFillPts;
    state.contourFillIdx = Math.min(state.contourFillIdx + step, pts.length-1);
    const idx   = state.contourFillIdx;
    const tip   = pts[idx];

    const cb = state.contentBounds;
    ctx.save(); fillBg(ctx);
    // Draw the completed edge outline first
    ctx.drawImage(state.edgeCanvas, 0, 0);
    // Reveal fill row-by-row only up to where the hand currently is
    const revealH = Math.min(tip.reveal_y + Math.round(cb.h / state.contourFillPts.length * step * 6), cb.y+cb.h) - cb.y;
    if (revealH > 0) ctx.drawImage(offscreen, cb.x, cb.y, cb.w, revealH, cb.x, cb.y, cb.w, revealH);
    ctx.restore();

    if (idx >= pts.length-1) { finishAnim(); return; }

    const dir = (idx>0 && pts[idx].x >= pts[idx-1].x) ? 1 : -1;
    hctx.clearRect(0,0,state.canvasW,state.canvasH);
    drawHand(hctx, tip.x, tip.y, dir, state.hand);
    setProgress(0.35 + (idx/pts.length)*0.65);
  }
}

// ─────────────────────────────────────────────
// ── OUTLINE + CHUNKS (NEW)
//    Phase 1: Draws the outline/contour like
//    the Contour animation style.
//    Phase 2: Fills using chunks like Chunk Jump
//    for a clean, modern reveal effect.
// ─────────────────────────────────────────────
function setupOutlineChunks() {
  const cb  = state.contentBounds;
  const map = buildPresenceMap();
  const W = cb.w, H = cb.h;

  // Build edge map (same as contour)
  const edgeMap = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!map[y*W+x]) continue;
    const boundary =
      (x===0 || !map[y*W+(x-1)]) ||
      (x===W-1 || !map[y*W+(x+1)]) ||
      (y===0 || !map[(y-1)*W+x]) ||
      (y===H-1 || !map[(y+1)*W+x]);
    if (boundary) edgeMap[y*W+x] = 1;
  }

  // Collect edge pixels (same as contour)
  const edgePts = [];
  // top edge
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) { if (edgeMap[y*W+x]) { edgePts.push({x:cb.x+x, y:cb.y+y}); break; } }
  }
  // bottom edge
  for (let x = W-1; x >= 0; x--) {
    for (let y = H-1; y >= 0; y--) { if (edgeMap[y*W+x]) { edgePts.push({x:cb.x+x, y:cb.y+y}); break; } }
  }
  // left edge
  for (let y = H-1; y >= 0; y--) {
    for (let x = 0; x < W; x++) { if (edgeMap[y*W+x]) { edgePts.push({x:cb.x+x, y:cb.y+y}); break; } }
  }

  // Sample edge colors
  const ocd = offscreen.getContext('2d').getImageData(cb.x, cb.y, W, H).data;
  state.outlineChunksEdgeColors = edgePts.map(p => {
    const lx2 = p.x - cb.x, ly = p.y - cb.y;
    const i = (ly*W + lx2)*4;
    return `rgba(${ocd[i]},${ocd[i+1]},${ocd[i+2]},${(ocd[i+3]/255).toFixed(2)})`;
  });

  // Setup for Phase 1 (outline drawing)
  state.outlineChunksEdgePts  = edgePts;
  state.outlineChunksPhase    = 1;  // 1 = outline, 2 = chunks
  state.outlineChunksEdgeIdx  = 0;

  // Dedicated canvas for outline
  state.edgeCanvas = document.createElement('canvas');
  state.edgeCanvas.width  = state.canvasW;
  state.edgeCanvas.height = state.canvasH;
  state.edgeCanvas.getContext('2d').clearRect(0,0,state.canvasW,state.canvasH);

  // Setup for Phase 2 (chunk filling) - prepare but don't start yet
  const numTiles = parseInt(document.getElementById('tile-slider').value) || 30;
  const { pts } = buildTileWaypoints(numTiles, (tiles) => {
    // Nearest-neighbour walk from random starting tile
    const ordered = [], rem = [...tiles];
    if (!rem.length) return ordered;
    let cur = rem.splice(Math.floor(Math.random()*rem.length), 1)[0];
    ordered.push(cur);
    while (rem.length) {
      let best = Infinity, bi = 0;
      rem.forEach((t, i) => {
        const d = Math.hypot(t.cx - cur.cx, t.cy - cur.cy);
        if (d < best) { best = d; bi = i; }
      });
      cur = rem.splice(bi, 1)[0]; ordered.push(cur);
    }
    return ordered;
  });

  state.outlineChunksChunkPts = pts;
  state.outlineChunksChunkIdx = 0;
  
  state.revealCanvas = null;
  ensureRevealCanvas();
}

function tickOutlineChunks(speed) {
  const handSpeed = parseInt(document.getElementById('hand-speed-slider').value);

  if (state.outlineChunksPhase === 1) {
    // ── Phase 1: Draw outline ──
    const step = Math.max(1, handSpeed);
    const ec   = state.edgeCanvas.getContext('2d');
    const pts  = state.outlineChunksEdgePts;

    for (let i = 0; i < step; i++) {
      if (state.outlineChunksEdgeIdx >= pts.length) break;
      const p = pts[state.outlineChunksEdgeIdx];
      const col = state.outlineChunksEdgeColors[state.outlineChunksEdgeIdx];
      // Paint edge dot
      ec.fillStyle = col;
      ec.beginPath();
      ec.arc(p.x, p.y, 1.2, 0, Math.PI*2);
      ec.fill();
      state.outlineChunksEdgeIdx++;
    }

    // Composite: background + edge outline
    ctx.save(); fillBg(ctx);
    ctx.drawImage(state.edgeCanvas, 0, 0);
    ctx.restore();

    // Hand position
    const tip = pts[Math.min(state.outlineChunksEdgeIdx, pts.length-1)];
    const dir = state.outlineChunksEdgeIdx > 1
      ? (pts[state.outlineChunksEdgeIdx-1].x >= pts[Math.max(0,state.outlineChunksEdgeIdx-2)].x ? 1 : -1)
      : 1;
    hctx.clearRect(0,0,state.canvasW,state.canvasH);
    drawHand(hctx, tip.x, tip.y, dir, state.hand);
    setProgress((state.outlineChunksEdgeIdx / pts.length) * 0.4); // phase 1 = 0–40%

    // Move to phase 2 when outline is done
    if (state.outlineChunksEdgeIdx >= pts.length) {
      state.outlineChunksPhase = 2;
    }

  } else {
    // ── Phase 2: Fill with chunks ──
    const pts = state.outlineChunksChunkPts;
    if (!pts.length) { finishAnim(); return; }
    
    const advance = Math.max(1, handSpeed);
    const rc = state.revealCanvas.getContext('2d');

    for (let i = 0; i < advance; i++) {
      if (state.outlineChunksChunkIdx >= pts.length) break;
      const tip = pts[state.outlineChunksChunkIdx++];
      if (tip.isLift || tip.isJump) continue;
      const r = tip.strokeR || 8;
      rc.save();
      rc.beginPath();
      rc.arc(tip.x, tip.y, r, 0, Math.PI*2);
      rc.clip();
      rc.drawImage(offscreen, 0, 0);
      rc.restore();
    }
    
    // Composite: background + edge + chunks
    ctx.save(); fillBg(ctx);
    ctx.drawImage(state.edgeCanvas, 0, 0); // outline stays on top
    ctx.drawImage(state.revealCanvas, 0, 0); // chunks below outline
    ctx.restore();

    // Hand position
    if (state.outlineChunksChunkIdx < pts.length) {
      const idx = Math.max(0, state.outlineChunksChunkIdx - 1);
      const tip = pts[idx];
      const dir = (tip.isLift||tip.isJump) ? 1 : (idx>0 && pts[idx].x >= pts[idx-1].x ? 1 : -1);
      hctx.clearRect(0,0,state.canvasW,state.canvasH);
      drawHand(hctx, tip.x, tip.y, dir, state.hand);
    } else {
      hctx.clearRect(0,0,state.canvasW,state.canvasH);
    }

    setProgress(0.4 + (state.outlineChunksChunkIdx / pts.length) * 0.6); // phase 2 = 40–100%

    if (state.outlineChunksChunkIdx >= pts.length) {
      finishAnim();
    }
  }
}

// ─────────────────────────────────────────────
// ── 2. NERVOUS LINES  (FIXED)
//    High-density waypoints so the hand
//    physically moves slowly even at high reveal
//    speed.  Each row: 2–3 passes back-and-forth
//    with jitter, overshoots, and hesitations.
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// ── OUTLINE FILL
//    Phase 1: traces the silhouette edge as a
//    continuous pen stroke — lifts the pen when
//    consecutive points are too far apart so no
//    ugly gap-closing lines are drawn.
//    Phase 2+: fills each quantized color
//    separately, lightest first. Each color sweeps
//    across the canvas with the hand, keeping the
//    outline composited on top at all times.
// ─────────────────────────────────────────────
function setupOutlineFill() {
  const cb  = state.contentBounds;
  const map = buildPresenceMap();
  const W = cb.w, H = cb.h;
  const ocd = offscreen.getContext('2d').getImageData(cb.x, cb.y, W, H).data;

  // ── Build edge map (4-connected boundary) ──
  const edgeMap = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!map[y*W+x]) continue;
    if ((x===0||!map[y*W+(x-1)]) || (x===W-1||!map[y*W+(x+1)]) ||
        (y===0||!map[(y-1)*W+x]) || (y===H-1||!map[(y+1)*W+x]))
      edgeMap[y*W+x] = 1;
  }

  // ── Collect edge pixels in 4-pass order then subsample ──
  const raw = [];
  for (let x=0;x<W;x++)   { for (let y=0;y<H;y++)   { if(edgeMap[y*W+x])   { raw.push({x:cb.x+x,y:cb.y+y}); break; } } }
  for (let y=0;y<H;y++)   { for (let x=W-1;x>=0;x--){ if(edgeMap[y*W+x])   { raw.push({x:cb.x+x,y:cb.y+y}); break; } } }
  for (let x=W-1;x>=0;x--){ for (let y=H-1;y>=0;y--){ if(edgeMap[y*W+x])   { raw.push({x:cb.x+x,y:cb.y+y}); break; } } }
  for (let y=H-1;y>=0;y--){ for (let x=0;x<W;x++)   { if(edgeMap[y*W+x])   { raw.push({x:cb.x+x,y:cb.y+y}); break; } } }

  const stride = Math.max(1, Math.floor(raw.length / Math.round(700 * resPointScale())));
  const perimPts = raw.filter((_, i) => i % stride === 0);
  if (perimPts.length > 1) perimPts.push({...perimPts[0]});

  // ── Outline color: darkest edge pixel, fallback to near-black ──
  let darkest=766, dR=20, dG=20, dB=20;
  for (let i=0; i<raw.length; i+=Math.max(1,Math.floor(raw.length/Math.round(300*resPointScale())))) {
    const p=raw[i], lx=p.x-cb.x, ly=p.y-cb.y, i4=(ly*W+lx)*4;
    const r=ocd[i4],g=ocd[i4+1],b=ocd[i4+2],a=ocd[i4+3];
    if (a>80 && r+g+b<darkest) { darkest=r+g+b; dR=r; dG=g; dB=b; }
  }
  let outlineColor = darkest>550 ? '#111' : `rgb(${Math.max(0,dR-20)},${Math.max(0,dG-20)},${Math.max(0,dB-20)})`;
  if (!document.getElementById('of-outline-autocolor')?.checked) {
    const userCol = document.getElementById('of-outline-color')?.value;
    if (userCol) outlineColor = userCol;
  }
  const ofThickness = parseFloat(document.getElementById('of-outline-thickness')?.value ?? 2) * resScale();
  // Quantize step: 40 gives ~7 buckets/channel, collapses near-identical shades
  const Q = 40;
  const colorMap = new Map();
  for (let y=0; y<H; y++) for (let x=0; x<W; x++) {
    const i4=(y*W+x)*4, a=ocd[i4+3];
    if (a<20) continue;
    const r=Math.round(ocd[i4]  /Q)*Q;
    const g=Math.round(ocd[i4+1]/Q)*Q;
    const b=Math.round(ocd[i4+2]/Q)*Q;
    const key=`${r},${g},${b}`;
    if (!colorMap.has(key)) colorMap.set(key,{r,g,b,pixels:[]});
    colorMap.get(key).pixels.push({x:cb.x+x, y:cb.y+y});
  }

  // Filter noise (< 0.3% of content), sort lightest first
  const totalPx = map.reduce((s,v)=>s+v,0);
  const minPx = Math.max(Math.round(20 * resScale() * resScale()), totalPx*0.003);
  const colorGroups = [...colorMap.values()]
    .filter(g=>g.pixels.length>=minPx)
    .sort((a,b)=>(0.299*b.r+0.587*b.g+0.114*b.b)-(0.299*a.r+0.587*a.g+0.114*a.b)); // lightest first

  // For each group, sort pixels in zigzag scan order for natural brush feel
  colorGroups.forEach((grp,gi) => {
    grp.pixels.sort((a,b)=>{
      if (a.y!==b.y) return a.y-b.y;
      return (Math.floor((a.y-cb.y)/2)%2===0) ? a.x-b.x : b.x-a.x;
    });
    // Build a pre-rendered canvas for this color group (exact pixel colors from offscreen)
    const c = document.createElement('canvas');
    c.width=state.canvasW; c.height=state.canvasH;
    const cctx=c.getContext('2d');
    const imgd=cctx.createImageData(state.canvasW,state.canvasH);
    const srcFull=offscreen.getContext('2d').getImageData(0,0,state.canvasW,state.canvasH);
    grp.pixels.forEach(p=>{
      const si=(p.y*state.canvasW+p.x)*4;
      imgd.data[si]=srcFull.data[si]; imgd.data[si+1]=srcFull.data[si+1];
      imgd.data[si+2]=srcFull.data[si+2]; imgd.data[si+3]=srcFull.data[si+3];
    });
    cctx.putImageData(imgd,0,0);
    grp.preCanvas=c;
    const cstyle = state.colorStyle || 'sparse';
    if (cstyle === 'watercolor') grp.preCanvas = _watercolorizeCanvas(c);
    else if (cstyle === 'filled') grp.preCanvas = _fillGapsCanvas(c);
    // Precompute hand waypoints: center-X of colored pixels per row
    const rows=new Map();
    grp.pixels.forEach(p=>{ if(!rows.has(p.y)) rows.set(p.y,{minX:p.x,maxX:p.x}); else { const r=rows.get(p.y); r.minX=Math.min(r.minX,p.x); r.maxX=Math.max(r.maxX,p.x); } });
    const waypoints=[];
    let wdir=1;
    [...rows.entries()].sort((a,b)=>a[0]-b[0]).forEach(([y,r])=>{
      waypoints.push({x: wdir>0 ? r.maxX : r.minX, y});
      wdir*=-1;
    });
    grp.waypoints=waypoints;
  });

  // ── Canvases ──
  state.ofOutlineCanvas = document.createElement('canvas');
  state.ofOutlineCanvas.width=state.canvasW; state.ofOutlineCanvas.height=state.canvasH;
  state.ofOutlineCanvas.getContext('2d').clearRect(0,0,state.canvasW,state.canvasH);

  // colorCanvas accumulates all filled colors so far
  state.ofColorCanvas = document.createElement('canvas');
  state.ofColorCanvas.width=state.canvasW; state.ofColorCanvas.height=state.canvasH;
  state.ofColorCanvas.getContext('2d').clearRect(0,0,state.canvasW,state.canvasH);

  state.ofPhase        = 1;
  state.ofPerimPts     = perimPts;
  state.ofPerimIdx     = 0;
  state.ofLastDrawn    = 0;
  state.ofOutlineColor = outlineColor;
  state.ofOutlineThickness = ofThickness;
  state.ofColorGroups  = colorGroups;
  state.ofColorIdx     = 0;   // which color group we're currently filling
  state.ofWaypointIdx  = 0;   // waypoint index within current group
  state.ofRevealY      = 0;   // current scanline Y for reveal within group
}

function tickOutlineFill(speed) {
  const handSpeed = parseInt(document.getElementById('hand-speed-slider').value);
  const cb = state.contentBounds;
  const totalPhases = 1 + (state.ofColorGroups ? state.ofColorGroups.length : 1);

  if (state.ofPhase === 1) {
    // ── Phase 1: grow the outline stroke ──
    // Use moveTo when consecutive points jump (avoids gap-closing lines)
    const JUMP = 8 * resScale(); // px threshold — above this, lift the pen
    const step = Math.max(1, handSpeed);
    const pts  = state.ofPerimPts;
    const newIdx = Math.min(state.ofPerimIdx + step, pts.length - 1);
    const oc = state.ofOutlineCanvas.getContext('2d');

    if (newIdx > state.ofLastDrawn) {
      _strokePencil(oc, pts, state.ofLastDrawn, newIdx,
        state.ofOutlineColor, state.ofOutlineThickness ?? (2.4 * resScale()),
        JUMP);
      state.ofLastDrawn = newIdx;
    }
    state.ofPerimIdx = newIdx;

    ctx.save(); fillBg(ctx);
    ctx.drawImage(state.ofOutlineCanvas, 0, 0);
    ctx.restore();

    const tip  = pts[newIdx];
    const prev = pts[Math.max(0, newIdx-1)];
    hctx.clearRect(0,0,state.canvasW,state.canvasH);
    drawHand(hctx, tip.x, tip.y, tip.x>=prev.x?1:-1, state.hand);
    setProgress((newIdx/pts.length) * (1/totalPhases));

    if (newIdx >= pts.length-1) {
      state.ofPhase     = 2;
      state.ofColorIdx  = 0;
      state.ofWaypointIdx = 0;
      state.ofRevealY   = cb.y;
    }

  } else {
    // ── Phase 2+: fill one color group at a time ──
    const grpIdx = state.ofColorIdx;
    if (!state.ofColorGroups || grpIdx >= state.ofColorGroups.length) { finishAnim(); return; }

    const grp = state.ofColorGroups[grpIdx];
    const maxY = cb.y + cb.h;

    // Advance reveal scanline by speed pixels per tick
    const advance = Math.max(1, Math.round(speed * 0.7));
    state.ofRevealY = Math.min(state.ofRevealY + advance, maxY);

    // Blit the portion of this group's pre-rendered canvas revealed so far
    const revealH = state.ofRevealY - cb.y;
    if (revealH > 0) {
      const cc = state.ofColorCanvas.getContext('2d');
      _wcFill(cc, grp.preCanvas, cb, revealH);
    }

    // Composite: bg + all filled colors so far + outline on top
    ctx.save();
    fillBg(ctx);
    ctx.drawImage(state.ofColorCanvas, 0, 0);
    ctx.drawImage(state.ofOutlineCanvas, 0, 0);
    ctx.restore();

    // Hand follows waypoints for this color group
    const wpts = grp.waypoints;
    if (wpts && wpts.length > 0) {
      // Find waypoint closest to current revealY
      let wi = state.ofWaypointIdx;
      while (wi < wpts.length-1 && wpts[wi].y < state.ofRevealY) wi++;
      state.ofWaypointIdx = wi;
      const tip  = wpts[Math.min(wi, wpts.length-1)];
      const prev2 = wpts[Math.max(0, wi-1)];
      hctx.clearRect(0,0,state.canvasW,state.canvasH);
      drawHand(hctx, tip.x, tip.y, tip.x>=prev2.x?1:-1, state.hand);
    }

    const phaseBase = (1 + grpIdx) / totalPhases;
    const phaseSpan = 1 / totalPhases;
    setProgress(phaseBase + (state.ofRevealY-cb.y)/cb.h * phaseSpan);

    if (state.ofRevealY >= maxY) {
      // This color group done — move to next
      state.ofColorIdx++;
      state.ofWaypointIdx = 0;
      state.ofRevealY = cb.y;
      if (state.ofColorIdx >= state.ofColorGroups.length) {
        finishAnim();
      }
    }
  }
}




// ─────────────────────────────────────────────
// ── ILLUSTRATED FILL
//    Phase 1: outer silhouette.
//    Phase 2: internal ink — raster-scan splits
//    ink pixels into pen-lift segments (no gap-
//    closing lines), then segments are reordered
//    by nearest-endpoint so the hand moves like
//    a human artist rather than a printer.
//    Phase 3+: color regions lightest-first.
// ─────────────────────────────────────────────
function setupIllustFill() {
  const cb  = state.contentBounds;
  const map = buildPresenceMap();
  const W = cb.w, H = cb.h;
  const ocd = offscreen.getContext('2d').getImageData(cb.x, cb.y, W, H).data;

  // Ink = dark AND near-neutral (low saturation).
  // True black/gray ink:   lum ~0–60,  sat ~0–15   (r≈g≈b, all near 0)
  // Dark brown pants:      lum ~20–40, sat ~25–50   (r much > b)
  // Dark green backpack:   lum ~25–50, sat ~30–60   (g much > r,b)
  // Dark shadow w/ hue:    lum ~10–30, sat ~20–40
  // Tightening SAT to 20 excludes all of the above while keeping pure black ink.
  const INK_LUM = Math.round(20 + getDetectionSensitivity() * 100);  // 20–120, default 70 at 0.5
  const INK_SAT = Math.round(4  + getDetectionSensitivity() * 32);   // 4–36,   default 20 at 0.5
  // MAX_THICKNESS: if a candidate ink pixel has ink runs wider than this in BOTH
  // horizontal AND vertical directions, it's a filled dark region, not a stroke.
  // True ink lines are 1–6px wide at 720p. Scale up for higher resolutions.
  // At higher sensitivity we allow thicker strokes to pass (catches bold text/thick lines).
  const MAX_THICKNESS = Math.round((4 + getDetectionSensitivity() * 8) * resScale()); // 4–12×res, default 8 at 0.5

  const isInkColor = (i4) => {
    if (ocd[i4+3] < 20) return false;
    const r=ocd[i4], g=ocd[i4+1], b=ocd[i4+2];
    if (0.299*r + 0.587*g + 0.114*b >= INK_LUM) return false;
    return Math.max(r,g,b) - Math.min(r,g,b) < INK_SAT;
  };

  // Build a raw ink candidate map first (color test only)
  const rawInk = new Uint8Array(W * H);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    if (isInkColor((y*W+x)*4)) rawInk[y*W+x] = 1;
  }

  // Thickness filter: measure horizontal and vertical ink run length at each pixel.
  // If min(h_span, v_span) > MAX_THICKNESS → it's a dark fill, not an ink stroke.
  const isInk = (x, y) => {
    if (!rawInk[y*W+x]) return false;
    // Horizontal span
    let hSpan = 1;
    for (let dx=1; x+dx<W && rawInk[y*W+(x+dx)]; dx++) hSpan++;
    for (let dx=1; x-dx>=0 && rawInk[y*W+(x-dx)]; dx++) hSpan++;
    if (hSpan > MAX_THICKNESS) {
      // Vertical span only needs to confirm it's also thick vertically
      let vSpan = 1;
      for (let dy=1; y+dy<H && rawInk[(y+dy)*W+x]; dy++) vSpan++;
      for (let dy=1; y-dy>=0 && rawInk[(y-dy)*W+x]; dy++) vSpan++;
      if (vSpan > MAX_THICKNESS) return false; // wide in both → filled region
    }
    return true;
  };

  // ── 1. Outer silhouette ──
  const edgeMap = new Uint8Array(W * H);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    if (!map[y*W+x]) continue;
    if ((x===0||!map[y*W+(x-1)]) || (x===W-1||!map[y*W+(x+1)]) ||
        (y===0||!map[(y-1)*W+x]) || (y===H-1||!map[(y+1)*W+x]))
      edgeMap[y*W+x] = 1;
  }
  const raw = [];
  for (let x=0;x<W;x++)   { for (let y=0;y<H;y++)   { if(edgeMap[y*W+x]) { raw.push({x:cb.x+x,y:cb.y+y}); break; } } }
  for (let y=0;y<H;y++)   { for (let x=W-1;x>=0;x--){ if(edgeMap[y*W+x]) { raw.push({x:cb.x+x,y:cb.y+y}); break; } } }
  for (let x=W-1;x>=0;x--){ for (let y=H-1;y>=0;y--){ if(edgeMap[y*W+x]) { raw.push({x:cb.x+x,y:cb.y+y}); break; } } }
  for (let y=H-1;y>=0;y--){ for (let x=0;x<W;x++)   { if(edgeMap[y*W+x]) { raw.push({x:cb.x+x,y:cb.y+y}); break; } } }
  const pStride = Math.max(1, Math.floor(raw.length / Math.round(700 * resPointScale())));
  const perimPts = raw.filter((_,i) => i%pStride===0);
  if (perimPts.length > 1) perimPts.push({...perimPts[0]});

  let darkest=766, dR=20, dG=20, dB=20;
  for (let i=0;i<raw.length;i+=Math.max(1,Math.floor(raw.length/Math.round(300*resPointScale())))) {
    const p=raw[i], lx=p.x-cb.x, ly=p.y-cb.y, i4=(ly*W+lx)*4;
    const r=ocd[i4],g=ocd[i4+1],b=ocd[i4+2],a=ocd[i4+3];
    if (a>80 && r+g+b<darkest) { darkest=r+g+b; dR=r; dG=g; dB=b; }
  }
  let outlineColor = darkest>550 ? '#111' : `rgb(${Math.max(0,dR-20)},${Math.max(0,dG-20)},${Math.max(0,dB-20)})`;
  if (!document.getElementById('of-outline-autocolor')?.checked) {
    const userCol = document.getElementById('of-outline-color')?.value;
    if (userCol) outlineColor = userCol;
  }
  const ifThickness = parseFloat(document.getElementById('of-outline-thickness')?.value ?? 2) * resScale();

  // ── 2. Raster-scan ink pixels into pen-lift segments ──
  // No flood-fill, no nearest-neighbour walk — just split on gaps.
  // This guarantees zero gap-closing lines.
  const GAP = Math.round(5 * resScale()); // px — Manhattan distance threshold for a pen lift
  const inkSet = new Uint8Array(W * H);
  const segments = []; // each segment = array of {x,y}
  let curSeg = null;
  let lastX = -9999, lastY = -9999;

  for (let y=0;y<H;y++) {
    for (let x=0;x<W;x++) {
      if (!isInk(x, y)) continue;
      inkSet[y*W+x] = 1;
      const px=cb.x+x, py=cb.y+y;
      const dist = Math.abs(px-lastX) + Math.abs(py-lastY);
      if (!curSeg || dist > GAP) {
        curSeg = [];
        segments.push(curSeg);
      }
      curSeg.push({x:px, y:py});
      lastX=px; lastY=py;
    }
  }

  // Subsample each segment so large shapes don't create thousands of waypoints
  const MAX_SEG_PX = Math.round(200 * resScale());
  const subSampled = segments
    .filter(seg => seg.length >= 1)
    .map(seg => {
      if (seg.length <= MAX_SEG_PX) return seg;
      const k = Math.ceil(seg.length / MAX_SEG_PX);
      // Keep first, last, and every k-th point
      const out = [seg[0]];
      for (let i=1;i<seg.length-1;i++) { if (i%k===0) out.push(seg[i]); }
      out.push(seg[seg.length-1]);
      return out;
    });

  // ── 3. Reorder segments by nearest-endpoint (greedy) ──
  // Hand starts where the outer silhouette ended.
  const used = new Uint8Array(subSampled.length);
  const ordered = [];
  let hx = perimPts.length>0 ? perimPts[perimPts.length-1].x : cb.x+cb.w/2;
  let hy = perimPts.length>0 ? perimPts[perimPts.length-1].y : cb.y;

  for (let n=0;n<subSampled.length;n++) {
    let bestD=Infinity, bestI=-1, bestFlip=false;
    for (let i=0;i<subSampled.length;i++) {
      if (used[i]) continue;
      const seg=subSampled[i];
      const p0=seg[0], pZ=seg[seg.length-1];
      const d0=(p0.x-hx)**2+(p0.y-hy)**2;
      const dZ=(pZ.x-hx)**2+(pZ.y-hy)**2;
      if (d0<bestD) { bestD=d0; bestI=i; bestFlip=false; }
      if (dZ<bestD) { bestD=dZ; bestI=i; bestFlip=true; }
    }
    if (bestI<0) break;
    used[bestI]=1;
    const seg = bestFlip ? [...subSampled[bestI]].reverse() : subSampled[bestI];
    ordered.push(seg);
    const last=seg[seg.length-1];
    hx=last.x; hy=last.y;
  }

  // ── 4. Flatten into waypoints with lift flags ──
  const inkWaypoints = [];
  ordered.forEach(seg => {
    seg.forEach((pt,i) => inkWaypoints.push({x:pt.x, y:pt.y, lift:i===0}));
  });

  // ── 5. Color quantization — exclude ink pixels ──
  const Q = 40;
  const qKey = (r,g,b) => `${Math.round(r/Q)*Q},${Math.round(g/Q)*Q},${Math.round(b/Q)*Q}`;
  const fullColorMap = new Map();
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const i4=(y*W+x)*4, a=ocd[i4+3];
    if (a<20 || inkSet[y*W+x]) continue;
    const key = qKey(ocd[i4],ocd[i4+1],ocd[i4+2]);
    if (!fullColorMap.has(key)) fullColorMap.set(key,{
      r:Math.round(ocd[i4]/Q)*Q, g:Math.round(ocd[i4+1]/Q)*Q, b:Math.round(ocd[i4+2]/Q)*Q, pixels:[]
    });
    fullColorMap.get(key).pixels.push({x:cb.x+x, y:cb.y+y});
  }
  const totalPx = map.reduce((s,v)=>s+v,0);
  const minPx   = Math.max(Math.round(20 * resScale() * resScale()), totalPx*0.003);
  const colorGroups = [...fullColorMap.values()]
    .filter(g => g.pixels.length >= minPx)
    .sort((a,b) => (0.299*b.r+0.587*b.g+0.114*b.b)-(0.299*a.r+0.587*a.g+0.114*a.b));

  const srcFull = offscreen.getContext('2d').getImageData(0,0,state.canvasW,state.canvasH);
  colorGroups.forEach(grp => {
    const c = document.createElement('canvas');
    c.width=state.canvasW; c.height=state.canvasH;
    const imgd = c.getContext('2d').createImageData(state.canvasW,state.canvasH);
    grp.pixels.forEach(p => {
      const si=(p.y*state.canvasW+p.x)*4;
      imgd.data[si]=srcFull.data[si]; imgd.data[si+1]=srcFull.data[si+1];
      imgd.data[si+2]=srcFull.data[si+2]; imgd.data[si+3]=srcFull.data[si+3];
    });
    c.getContext('2d').putImageData(imgd,0,0);
    const cstyle = state.colorStyle || 'sparse';
    if (cstyle === 'watercolor') grp.preCanvas = _watercolorizeCanvas(c);
    else if (cstyle === 'filled') grp.preCanvas = _fillGapsCanvas(c);
    else grp.preCanvas = c;
    const rows = new Map();
    grp.pixels.forEach(p => {
      if (!rows.has(p.y)) rows.set(p.y,{minX:p.x,maxX:p.x});
      else { const r=rows.get(p.y); r.minX=Math.min(r.minX,p.x); r.maxX=Math.max(r.maxX,p.x); }
    });
    const waypoints=[]; let wdir=1;
    [...rows.entries()].sort((a,b)=>a[0]-b[0]).forEach(([y,r]) => {
      waypoints.push({x:wdir>0?r.maxX:r.minX, y}); wdir*=-1;
    });
    grp.waypoints = waypoints;
  });

  // ── 6. Canvases ──
  state.ifOutlineCanvas = document.createElement('canvas');
  state.ifOutlineCanvas.width=state.canvasW; state.ifOutlineCanvas.height=state.canvasH;
  state.ifOutlineCanvas.getContext('2d').clearRect(0,0,state.canvasW,state.canvasH);

  state.ifInkCanvas = document.createElement('canvas');
  state.ifInkCanvas.width=state.canvasW; state.ifInkCanvas.height=state.canvasH;
  state.ifInkCanvas.getContext('2d').clearRect(0,0,state.canvasW,state.canvasH);

  state.ifColorCanvas = document.createElement('canvas');
  state.ifColorCanvas.width=state.canvasW; state.ifColorCanvas.height=state.canvasH;
  state.ifColorCanvas.getContext('2d').clearRect(0,0,state.canvasW,state.canvasH);

  state.ifPhase         = 1;
  state.ifPerimPts      = perimPts;
  state.ifPerimIdx      = 0;
  state.ifLastDrawn     = 0;
  state.ifOutlineColor  = outlineColor;
  state.ifOutlineThickness = ifThickness;
  state.ifInkWaypoints  = inkWaypoints;
  state.ifInkIdx        = 0;
  state.ifInkLastDrawn  = 0;
  state.ifColorGroups   = colorGroups;
  state.ifColorIdx      = 0;
  state.ifWaypointIdx   = 0;
  state.ifRevealY       = 0;
}

function tickIllustFill(speed) {
  const handSpeed = parseInt(document.getElementById('hand-speed-slider').value);
  const cb = state.contentBounds;
  const JUMP = 8 * resScale();
  const nColors = state.ifColorGroups ? state.ifColorGroups.length : 1;
  const totalPhases = 2 + nColors;

  // ── Phase 1: outer silhouette ──
  if (state.ifPhase === 1) {
    const step = Math.max(1, handSpeed);
    const pts  = state.ifPerimPts;
    const newIdx = Math.min(state.ifPerimIdx + step, pts.length - 1);
    const oc = state.ifOutlineCanvas.getContext('2d');
    if (newIdx > state.ifLastDrawn) {
      _strokePencil(oc, pts, state.ifLastDrawn, newIdx,
        state.ifOutlineColor, state.ifOutlineThickness ?? (2.4 * resScale()),
        JUMP);
      state.ifLastDrawn = newIdx;
    }
    state.ifPerimIdx = newIdx;
    ctx.save(); fillBg(ctx);
    ctx.drawImage(state.ifOutlineCanvas,0,0); ctx.restore();
    const tip=pts[newIdx], prev=pts[Math.max(0,newIdx-1)];
    hctx.clearRect(0,0,state.canvasW,state.canvasH);
    drawHand(hctx,tip.x,tip.y,tip.x>=prev.x?1:-1,state.hand);
    setProgress((newIdx/pts.length)*(1/totalPhases));
    if (newIdx >= pts.length-1) { state.ifPhase=2; state.ifInkIdx=0; state.ifInkLastDrawn=0; }
    return;
  }

  // ── Phase 2: draw reordered ink segments at handSpeed ──
  if (state.ifPhase === 2) {
    const wps = state.ifInkWaypoints;
    if (!wps || wps.length===0) { state.ifPhase=3; state.ifColorIdx=0; state.ifRevealY=cb.y; return; }

    // Cap step so the final strokes never flash — at most 1% of waypoints per tick
    const maxStep = Math.max(1, Math.floor(wps.length * 0.01));
    const step   = Math.min(Math.max(1, handSpeed), maxStep);
    const newIdx = Math.min(state.ifInkIdx + step, wps.length - 1);
    const ic = state.ifInkCanvas.getContext('2d');

    if (newIdx > state.ifInkLastDrawn) {
      _strokePencil(ic, wps, state.ifInkLastDrawn, newIdx,
        state.ifOutlineColor, state.ifOutlineThickness ?? (1.8 * resScale()),
        JUMP);
      state.ifInkLastDrawn = newIdx;
    }
    state.ifInkIdx = newIdx;

    ctx.save(); fillBg(ctx);
    ctx.drawImage(state.ifOutlineCanvas, 0, 0);
    ctx.drawImage(state.ifInkCanvas, 0, 0);
    ctx.restore();

    const tip=wps[newIdx], prev=wps[Math.max(0,newIdx-1)];
    hctx.clearRect(0,0,state.canvasW,state.canvasH);
    drawHand(hctx,tip.x,tip.y,tip.x>=prev.x?1:-1,state.hand);
    setProgress((1/totalPhases)+(newIdx/wps.length)*(1/totalPhases));

    if (newIdx >= wps.length-1) { state.ifPhase=3; state.ifColorIdx=0; state.ifWaypointIdx=0; state.ifRevealY=cb.y; }
    return;
  }

  // ── Phase 3+: fill each color group by scanline ──
  const grpIdx = state.ifColorIdx;
  if (!state.ifColorGroups || grpIdx >= state.ifColorGroups.length) { finishAnim(); return; }
  const grp   = state.ifColorGroups[grpIdx];
  const maxY  = cb.y + cb.h;
  const advance = Math.max(1, Math.round(speed * 0.7));
  state.ifRevealY = Math.min(state.ifRevealY + advance, maxY);
  const revealH = state.ifRevealY - cb.y;
  if (revealH > 0) {
    _wcFill(state.ifColorCanvas.getContext('2d'), grp.preCanvas, cb, revealH);
  }
  ctx.save(); fillBg(ctx);
  ctx.drawImage(state.ifColorCanvas, 0, 0);
  ctx.drawImage(state.ifOutlineCanvas, 0, 0);
  ctx.drawImage(state.ifInkCanvas, 0, 0);
  ctx.restore();

  const wpts=grp.waypoints;
  if (wpts && wpts.length>0) {
    let wi=state.ifWaypointIdx;
    while (wi<wpts.length-1 && wpts[wi].y<state.ifRevealY) wi++;
    state.ifWaypointIdx=wi;
    const tip=wpts[Math.min(wi,wpts.length-1)], prev2=wpts[Math.max(0,wi-1)];
    hctx.clearRect(0,0,state.canvasW,state.canvasH);
    drawHand(hctx,tip.x,tip.y,tip.x>=prev2.x?1:-1,state.hand);
  }
  const phaseBase=(2+grpIdx)/totalPhases;
  setProgress(phaseBase+(state.ifRevealY-cb.y)/cb.h*(1/totalPhases));
  if (state.ifRevealY>=maxY) {
    state.ifColorIdx++; state.ifWaypointIdx=0; state.ifRevealY=cb.y;
    if (state.ifColorIdx>=state.ifColorGroups.length) finishAnim();
  }
}


function tickOutlineOnly(speed) {
  const handSpeed = parseInt(document.getElementById('hand-speed-slider').value);
  const JUMP = 8 * resScale();
  const drawFrame = () => {
    ctx.save(); fillBg(ctx);
    if (state.ifOutlineCanvas) ctx.drawImage(state.ifOutlineCanvas, 0, 0);
    if (state.ifInkCanvas)     ctx.drawImage(state.ifInkCanvas, 0, 0);
    ctx.restore();
  };

  // Phase 1: outer silhouette
  if (state.ifPhase === 1) {
    const step = Math.max(1, handSpeed);
    const pts  = state.ifPerimPts;
    const newIdx = Math.min(state.ifPerimIdx + step, pts.length - 1);
    const oc = state.ifOutlineCanvas.getContext('2d');
    if (newIdx > state.ifLastDrawn) {
      _strokePencil(oc, pts, state.ifLastDrawn, newIdx,
        state.ifOutlineColor, state.ifOutlineThickness ?? (2 * resScale()),
        JUMP);
      state.ifLastDrawn = newIdx;
    }
    state.ifPerimIdx = newIdx;
    drawFrame();
    const tip=pts[newIdx], prev=pts[Math.max(0,newIdx-1)];
    hctx.clearRect(0,0,state.canvasW,state.canvasH);
    drawHand(hctx,tip.x,tip.y,tip.x>=prev.x?1:-1,state.hand);
    setProgress(newIdx/pts.length * 0.5);
    if (newIdx >= pts.length-1) { state.ifPhase=2; state.ifInkIdx=0; state.ifInkLastDrawn=0; }
    return;
  }

  // Phase 2: internal ink strokes — finish with outlines only, no original image
  if (state.ifPhase === 2) {
    const wps = state.ifInkWaypoints;
    if (!wps || wps.length===0) {
      // No internal strokes — just finish with outer silhouette
      drawFrame();
      state.noFlashFinish = true;
      finishAnim();
      return;
    }

    const maxStep = Math.max(1, Math.floor(wps.length * 0.01));
    const step   = Math.min(Math.max(1, handSpeed), maxStep);
    const newIdx = Math.min(state.ifInkIdx + step, wps.length - 1);
    const ic = state.ifInkCanvas.getContext('2d');

    if (newIdx > state.ifInkLastDrawn) {
      _strokePencil(ic, wps, state.ifInkLastDrawn, newIdx,
        state.ifOutlineColor, (state.ifOutlineThickness ?? (2 * resScale())) * 0.75,
        JUMP);
      state.ifInkLastDrawn = newIdx;
    }
    state.ifInkIdx = newIdx;
    drawFrame();

    const tip=wps[newIdx], prev=wps[Math.max(0,newIdx-1)];
    hctx.clearRect(0,0,state.canvasW,state.canvasH);
    drawHand(hctx,tip.x,tip.y,tip.x>=prev.x?1:-1,state.hand);
    setProgress(0.5 + (newIdx/wps.length) * 0.5);

    if (newIdx >= wps.length-1) {
      // Final frame is outlines-only on canvas background
      drawFrame();
      state.noFlashFinish = true;
      finishAnim();
    }
    return;
  }
}


function setupNervous() {
  const cb  = state.contentBounds;
  const map = buildPresenceMap();
  const W = cb.w, H = cb.h;

  const STEP = Math.max(4, Math.round(H/70));
  const pts  = [];

  for (let ry = 0; ry < H; ry += STEP) {
    let lx = W, rx = 0;
    for (let y2 = ry; y2 < Math.min(ry+STEP,H); y2++)
      for (let x = 0; x < W; x++)
        if (map[y2*W+x]) { lx=Math.min(lx,x); rx=Math.max(rx,x); }
    if (lx > rx) continue;

    const ay     = cb.y + ry + STEP*0.4;
    const passes = 2 + Math.floor(Math.random()*2);
    let dir      = Math.random() < 0.5 ? 1 : -1;

    for (let p = 0; p < passes; p++) {
      const inset = Math.random()*12;
      const x1 = cb.x + (dir>0 ? lx+inset : rx-inset);
      const x2 = cb.x + (dir>0 ? rx-inset  : lx+inset);
      const yoff = (Math.random()-0.5)*STEP*0.5;
      const dist = Math.abs(x2-x1);

      // HIGH density: 1 pt per ~4px so hand moves visibly slowly
      const segs = Math.max(4, Math.floor(dist/4));
      for (let s = 0; s <= segs; s++) {
        const t = s/segs;
        pts.push({
          x: x1+(x2-x1)*t + (Math.random()-0.5)*3,
          y: ay + yoff + Math.sin(t*Math.PI*6)*2,
          reveal_y: ay + STEP*(p/passes)
        });
      }
      // Hesitation: 6 stationary points at end of stroke
      for (let h2 = 0; h2 < 6; h2++)
        pts.push({x: x2+(Math.random()-0.5)*2, y: ay+yoff+(Math.random()-0.5)*2, reveal_y: ay+STEP*(p/passes)});

      dir *= -1;
    }
  }

  state.strokeList = pts;
  state.strokeIdx  = 0;
}

function tickNervous(speed) {
  const pts       = state.strokeList;
  if (!pts.length) { finishAnim(); return; }
  const handSpeed = parseInt(document.getElementById('hand-speed-slider').value);

  // Hand advances by handSpeed waypoints (1 pt ≈ 4px, so handSpeed=6 → ~24px/frame)
  // Reveal advances by speed (separate concern)
  state.strokeIdx = Math.min(state.strokeIdx + handSpeed, pts.length-1);
  const idx = state.strokeIdx;
  const tip = pts[idx];

  ctx.save(); fillBg(ctx);
  const cb = state.contentBounds;
  const h  = Math.min(tip.reveal_y + 16, cb.y+cb.h) - cb.y;
  if (h > 0) ctx.drawImage(offscreen, cb.x,cb.y, cb.w,h, cb.x,cb.y, cb.w,h);
  ctx.restore();

  if (idx >= pts.length-1) { finishAnim(); return; }

  const dir = (idx>0 && pts[idx].x >= pts[idx-1].x) ? 1 : -1;
  hctx.clearRect(0,0,state.canvasW,state.canvasH);
  drawHand(hctx, tip.x, tip.y, dir, state.hand);
  setProgress(idx/pts.length);
}

// ─────────────────────────────────────────────
// ── 3. TOP ANCHOR  (FIXED)
//    Uses a revealCanvas so each column is
//    only revealed as the hand draws it —
//    nothing appears until the hand gets there.
// ─────────────────────────────────────────────
function setupTopAnchor() {
  const cb  = state.contentBounds;
  const map = buildPresenceMap();
  const W = cb.w, H = cb.h;

  const COL_W = Math.max(18, Math.round(W/28));
  const pts   = [];

  // Build column list then do a partial shuffle
  const colOrder = [];
  for (let cx = 0; cx < W; cx += COL_W) colOrder.push(cx);
  for (let i = colOrder.length-1; i > 0; i--) {
    if (Math.random() < 0.5) {
      const j = Math.max(0, i - 1 - Math.floor(Math.random()*4));
      [colOrder[i], colOrder[j]] = [colOrder[j], colOrder[i]];
    }
  }

  for (const cx of colOrder) {
    let topY = -1, botY = -1;
    for (let y = 0; y < H; y++)
      for (let x = cx; x < Math.min(cx+COL_W,W); x++)
        if (map[y*W+x]) { if(topY<0) topY=y; botY=y; }
    if (topY < 0) continue;

    const midX = cb.x + cx + COL_W*0.5 + (Math.random()-0.5)*COL_W*0.3;
    // HIGH density: 1 pt per 3px vertically
    const dist  = botY - topY;
    const steps = Math.max(4, Math.floor(dist/3));

    // Air-travel jump (isJump pts are consumed fast)
    pts.push({x:midX, y:cb.y+topY-8, isJump:true,
              revealColX:cb.x+cx, revealColW:COL_W, revealColY1:cb.y+topY, revealColY2:cb.y+botY});

    for (let r = 0; r <= steps; r++) {
      const t  = r/steps;
      const ry = topY + dist*t;
      pts.push({
        x: midX + (Math.random()-0.5)*5,
        y: cb.y + ry,
        revealColX: cb.x+cx, revealColW: COL_W,
        revealColY1: cb.y+topY, revealColY2: cb.y+ry  // only reveal up to here
      });
    }
    pts.push({x:midX, y:cb.y+botY+8, isJump:true,
              revealColX:cb.x+cx, revealColW:COL_W, revealColY1:cb.y+topY, revealColY2:cb.y+botY});
  }

  state.strokeList  = pts;
  state.strokeIdx   = 0;
  state.revealCanvas = null;
  ensureRevealCanvas();
}

function tickTopAnchor(speed) {
  const pts       = state.strokeList;
  if (!pts.length) { finishAnim(); return; }
  const handSpeed = parseInt(document.getElementById('hand-speed-slider').value);

  // Consume handSpeed drawing-points per frame; skip jump pts instantly
  let budget = handSpeed;
  while (budget > 0 && state.strokeIdx < pts.length) {
    const p = pts[state.strokeIdx];
    state.strokeIdx++;
    if (!p.isJump) budget--;

    // As each drawing pt is consumed, paint ONLY that column up to revealColY2
    if (!p.isJump && p.revealColX !== undefined) {
      const rc = state.revealCanvas.getContext('2d');
      const rh = p.revealColY2 - p.revealColY1 + 1;
      if (rh > 0)
        rc.drawImage(offscreen,
          p.revealColX, p.revealColY1, p.revealColW, rh,
          p.revealColX, p.revealColY1, p.revealColW, rh);
    }
  }

  ctx.drawImage(state.revealCanvas, 0, 0);

  if (state.strokeIdx >= pts.length) { finishAnim(); return; }

  const tip = pts[Math.min(state.strokeIdx, pts.length-1)];
  const prev = pts[Math.max(0, state.strokeIdx-1)];
  const dir = tip.isJump ? 1 : (tip.y >= prev.y ? 1 : -1);
  hctx.clearRect(0,0,state.canvasW,state.canvasH);
  drawHand(hctx, tip.x, tip.y, dir, state.hand);
  setProgress(state.strokeIdx / pts.length);
}

// ─────────────────────────────────────────────
// SHARED TILE BUILDER
// Divides content into N organic tiles, builds
// dense guaranteed-coverage zigzag waypoints
// for each tile, returns ordered tile list.
// orderFn: function(tiles, cb) → sorted tiles[]
// ─────────────────────────────────────────────
function buildTileWaypoints(numTiles, orderFn) {
  const cb  = state.contentBounds;
  const map = buildPresenceMap();
  const W = cb.w, H = cb.h;

  // Determine tile grid dimensions to approximate numTiles
  const aspect = W / H;
  const cols   = Math.max(2, Math.round(Math.sqrt(numTiles * aspect)));
  const rows   = Math.max(2, Math.round(numTiles / cols));
  const tileW  = W / cols;
  const tileH  = H / rows;

  // Build tile objects — only include tiles that have content pixels
  const tiles = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const tx = Math.floor(col * tileW);
      const ty = Math.floor(row * tileH);
      const tw = Math.ceil(tileW) + 1;
      const th = Math.ceil(tileH) + 1;
      // Check if this tile has any content
      let hasContent = false;
      outer: for (let y = ty; y < Math.min(ty+th, H); y++)
        for (let x = tx; x < Math.min(tx+tw, W); x++)
          if (map[y*W+x]) { hasContent = true; break outer; }
      if (!hasContent) continue;
      // Centroid = centre of tile (canvas coords)
      tiles.push({ col, row, tx, ty, tw, th,
        cx: cb.x + tx + tileW/2, cy: cb.y + ty + tileH/2 });
    }
  }

  // Let caller decide order
  const ordered = orderFn(tiles, cb);

  // Build dense waypoints for every tile using short zigzag strokes
  // Each stroke row is ~3px apart so brush circles (radius=strokeR) overlap
  const strokeR = Math.max(5, Math.round(Math.min(tileW, tileH) * 0.18));
  const rowStep = Math.max(3, Math.round(strokeR * 1.1));
  const pts = [];

  for (const tile of ordered) {
    const localPts = [];
    let dir = Math.random() < 0.5 ? 1 : -1;
    // Slight random rotation per tile for organic feel
    const angle = (Math.random() - 0.5) * 0.3;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);

    for (let ry = 0; ry < tile.th; ry += rowStep) {
      // Find left/right content extent for this row band inside tile
      let lx = tile.tw, rx = 0;
      for (let dy = 0; dy < rowStep; dy++) {
        const py = tile.ty + ry + dy;
        if (py >= H) continue;
        for (let x = 0; x < tile.tw; x++) {
          const px = tile.tx + x;
          if (px >= W) continue;
          if (map[py*W+px]) { lx = Math.min(lx, x); rx = Math.max(rx, x); }
        }
      }
      if (lx > rx) { dir *= -1; continue; }

      // Add slight overshoot (looks hand-drawn)
      const overshoot = strokeR * 0.4;
      const x1 = (dir > 0 ? lx - overshoot : rx + overshoot);
      const x2 = (dir > 0 ? rx + overshoot : lx - overshoot);
      const baseY = ry + rowStep * 0.5;
      const segs  = Math.max(3, Math.ceil(Math.abs(rx - lx) / Math.max(strokeR * 0.8, 3)));

      for (let s = 0; s <= segs; s++) {
        const t  = s / segs;
        const lx2 = x1 + (x2 - x1) * t;
        const ly  = baseY + Math.sin(t * Math.PI * 2) * 1.5 + (Math.random() - 0.5) * 1.5;
        // Apply slight rotation around tile centre
        const dx = lx2 - tileW/2, dy2 = ly - tileH/2;
        const rx2 = dx*cosA - dy2*sinA + tileW/2;
        const ry2 = dx*sinA + dy2*cosA + tileH/2;
        localPts.push({
          x: cb.x + tile.tx + rx2 + (Math.random()-0.5)*1.5,
          y: cb.y + tile.ty + ry2 + (Math.random()-0.5)*1.5,
          strokeR
        });
      }
      // Micro-lift between rows (pen up feel)
      if (localPts.length) localPts.push({...localPts[localPts.length-1], isLift:true});
      dir *= -1;
    }

    if (!localPts.length) continue;
    // Mark last point of tile as a jump (air travel to next tile)
    localPts[localPts.length-1] = {...localPts[localPts.length-1], isLift:false, isJump:true};
    pts.push(...localPts);
  }

  return { pts, strokeR };
}

// ─────────────────────────────────────────────
// ── 4. CHUNK JUMP
//    Tiles visited in nearest-neighbour walk
//    so hand jumps naturally between neighbours.
// ─────────────────────────────────────────────
function setupChunkJump() {
  const numTiles = parseInt(document.getElementById('tile-slider').value) || 30;

  const { pts } = buildTileWaypoints(numTiles, (tiles) => {
    // Nearest-neighbour walk from a random starting tile
    const ordered = [], rem = [...tiles];
    if (!rem.length) return ordered;
    let cur = rem.splice(Math.floor(Math.random()*rem.length), 1)[0];
    ordered.push(cur);
    while (rem.length) {
      let best = Infinity, bi = 0;
      rem.forEach((t, i) => {
        const d = Math.hypot(t.cx - cur.cx, t.cy - cur.cy);
        if (d < best) { best = d; bi = i; }
      });
      cur = rem.splice(bi, 1)[0]; ordered.push(cur);
    }
    return ordered;
  });

  state.strokeList    = pts;
  state.strokeIdx     = 0;
  state.noFlashFinish = true;
  state.revealCanvas  = null;
  ensureRevealCanvas();
  fillBg(ctx);
}

function tickChunkJump(speed) {
  const pts = state.strokeList;
  if (!pts.length) { finishAnim(); return; }
  const handSpeed = parseInt(document.getElementById('hand-speed-slider').value);
  const advance   = Math.max(1, handSpeed);
  const rc        = state.revealCanvas.getContext('2d');

  for (let i = 0; i < advance; i++) {
    if (state.strokeIdx >= pts.length) break;
    const tip = pts[state.strokeIdx++];
    if (tip.isLift || tip.isJump) continue;
    const r = tip.strokeR || 8;
    rc.save();
    rc.beginPath();
    rc.arc(tip.x, tip.y, r, 0, Math.PI*2);
    rc.clip();
    rc.drawImage(offscreen, 0, 0);
    rc.restore();
  }
  ctx.save(); fillBg(ctx); ctx.drawImage(state.revealCanvas, 0, 0); ctx.restore();

  if (state.strokeIdx >= pts.length) { finishAnim(); return; }

  const idx = Math.max(0, state.strokeIdx - 1);
  const tip = pts[idx];
  const dir = (tip.isLift||tip.isJump) ? 1 : (idx>0 && pts[idx].x >= pts[idx-1].x ? 1 : -1);
  hctx.clearRect(0,0,state.canvasW,state.canvasH);
  drawHand(hctx, tip.x, tip.y, dir, state.hand);
  setProgress(state.strokeIdx / pts.length);
}

// ─────────────────────────────────────────────
// ── 6. SCRIBBLE BUILD
//    Tiles sorted by distance from content
//    centroid — grows outward from centre.
// ─────────────────────────────────────────────
function setupScribble() {
  const numTiles = parseInt(document.getElementById('tile-slider').value) || 30;
  const cb = state.contentBounds;

  const { pts } = buildTileWaypoints(numTiles, (tiles) => {
    // Sort by distance from content centre, with slight randomness
    const cx = cb.x + cb.w/2, cy = cb.y + cb.h/2;
    return [...tiles].sort((a, b) =>
      (Math.hypot(a.cx-cx, a.cy-cy) + Math.random()*40) -
      (Math.hypot(b.cx-cx, b.cy-cy) + Math.random()*40)
    );
  });

  state.strokeList    = pts;
  state.strokeIdx     = 0;
  state.scribblePhase = 0;
  state.noFlashFinish = true;
  state.revealCanvas  = null;
  ensureRevealCanvas();
  fillBg(ctx);
}

function tickScribble(speed) {
  const pts = state.strokeList;
  if (!pts.length) { finishAnim(); return; }
  const handSpeed = parseInt(document.getElementById('hand-speed-slider').value);

  state.scribblePhase += 0.12;
  const rhythmMult = 0.6 + 0.6 * Math.abs(Math.sin(state.scribblePhase));
  const advance    = Math.max(1, Math.round(handSpeed * rhythmMult));
  const rc         = state.revealCanvas.getContext('2d');

  for (let i = 0; i < advance; i++) {
    if (state.strokeIdx >= pts.length) break;
    const tip = pts[state.strokeIdx++];
    if (tip.isLift || tip.isJump) continue;
    const r = tip.strokeR || 8;
    rc.save();
    rc.beginPath();
    rc.arc(tip.x, tip.y, r, 0, Math.PI*2);
    rc.clip();
    rc.drawImage(offscreen, 0, 0);
    rc.restore();
  }
  ctx.save(); fillBg(ctx); ctx.drawImage(state.revealCanvas, 0, 0); ctx.restore();

  if (state.strokeIdx >= pts.length) { finishAnim(); return; }

  const idx = Math.max(0, state.strokeIdx - 1);
  const tip = pts[idx];
  const dir = (tip.isLift||tip.isJump) ? 1 : (idx>0 && pts[idx].x >= pts[idx-1].x ? 1 : -1);
  hctx.clearRect(0,0,state.canvasW,state.canvasH);
  drawHand(hctx, tip.x, tip.y, dir, state.hand);
  setProgress(state.strokeIdx / pts.length);
}

// ─────────────────────────────────────────────
// ── 5. GESTURE  (FIXED)
//    Pass 1: loose diagonal sweeps that reveal
//    a blurred, low-detail version of the image
//    (simulates a rough first sketch).
//    Pass 2: tighter sweeps that reveal the full
//    sharp image — adding the "detail" layer.
// ─────────────────────────────────────────────
function setupGesture() {
  const cb  = state.contentBounds;
  const W = cb.w, H = cb.h;

  // ── Pre-render a blurred "sketch" version onto a dedicated canvas ──
  state.gestureSketchCanvas = document.createElement('canvas');
  state.gestureSketchCanvas.width  = state.canvasW;
  state.gestureSketchCanvas.height = state.canvasH;
  const sc = state.gestureSketchCanvas.getContext('2d');
  // Start transparent — draw only the blurred sketch of the current layer
  sc.clearRect(0,0,state.canvasW,state.canvasH);
  // Draw source at reduced opacity + heavy blur = rough sketch feel
  sc.filter = 'blur(6px) saturate(0.3) contrast(0.7)';
  sc.globalAlpha = 0.72;
  sc.drawImage(offscreen, 0, 0);
  sc.filter = 'none';
  sc.globalAlpha = 1;

  function buildSweeps(slopeMag, spacing, densityPx, pass) {
    const pts = [];
    const sweepDefs = [
      {slope:  slopeMag, dir:  1},
      {slope: -slopeMag, dir: -1},
    ];
    for (const def of sweepDefs) {
      for (let offset = -H; offset < H + W*Math.abs(def.slope) + H; offset += spacing) {
        let sx1, sy1, sx2, sy2;
        if (def.dir === 1) {
          sx1=cb.x;   sy1=cb.y+offset;
          sx2=cb.x+W; sy2=cb.y+offset+W*def.slope;
        } else {
          sx1=cb.x+W; sy1=cb.y+offset;
          sx2=cb.x;   sy2=cb.y+offset+W*Math.abs(def.slope);
        }
        const minY=cb.y, maxY=cb.y+H;
        if (Math.max(sy1,sy2)<minY || Math.min(sy1,sy2)>maxY) continue;
        const lineLen = Math.hypot(sx2-sx1, sy2-sy1);
        const segs    = Math.max(6, Math.floor(lineLen/densityPx));
        const goFwd   = (Math.random()<0.5);
        for (let s=0; s<=segs; s++) {
          const t  = goFwd ? s/segs : 1-s/segs;
          const rx = sx1+(sx2-sx1)*t;
          const ry = sy1+(sy2-sy1)*t + (Math.random()-0.5)*4;
          const cx2 = Math.max(cb.x, Math.min(cb.x+W-1, rx));
          const cy2 = Math.max(cb.y, Math.min(cb.y+H-1, ry));
          pts.push({ x:cx2, y:cy2, revealY: Math.max(minY, Math.min(maxY, ry)), pass });
        }
        pts.push({ x: Math.max(cb.x,Math.min(cb.x+W-1,goFwd?sx2:sx1)),
                   y: Math.max(cb.y,Math.min(cb.y+H-1,goFwd?sy2:sy1)),
                   isJump:true, revealY: Math.max(sy1,sy2), pass });
      }
    }
    return pts;
  }

  // Pass 1: wide sparse sweeps → blurry image; Pass 2: tighter denser sweeps → full image
  const pass1 = buildSweeps(0.45, H/10, 6, 1);
  const pass2 = buildSweeps(0.25, H/22, 5, 2);

  state.strokeList       = [...pass1, ...pass2];
  state.gesturePass1End  = pass1.length;   // index where pass 2 starts
  state.strokeIdx        = 0;
  state.gestureRevealY   = cb.y;
  state.revealCanvas     = null;
  ensureRevealCanvas();
}

function tickGesture(speed) {
  const pts       = state.strokeList;
  if (!pts.length) { finishAnim(); return; }
  const handSpeed = parseInt(document.getElementById('hand-speed-slider').value);

  let budget = handSpeed;
  while (budget > 0 && state.strokeIdx < pts.length) {
    const p = pts[state.strokeIdx];
    state.strokeIdx++;
    if (p.isJump) continue;
    budget--;

    const rc  = state.revealCanvas.getContext('2d');
    const cb  = state.contentBounds;
    const src = (p.pass === 1) ? state.gestureSketchCanvas : offscreen;
    if (p.revealY !== undefined) {
      const bandY = Math.max(cb.y, p.revealY - 12);
      const bandH = 26;
      rc.drawImage(src, cb.x, bandY, cb.w, bandH, cb.x, bandY, cb.w, bandH);
    }
  }

  ctx.drawImage(state.revealCanvas, 0, 0);

  if (state.strokeIdx >= pts.length) { finishAnim(); return; }

  const tip  = pts[Math.min(state.strokeIdx, pts.length-1)];
  const prev = pts[Math.max(0, state.strokeIdx-1)];
  const dir  = tip.isJump ? 1 : (tip.x >= prev.x ? 1 : -1);
  hctx.clearRect(0,0,state.canvasW,state.canvasH);
  drawHand(hctx, tip.x, tip.y, dir, state.hand);
  setProgress(state.strokeIdx/pts.length);
}

// ─────────────────────────────────────────────
// ── 7. SPECIALIZED STYLES
//    Each style uses buildTileWaypoints with a
//    custom ordering function that mimics the
//    natural drawing order for that subject.
// ─────────────────────────────────────────────

// Scoring helpers — return a sort key per tile
// so tiles are visited in subject-aware order.
const SPECIALIZED_ORDERS = {

  // ── HUMAN: top-down, slight centre-gravity per band
  // Head (top 20%) → neck/shoulders (20-35%) → torso (35-65%)
  // → hips (65-75%) → legs (75-90%) → feet (90-100%)
  human(tiles, cb) {
    const H = cb.h;
    // Band weights: earlier bands = lower score = drawn first
    function bandScore(normY) {
      if (normY < 0.20) return normY * 1.0;                    // head
      if (normY < 0.35) return 0.20 + (normY-0.20) * 1.2;    // shoulders
      if (normY < 0.65) return 0.38 + (normY-0.35) * 1.0;    // torso
      if (normY < 0.75) return 0.68 + (normY-0.65) * 1.0;    // hips
      return 0.78 + (normY-0.75) * 1.0;                       // legs/feet
    }
    return [...tiles].sort((a, b) => {
      const ay = (a.cy - cb.y) / H, by = (b.cy - cb.y) / H;
      // Within same band, prefer centre-x (spine first)
      const aCx = Math.abs((a.cx - cb.x) / cb.w - 0.5) * 0.08;
      const bCx = Math.abs((b.cx - cb.x) / cb.w - 0.5) * 0.08;
      return (bandScore(ay) + aCx + Math.random()*0.03) -
             (bandScore(by) + bCx + Math.random()*0.03);
    });
  },

  // ── ANIMAL: left-to-right sweep (head-side first)
  // Primary sort: X position (head = left)
  // Secondary:    vertical centre — body before legs, then legs
  animal(tiles, cb) {
    const W = cb.w, H = cb.h;
    return [...tiles].sort((a, b) => {
      const ax = (a.cx - cb.x) / W;
      const bx = (b.cx - cb.x) / W;
      // Within same column, torso (middle third vertically) before legs
      const ayNorm = (a.cy - cb.y) / H;
      const byNorm = (b.cy - cb.y) / H;
      const aBody  = Math.abs(ayNorm - 0.45) * 0.18;
      const bBody  = Math.abs(byNorm - 0.45) * 0.18;
      return (ax + aBody + Math.random()*0.04) -
             (bx + bBody + Math.random()*0.04);
    });
  },

  // ── VEHICLE: front-to-rear horizontally, then bottom-up for chassis
  // Pass 1: upper body left→right (cab, windows, body panels)
  // Pass 2: lower strip bottom-up (wheels, undercarriage)
  vehicle(tiles, cb) {
    const W = cb.w, H = cb.h;
    return [...tiles].sort((a, b) => {
      const ax = (a.cx - cb.x) / W;
      const bx = (b.cx - cb.x) / W;
      const ayNorm = (a.cy - cb.y) / H;
      const byNorm = (b.cy - cb.y) / H;
      // Bottom 25% (wheels) drawn after top body
      const aPhase = ayNorm > 0.75 ? 1 + (1 - ax)*0.3 : ax;
      const bPhase = byNorm > 0.75 ? 1 + (1 - bx)*0.3 : bx;
      return (aPhase + Math.random()*0.04) - (bPhase + Math.random()*0.04);
    });
  },

  // ── BUILDING: bottom-up, column by column
  // Ground floor → walls → windows → roof
  // Within each floor, left-to-right
  building(tiles, cb) {
    const W = cb.w, H = cb.h;
    return [...tiles].sort((a, b) => {
      // Invert Y so bottom tiles score lower (drawn first)
      const ay = 1 - (a.cy - cb.y) / H;
      const by = 1 - (b.cy - cb.y) / H;
      const ax = (a.cx - cb.x) / W * 0.12;
      const bx = (b.cx - cb.x) / W * 0.12;
      return (ay + ax + Math.random()*0.04) - (by + bx + Math.random()*0.04);
    });
  },

  // ── NATURE: outer silhouette inward spiral
  // Tiles sorted by distance from the outermost ring inward.
  // Uses max-of-normalised-distances-from-all-four-edges as
  // "how close to the edge" — edge tiles drawn first, core last.
  nature(tiles, cb) {
    const W = cb.w, H = cb.h;
    return [...tiles].sort((a, b) => {
      const ax = (a.cx - cb.x) / W, ay = (a.cy - cb.y) / H;
      const bx = (b.cx - cb.x) / W, by = (b.cy - cb.y) / H;
      // Distance from nearest edge (0 = on edge, 0.5 = dead centre)
      const aDist = Math.min(ax, 1-ax, ay, 1-ay);
      const bDist = Math.min(bx, 1-bx, by, 1-by);
      // Add slight clockwise spiral bias
      const aAngle = Math.atan2(ay - 0.5, ax - 0.5) / (Math.PI*2) * 0.04;
      const bAngle = Math.atan2(by - 0.5, bx - 0.5) / (Math.PI*2) * 0.04;
      return (aDist + aAngle + Math.random()*0.03) -
             (bDist + bAngle + Math.random()*0.03);
    });
  },

  // ── PORTRAIT: face centre first (eye-level), then outward rings
  // Focus point slightly above centre (eyes/nose region)
  portrait(tiles, cb) {
    const W = cb.w, H = cb.h;
    const fx = cb.x + W * 0.50;   // face centre X
    const fy = cb.y + H * 0.38;   // eye-level focus point
    return [...tiles].sort((a, b) => {
      // Stretch Y so rings are oval (face aspect)
      const da = Math.hypot((a.cx - fx), (a.cy - fy) * 1.25);
      const db = Math.hypot((b.cx - fx), (b.cy - fy) * 1.25);
      return (da + Math.random() * 18) - (db + Math.random() * 18);
    });
  },

  // ── LANDSCAPE: sky-to-ground in depth bands, pan L→R per band
  landscape(tiles, cb) {
    const W = cb.w, H = cb.h;
    const ZONES = 4;
    return [...tiles].sort((a, b) => {
      const zA = Math.floor(((a.cy - cb.y) / H) * ZONES);
      const zB = Math.floor(((b.cy - cb.y) / H) * ZONES);
      if (zA !== zB) return zA - zB;
      // Within zone: pan left-to-right like a camera sweep
      return ((a.cx - cb.x) / W) - ((b.cx - cb.x) / W) + (Math.random() - 0.5) * 0.12;
    });
  },

  // ── SPIRAL: true Archimedean spiral outward from centre
  // Angle increases while radius grows — clean spiral path
  spiral(tiles, cb) {
    const cx = cb.x + cb.w / 2, cy = cb.y + cb.h / 2;
    const maxR = Math.hypot(cb.w / 2, cb.h / 2);
    return [...tiles].sort((a, b) => {
      const ra = Math.hypot(a.cx - cx, a.cy - cy);
      const rb = Math.hypot(b.cx - cx, b.cy - cy);
      const aa = ((Math.atan2(a.cy - cy, a.cx - cx) + Math.PI * 2) % (Math.PI * 2));
      const ab = ((Math.atan2(b.cy - cy, b.cx - cx) + Math.PI * 2) % (Math.PI * 2));
      // Score = radial ring number (coarse) + angular position within ring
      const sa = (ra / maxR) + aa / (Math.PI * 2) * 0.6;
      const sb = (rb / maxR) + ab / (Math.PI * 2) * 0.6;
      return sa - sb;
    });
  },

  // ── EXPLODE: outer edges first, converging to centre
  // All four edges start simultaneously and meet in the middle
  explode(tiles, cb) {
    const cx = cb.x + cb.w / 2, cy = cb.y + cb.h / 2;
    return [...tiles].sort((a, b) => {
      const da = Math.hypot(a.cx - cx, a.cy - cy);
      const db = Math.hypot(b.cx - cx, b.cy - cy);
      // Farthest first — converges inward
      return (db + Math.random() * 22) - (da + Math.random() * 22);
    });
  },
};

function setupSpecialized(kind) {
  const numTiles = parseInt(document.getElementById('spec-tile-slider').value) || 35;
  const cb       = state.contentBounds;
  const orderFn  = SPECIALIZED_ORDERS[kind];

  const { pts } = buildTileWaypoints(numTiles, (tiles) => orderFn(tiles, cb));

  state.strokeList    = pts;
  state.strokeIdx     = 0;
  state.scribblePhase = 0;
  state.noFlashFinish = true;
  state.revealCanvas  = null;
  ensureRevealCanvas();
  fillBg(ctx);
}

function tickSpecialized(speed) {
  const pts = state.strokeList;
  if (!pts.length) { finishAnim(); return; }
  const handSpeed = parseInt(document.getElementById('hand-speed-slider').value);

  state.scribblePhase = (state.scribblePhase || 0) + 0.1;
  const rhythmMult = 0.7 + 0.5 * Math.abs(Math.sin(state.scribblePhase));
  const advance    = Math.max(1, Math.round(handSpeed * rhythmMult));
  const rc         = state.revealCanvas.getContext('2d');

  for (let i = 0; i < advance; i++) {
    if (state.strokeIdx >= pts.length) break;
    const tip = pts[state.strokeIdx++];
    if (tip.isLift || tip.isJump) continue;
    const r = tip.strokeR || 8;
    rc.save();
    rc.beginPath();
    rc.arc(tip.x, tip.y, r, 0, Math.PI*2);
    rc.clip();
    rc.drawImage(offscreen, 0, 0);
    rc.restore();
  }
  ctx.save(); fillBg(ctx); ctx.drawImage(state.revealCanvas, 0, 0); ctx.restore();

  if (state.strokeIdx >= pts.length) { finishAnim(); return; }

  const idx = Math.max(0, state.strokeIdx - 1);
  const tip = pts[idx];
  const dir = (tip.isLift||tip.isJump) ? 1 : (idx>0 && pts[idx].x >= pts[idx-1].x ? 1 : -1);
  hctx.clearRect(0,0,state.canvasW,state.canvasH);
  drawHand(hctx, tip.x, tip.y, dir, state.hand);
  setProgress(state.strokeIdx / pts.length);
}

// ─── 7. ANIMATION CORE
// ─── PARALLEL-SLOT ANIMATION SYSTEM ───────────────────────────────────────────
//
// Layers with the same animOrder number animate simultaneously.
// Each simultaneous layer gets its own "slot": an isolated offscreen canvas + a
// copy of all the per-animation state variables.  Every rAF tick swaps state in,
// ticks the style, swaps back, then composites all slot canvases to _mainCtx.
//
// ──────────────────────────────────────────────────────────────────────────────

// All state keys that are unique per animation slot (not shared globals)
const _SLOT_KEYS = [
  'curX','curY','scanDir',
  'strokeList','strokeIdx','scribblePhase',
  'contourPhase','contourEdgePts','contourFillPts','contourEdgeIdx','contourFillIdx',
  'edgeCanvas','contourEdgeColors','revealCanvas',
  'ofOutlineCanvas','ofColorCanvas','ofPhase','ofPerimPts','ofPerimIdx','ofLastDrawn',
  'ofOutlineColor','ofOutlineThickness','ofColorGroups','ofColorIdx','ofWaypointIdx','ofRevealY',
  'ifOutlineCanvas','ifColorCanvas','ifInkCanvas',
  'ifPhase','ifPerimPts','ifPerimIdx','ifLastDrawn',
  'ifInkIdx','ifInkLastDrawn','ifInkWaypoints','ifInternalIdx','ifInternalLast',
  'ifColorGroups','ifColorIdx','ifWaypointIdx','ifRevealY','ifOutlineColor','ifOutlineThickness',
  'noFlashFinish','contentBounds','animStyle','hand','zigzag','textAnimDir','textDrawStyle','outlineDetect','outlineAlgorithm','outlineStrokeStyle',
  'stPhase','stOutlineCanvas','stOutlinePts','stOutlineIdx','stOutlineLastDrawn',
  'stFillPts','stOutlineColor','stOutlineThickness',
];

// Swap slot state → global state (+ swap ctx/offscreen)
function _slotIn(slot) {
  _SLOT_KEYS.forEach(k => { slot._saved[k] = state[k]; state[k] = slot._state[k]; });
  slot._savedOffscreen = offscreen;
  offscreen = slot.offscreen;
  ctx = slot.ctx;
  state._currentSlot = slot;
  state._slotMode    = true;
}

// Swap global state → slot state (+ restore ctx/offscreen)
function _slotOut(slot) {
  _SLOT_KEYS.forEach(k => { slot._state[k] = state[k]; state[k] = slot._saved[k]; });
  slot.offscreen        = offscreen;
  offscreen             = slot._savedOffscreen;
  ctx                   = _mainCtx;
  state._currentSlot    = null;
  state._slotMode       = false;
}

// Dispatch one tick for a single slot
function _tickSlot(slot) {
  const speed = slot.layer.speed ?? parseInt(document.getElementById('speed-slider').value);
  // Temporarily push this layer's slider values so tick fns read correct values
  const _push = (id, v) => { const e=document.getElementById(id); if(e) e.value=v; };
  _push('speed-slider',      slot.layer.speed      ?? 40);
  _push('hand-speed-slider', slot.layer.handSpeed  ?? 6);
  _push('tile-slider',       slot.layer.chunks     ?? 30);
  _push('spec-tile-slider',  slot.layer.specChunks ?? 35);

  switch (state.animStyle) {
    case 'contour':       tickContour(speed);       break;
    case 'outlinechunks': tickOutlineChunks(speed); break;
    case 'outlinefill':   tickOutlineFill(speed);   break;
    case 'illustfill':    tickIllustFill(speed);    break;
    case 'outlineonly':   tickOutlineOnly(speed);   break;
    case 'chunkjump':     tickChunkJump(speed);     break;
    case 'scribble':      tickScribble(speed);      break;
    case 'spec-text':         tickSpecText(speed);    break;
    case 'spec-human': case 'spec-animal': case 'spec-portrait':
    case 'spec-vehicle': case 'spec-building': case 'spec-landscape':
    case 'spec-spiral': case 'spec-nature':
                          tickSpecialized(speed); break;
    default:              tickScanner(speed);       break;
  }
}

// Tick ALL active slots, then composite to _mainCtx
function _tickAllSlots() {
  if (!state._activeSlots || !state._activeSlots.length) return;

  // Suppress hctx.clearRect so each slot adds its hand without wiping previous ones
  hctx.clearRect(0, 0, state.canvasW, state.canvasH);
  const _origClear = hctx.clearRect.bind(hctx);
  hctx.clearRect = () => {};

  state._activeSlots.forEach(slot => {
    if (slot.done) return;
    _slotIn(slot);
    _tickSlot(slot);
    _slotOut(slot);
  });

  hctx.clearRect = _origClear; // restore

  // Check if every slot in this group has finished
  if (state._activeSlots.every(s => s.done)) {
    state.playing = false;
    // Final composite: bgCanvas (has all baked layers) onto _mainCtx
    _mainCtx.save();
    state._slotMode = false;
    fillBg(_mainCtx);
    // Re-draw above-baked layers so they don't flash invisible during the
    // 200ms gap between groups (same logic as the live-tick composite below).
    if (state._animGroups && state._animGroups.length > 1) {
      const gpos = state._groupPos ?? 0;
      const currentMaxIdx = Math.max(
        ...state._animGroups[gpos].map(l => state.layers.indexOf(l))
      );
      const aboveBaked = [];
      for (let g = 0; g < gpos; g++) {
        state._animGroups[g].forEach(layer => {
          if (layer.visible === false) return;
          if (state.layers.indexOf(layer) > currentMaxIdx) aboveBaked.push(layer);
        });
      }
      aboveBaked.sort((a, b) => state.layers.indexOf(a) - state.layers.indexOf(b));
      aboveBaked.forEach(layer => {
        _mainCtx.save();
        _mainCtx.globalAlpha = layer.opacity ?? 1;
        _mainCtx.drawImage(layer.img, layer.x, layer.y, layer.w, layer.h);
        _mainCtx.restore();
      });
    }
    _mainCtx.restore();

    const nextGroup = (state._groupPos ?? 0) + 1;
    if (nextGroup < (state._animGroups || []).length) {
      setTimeout(() => _runGroupAt(nextGroup), 200);
    } else {
      _allLayersDone();
    }
    return;
  }

  // Composite: background + bgCanvas + each slot's drawn canvas
  _mainCtx.save();
  state._slotMode = false;
  fillBg(_mainCtx); // draws bg gradient + bgCanvas (already-completed layers)
  state._activeSlots.forEach(slot => _mainCtx.drawImage(slot.canvas, 0, 0));

  // Z-order fix: already-baked layers that are visually ABOVE the current group
  // (higher state.layers index) get covered by opaque pixels during the current
  // group's animation. Re-draw them on top each tick so the correct visual order
  // is maintained throughout the animation, not just at the end.
  if (state._animGroups && state._animGroups.length > 1) {
    const gpos = state._groupPos ?? 0;
    const currentMaxIdx = Math.max(
      ...state._animGroups[gpos].map(l => state.layers.indexOf(l))
    );
    const aboveBaked = [];
    for (let g = 0; g < gpos; g++) {
      state._animGroups[g].forEach(layer => {
        if (layer.visible === false) return;
        if (state.layers.indexOf(layer) > currentMaxIdx) aboveBaked.push(layer);
      });
    }
    aboveBaked.sort((a, b) => state.layers.indexOf(a) - state.layers.indexOf(b));
    aboveBaked.forEach(layer => {
      _mainCtx.save();
      _mainCtx.globalAlpha = layer.opacity ?? 1;
      _mainCtx.drawImage(layer.img, layer.x, layer.y, layer.w, layer.h);
      _mainCtx.restore();
    });
  }



  // Live reveal blend: start fading in the final image during the last ~35% of animation
  if (state._revealFinalCanvas) {
    const prog = state._animProgress || 0;
    const THRESHOLD = 0.65; // start blending at 65% progress
    if (prog > THRESHOLD) {
      const rawT = (prog - THRESHOLD) / (1 - THRESHOLD); // 0→1 over last 35%
      const ease = rawT < 0.5 ? 2*rawT*rawT : -1+(4-2*rawT)*rawT;
      const fc = state._revealFinalCanvas;
      const W = state.canvasW, H = state.canvasH;

      if (_revealStyle === 'fade' || _revealStyle === 'instant') {
        _mainCtx.globalAlpha = ease;
        _mainCtx.drawImage(fc, 0, 0);
        _mainCtx.globalAlpha = 1;

      } else if (_revealStyle === 'dissolve') {
        if (!state._dissolveMap) {
          state._dissolveMap = new Float32Array(W * H);
          for (let i = 0; i < state._dissolveMap.length; i++) state._dissolveMap[i] = Math.random();
        }
        const imgData = _mainCtx.getImageData(0, 0, W, H);
        const raw = imgData.data;
        const tmp2 = document.createElement('canvas'); tmp2.width=W; tmp2.height=H;
        const tc2 = tmp2.getContext('2d'); tc2.drawImage(fc, 0, 0);
        const tData = tc2.getImageData(0, 0, W, H).data;
        for (let i = 0; i < state._dissolveMap.length; i++) {
          if (state._dissolveMap[i] < ease) {
            const p = i*4;
            raw[p]=tData[p]; raw[p+1]=tData[p+1]; raw[p+2]=tData[p+2]; raw[p+3]=tData[p+3];
          }
        }
        _mainCtx.putImageData(imgData, 0, 0);

      } else if (_revealStyle === 'wipe-right') {
        const wipeX = Math.round(ease * W);
        _mainCtx.save();
        _mainCtx.beginPath(); _mainCtx.rect(0, 0, wipeX, H); _mainCtx.clip();
        _mainCtx.drawImage(fc, 0, 0);
        _mainCtx.restore();
        const grd = _mainCtx.createLinearGradient(wipeX-14, 0, wipeX+14, 0);
        grd.addColorStop(0,'rgba(255,255,255,0)'); grd.addColorStop(0.5,'rgba(255,255,255,0.22)'); grd.addColorStop(1,'rgba(255,255,255,0)');
        _mainCtx.fillStyle=grd; _mainCtx.fillRect(wipeX-14, 0, 28, H);

      } else if (_revealStyle === 'iris') {
        const cx2=W/2, cy2=H/2;
        const r = ease * Math.sqrt(cx2*cx2+cy2*cy2) * 1.06;
        _mainCtx.save();
        _mainCtx.beginPath(); _mainCtx.arc(cx2, cy2, r, 0, Math.PI*2); _mainCtx.clip();
        _mainCtx.drawImage(fc, 0, 0);
        _mainCtx.restore();

      } else if (_revealStyle === 'scan-lines') {
        const SLATS = 18, slatH = H / SLATS;
        for (let s = 0; s < SLATS; s++) {
          const offset = (s / SLATS) * 0.35;
          const localT = Math.min(Math.max((ease - offset) / (1 - 0.35), 0), 1);
          const se = localT < 0.5 ? 2*localT*localT : -1+(4-2*localT)*localT;
          const revealW = se * W; if (revealW <= 0) continue;
          _mainCtx.save();
          const sx = (s%2===0) ? 0 : W-revealW;
          _mainCtx.beginPath(); _mainCtx.rect(sx, s*slatH, revealW, slatH+1); _mainCtx.clip();
          _mainCtx.drawImage(fc, 0, 0);
          _mainCtx.restore();
        }
      }
    }
  }
  _mainCtx.restore();
}

// Build a fresh bgCanvas for the start of a group (background + all prev-group layers)
function _buildGroupBgCanvas(gpos) {
  const bg = document.createElement('canvas');
  bg.width = state.canvasW; bg.height = state.canvasH;
  const bc = bg.getContext('2d');
  // Draw the scene background (without any bgCanvas reference — avoids self-draw)
  const _tmpBg = state.bgCanvas; state.bgCanvas = null;
  fillBg(bc);
  state.bgCanvas = _tmpBg;
  return bg;
}

function getAnimOrder() {
  const visible    = state.layers.filter(l => l.visible !== false);
  const ordered    = visible.filter(l=>l.animOrder!==null).sort((a,b)=>a.animOrder-b.animOrder);
  const unordered  = visible.filter(l=>l.animOrder===null);
  return [...ordered, ...unordered];
}

function generate() {
  if (state.layers.length === 0) { alert('Please upload at least one image first.'); return; }
  state.bgCanvas       = null;
  state._activeSlots   = [];
  state._currentSlot   = null;
  state._slotMode      = false;
  state._revealFinalCanvas = null;
  state._dissolveMap   = null;
  state._animProgress  = 0;
  ctx = _mainCtx;

  // Build ordered list then group by animOrder (same number → run simultaneously)
  const allOrdered = getAnimOrder();
  state._animQueue = allOrdered; // flat list (backward compat)
  state._queuePos  = 0;

  const groupMap = new Map();
  allOrdered.forEach(layer => {
    const key = layer.animOrder ?? `__${layer.id}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(layer);
  });
  state._animGroups = [...groupMap.values()];
  state._groupPos   = 0;

  _runGroupAt(0);
}

function _runGroupAt(gpos) {
  if (!state._animGroups || gpos >= state._animGroups.length) { _allLayersDone(); return; }
  state._groupPos = gpos;
  const group     = state._animGroups[gpos];

  // Pre-build the final image canvas for live reveal blending
  const _imageRevealOn = document.getElementById('image-reveal')?.checked !== false;
  const groupHasOutline = group.some(l => {
    const s = l.animStyle || state.animStyle;
    return s === 'illustfill' || s === 'outlinefill';
  });
  if (_imageRevealOn && groupHasOutline && _revealStyle !== 'instant') {
    const fc = document.createElement('canvas');
    fc.width = state.canvasW; fc.height = state.canvasH;
    const fctx = fc.getContext('2d');
    // Draw all layers that will be visible at end (bg + current group layers that have reveal on)
    const _tmpBg = state.bgCanvas; state.bgCanvas = null;
    fillBg(fctx);
    state.bgCanvas = _tmpBg;
    if (state.bgCanvas) fctx.drawImage(state.bgCanvas, 0, 0);
    group.forEach(l => {
      if (l.visible === false) return;
      fctx.save();
      fctx.globalAlpha = l.opacity ?? 1;
      fctx.drawImage(l.img, l.x, l.y, l.w, l.h);
      fctx.restore();
    });
    state._revealFinalCanvas = fc;
  } else {
    state._revealFinalCanvas = null;
  }

  // bgCanvas at this point already has all groups before gpos baked in (by finishAnim).
  // For group 0 it is null, so we build a fresh one.
  if (!state.bgCanvas) state.bgCanvas = _buildGroupBgCanvas(gpos);
  const sharedBg = state.bgCanvas;

  // Build a slot for every layer in this group
  state._activeSlots = group.map(layer => {
    const sc = document.createElement('canvas');
    sc.width  = state.canvasW;
    sc.height = state.canvasH;
    const slot = {
      layer,
      canvas: sc,
      ctx:    sc.getContext('2d'),
      offscreen: null,
      done:  false,
      _state: {},
      _saved: {},
    };
    // Seed slot state from current globals, then apply layer overrides
    _SLOT_KEYS.forEach(k => slot._state[k] = state[k]);
    slot._state.animStyle   = layer.animStyle;  // always set — inherited from state at addLayer time
    slot._state.hand        = layer.hand      || state.hand;
    slot._state.zigzag      = layer.zigzag    ?? state.zigzag;
    slot._state.textAnimDir  = layer.textAnimDir  || state.textAnimDir  || 'ltr';
    slot._state.textDrawStyle= layer.textDrawStyle|| state.textDrawStyle|| 'reveal';
    slot._state.outlineDetect   = layer.outlineDetect   ?? state.outlineDetect   ?? 50;
    slot._state.outlineAlgorithm= layer.outlineAlgorithm|| state.outlineAlgorithm|| 'classic';
    slot._state.outlineStrokeStyle = layer.outlineStrokeStyle || state.outlineStrokeStyle || 'default';
    return slot;
  });

  // Pre-render and setup each slot individually
  state._activeSlots.forEach(slot => {
    const _prevStyle = state.animStyle;
    state.animStyle  = slot._state.animStyle;
    state.activeLayerIndex = state.layers.indexOf(slot.layer);

    preRender(sharedBg); // writes offscreen + state.contentBounds
    slot.offscreen         = offscreen;
    slot._state.contentBounds = { ...state.contentBounds };
    state.animStyle = _prevStyle;

    // Push layer-specific slider values, setup the animation style in slot context
    _slotIn(slot);
    // resetAnim clears all tick state — good starting point
    cancelAnimationFrame(state.animFrame);
    state.playing = false; state.done = false;
    state.revealCanvas = null; state.edgeCanvas = null;
    state.ofOutlineCanvas = null; state.ofColorCanvas = null;
    state.ofPhase=1; state.ofPerimIdx=0; state.ofFillIdx=0; state.ofLastDrawn=0;
    state.ofColorGroups=null; state.ofColorIdx=0; state.ofWaypointIdx=0; state.ofRevealY=0;
    state.ifOutlineCanvas=null; state.ifColorCanvas=null; state.ifInkCanvas=null;
    state.ifPhase=1; state.ifPerimIdx=0; state.ifLastDrawn=0;
    state.ifInkIdx=0; state.ifInkLastDrawn=0; state.ifInkWaypoints=null;
    state.ifInternalIdx=0; state.ifInternalLast=0;
    state.ifColorGroups=null; state.ifColorIdx=0; state.ifWaypointIdx=0; state.ifRevealY=0;
    state.scribblePhase=0; state.contourPhase=1;
    state.noFlashFinish=false;
    state.stPhase=1; state.stOutlineCanvas=null; state.stOutlinePts=null;
    state.stOutlineIdx=0; state.stOutlineLastDrawn=0; state.stFillPts=null;
    state.curX=0; state.curY=0; state.scanDir=1; state.strokeList=[]; state.strokeIdx=0;

    // Push layer slider values so setupStyle reads them correctly
    const _setSlider = (id, valId, val) => {
      const el = document.getElementById(id);
      if (el) { el.value = val; document.getElementById(valId).textContent = val; }
    };
    _setSlider('speed-slider',      'speed-val',      slot.layer.speed      ?? 40);
    _setSlider('hand-speed-slider', 'hand-speed-val', slot.layer.handSpeed  ?? 6);
    _setSlider('tile-slider',       'tile-val',       slot.layer.chunks     ?? 30);
    _setSlider('spec-tile-slider',  'spec-tile-val',  slot.layer.specChunks ?? 35);

    // Push per-layer stroke style so setup functions read it correctly
    state.outlineStrokeStyle = slot.layer.outlineStrokeStyle || state.outlineStrokeStyle || 'default';

    setupStyle(); // writes all the tick-state into state.* from offscreen
    _slotOut(slot);
  });

  // Restore offscreen to something valid for legacy checks
  offscreen = state._activeSlots[state._activeSlots.length - 1]?.offscreen ?? offscreen;

  sctx.clearRect(0, 0, state.canvasW, state.canvasH);
  document.getElementById('play-pause-btn').disabled = false;
  document.getElementById('done-badge').classList.remove('show');
  setProgress(0);
  startAnim();
}

function _allLayersDone() {
  state._activeSlots  = [];
  state._currentSlot  = null;
  state._slotMode     = false;
  ctx = _mainCtx;

  const _imageRevealOn = document.getElementById('image-reveal')?.checked !== false;
  const anyOutline = (state._animGroups || []).flat().some(l => {
    const s = l.animStyle || state.animStyle;
    return s === 'illustfill' || s === 'outlinefill' || s === 'outlineonly';
  });
  const anyOutlineNoReveal = (state._animGroups || []).flat().some(l => {
    const s   = l.animStyle || state.animStyle;
    const sty = l.textDrawStyle || state.textDrawStyle || 'reveal';
    return s === 'outlineonly' || (s === 'spec-text' && sty !== 'reveal') ||
           ((s === 'illustfill' || s === 'outlinefill') && !_imageRevealOn);
  });

  const shouldReveal = _imageRevealOn && anyOutline && _revealStyle !== 'instant';

  function _snap() {
    if (anyOutlineNoReveal) {
      if (state.bgCanvas) {
        const _tmpBg = state.bgCanvas; state.bgCanvas = null;
        fillBg(_mainCtx);
        state.bgCanvas = _tmpBg;
        _mainCtx.drawImage(state.bgCanvas, 0, 0);
      }
    } else {
      state.bgCanvas = null;
      redrawLayersOnCanvas();
    }
    state.bgCanvas = null;
    state._revealFinalCanvas = null;
    hctx.clearRect(0, 0, state.canvasW, state.canvasH);
    state.done = true; state.playing = false; updatePlayIcons();
    setProgress(1);
    document.getElementById('done-badge').classList.add('show');
    drawSelectionHandles();
  }

  // If the live blend already ran (progress reached 1), just snap to final cleanly.
  // Otherwise run a short catch-up fade for the remaining gap.
  if (shouldReveal && state._revealFinalCanvas) {
    // Capture whatever is on screen right now as the "art" starting point
    const artSnap = document.createElement('canvas');
    artSnap.width = state.canvasW; artSnap.height = state.canvasH;
    artSnap.getContext('2d').drawImage(_mainCtx.canvas, 0, 0);

    const prog = state._animProgress || 1;
    const remaining = Math.max(0, 1 - prog); // fraction left to blend
    const THRESHOLD = 0.65;
    const rawDone = (prog - THRESHOLD) / (1 - THRESHOLD);
    const startAlpha = rawDone < 0 ? 0 : (rawDone < 0.5 ? 2*rawDone*rawDone : -1+(4-2*rawDone)*rawDone);

    if (startAlpha >= 0.98) {
      // Already nearly fully blended — just snap
      _snap();
      return;
    }

    // Short fade for the remaining gap
    const dur = parseFloat(document.getElementById('reveal-duration-slider')?.value ?? 1.2) * (1 - startAlpha) * 600;
    const finalCanvas = state._revealFinalCanvas;
    const start = performance.now();
    function catchUp(now) {
      const t = Math.min((now - start) / Math.max(dur, 50), 1);
      const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
      const alpha = startAlpha + (1 - startAlpha) * ease;
      _mainCtx.save();
      fillBg(_mainCtx);
      _mainCtx.globalAlpha = 1 - alpha;
      _mainCtx.drawImage(artSnap, 0, 0);
      _mainCtx.globalAlpha = alpha;
      _mainCtx.drawImage(finalCanvas, 0, 0);
      _mainCtx.globalAlpha = 1;
      _mainCtx.restore();
      if (t < 1) { requestAnimationFrame(catchUp); }
      else { _snap(); }
    }
    requestAnimationFrame(catchUp);
  } else {
    _snap();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ── SHARED: binary ink map → waypoints
//    All new algorithms produce a Uint8Array inkMap then call this.
//    Identical raster-scan → subsample → greedy-reorder → lift-flag pipeline
//    used in the original two helpers.
// ─────────────────────────────────────────────────────────────────────────────
function _waypointsFromInkMap(inkMap, W, H, cb, perimLastPt) {
  const GAP        = Math.round(5 * resScale());
  const MAX_SEG_PX = Math.round(200 * resScale());
  const segments = [];
  let curSeg = null, lastX = -9999, lastY = -9999;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inkMap[y * W + x]) continue;
      const px = cb.x + x, py = cb.y + y;
      if (!curSeg || Math.abs(px - lastX) + Math.abs(py - lastY) > GAP) {
        curSeg = []; segments.push(curSeg);
      }
      curSeg.push({ x: px, y: py });
      lastX = px; lastY = py;
    }
  }
  const subSampled = segments.filter(s => s.length >= 1).map(seg => {
    if (seg.length <= MAX_SEG_PX) return seg;
    const k = Math.ceil(seg.length / MAX_SEG_PX);
    const out = [seg[0]];
    for (let i = 1; i < seg.length - 1; i++) if (i % k === 0) out.push(seg[i]);
    out.push(seg[seg.length - 1]);
    return out;
  });
  const used = new Uint8Array(subSampled.length);
  const ordered = [];
  let hx = perimLastPt ? perimLastPt.x : cb.x + cb.w / 2;
  let hy = perimLastPt ? perimLastPt.y : cb.y;
  for (let n = 0; n < subSampled.length; n++) {
    let bestD = Infinity, bestI = -1, bestFlip = false;
    for (let i = 0; i < subSampled.length; i++) {
      if (used[i]) continue;
      const seg = subSampled[i];
      const p0 = seg[0], pZ = seg[seg.length - 1];
      const d0 = (p0.x - hx) ** 2 + (p0.y - hy) ** 2;
      const dZ = (pZ.x - hx) ** 2 + (pZ.y - hy) ** 2;
      if (d0 < bestD) { bestD = d0; bestI = i; bestFlip = false; }
      if (dZ < bestD) { bestD = dZ; bestI = i; bestFlip = true; }
    }
    if (bestI < 0) break;
    used[bestI] = 1;
    const seg = bestFlip ? [...subSampled[bestI]].reverse() : subSampled[bestI];
    ordered.push(seg);
    const last = seg[seg.length - 1]; hx = last.x; hy = last.y;
  }
  const waypoints = [];
  ordered.forEach(seg => { seg.forEach((pt, i) => waypoints.push({ x: pt.x, y: pt.y, lift: i === 0 })); });
  return waypoints;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── ALG 1: Adaptive Local Contrast
//
//    Uses an integral-image box mean to compare each pixel against its local
//    neighborhood.  Marks pixels that are significantly darker than the mean
//    of a surrounding window — handles uneven lighting and embossed styles
//    where a global threshold would miss light ink on light paper.
// ─────────────────────────────────────────────────────────────────────────────
function _buildInkMap_Adaptive(ocd, W, H, map) {
  const sens = getDetectionSensitivity();
  // Larger radius → more global comparison (coarser edges)
  // Smaller radius → more local (finer, noisy)
  const RADIUS = Math.max(3, Math.round(16 - sens * 10)); // 16→6 as sensitivity rises
  // RATIO: pixel must be ≤ RATIO × local_mean to be ink
  const RATIO  = 0.80 - sens * 0.30; // 0.80→0.50

  // Build luma map
  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i4 = (y * W + x) * 4;
    lum[y * W + x] = 0.299 * ocd[i4] + 0.587 * ocd[i4 + 1] + 0.114 * ocd[i4 + 2];
  }

  // Integral image (prefix sum)
  const II = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    II[(y + 1) * (W + 1) + (x + 1)] =
      lum[y * W + x]
      + II[y * (W + 1) + (x + 1)]
      + II[(y + 1) * (W + 1) + x]
      - II[y * (W + 1) + x];
  }
  const boxMean = (x, y, r) => {
    const x1 = Math.max(0, x - r), y1 = Math.max(0, y - r);
    const x2 = Math.min(W, x + r + 1), y2 = Math.min(H, y + r + 1);
    const n = (x2 - x1) * (y2 - y1);
    if (n === 0) return 128;
    return (II[y2 * (W + 1) + x2] - II[y1 * (W + 1) + x2]
          - II[y2 * (W + 1) + x1] + II[y1 * (W + 1) + x1]) / n;
  };

  const raw = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!map[y * W + x]) continue;
    const l = lum[y * W + x];
    const mean = boxMean(x, y, RADIUS);
    // Need a reasonably bright neighborhood so we're not inside a uniformly dark fill
    if (mean > 25 && l < mean * RATIO) raw[y * W + x] = 1;
  }

  // Thin with thickness filter (same as classic)
  const MAX_T = Math.round((4 + sens * 8) * resScale());
  const inkMap = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!raw[y * W + x]) continue;
    let h = 1; for (let d=1; x+d<W && raw[y*W+(x+d)]; d++) h++; for (let d=1; x-d>=0 && raw[y*W+(x-d)]; d++) h++;
    if (h > MAX_T) {
      let v = 1; for (let d=1; y+d<H && raw[(y+d)*W+x]; d++) v++; for (let d=1; y-d>=0 && raw[(y-d)*W+x]; d++) v++;
      if (v > MAX_T) continue;
    }
    inkMap[y * W + x] = 1;
  }
  return inkMap;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── ALG 2: Chroma Boundary
//
//    Measures the maximum RGB color distance between each pixel and its 8
//    neighbors.  Any significant color transition marks an edge — including
//    colored outlines (red on pink, blue on cyan) that luma-only methods miss.
//    Non-maximum suppression thins multi-pixel ridges to single-pixel edges.
// ─────────────────────────────────────────────────────────────────────────────
function _buildInkMap_Chroma(ocd, W, H, map) {
  const sens = getDetectionSensitivity();
  const THRESH = Math.round(180 - sens * 140); // 180→40 — color distance threshold

  // Compute max 8-neighbor color distance per pixel
  const gradMap = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (!map[y * W + x]) continue;
    const i4 = (y * W + x) * 4;
    const pr = ocd[i4], pg = ocd[i4+1], pb = ocd[i4+2];
    let maxD = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dy === 0 && dx === 0) continue;
      const ni = ((y+dy)*W+(x+dx))*4;
      const dr = pr - ocd[ni], dg = pg - ocd[ni+1], db = pb - ocd[ni+2];
      const d = Math.sqrt(dr*dr + dg*dg + db*db);
      if (d > maxD) maxD = d;
    }
    gradMap[y * W + x] = maxD;
  }

  // Non-maximum suppression in 8-neighborhood to thin ridges
  const inkMap = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (gradMap[y * W + x] < THRESH) continue;
    const g = gradMap[y * W + x];
    let isMax = true;
    for (let dy = -1; dy <= 1 && isMax; dy++) for (let dx = -1; dx <= 1 && isMax; dx++) {
      if (dy === 0 && dx === 0) continue;
      if (gradMap[(y+dy)*W+(x+dx)] > g) isMax = false;
    }
    if (isMax) inkMap[y * W + x] = 1;
  }
  return inkMap;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── ALG 3: LoG Zero-Crossing
//
//    Laplacian of Gaussian: Gaussian-blur the luma channel, apply Laplacian
//    (second-derivative) and find sign-change zero-crossings.  Zero-crossings
//    land exactly at edge centers — giving single-pixel-wide lines regardless
//    of stroke weight.  Excels at finding faint/thin outlines that gradient
//    methods smooth over.
// ─────────────────────────────────────────────────────────────────────────────
function _buildInkMap_LoG(ocd, W, H, map) {
  const sens = getDetectionSensitivity();
  const SIGMA    = 0.8 + sens * 2.2;          // 0.8→3.0
  const ZC_FLOOR = 8 + (1 - sens) * 30;       // minimum sign-change magnitude to reject noise

  // Build luma
  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i4 = (y * W + x) * 4;
    lum[y * W + x] = 0.299*ocd[i4] + 0.587*ocd[i4+1] + 0.114*ocd[i4+2];
  }

  // Separable Gaussian blur
  const KR = Math.max(1, Math.ceil(SIGMA * 3));
  const kw = KR * 2 + 1;
  const kernel = new Float32Array(kw);
  let kSum = 0;
  for (let i = 0; i < kw; i++) {
    const d = i - KR;
    kernel[i] = Math.exp(-(d * d) / (2 * SIGMA * SIGMA));
    kSum += kernel[i];
  }
  for (let i = 0; i < kw; i++) kernel[i] /= kSum;

  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -KR; k <= KR; k++) s += lum[y * W + Math.max(0, Math.min(W-1, x+k))] * kernel[k+KR];
    tmp[y * W + x] = s;
  }
  const blurred = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -KR; k <= KR; k++) s += tmp[Math.max(0,Math.min(H-1,y+k)) * W + x] * kernel[k+KR];
    blurred[y * W + x] = s;
  }

  // 3×3 Laplacian
  const lap = new Float32Array(W * H);
  for (let y = 1; y < H-1; y++) for (let x = 1; x < W-1; x++) {
    if (!map[y*W+x]) continue;
    lap[y*W+x] = blurred[y*W+(x-1)] + blurred[y*W+(x+1)]
               + blurred[(y-1)*W+x] + blurred[(y+1)*W+x]
               - 4 * blurred[y*W+x];
  }

  // Zero-crossings: sign change to at least one 4-connected neighbor with sufficient magnitude
  const inkMap = new Uint8Array(W * H);
  for (let y = 1; y < H-1; y++) for (let x = 1; x < W-1; x++) {
    if (!map[y*W+x]) continue;
    const v = lap[y*W+x];
    if (v === 0) continue;
    const nbrs = [lap[y*W+(x-1)], lap[y*W+(x+1)], lap[(y-1)*W+x], lap[(y+1)*W+x]];
    for (const n of nbrs) {
      if (n !== 0 && Math.sign(v) !== Math.sign(n) && Math.abs(v - n) > ZC_FLOOR) {
        inkMap[y*W+x] = 1; break;
      }
    }
  }
  return inkMap;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── ALG 4: Morphological Shell
//
//    Converts the image to a dark-pixel binary map, erodes it by N pixels
//    (min-filter), then subtracts: original − eroded = exact 1–N px border
//    around every dark region.  Purely geometric — works on any image that
//    has dark strokes, regardless of whether they're ink, pencil, or shadow.
// ─────────────────────────────────────────────────────────────────────────────
function _buildInkMap_MorphShell(ocd, W, H, map) {
  const sens = getDetectionSensitivity();
  const LUM_THRESH = Math.round(30 + sens * 130); // 30→160 luma cutoff for "dark"
  const ERODE_R    = Math.max(1, Math.round(4 - sens * 2.5)); // 4→2px erosion

  // Dark binary map
  const dark = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!map[y*W+x]) continue;
    const i4 = (y*W+x)*4;
    if (ocd[i4+3] < 20) continue;
    const l = 0.299*ocd[i4] + 0.587*ocd[i4+1] + 0.114*ocd[i4+2];
    if (l < LUM_THRESH) dark[y*W+x] = 1;
  }

  // Erode: pixel survives only if its entire ERODE_R-radius Chebyshev neighborhood is dark
  const eroded = new Uint8Array(W * H);
  outer: for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!dark[y*W+x]) continue;
    for (let dy = -ERODE_R; dy <= ERODE_R; dy++) {
      for (let dx = -ERODE_R; dx <= ERODE_R; dx++) {
        const ny = y+dy, nx = x+dx;
        if (ny<0||ny>=H||nx<0||nx>=W) continue;
        if (!dark[ny*W+nx]) { eroded[y*W+x] = 0; continue; } // skip, don't set
      }
    }
    // All neighbors were dark — mark as survived erosion
    let survive = true;
    for (let dy = -ERODE_R; dy <= ERODE_R && survive; dy++)
      for (let dx = -ERODE_R; dx <= ERODE_R && survive; dx++) {
        const ny = y+dy, nx = x+dx;
        if (ny<0||ny>=H||nx<0||nx>=W) continue;
        if (!dark[ny*W+nx]) survive = false;
      }
    if (survive) eroded[y*W+x] = 1;
  }

  // Shell = dark AND NOT eroded
  const inkMap = new Uint8Array(W * H);
  for (let i = 0; i < W*H; i++) { if (dark[i] && !eroded[i]) inkMap[i] = 1; }
  return inkMap;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── ALG 5: Canny+ (Hysteresis Edge Linking)
//
//    Full double-threshold Canny with BFS hysteresis: strong edges seed a
//    flood-fill that "grows" into connected weak edges.  This links broken
//    stroke segments that single-threshold Canny (or the Real Image algorithm)
//    would discard as noise — giving continuous outlines even on sketchy art.
// ─────────────────────────────────────────────────────────────────────────────
function _buildInkMap_Canny2(ocd, W, H, map) {
  const sens = getDetectionSensitivity();

  // Luma + small Gaussian blur (5-tap σ≈1.4)
  const lum = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i4 = (y*W+x)*4;
    lum[y*W+x] = 0.299*ocd[i4] + 0.587*ocd[i4+1] + 0.114*ocd[i4+2];
  }
  const K5 = [0.0625, 0.25, 0.375, 0.25, 0.0625];
  const tmp = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -2; k <= 2; k++) s += lum[y*W+Math.max(0,Math.min(W-1,x+k))] * K5[k+2];
    tmp[y*W+x] = s;
  }
  const bl = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -2; k <= 2; k++) s += tmp[Math.max(0,Math.min(H-1,y+k))*W+x] * K5[k+2];
    bl[y*W+x] = s;
  }

  // Sobel gradient + NMS
  const grad = new Float32Array(W * H);
  const ang  = new Uint8Array(W * H);
  let maxG = 0;
  for (let y = 1; y < H-1; y++) for (let x = 1; x < W-1; x++) {
    if (!map[y*W+x]) continue;
    const gx = -bl[(y-1)*W+(x-1)] +bl[(y-1)*W+(x+1)] -2*bl[y*W+(x-1)] +2*bl[y*W+(x+1)] -bl[(y+1)*W+(x-1)] +bl[(y+1)*W+(x+1)];
    const gy = -bl[(y-1)*W+(x-1)] -2*bl[(y-1)*W+x] -bl[(y-1)*W+(x+1)] +bl[(y+1)*W+(x-1)] +2*bl[(y+1)*W+x] +bl[(y+1)*W+(x+1)];
    const g = Math.sqrt(gx*gx+gy*gy);
    grad[y*W+x] = g; if (g > maxG) maxG = g;
    const deg = ((Math.atan2(gy,gx)*180/Math.PI)+180)%180;
    ang[y*W+x] = deg<22.5||deg>=157.5 ? 0 : deg<67.5 ? 3 : deg<112.5 ? 1 : 2;
  }
  const nms = new Float32Array(W * H);
  for (let y = 1; y < H-1; y++) for (let x = 1; x < W-1; x++) {
    if (!map[y*W+x]||!grad[y*W+x]) continue;
    const g = grad[y*W+x];
    let n1, n2;
    switch (ang[y*W+x]) {
      case 0: n1=grad[y*W+(x-1)];     n2=grad[y*W+(x+1)];     break;
      case 1: n1=grad[(y-1)*W+x];     n2=grad[(y+1)*W+x];     break;
      case 2: n1=grad[(y-1)*W+(x+1)]; n2=grad[(y+1)*W+(x-1)]; break;
      case 3: n1=grad[(y-1)*W+(x-1)]; n2=grad[(y+1)*W+(x+1)]; break;
    }
    if (g >= n1 && g >= n2) nms[y*W+x] = g;
  }

  // Double threshold — sensitivity shifts both thresholds down
  const T_HIGH = maxG * (0.40 - sens * 0.30); // 0.40→0.10
  const T_LOW  = T_HIGH * 0.40;               // low = 40% of high (classic ratio)

  const STRONG = 2, WEAK = 1;
  const es = new Uint8Array(W * H);
  const seeds = [];
  for (let i = 0; i < W*H; i++) {
    if      (nms[i] >= T_HIGH) { es[i] = STRONG; seeds.push(i); }
    else if (nms[i] >= T_LOW)  { es[i] = WEAK; }
  }

  // BFS: promote weak edges connected to strong ones
  let qi = 0;
  while (qi < seeds.length) {
    const idx = seeds[qi++];
    const y = Math.floor(idx / W), x = idx % W;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (dy===0&&dx===0) continue;
      const ny=y+dy, nx=x+dx;
      if (ny<0||ny>=H||nx<0||nx>=W) continue;
      const ni = ny*W+nx;
      if (es[ni] === WEAK) { es[ni] = STRONG; seeds.push(ni); }
    }
  }

  const inkMap = new Uint8Array(W * H);
  for (let i = 0; i < W*H; i++) { if (es[i] === STRONG) inkMap[i] = 1; }
  return inkMap;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── DISPATCH: run the selected algorithm and return waypoints
// ─────────────────────────────────────────────────────────────────────────────
function _buildInkWaypointsByAlgorithm(perimLastPt) {
  const alg = state.outlineAlgorithm || 'classic';
  if (alg === 'classic') return null; // use existing classic pipeline
  const cb  = state.contentBounds;
  const W = cb.w, H = cb.h;
  const ocd = offscreen.getContext('2d').getImageData(cb.x, cb.y, W, H).data;
  const map = buildPresenceMap();
  let inkMap;
  switch (alg) {
    case 'adaptive':    inkMap = _buildInkMap_Adaptive(ocd, W, H, map);    break;
    case 'chroma':      inkMap = _buildInkMap_Chroma(ocd, W, H, map);      break;
    case 'log':         inkMap = _buildInkMap_LoG(ocd, W, H, map);         break;
    case 'morph-shell': inkMap = _buildInkMap_MorphShell(ocd, W, H, map);  break;
    case 'canny2':      inkMap = _buildInkMap_Canny2(ocd, W, H, map);      break;
    default:            return null;
  }
  return _waypointsFromInkMap(inkMap, W, H, cb, perimLastPt);
}


//
// Runs the same raster-scan → subsample → greedy
// reorder pipeline as the original, but expands
// what counts as "ink":
//
//   Pass A (original): dark + near-neutral pixels
//   Pass B (cartoon):  pixels that are noticeably
//     darker than every one of their lit neighbours
//     AND sit on a luma edge (light on at least one
//     side).  Catches coloured anime outlines — dark
//     blue around blue, dark red around red, etc.
//   Both passes share the same thickness filter so
//   filled dark regions are still excluded.
// ─────────────────────────────────────────────
function buildColorRegionInkWaypoints(perimLastPt) {
  const cb = state.contentBounds;
  const W = cb.w, H = cb.h;
  const ocd = offscreen.getContext('2d').getImageData(cb.x, cb.y, W, H).data;
  const map = buildPresenceMap();
  const lum = i4 => 0.299*ocd[i4] + 0.587*ocd[i4+1] + 0.114*ocd[i4+2];

  // ── Pass A: original — dark AND low-saturation (pure/near-black ink) ──
  // Sensitivity-driven: at 0.5 → A_LUM=80, A_SAT=28 (original defaults)
  const A_LUM = Math.round(30 + getDetectionSensitivity() * 100);  // 30–130, default 80 at 0.5
  const A_SAT = Math.round(6  + getDetectionSensitivity() * 44);   // 6–50,   default 28 at 0.5
  const rawInk = new Uint8Array(W * H);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const i4=(y*W+x)*4;
    if (ocd[i4+3]<20) continue;
    const r=ocd[i4],g=ocd[i4+1],b=ocd[i4+2];
    if (0.299*r+0.587*g+0.114*b < A_LUM &&
        Math.max(r,g,b)-Math.min(r,g,b) < A_SAT) rawInk[y*W+x]=1;
  }

  // ── Pass B: local-darkness — pixel is distinctly darker than its lit neighbours ──
  // Rules (ALL must pass):
  //   1. Pixel lum < 150 (not a highlight)
  //   2. At least one 4-connected neighbour has lum >= pixel_lum + DARK_MARGIN
  //      (there's a bright side → this pixel IS on the dark side of an edge)
  //   3. Minimum lit-neighbour lum > pixel_lum + DARK_MARGIN
  //      would be too strict; instead we require the BRIGHTEST neighbour to be
  //      >= pixel_lum + DARK_MARGIN — one bright side is enough.
  //   4. Not already caught by Pass A
  //
  // DARK_MARGIN = contrast needed to count as an outline edge.
  // At 0.5 → 40 (original). Less sensitive = higher margin (only very sharp edges).
  // More sensitive = lower margin (catches soft/light outlines).
  const DARK_MARGIN  = Math.round(10 + (1 - getDetectionSensitivity()) * 60); // 70→10, default 40 at 0.5
  const MAX_PIX_LUM  = Math.round(100 + getDetectionSensitivity() * 100);     // 100–200, default 150 at 0.5
  const colorInk = new Uint8Array(W * H);
  for (let y=1;y<H-1;y++) for (let x=1;x<W-1;x++) {
    if (!map[y*W+x] || rawInk[y*W+x]) continue;
    const i4=(y*W+x)*4;
    const cL = lum(i4);
    if (cL >= MAX_PIX_LUM) continue;

    // Check 4-connected neighbours only (diagonal creates false diagonals)
    let brightestNeighbour = 0;
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dy,dx] of dirs) {
      const ny=y+dy, nx=x+dx;
      if (!map[ny*W+nx]) continue;
      const nL = lum((ny*W+nx)*4);
      if (nL > brightestNeighbour) brightestNeighbour = nL;
    }
    // Need at least one noticeably brighter 4-connected content neighbour
    if (brightestNeighbour - cL >= DARK_MARGIN) colorInk[y*W+x] = 1;
  }

  // ── Merged raw map ──
  const merged = new Uint8Array(W * H);
  for (let i=0;i<W*H;i++) merged[i] = rawInk[i] | colorInk[i];

  // ── Thickness filter (same logic as original) ──
  const MAX_THICKNESS = Math.round((4 + getDetectionSensitivity() * 8) * resScale());
  const isInk = (x, y) => {
    if (!merged[y*W+x]) return false;
    let hSpan=1;
    for (let dx=1; x+dx<W && merged[y*W+(x+dx)]; dx++) hSpan++;
    for (let dx=1; x-dx>=0 && merged[y*W+(x-dx)]; dx++) hSpan++;
    if (hSpan > MAX_THICKNESS) {
      let vSpan=1;
      for (let dy=1; y+dy<H && merged[(y+dy)*W+x]; dy++) vSpan++;
      for (let dy=1; y-dy>=0 && merged[(y-dy)*W+x]; dy++) vSpan++;
      if (vSpan > MAX_THICKNESS) return false;
    }
    return true;
  };

  // ── Raster-scan into segments (identical to original) ──
  const GAP = Math.round(5 * resScale());
  const segments = [];
  let curSeg=null, lastX=-9999, lastY=-9999;
  for (let y=0;y<H;y++) {
    for (let x=0;x<W;x++) {
      if (!isInk(x,y)) continue;
      const px=cb.x+x, py=cb.y+y;
      const dist=Math.abs(px-lastX)+Math.abs(py-lastY);
      if (!curSeg||dist>GAP) { curSeg=[]; segments.push(curSeg); }
      curSeg.push({x:px,y:py});
      lastX=px; lastY=py;
    }
  }

  // ── Subsample long segments ──
  const MAX_SEG_PX = Math.round(200 * resScale());
  const subSampled = segments.filter(s=>s.length>=1).map(seg=>{
    if (seg.length<=MAX_SEG_PX) return seg;
    const k=Math.ceil(seg.length/MAX_SEG_PX);
    const out=[seg[0]];
    for (let i=1;i<seg.length-1;i++) { if(i%k===0) out.push(seg[i]); }
    out.push(seg[seg.length-1]);
    return out;
  });

  // ── Greedy nearest-endpoint reorder ──
  const used=new Uint8Array(subSampled.length);
  const ordered=[];
  let hx=perimLastPt?perimLastPt.x:cb.x+cb.w/2;
  let hy=perimLastPt?perimLastPt.y:cb.y;
  for (let n=0;n<subSampled.length;n++) {
    let bestD=Infinity,bestI=-1,bestFlip=false;
    for (let i=0;i<subSampled.length;i++) {
      if (used[i]) continue;
      const seg=subSampled[i];
      const p0=seg[0],pZ=seg[seg.length-1];
      const d0=(p0.x-hx)**2+(p0.y-hy)**2;
      const dZ=(pZ.x-hx)**2+(pZ.y-hy)**2;
      if (d0<bestD){bestD=d0;bestI=i;bestFlip=false;}
      if (dZ<bestD){bestD=dZ;bestI=i;bestFlip=true;}
    }
    if (bestI<0) break;
    used[bestI]=1;
    const seg=bestFlip?[...subSampled[bestI]].reverse():subSampled[bestI];
    ordered.push(seg);
    const last=seg[seg.length-1]; hx=last.x; hy=last.y;
  }

  // ── Flatten with lift flags ──
  const waypoints=[];
  ordered.forEach(seg=>{ seg.forEach((pt,i)=>waypoints.push({x:pt.x,y:pt.y,lift:i===0})); });
  return waypoints;
}

function buildRealImageInkWaypoints(perimLastPt) {
  const cb = state.contentBounds;
  const W = cb.w, H = cb.h;
  const ocd = offscreen.getContext('2d').getImageData(cb.x, cb.y, W, H).data;
  const map = buildPresenceMap();

  // ── 1. Luminance map ──
  const lumMap = new Float32Array(W * H);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
    const i4=(y*W+x)*4;
    lumMap[y*W+x] = 0.299*ocd[i4] + 0.587*ocd[i4+1] + 0.114*ocd[i4+2];
  }

  // ── 2. Sobel gradient magnitude + direction ──
  // Gx = [-1 0 1 / -2 0 2 / -1 0 1]  Gy = [-1 -2 -1 / 0 0 0 / 1 2 1]
  const grad  = new Float32Array(W * H);
  const angle = new Uint8Array(W * H);  // 0=H 1=V 2=D/ 3=D\
  let maxG = 0;
  for (let y=1;y<H-1;y++) for (let x=1;x<W-1;x++) {
    if (!map[y*W+x]) continue;
    const gx =
      -lumMap[(y-1)*W+(x-1)] + lumMap[(y-1)*W+(x+1)]
      -2*lumMap[y*W+(x-1)]   + 2*lumMap[y*W+(x+1)]
      -lumMap[(y+1)*W+(x-1)] + lumMap[(y+1)*W+(x+1)];
    const gy =
      -lumMap[(y-1)*W+(x-1)] - 2*lumMap[(y-1)*W+x] - lumMap[(y-1)*W+(x+1)]
      +lumMap[(y+1)*W+(x-1)] + 2*lumMap[(y+1)*W+x] + lumMap[(y+1)*W+(x+1)];
    const g = Math.sqrt(gx*gx + gy*gy);
    grad[y*W+x] = g;
    if (g > maxG) maxG = g;
    // Quantise to 4 directions for NMS
    const deg = ((Math.atan2(gy, gx) * 180 / Math.PI) + 180) % 180;
    angle[y*W+x] = deg < 22.5||deg >= 157.5 ? 0   // horizontal
                 : deg < 67.5                ? 3   // diagonal \
                 : deg < 112.5               ? 1   // vertical
                 :                             2;  // diagonal /
  }

  // ── 3. Adaptive threshold ──
  // Use Otsu's method on the non-zero gradient values to find a natural split.
  // Then clamp: never below 15% of maxG (noise floor) or above 60% (misses real edges).
  const BINS = 256;
  const hist = new Float32Array(BINS);
  let nPx = 0;
  for (let i=0;i<W*H;i++) {
    if (!map[i]||grad[i]===0) continue;
    hist[Math.min(BINS-1, Math.floor(grad[i]/maxG*(BINS-1)))]++;
    nPx++;
  }
  // Otsu
  let sumAll=0;
  for (let b=0;b<BINS;b++) sumAll+=b*hist[b];
  let sumB=0, wB=0, bestVar=0, otsuT=0;
  for (let b=0;b<BINS;b++) {
    wB+=hist[b]; if(wB===0) continue;
    const wF=nPx-wB; if(wF===0) break;
    sumB+=b*hist[b];
    const mB=sumB/wB, mF=(sumAll-sumB)/wF;
    const v=wB*wF*(mB-mF)*(mB-mF);
    if (v>bestVar){bestVar=v;otsuT=b;}
  }
  const rawT = otsuT/BINS * maxG;
  // Sensitivity shifts the clamp window: more sensitive = lower floor + higher ceiling
  const t_sens = getDetectionSensitivity();
  const t_lo   = 0.25 - t_sens * 0.20;  // 0.25 → 0.05 as sensitivity rises
  const t_hi   = 0.40 + t_sens * 0.30;  // 0.40 → 0.70 as sensitivity rises
  const threshold = Math.max(maxG * t_lo, Math.min(maxG * t_hi, rawT));

  // ── 4. Non-maximum suppression ──
  // Keep a pixel only if it is a local maximum along its gradient direction.
  // This thins multi-pixel-wide gradient bands down to single-pixel ridges.
  const nms = new Uint8Array(W * H);
  for (let y=1;y<H-1;y++) for (let x=1;x<W-1;x++) {
    if (!map[y*W+x] || grad[y*W+x] < threshold) continue;
    const g = grad[y*W+x];
    let n1, n2;
    switch (angle[y*W+x]) {
      case 0: n1=grad[y*W+(x-1)];     n2=grad[y*W+(x+1)];     break;
      case 1: n1=grad[(y-1)*W+x];     n2=grad[(y+1)*W+x];     break;
      case 2: n1=grad[(y-1)*W+(x+1)]; n2=grad[(y+1)*W+(x-1)]; break;
      case 3: n1=grad[(y-1)*W+(x-1)]; n2=grad[(y+1)*W+(x+1)]; break;
    }
    if (g >= n1 && g >= n2) nms[y*W+x] = 1;
  }

  // ── 5. Raster-scan into segments (same logic as original pipeline) ──
  const GAP = Math.round(5 * resScale());
  const segments = [];
  let curSeg=null, lastX=-9999, lastY=-9999;
  for (let y=0;y<H;y++) {
    for (let x=0;x<W;x++) {
      if (!nms[y*W+x]) continue;
      const px=cb.x+x, py=cb.y+y;
      const dist=Math.abs(px-lastX)+Math.abs(py-lastY);
      if (!curSeg||dist>GAP) { curSeg=[]; segments.push(curSeg); }
      curSeg.push({x:px, y:py});
      lastX=px; lastY=py;
    }
  }

  // ── 6. Subsample long segments ──
  const MAX_SEG_PX = Math.round(200 * resScale());
  const subSampled = segments.filter(s=>s.length>=1).map(seg=>{
    if (seg.length<=MAX_SEG_PX) return seg;
    const k=Math.ceil(seg.length/MAX_SEG_PX);
    const out=[seg[0]];
    for (let i=1;i<seg.length-1;i++){if(i%k===0)out.push(seg[i]);}
    out.push(seg[seg.length-1]);
    return out;
  });

  // ── 7. Greedy nearest-endpoint reorder ──
  const used=new Uint8Array(subSampled.length);
  const ordered=[];
  let hx=perimLastPt?perimLastPt.x:cb.x+cb.w/2;
  let hy=perimLastPt?perimLastPt.y:cb.y;
  for (let n=0;n<subSampled.length;n++) {
    let bestD=Infinity,bestI=-1,bestFlip=false;
    for (let i=0;i<subSampled.length;i++) {
      if(used[i]) continue;
      const seg=subSampled[i];
      const p0=seg[0],pZ=seg[seg.length-1];
      const d0=(p0.x-hx)**2+(p0.y-hy)**2;
      const dZ=(pZ.x-hx)**2+(pZ.y-hy)**2;
      if(d0<bestD){bestD=d0;bestI=i;bestFlip=false;}
      if(dZ<bestD){bestD=dZ;bestI=i;bestFlip=true;}
    }
    if(bestI<0) break;
    used[bestI]=1;
    const seg=bestFlip?[...subSampled[bestI]].reverse():subSampled[bestI];
    ordered.push(seg);
    const last=seg[seg.length-1]; hx=last.x; hy=last.y;
  }

  // ── 8. Flatten with lift flags ──
  const waypoints=[];
  ordered.forEach(seg=>{seg.forEach((pt,i)=>waypoints.push({x:pt.x,y:pt.y,lift:i===0}));});
  return waypoints;
}

// ─── TEXT DIR SELECTOR ───
function selectTextDir(el) {
  if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot();
  document.querySelectorAll('#text-dir-grid .anim-opt').forEach(a => a.classList.remove('selected'));
  el.classList.add('selected');
  state.textAnimDir = el.dataset.dir;
  const layer = getSelectedLayer();
  if (layer) layer.textAnimDir = el.dataset.dir;
}

// ─── TEXT DRAW STYLE SELECTOR ───
function selectTextDrawStyle(el) {
  if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot();
  document.querySelectorAll('#text-style-grid .anim-opt').forEach(a => a.classList.remove('selected'));
  el.classList.add('selected');
  const sty = el.dataset.style;
  state.textDrawStyle = sty;
  const layer = getSelectedLayer();
  if (layer) layer.textDrawStyle = sty;
  const showOutlineOpts = sty === 'outline' || sty === 'outline-fill';
  const outlineOptEl = document.getElementById('text-outline-opts');
  if (outlineOptEl) outlineOptEl.style.display = showOutlineOpts ? 'flex' : 'none';
}

// ─────────────────────────────────────────────
// ── SPEC-TEXT  (character-by-character reveal)
//
// Fill styles:
//   reveal       — column-by-column image reveal (original)
//   outline      — pen traces each character outline; no fill
//   outline-fill — outline first, then column fill reveal
//
// Direction: ltr | rtl | ttb | btt
// ─────────────────────────────────────────────
function _buildSpecTextClusters(cb, map, dir) {
  const W = cb.w, H = cb.h;

  // 1. BFS connected components
  const visited = new Uint8Array(W * H);
  const rawComps = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (!map[idx] || visited[idx]) continue;
      let minX = x, maxX = x, minY = y, maxY = y;
      const queue = [idx];
      visited[idx] = 1;
      let qi = 0;
      while (qi < queue.length) {
        const cur = queue[qi++];
        const cx2 = cur % W, cy2 = Math.floor(cur / W);
        minX = Math.min(minX, cx2); maxX = Math.max(maxX, cx2);
        minY = Math.min(minY, cy2); maxY = Math.max(maxY, cy2);
        for (const ni of [cur-1, cur+1, cur-W, cur+W]) {
          if (ni < 0 || ni >= W * H) continue;
          if (ni % W === 0 && cur % W === W-1) continue;
          if (cur % W === 0 && ni % W === W-1) continue;
          if (!map[ni] || visited[ni]) continue;
          visited[ni] = 1;
          queue.push(ni);
        }
      }
      if (queue.length < 3) continue;
      rawComps.push({ minX: cb.x+minX, maxX: cb.x+maxX, minY: cb.y+minY, maxY: cb.y+maxY });
    }
  }

  // 2. Proximity-merge (handles letter counters like o, e, a)
  const MERGE_GAP = Math.max(6, Math.round(Math.min(W, H) * 0.05));
  const par = rawComps.map((_, i) => i);
  const find = i => { while (par[i]!==i){par[i]=par[par[i]];i=par[i];} return i; };
  const union = (a, b) => { par[find(a)] = find(b); };
  for (let i = 0; i < rawComps.length; i++)
    for (let j = i+1; j < rawComps.length; j++) {
      const a = rawComps[i], b = rawComps[j];
      if (a.maxX+MERGE_GAP >= b.minX && b.maxX+MERGE_GAP >= a.minX &&
          a.maxY+MERGE_GAP >= b.minY && b.maxY+MERGE_GAP >= a.minY) union(i, j);
    }
  const gm = new Map();
  rawComps.forEach((c, i) => {
    const r = find(i);
    if (!gm.has(r)) gm.set(r, { minX:c.minX, maxX:c.maxX, minY:c.minY, maxY:c.maxY });
    else { const g=gm.get(r); g.minX=Math.min(g.minX,c.minX); g.maxX=Math.max(g.maxX,c.maxX);
           g.minY=Math.min(g.minY,c.minY); g.maxY=Math.max(g.maxY,c.maxY); }
  });

  let clusters = [...gm.values()].map(g => ({
    ...g, cx: (g.minX+g.maxX)/2, cy: (g.minY+g.maxY)/2
  }));
  if (!clusters.length)
    clusters = [{ minX:cb.x, maxX:cb.x+W, minY:cb.y, maxY:cb.y+H,
                  cx:cb.x+W/2, cy:cb.y+H/2 }];

  // 3. Sort by direction
  if      (dir === 'ltr') clusters.sort((a,b) => (a.cx-b.cx) + (a.cy-b.cy)*0.05);
  else if (dir === 'rtl') clusters.sort((a,b) => (b.cx-a.cx) + (a.cy-b.cy)*0.05);
  else if (dir === 'ttb') clusters.sort((a,b) => (a.cy-b.cy) + (a.cx-b.cx)*0.05);
  else if (dir === 'btt') clusters.sort((a,b) => (b.cy-a.cy) + (a.cx-b.cx)*0.05);

  return clusters;
}

function _buildSpecTextRevealPts(clusters, cb, map) {
  const W = cb.w;
  const pts = [];
  clusters.forEach(cluster => {
    const cW = Math.max(1, cluster.maxX - cluster.minX);
    const COL_W = Math.max(3, Math.round(cW / Math.max(1, Math.round(cW / 12))));
    pts.push({ x: cluster.cx, y: cluster.minY-10, isJump:true,
               revealColX: cluster.minX, revealColW:1,
               revealColY1: cluster.minY, revealColY2: cluster.minY });
    for (let cx2 = cluster.minX; cx2 <= cluster.maxX; cx2 += COL_W) {
      const cxLocal = cx2 - cb.x;
      let topY = -1, botY = -1;
      for (let y2 = 0; y2 < cb.h; y2++)
        for (let dx = 0; dx < COL_W; dx++) {
          const lx = cxLocal+dx; if (lx<0||lx>=W) continue;
          if (map[y2*W+lx]) { if(topY<0) topY=cb.y+y2; botY=cb.y+y2; }
        }
      if (topY < 0) continue;
      const midX = cx2 + COL_W*0.5;
      const dist = botY - topY;
      const steps = Math.max(3, Math.floor(dist/3));
      pts.push({ x:midX, y:topY-6, isJump:true, revealColX:cx2, revealColW:COL_W, revealColY1:topY, revealColY2:topY });
      for (let s=0; s<=steps; s++) {
        const t=s/steps, ry=topY+dist*t;
        pts.push({ x:midX+(Math.random()-0.5)*4, y:ry, revealColX:cx2, revealColW:COL_W, revealColY1:topY, revealColY2:Math.min(ry,botY) });
      }
      pts.push({ x:midX, y:botY+6, isJump:true, revealColX:cx2, revealColW:COL_W, revealColY1:topY, revealColY2:botY });
    }
  });
  return pts;
}

function _buildSpecTextOutlinePts(clusters, cb, map) {
  // For each cluster, build 4-pass raster-scan perimeter and subsample
  const W = cb.w, H = cb.h;
  const ocd = offscreen.getContext('2d').getImageData(cb.x, cb.y, W, H).data;

  // Auto-detect darkest edge color for default
  let darkest = 766, dR=20, dG=20, dB=20;
  for (let i=0; i<W*H; i+=Math.max(1,Math.floor(W*H/400))) {
    if (!map[i]) continue;
    const i4=i*4, r=ocd[i4], g=ocd[i4+1], b=ocd[i4+2], a=ocd[i4+3];
    if (a>80 && r+g+b < darkest) { darkest=r+g+b; dR=r; dG=g; dB=b; }
  }
  const autoColor = darkest > 550 ? '#111' : `rgb(${Math.max(0,dR-20)},${Math.max(0,dG-20)},${Math.max(0,dB-20)})`;

  // Read user color choice
  const autoChecked = document.getElementById('text-outline-autocolor')?.checked;
  const userColor   = document.getElementById('text-outline-color')?.value || '#000000';
  const outlineColor = autoChecked ? autoColor : userColor;
  const thickness   = parseFloat(document.getElementById('text-outline-thickness')?.value ?? 2) * resScale();

  // Build edge map across whole content bounds
  const edgeMap = new Uint8Array(W * H);
  for (let y=0; y<H; y++) for (let x=0; x<W; x++) {
    if (!map[y*W+x]) continue;
    if ((x===0||!map[y*W+(x-1)]) || (x===W-1||!map[y*W+(x+1)]) ||
        (y===0||!map[(y-1)*W+x]) || (y===H-1||!map[(y+1)*W+x]))
      edgeMap[y*W+x] = 1;
  }

  const JUMP = 8 * resScale();
  const allPts = []; // will hold {x, y, lift} with cluster boundaries
  const TARGET_PER_CLUSTER = Math.round(180 * resPointScale());

  clusters.forEach(cluster => {
    const clMinX = cluster.minX - cb.x, clMaxX = cluster.maxX - cb.x;
    const clMinY = cluster.minY - cb.y, clMaxY = cluster.maxY - cb.y;

    const raw = [];
    // 4-pass perimeter scan scoped to this cluster's bbox
    for (let x=clMinX; x<=clMaxX; x++)
      for (let y=clMinY; y<=clMaxY; y++) { if(edgeMap[y*W+x]){raw.push({x:cb.x+x,y:cb.y+y});break;} }
    for (let y=clMinY; y<=clMaxY; y++)
      for (let x=clMaxX; x>=clMinX; x--) { if(edgeMap[y*W+x]){raw.push({x:cb.x+x,y:cb.y+y});break;} }
    for (let x=clMaxX; x>=clMinX; x--)
      for (let y=clMaxY; y>=clMinY; y--) { if(edgeMap[y*W+x]){raw.push({x:cb.x+x,y:cb.y+y});break;} }
    for (let y=clMaxY; y>=clMinY; y--)
      for (let x=clMinX; x<=clMaxX; x++) { if(edgeMap[y*W+x]){raw.push({x:cb.x+x,y:cb.y+y});break;} }

    if (!raw.length) return;
    if (raw.length > 1) raw.push({ ...raw[0] }); // close the loop

    const stride = Math.max(1, Math.floor(raw.length / TARGET_PER_CLUSTER));
    const pts = raw.filter((_, i) => i % stride === 0);

    // Jump to this cluster's first point
    allPts.push({ x:pts[0].x, y:pts[0].y, lift:true, isJump:true });
    pts.forEach((p, i) => allPts.push({ x:p.x, y:p.y, lift: i===0 }));
  });

  return { pts: allPts, color: outlineColor, thickness };
}

function setupSpecText() {
  const cb  = state.contentBounds;
  const map = buildPresenceMap();
  const dir = state.textAnimDir  || 'ltr';
  const sty = state.textDrawStyle || 'reveal';

  const clusters = _buildSpecTextClusters(cb, map, dir);

  if (sty === 'reveal') {
    // ── Reveal mode: column-by-column image reveal ──
    state.strokeList   = _buildSpecTextRevealPts(clusters, cb, map);
    state.strokeIdx    = 0;
    state.stPhase      = 1; // single phase
    state.revealCanvas = null;
    ensureRevealCanvas();

  } else {
    // ── Outline or Outline+Fill ──
    const { pts, color, thickness } = _buildSpecTextOutlinePts(clusters, cb, map);

    state.stOutlineCanvas = document.createElement('canvas');
    state.stOutlineCanvas.width  = state.canvasW;
    state.stOutlineCanvas.height = state.canvasH;
    state.stOutlineCanvas.getContext('2d').clearRect(0, 0, state.canvasW, state.canvasH);

    state.stOutlinePts        = pts;
    state.stOutlineIdx        = 0;
    state.stOutlineLastDrawn  = 0;
    state.stOutlineColor      = color;
    state.stOutlineThickness  = thickness;
    state.stPhase             = 1; // 1=outline, 2=fill

    if (sty === 'outline-fill') {
      // Pre-build fill pts so phase 2 is ready to run immediately
      state.stFillPts  = _buildSpecTextRevealPts(clusters, cb, map);
      state.strokeList = state.stFillPts;
      state.strokeIdx  = 0;
      state.revealCanvas = null;
      ensureRevealCanvas();
    } else {
      state.stFillPts = null;
    }
  }
}

function tickSpecText(speed) {
  const sty = state.textDrawStyle || 'reveal';
  const handSpeed = parseInt(document.getElementById('hand-speed-slider').value);

  // ── Reveal mode ────────────────────────────────────────────────────────────
  if (sty === 'reveal') {
    const pts = state.strokeList;
    if (!pts || !pts.length) { finishAnim(); return; }
    let budget = handSpeed;
    while (budget > 0 && state.strokeIdx < pts.length) {
      const p = pts[state.strokeIdx++];
      if (!p.isJump) budget--;
      if (!p.isJump && p.revealColX !== undefined) {
        const rc = state.revealCanvas.getContext('2d');
        const rh = p.revealColY2 - p.revealColY1 + 1;
        if (rh > 0) rc.drawImage(offscreen, p.revealColX, p.revealColY1, p.revealColW, rh,
                                            p.revealColX, p.revealColY1, p.revealColW, rh);
      }
    }
    ctx.save(); fillBg(ctx); ctx.drawImage(state.revealCanvas, 0, 0); ctx.restore();
    if (state.strokeIdx >= pts.length) { finishAnim(); return; }
    const tip = pts[Math.min(state.strokeIdx, pts.length-1)];
    const prv = pts[Math.max(0, state.strokeIdx-1)];
    hctx.clearRect(0,0,state.canvasW,state.canvasH);
    drawHand(hctx, tip.x, tip.y, tip.isJump ? 1 : (tip.y>=prv.y?1:-1), state.hand);
    setProgress(state.strokeIdx / pts.length);
    return;
  }

  // ── Phase 1: draw outlines ─────────────────────────────────────────────────
  if (state.stPhase === 1) {
    const JUMP = 8 * resScale();
    const pts  = state.stOutlinePts;
    if (!pts || !pts.length) {
      if (sty === 'outline') { finishAnim(); return; }
      state.stPhase = 2; state.strokeIdx = 0; return;
    }

    const step   = Math.max(1, handSpeed);
    const newIdx = Math.min(state.stOutlineIdx + step, pts.length - 1);
    const oc     = state.stOutlineCanvas.getContext('2d');

    if (newIdx > state.stOutlineLastDrawn) {
      _strokePencil(oc, pts, state.stOutlineLastDrawn, newIdx,
        state.stOutlineColor, state.stOutlineThickness,
        JUMP);
      state.stOutlineLastDrawn = newIdx;
    }
    state.stOutlineIdx = newIdx;

    ctx.save(); fillBg(ctx);
    ctx.drawImage(state.stOutlineCanvas, 0, 0);
    ctx.restore();

    const outProg = newIdx / pts.length;
    setProgress(sty === 'outline-fill' ? outProg * 0.45 : outProg);

    if (newIdx >= pts.length - 1) {
      if (sty === 'outline') { finishAnim(); return; }
      // Transition to fill phase
      state.stPhase   = 2;
      state.strokeIdx = 0;
      return;
    }
    const tip = pts[newIdx], prv = pts[Math.max(0, newIdx-1)];
    hctx.clearRect(0,0,state.canvasW,state.canvasH);
    drawHand(hctx, tip.x, tip.y, tip.x >= prv.x ? 1 : -1, state.hand);
    return;
  }

  // ── Phase 2: fill reveal (outline-fill only) ───────────────────────────────
  if (state.stPhase === 2) {
    const pts = state.stFillPts || state.strokeList;
    if (!pts || !pts.length) { finishAnim(); return; }

    let budget = handSpeed;
    while (budget > 0 && state.strokeIdx < pts.length) {
      const p = pts[state.strokeIdx++];
      if (!p.isJump) budget--;
      if (!p.isJump && p.revealColX !== undefined) {
        const rc = state.revealCanvas.getContext('2d');
        const rh = p.revealColY2 - p.revealColY1 + 1;
        if (rh > 0) rc.drawImage(offscreen, p.revealColX, p.revealColY1, p.revealColW, rh,
                                            p.revealColX, p.revealColY1, p.revealColW, rh);
      }
    }

    ctx.save(); fillBg(ctx);
    ctx.drawImage(state.revealCanvas,    0, 0); // filled pixels beneath
    ctx.drawImage(state.stOutlineCanvas, 0, 0); // outline on top
    ctx.restore();

    if (state.strokeIdx >= pts.length) { finishAnim(); return; }

    setProgress(0.45 + (state.strokeIdx / pts.length) * 0.55);
    const tip = pts[Math.min(state.strokeIdx, pts.length-1)];
    const prv = pts[Math.max(0, state.strokeIdx-1)];
    hctx.clearRect(0,0,state.canvasW,state.canvasH);
    drawHand(hctx, tip.x, tip.y, tip.isJump ? 1 : (tip.y>=prv.y?1:-1), state.hand);
  }
}

function setupStyle() {
  switch(state.animStyle) {
    case 'contour':         setupContour();                  break;
    case 'outlinechunks':   setupOutlineChunks();            break;
    case 'outlinefill':     setupOutlineFill();              break;
    case 'illustfill':
      setupIllustFill();
      if (state.outlineAlgorithm && state.outlineAlgorithm !== 'classic') {
        const lastPt1 = state.ifPerimPts?.length > 0 ? state.ifPerimPts[state.ifPerimPts.length-1] : null;
        const wpts1 = _buildInkWaypointsByAlgorithm(lastPt1);
        if (wpts1) state.ifInkWaypoints = wpts1;
      }
      break;
    case 'outlineonly':
      setupIllustFill();
      // Override auto-detected color with user's choice if not auto
      if (!document.getElementById('outlineonly-autocolor')?.checked) {
        const col = document.getElementById('outlineonly-color')?.value || '#000000';
        state.ifOutlineColor = col;
      }
      state.ifOutlineThickness = parseFloat(document.getElementById('outlineonly-thickness')?.value ?? 2) * resScale();
      if (state.outlineAlgorithm && state.outlineAlgorithm !== 'classic') {
        // New algorithm takes priority over Color Region / Real Image checkboxes
        const lastPt2 = state.ifPerimPts?.length > 0 ? state.ifPerimPts[state.ifPerimPts.length-1] : null;
        const wpts2 = _buildInkWaypointsByAlgorithm(lastPt2);
        if (wpts2) state.ifInkWaypoints = wpts2;
      } else {
        // Color Region Outlines: swap ink waypoints with color-boundary waypoints
        if (document.getElementById('outlineonly-colorregion')?.checked) {
          const lastPt = state.ifPerimPts && state.ifPerimPts.length > 0
            ? state.ifPerimPts[state.ifPerimPts.length - 1] : null;
          state.ifInkWaypoints = buildColorRegionInkWaypoints(lastPt);
        }
        // Real Image Edges: swap ink waypoints with Sobel-NMS edge waypoints
        if (document.getElementById('outlineonly-realimage')?.checked) {
          const lastPt = state.ifPerimPts && state.ifPerimPts.length > 0
            ? state.ifPerimPts[state.ifPerimPts.length - 1] : null;
          state.ifInkWaypoints = buildRealImageInkWaypoints(lastPt);
        }
      }
      break;
    case 'chunkjump':       setupChunkJump();                break;
    case 'scribble':        setupScribble();                 break;
    case 'spec-text':         setupSpecText();                 break;
    case 'spec-human':      setupSpecialized('human');       break;
    case 'spec-animal':     setupSpecialized('animal');      break;
    case 'spec-portrait':   setupSpecialized('portrait');    break;
    case 'spec-vehicle':    setupSpecialized('vehicle');     break;
    case 'spec-building':   setupSpecialized('building');    break;
    case 'spec-landscape':  setupSpecialized('landscape');   break;
    case 'spec-spiral':     setupSpecialized('spiral');      break;
    default:                setupScanner();                  break;
  }
}

function resetAnim() {
  cancelAnimationFrame(state.animFrame);
  // Clean up any active parallel slots
  state._activeSlots  = [];
  state._currentSlot  = null;
  state._slotMode     = false;
  ctx = _mainCtx;
  state.playing=false; state.done=false;
  state.revealCanvas=null;
  state.edgeCanvas=null;
  state.ofOutlineCanvas=null; state.ofColorCanvas=null;
  state.ofPhase=1; state.ofPerimIdx=0; state.ofFillIdx=0; state.ofLastDrawn=0;
  state.ofColorGroups=null; state.ofColorIdx=0; state.ofWaypointIdx=0; state.ofRevealY=0; state.ofOutlineThickness=null;
  state.ifOutlineCanvas=null; state.ifColorCanvas=null; state.ifInkCanvas=null;
  state.ifPhase=1; state.ifPerimIdx=0; state.ifLastDrawn=0;
  state.ifInkIdx=0; state.ifInkLastDrawn=0; state.ifInkWaypoints=null;
  state.ifInternalIdx=0; state.ifInternalLast=0;
  state.ifColorGroups=null; state.ifColorIdx=0; state.ifWaypointIdx=0; state.ifRevealY=0;
  // spec-text outline/fill state
  state.stPhase=1; state.stOutlineCanvas=null; state.stOutlinePts=null;
  state.stOutlineIdx=0; state.stOutlineLastDrawn=0; state.stFillPts=null;
  // Note: bgCanvas is NOT cleared here — it is managed by preRender/finishAnim
  state.scribblePhase=0;
  state.contourPhase=1;
  state.noFlashFinish=false;
  updatePlayIcons();
  // Only wipe the canvas if we're not mid-sequence (bgCanvas present means layers already drawn)
  if (!state.bgCanvas) fillBg(ctx);
  hctx.clearRect(0,0,state.canvasW,state.canvasH);
  sctx.clearRect(0,0,state.canvasW,state.canvasH);
  setProgress(0);
  const ov = document.getElementById('outline-overlay');
  if (ov) { ov.style.display='none'; ov.style.opacity=1; }
}

function restartAnim() {
  if (state.layers.length > 0) { generate(); return; }
  if (!offscreen) return;
  resetAnim(); setupStyle(); startAnim();
}

function startAnim()  { state.playing=true; updatePlayIcons(); animate(); }
function togglePlay() {
  if (state.done) { restartAnim(); return; }
  state.playing=!state.playing; updatePlayIcons();
  if (state.playing) animate();
}
function updatePlayIcons() {
  document.getElementById('play-icon').style.display  = state.playing?'none':'block';
  document.getElementById('pause-icon').style.display = state.playing?'block':'none';
}

function finishAnim() {
  // What style just finished?
  const _finishAnimStyle = state.animStyle;
  const _isOutlineOnly   = _finishAnimStyle === 'outlineonly';
  const _isOutlineStyle  = _finishAnimStyle === 'illustfill' || _finishAnimStyle === 'outlinefill';
  const _isSpecText      = _finishAnimStyle === 'spec-text';
  const _textDrawStyle   = state.textDrawStyle || 'reveal';
  const _specTextNoReveal= _isSpecText && _textDrawStyle !== 'reveal';
  const _imageRevealOn   = document.getElementById('image-reveal')?.checked !== false;
  const _shouldBakeRawImage = !_isOutlineOnly && !_specTextNoReveal && (!_isOutlineStyle || _imageRevealOn);

  // ── SLOT PATH (parallel animation) ──────────────────────────────────────────
  const slot = state._currentSlot;
  if (slot) {
    // Bake this slot's completed result into the shared bgCanvas
    if (state.bgCanvas) {
      const bc = state.bgCanvas.getContext('2d');
      if (_shouldBakeRawImage) {
        const l = slot.layer;
        if (l) {
          bc.save(); bc.globalAlpha = l.opacity ?? 1;
          bc.drawImage(l.img, l.x, l.y, l.w, l.h);
          bc.restore();
        }
      } else {
        // Bake drawn strokes / fills (no raw image)
        if (state.ifColorCanvas)   bc.drawImage(state.ifColorCanvas,   0, 0);
        if (state.ofColorCanvas)   bc.drawImage(state.ofColorCanvas,   0, 0);
        if (state.ifOutlineCanvas) bc.drawImage(state.ifOutlineCanvas, 0, 0);
        if (state.ofOutlineCanvas) bc.drawImage(state.ofOutlineCanvas, 0, 0);
        if (state.ifInkCanvas)     bc.drawImage(state.ifInkCanvas,     0, 0);
        // spec-text outline/fill modes
        if (_specTextNoReveal) {
          if (state.revealCanvas)    bc.drawImage(state.revealCanvas,    0, 0);
          if (state.stOutlineCanvas) bc.drawImage(state.stOutlineCanvas, 0, 0);
        }
      }
    }
    // Mark slot done; _tickAllSlots will detect when all slots finish
    slot.done = true;
    hctx.clearRect(0, 0, state.canvasW, state.canvasH);
    setProgress(1);
    return; // _tickAllSlots handles group advancement
  }

  // ── LEGACY SINGLE-SLOT PATH (kept for non-layer / direct use) ───────────────
  // BUG FIX: When an outline style ran without revealing the raw image, baking layer.img into
  // bgCanvas would make the raw image leak into ALL subsequent layers' animations.
  if (state.bgCanvas) {
    const bc = state.bgCanvas.getContext('2d');
    const layer = (state._animQueue && state._animQueue[state._queuePos])
      ? state._animQueue[state._queuePos]
      : state.layers[state.activeLayerIndex];
    if (_shouldBakeRawImage) {
      if (layer) {
        bc.save(); bc.globalAlpha = (layer.opacity !== undefined ? layer.opacity : 1);
        bc.drawImage(layer.img, layer.x, layer.y, layer.w, layer.h);
        bc.restore();
      }
    } else {
      if (state.ifColorCanvas)   bc.drawImage(state.ifColorCanvas,   0, 0);
      if (state.ofColorCanvas)   bc.drawImage(state.ofColorCanvas,   0, 0);
      if (state.ifOutlineCanvas) bc.drawImage(state.ifOutlineCanvas, 0, 0);
      if (state.ofOutlineCanvas) bc.drawImage(state.ofOutlineCanvas, 0, 0);
      if (state.ifInkCanvas)     bc.drawImage(state.ifInkCanvas,     0, 0);
      // spec-text outline/fill modes
      if (_specTextNoReveal) {
        if (state.revealCanvas)    bc.drawImage(state.revealCanvas,    0, 0);
        if (state.stOutlineCanvas) bc.drawImage(state.stOutlineCanvas, 0, 0);
      }
    }
  }

  // Suppress raw-image flash for non-reveal spec-text and outline-only modes
  if (!state.noFlashFinish && (_imageRevealOn || !_isOutlineStyle) && !_specTextNoReveal) {
    ctx.save(); fillBg(ctx); ctx.drawImage(offscreen,0,0); ctx.restore();
  } else if (_specTextNoReveal) {
    // Composite the drawn strokes as the final frame (no raw image blit)
    ctx.save(); fillBg(ctx);
    if (state.revealCanvas)    ctx.drawImage(state.revealCanvas,    0, 0);
    if (state.stOutlineCanvas) ctx.drawImage(state.stOutlineCanvas, 0, 0);
    ctx.restore();
  }
  hctx.clearRect(0,0,state.canvasW,state.canvasH);
  state.done=true; state.playing=false; updatePlayIcons();
  setProgress(1);

  const finishedStyle = state.animStyle;
  if (state._savedAnimStyle !== undefined) state.animStyle = state._savedAnimStyle;
  if (state._savedHand      !== undefined) state.hand      = state._savedHand;
  if (state._savedZigzag    !== undefined) state.zigzag    = state._savedZigzag;

  const nextPos = (state._queuePos ?? 0) + 1;
  if (state._animQueue && nextPos < state._animQueue.length) {
    setTimeout(() => _runGroupAt(nextPos), 200); // legacy: each "group" is 1 layer
  } else {
    state.bgCanvas = null;
    document.getElementById('done-badge').classList.add('show');
    drawSelectionHandles();
    if ((finishedStyle==='illustfill'||finishedStyle==='outlinefill'||finishedStyle==='outlineonly') &&
        (state.ifOutlineCanvas||state.ifInkCanvas||state.ofOutlineCanvas)) {
      _bakeOutlineOverlay();
    }
  }
}

function _bakeOutlineOverlay() {
  const ov = document.getElementById('outline-overlay');
  ov.width  = state.canvasW;
  ov.height = state.canvasH;
  const oc2 = ov.getContext('2d');
  oc2.clearRect(0,0,state.canvasW,state.canvasH);
  // Illust Fill canvases
  if (state.ifOutlineCanvas) oc2.drawImage(state.ifOutlineCanvas, 0, 0);
  if (state.ifInkCanvas)     oc2.drawImage(state.ifInkCanvas, 0, 0);
  // Outline Fill canvas
  if (state.ofOutlineCanvas) oc2.drawImage(state.ofOutlineCanvas, 0, 0);
  const visible = document.getElementById('outline-visible')?.checked !== false;
  const opacity = (document.getElementById('outline-opacity')?.value ?? 100) / 100;
  ov.style.display  = visible ? 'block' : 'none';
  ov.style.opacity  = opacity;
}

function setOutlineVisible(visible) {
  const ov = document.getElementById('outline-overlay');
  if (ov) ov.style.display = visible ? 'block' : 'none';
}

function setOutlineOpacity(val) {
  const ov = document.getElementById('outline-overlay');
  if (ov) ov.style.opacity = val / 100;
  const el = document.getElementById('outline-opacity-val');
  if (el) el.textContent = val + '%';
}


  // ============================================================
  // PUBLIC API - Export all animation functions
  // ============================================================

  window.AnimationEngine = {
    // Setup functions (called before animation starts)
    setupScanner,
    setupContour,
    setupOutlineChunks,
    setupOutlineFill,
    setupIllustFill,
    setupChunkJump,
    setupScribble,
    setupSpecText,
    setupSpecialized,
    
    // Core animation algorithms
    tickScanner,
    tickContour,
    tickOutlineChunks,
    tickOutlineFill,
    tickIllustFill,
    tickOutlineOnly,
    tickChunkJump,
    tickScribble,
    tickSpecText,
    tickSpecialized,
    
    // Helper functions (used by setupStyle and animations)
    buildPresenceMap,
    revealUpToY,
    ensureRevealCanvas,
    _buildInkWaypointsByAlgorithm,
    buildColorRegionInkWaypoints,
    buildRealImageInkWaypoints,
    
    // Slot system (needed for parallel animations)
    _SLOT_KEYS,
    _slotIn,
    _slotOut,
    _tickSlot,
    _tickAllSlots,
  };

  console.log('✓ Animation Engine loaded');

})(window);
