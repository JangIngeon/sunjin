import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { buildFacility, LABELS } from '../scene/buildFacility.js'
import { ctx } from '../scene/helpers.js'
import { CX, CZ } from '../scene/helpers.js'
import { TERMS, CATS } from '../data/terms.js'
import { useAppStore } from '../store/useAppStore.js'

/**
 * 3D 뷰포트 — 레퍼런스(용어사전 HTML)의 카메라·라벨·인터랙션 로직을
 * 그대로 포팅한 명령형 three.js 계층. React는 컨테이너와 상태 구독만 담당.
 *
 * 모션 동일성 체크리스트 (레퍼런스 대비):
 *  · 좌드래그 궤도 / 우드래그 팬 / 휠 커서줌(레이캐스트 타깃 이동) / 시점 초기화
 *  · 카메라 이동 중 라벨 페이드아웃 → 정지 260ms 후 방사형 재배치
 *  · 호버: 발광 하이라이트 + 커서 추종 툴팁
 *  · 선택: 나머지 회색화(Focus) + 굵은 검정 윤곽선 + 선택 리더 강조
 *  · 외벽 카메라방향 자동 페이드, 상부 슬래브 탑뷰/선택 연동 페이드
 *  · 배관 그라디언트 + 흐름 패킷(꼬리 4개) 애니메이션, 계통별 토글
 */

function V(x, y, z) { return new THREE.Vector3(x - CX, z, y - CZ) }

const FLOOR_OF_Z = (z) => (z < 12 ? 'b1' : z < 25.5 ? 'f1' : z < 39 ? 'f2' : 'roof')
/* 층별 z-대역 (도면 좌표) — 흐름 배관/도트의 층 아이솔레이션 판정용 */
const FLOOR_BANDS = { b1: [-99, 12], f1: [12, 25.5], f2: [25.5, 39], roof: [39, 999] }

export default function Viewport() {
  const hostRef = useRef(null)

  useEffect(() => {
    const host = hostRef.current
    const canvas = host.querySelector('canvas')
    const leadersSvg = host.querySelector('.leaders')
    const selectedLeaderSvg = host.querySelector('.selected-leader')
    const labelsDiv = host.querySelector('.labels')
    const tip = host.querySelector('.tip3d')

    /* ── 렌더러/카메라 ── */
    // 고정 디자인 캔버스(1908×928)가 scale로 축소되므로, 선명도를 위해 배율을 픽셀비율에 반영
    const designScale = () => window.__designScale || 1
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    const applyPixelRatio = () =>
      renderer.setPixelRatio(Math.min(Math.max((window.devicePixelRatio || 1) * designScale(), 0.75), 2.5))
    applyPixelRatio()
    renderer.setClearColor(0xffffff, 1)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    const scene = new THREE.Scene()
    // 시인성 확장: 수평 1.8배(면적 3.24배) · 수직 2.2배(층고 피치 13.5→29.7m)
    // 도면 좌표계는 그대로 두고 씬 루트 그룹을 비등방 스케일한다
    const FS = new THREE.Vector3(1.8, 2.2, 1.8)
    const camera = new THREE.PerspectiveCamera(33, 1, 1, 8000)
    const target = new THREE.Vector3(-40, 14, -11)
    const sph = { az: -0.62, pol: 1.02, dist: 630 }
    const HOME = { az: -0.62, pol: 1.02, dist: 630, tx: -40, ty: 22, tz: -11 }

    function updateCam() {
      const sp = Math.sin(sph.pol), cp = Math.cos(sph.pol)
      camera.position.set(
        target.x + sph.dist * sp * Math.sin(sph.az),
        target.y + sph.dist * cp,
        target.z + sph.dist * sp * Math.cos(sph.az))
      camera.lookAt(target)
      markCameraMoving()
    }

    // 고명도 파스텔 무드: 하이키 조명 (그림자 최소, 밝은 바닥 반사광)
    /* 전체 컬러톤 명도 상향 */
    scene.add(new THREE.HemisphereLight(0xffffff, 0xeef1f5, 1.4))
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.52); dir1.position.set(120, 180, 80); scene.add(dir1)
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.26); dir2.position.set(-100, 80, -120); scene.add(dir2)

    /* ── 시설 구축 (스케일 그룹) ── */
    const facilityRoot = new THREE.Group()
    facilityRoot.scale.copy(FS)
    scene.add(facilityRoot)
    buildFacility(facilityRoot)
    const { groupReg, pickables, wallsFade, flows, slabs } = ctx

    /* 장비 색 보정 — 파스텔 무드: 명도는 유지하고 채도만 살짝 올린다 */
    ;(function enhanceBaseEquipmentColors() {
      const seen = []
      for (const id in groupReg) groupReg[id].traverse((o) => {
        if (!o.isMesh || !o.material || !o.material.color || o.userData.flowPart || o.userData.selectionOutline) return
        if (seen.indexOf(o.material) !== -1) return
        seen.push(o.material)
        const hsl = { h: 0, s: 0, l: 0 }
        o.material.color.getHSL(hsl)
        if (hsl.s > 0.04) hsl.s = Math.min(1, hsl.s * 1.12 + 0.015)
        o.material.color.setHSL(hsl.h, hsl.s, hsl.l)
      })
    })()

    /* ── 라벨/리더 생성 ── */
    const labelObjs = []
    const anchorZ = {}
    for (let i = 0; i < LABELS.length; i++) {
      const id = LABELS[i][0]
      const t = TERMS[id]
      anchorZ[id] = LABELS[i][1][2]
      const div = document.createElement('div')
      div.className = 'lbl'
      div.setAttribute('data-label-id', id)
      div.style.setProperty('--cat', CATS[t.cat].color)
      div.innerHTML = '<div class="lt">' + t.name + '</div><div class="le">' + t.en + '</div>'
      div.addEventListener('click', (e) => { e.stopPropagation(); hideTip(); useAppStore.getState().setSelected(id) })
      div.addEventListener('mouseenter', (e) => showTip(id, e))
      div.addEventListener('mousemove', moveTip)
      div.addEventListener('mouseleave', hideTip)
      labelsDiv.appendChild(div)
      const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line')
      ln.setAttribute('stroke', '#929497'); ln.setAttribute('stroke-width', '1.6')
      ln.setAttribute('stroke-dasharray', '0.1 7'); ln.setAttribute('stroke-linecap', 'round')
      ln.setAttribute('stroke-opacity', '0.88')
      leadersSvg.appendChild(ln)
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      dot.setAttribute('r', '1.25'); dot.setAttribute('fill', '#929497')
      dot.setAttribute('stroke', '#929497'); dot.setAttribute('stroke-opacity', '0.88')
      leadersSvg.appendChild(dot)
      labelObjs.push({
        id, anchor: V(LABELS[i][1][0], LABELS[i][1][1], LABELS[i][1][2]).multiply(FS),
        div, line: ln, dot, hidden: false, sx: 0, sy: 0,
        floor: FLOOR_OF_Z(LABELS[i][1][2]),
      })
    }

    /* ── 라벨 레이아웃 (레퍼런스 알고리즘 포팅) ── */
    let labelsDirty = true
    let labelTimer = null
    function markCameraMoving() {
      host.classList.add('labels-moving')
      labelsDirty = true
      if (labelTimer) clearTimeout(labelTimer)
      labelTimer = setTimeout(() => {
        host.classList.remove('labels-moving')
        layoutLabels(true)
      }, 260)
    }

    function layoutLabels(force) {
      if (!useAppStore.getState().labelsOn) return
      if (host.classList.contains('labels-moving')) return
      if (!force && !labelsDirty) return
      labelsDirty = false
      const w = host.clientWidth, h = host.clientHeight
      if (!w || !h) return
      const items = []
      const labelW = Math.max(104, Math.min(140, w * 0.105)), labelH = 31
      for (let i = 0; i < labelObjs.length; i++) {
        const L = labelObjs[i]
        if (L.hidden) {
          L.div.classList.add('hid'); L.line.setAttribute('opacity', '0'); L.dot.setAttribute('opacity', '0')
          continue
        }
        const p = L.anchor.clone().project(camera)
        L.sx = (p.x * 0.5 + 0.5) * w; L.sy = (-p.y * 0.5 + 0.5) * h
        L.div.classList.remove('hid'); L.div.style.width = labelW + 'px'; L.div.style.maxWidth = labelW + 'px'
        items.push(L)
      }
      if (!items.length) return
      /* 단층 원본과 동일한 라벨 프레임 공식 */
      const frame = { l: Math.max(18, w * 0.018) + 20, r: w - Math.max(18, w * 0.018) - 20, t: Math.max(16, h * 0.025) + 50, b: h - Math.max(16, h * 0.025) - 40 }
      const gapX = Math.max(30, w * 0.022), gapY = Math.max(26, h * 0.038), innerW = frame.r - frame.l
      const horizontalCapacity = Math.max(4, Math.floor((innerW + gapX) / (labelW + gapX)))
      let topCount = Math.min(horizontalCapacity, Math.ceil(items.length * 0.34))
      let bottomCount = Math.min(horizontalCapacity, Math.ceil(items.length * 0.34))
      let sideTotal = Math.max(0, items.length - topCount - bottomCount)
      let leftCount = Math.ceil(sideTotal / 2), rightCount = sideTotal - leftCount
      const maxSide = Math.max(leftCount, rightCount), usableSideH = frame.b - frame.t - labelH * 2 - gapY * 2
      if (maxSide > 1 && usableSideH / (maxSide - 1) < labelH + gapY) {
        const need = items.length - (Math.floor(usableSideH / (labelH + gapY)) + 1) * 2
        topCount = Math.min(horizontalCapacity, Math.ceil(need / 2)); bottomCount = Math.min(horizontalCapacity, need - topCount)
        sideTotal = Math.max(0, items.length - topCount - bottomCount); leftCount = Math.ceil(sideTotal / 2); rightCount = sideTotal - leftCount
      }
      const slots = []
      function addHorizontal(count, y, side) {
        if (!count) return
        const space = innerW - labelW
        for (let n = 0; n < count; n++) slots.push({ x: frame.l + (count === 1 ? space / 2 : space * n / (count - 1)), y, side })
      }
      function addVertical(count, x, side) {
        if (!count) return
        const y0 = frame.t + labelH + gapY, y1 = frame.b - labelH * 2 - gapY
        for (let n = 0; n < count; n++) slots.push({ x, y: count === 1 ? (y0 + y1) / 2 : y0 + (y1 - y0) * n / (count - 1), side })
      }
      addHorizontal(topCount, frame.t, 'top'); addHorizontal(bottomCount, frame.b - labelH, 'bottom')
      addVertical(leftCount, frame.l, 'left'); addVertical(rightCount, frame.r - labelW, 'right')
      ;(function addAvoidanceCandidates() {
        const maxX = frame.r - labelW, yTop = frame.t, yBottom = frame.b - labelH
        const stepX = Math.max(18, (labelW + gapX) / 4), stepY = Math.max(14, (labelH + gapY) / 3)
        for (let ax = frame.l; ax <= maxX + 0.5; ax += stepX) { slots.push({ x: Math.min(ax, maxX), y: yTop, side: 'top' }); slots.push({ x: Math.min(ax, maxX), y: yBottom, side: 'bottom' }) }
        slots.push({ x: maxX, y: yTop, side: 'top' }); slots.push({ x: maxX, y: yBottom, side: 'bottom' })
        const minY = frame.t + labelH + gapY, maxY = frame.b - labelH * 2 - gapY
        for (let ay = minY; ay <= maxY + 0.5; ay += stepY) { slots.push({ x: frame.l, y: Math.min(ay, maxY), side: 'left' }); slots.push({ x: frame.r - labelW, y: Math.min(ay, maxY), side: 'right' }) }
        slots.push({ x: frame.l, y: maxY, side: 'left' }); slots.push({ x: frame.r - labelW, y: maxY, side: 'right' })
      })()
      function buildModelAvoidRects() {
        const rects = []
        const bb = new THREE.Box3()
        const v = new THREE.Vector3()
        scene.updateMatrixWorld(true); camera.updateMatrixWorld(true)
        scene.traverse((o) => {
          if (!o.isMesh || !o.visible || o.userData.groundSurface || o.userData.selectionOutline || o.userData.flowParticle) return
          bb.setFromObject(o)
          if (bb.isEmpty()) return
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, valid = false
          for (let xi = 0; xi < 2; xi++) for (let yi = 0; yi < 2; yi++) for (let zi = 0; zi < 2; zi++) {
            v.set(xi ? bb.max.x : bb.min.x, yi ? bb.max.y : bb.min.y, zi ? bb.max.z : bb.min.z).project(camera)
            if (!isFinite(v.x) || !isFinite(v.y)) continue
            const px = (v.x * 0.5 + 0.5) * w, py = (-v.y * 0.5 + 0.5) * h
            valid = true
            minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py)
          }
          if (!valid || maxX < 0 || minX > w || maxY < 0 || minY > h) return
          rects.push({ l: minX - 4, r: maxX + 4, t: minY - 4, b: maxY + 4 })
        })
        return rects
      }
      const modelAvoidKey = [w, h, camera.position.x.toFixed(3), camera.position.y.toFixed(3), camera.position.z.toFixed(3), camera.quaternion.x.toFixed(5), camera.quaternion.y.toFixed(5), camera.quaternion.z.toFixed(5), camera.quaternion.w.toFixed(5)].join('|')
      let modelAvoidRects
      if (layoutLabels._key === modelAvoidKey && layoutLabels._rects) modelAvoidRects = layoutLabels._rects
      else { modelAvoidRects = buildModelAvoidRects(); layoutLabels._key = modelAvoidKey; layoutLabels._rects = modelAvoidRects }
      function modelOverlapPenalty(slot) {
        const l = slot.x - 3, r = slot.x + labelW + 3, t = slot.y - 3, b = slot.y + labelH + 3
        let maxArea = 0, hits = 0
        for (let mi = 0; mi < modelAvoidRects.length; mi++) {
          const mr = modelAvoidRects[mi]
          const ox = Math.min(r, mr.r) - Math.max(l, mr.l), oy = Math.min(b, mr.b) - Math.max(t, mr.t)
          if (ox > 0 && oy > 0) { hits++; maxArea = Math.max(maxArea, ox * oy) }
        }
        return maxArea ? 240000 + maxArea * 45 + Math.min(hits, 8) * 3500 : 0
      }
      for (let mp = 0; mp < slots.length; mp++) slots[mp].modelPenalty = modelOverlapPenalty(slots[mp])
      function cross(a, b, c, d) {
        function ccw(p1, p2, p3) { return (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x) }
        return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d)
      }
      function segmentHitsText(a, b, slot) {
        const r = { l: slot.x + 5, r: slot.x + labelW, t: slot.y + 1, b: slot.y + labelH - 1 }
        if (a.x > r.l && a.x < r.r && a.y > r.t && a.y < r.b) return true
        const tl = { x: r.l, y: r.t }, tr = { x: r.r, y: r.t }, br = { x: r.r, y: r.b }, bl = { x: r.l, y: r.b }
        return cross(a, b, tl, tr) || cross(a, b, tr, br) || cross(a, b, br, bl) || cross(a, b, bl, tl)
      }
      function endpoint(slot, item) {
        const top = { x: slot.x, y: slot.y }, bottom = { x: slot.x, y: slot.y + labelH - 2 }, anchor = { x: item.sx, y: item.sy }
        const topScore = (segmentHitsText(anchor, top, slot) ? 1000000 : 0) + Math.hypot(anchor.x - top.x, anchor.y - top.y)
        const bottomScore = (segmentHitsText(anchor, bottom, slot) ? 1000000 : 0) + Math.hypot(anchor.x - bottom.x, anchor.y - bottom.y)
        return topScore <= bottomScore ? top : bottom
      }
      function slotsOverlap(a, b) {
        return !(a.x + labelW + gapX <= b.x || b.x + labelW + gapX <= a.x || a.y + labelH + gapY <= b.y || b.y + labelH + gapY <= a.y)
      }
      const cx2 = w / 2, cy2 = h / 2, used = {}, assigned = []
      items.sort((a, b) => Math.hypot(b.sx - cx2, b.sy - cy2) - Math.hypot(a.sx - cx2, a.sy - cy2))
      for (let k = 0; k < items.length; k++) {
        const item = items[k]
        let best = -1, bestScore = Infinity
        let ivx = item.sx - cx2, ivy = item.sy - cy2
        const il = Math.max(1, Math.hypot(ivx, ivy)); ivx /= il; ivy /= il
        for (let pass2 = 0; pass2 < 2; pass2++) {
          for (let q = 0; q < slots.length; q++) {
            if (used[q]) continue
            let blocked = false
            for (let ba = 0; ba < assigned.length; ba++) if (slotsOverlap(slots[q], assigned[ba].slot)) { blocked = true; break }
            if (pass2 === 0 && blocked) continue
            const e = endpoint(slots[q], item)
            let svx = e.x - cx2, svy = e.y - cy2
            const sl = Math.max(1, Math.hypot(svx, svy)); svx /= sl; svy /= sl
            let score = Math.hypot(item.sx - e.x, item.sy - e.y) + (1 - (ivx * svx + ivy * svy)) * 1100 + (slots[q].modelPenalty || 0) + (blocked ? 5000000 : 0)
            for (let a = 0; a < assigned.length; a++) if (cross({ x: item.sx, y: item.sy }, e, { x: assigned[a].item.sx, y: assigned[a].item.sy }, assigned[a].end)) score += 100000
            if (score < bestScore) { bestScore = score; best = q }
          }
          if (best >= 0) break
        }
        if (best < 0) continue
        used[best] = true
        assigned.push({ item, slot: slots[best], end: endpoint(slots[best], item) })
      }
      function assignmentScore(arr) {
        let total = 0
        for (let i = 0; i < arr.length; i++) {
          const ai = arr[i].item, ae = endpoint(arr[i].slot, ai)
          const avx = ai.sx - cx2, avy = ai.sy - cy2, al = Math.max(1, Math.hypot(avx, avy))
          const evx = ae.x - cx2, evy = ae.y - cy2, el = Math.max(1, Math.hypot(evx, evy))
          total += Math.hypot(ai.sx - ae.x, ai.sy - ae.y) + (1 - (avx / al * evx / el + avy / al * evy / el)) * 700 + (arr[i].slot.modelPenalty || 0)
          for (let r = 0; r < arr.length; r++) if (r !== i && segmentHitsText({ x: ai.sx, y: ai.sy }, ae, arr[r].slot)) total += 45000
          for (let j = i + 1; j < arr.length; j++) {
            const aj = arr[j].item, je = endpoint(arr[j].slot, aj)
            if (cross({ x: ai.sx, y: ai.sy }, ae, { x: aj.sx, y: aj.sy }, je)) total += 140000
            if (slotsOverlap(arr[i].slot, arr[j].slot)) total += 8000000
          }
        }
        return total
      }
      let currentScore = assignmentScore(assigned)
      for (let pass = 0; pass < 18; pass++) {
        let bestSwapI = -1, bestSwapJ = -1, bestSwapScore = currentScore
        for (let si = 0; si < assigned.length - 1; si++) for (let sj = si + 1; sj < assigned.length; sj++) {
          let hold = assigned[si].slot; assigned[si].slot = assigned[sj].slot; assigned[sj].slot = hold
          const trial = assignmentScore(assigned)
          hold = assigned[si].slot; assigned[si].slot = assigned[sj].slot; assigned[sj].slot = hold
          if (trial < bestSwapScore - 0.5) { bestSwapScore = trial; bestSwapI = si; bestSwapJ = sj }
        }
        if (bestSwapI < 0) break
        const finalHold = assigned[bestSwapI].slot
        assigned[bestSwapI].slot = assigned[bestSwapJ].slot; assigned[bestSwapJ].slot = finalHold
        assigned[bestSwapI].end = endpoint(assigned[bestSwapI].slot, assigned[bestSwapI].item)
        assigned[bestSwapJ].end = endpoint(assigned[bestSwapJ].slot, assigned[bestSwapJ].item)
        currentScore = bestSwapScore
      }
      const selected = useAppStore.getState().selected
      for (let z2 = 0; z2 < assigned.length; z2++) {
        const A = assigned[z2], item = A.item, x = A.slot.x, y = A.slot.y
        item.div.style.left = x + 'px'; item.div.style.top = y + 'px'
        const attach = endpoint(A.slot, item), lineX = attach.x, lineY = attach.y
        const hit = selectedOutlinePoint(item, lineX, lineY, w, h)
        item.line.setAttribute('x1', hit.x); item.line.setAttribute('y1', hit.y)
        item.line.setAttribute('x2', lineX); item.line.setAttribute('y2', lineY)
        item.dot.setAttribute('cx', hit.x); item.dot.setAttribute('cy', hit.y)
        item.line.setAttribute('opacity', item.id === selected ? '1' : (selected ? '.6' : '.78'))
        item.dot.setAttribute('opacity', item.id === selected ? '1' : (selected ? '.6' : '.78'))
      }
    }

    function refreshSelectedLeader() {
      const w = host.clientWidth, h = host.clientHeight
      const selected = useAppStore.getState().selected
      for (let i = 0; i < labelObjs.length; i++) {
        const L = labelObjs[i]
        const x2 = parseFloat(L.line.getAttribute('x2')), y2 = parseFloat(L.line.getAttribute('y2'))
        if (!isFinite(x2) || !isFinite(y2)) continue
        const hit = (L.id === selected) ? selectedOutlinePoint(L, x2, y2, w, h) : { x: L.sx, y: L.sy }
        L.line.setAttribute('x1', hit.x); L.line.setAttribute('y1', hit.y)
        L.dot.setAttribute('cx', hit.x); L.dot.setAttribute('cy', hit.y)
      }
    }

    /* ── 툴팁 ── */
    function showTip(id, e) {
      const t = TERMS[id]
      if (!t) return
      tip.style.setProperty('--tip-color', CATS[t.cat].color)
      tip.classList.toggle('power-tip', t.cat === 'power')
      tip.innerHTML = '<div class="t-name">' + t.name + '</div><div class="t-en">' + t.en + '</div><div class="t-short">' + t.short + '</div>'
      tip.style.display = 'block'
      if (e) moveTip(e)
    }
    function moveTip(e) {
      // 스케일된 캔버스: 화면 px → 디자인 px 변환 후 배치
      const s = designScale()
      const rect = host.getBoundingClientRect()
      const ex = (e.clientX - rect.left) / s, ey = (e.clientY - rect.top) / s
      const pad = 14
      let x = ex + pad, y = ey + pad
      const tw = tip.offsetWidth, th = tip.offsetHeight
      if (x + tw > host.clientWidth - 8) x = ex - tw - pad
      if (y + th > host.clientHeight - 8) y = ey - th - pad
      tip.style.left = x + 'px'; tip.style.top = y + 'px'
    }
    function hideTip() { tip.style.display = 'none' }

    /* ── 호버/선택/포커스/윤곽선 (레퍼런스 포팅) ── */
    function groupMats(term, fn) {
      const g = groupReg[term]
      if (!g) return
      g.traverse((o) => { if (o.material) fn(o) })
    }
    let hovered = null
    function setHover(term) {
      if (hovered === term) return
      hovered = term
      /* 호버 시 채도 틴트 없이 선택과 동일한 검은 라인 아웃라인만 표시 */
      clearHoverOutline()
      if (hovered && hovered !== useAppStore.getState().selected) buildOutlineEdges(hovered, hoverOutline)
    }

    let focusSaved = []
    function restoreFocus() {
      for (let i = 0; i < focusSaved.length; i++) {
        const f = focusSaved[i]
        f.material.color.copy(f.color)
        if (f.emissive) f.material.emissive.copy(f.emissive)
        if (f.hadVC) { f.material.vertexColors = true; f.material.needsUpdate = true }
      }
      focusSaved = []
    }
    function applyFocus(term) {
      restoreFocus()
      const keep = groupReg[term]
      /* 선택 외 모델: 불투명도 50% 흰색 레이어를 올린 듯 밝게 (색을 흰색으로 50% 블렌드) */
      const whiteTarget = new THREE.Color('#ffffff')
      scene.traverse((o) => {
        if (!o.material || !o.material.color || o.userData.selectionOutline) return
        for (let p = o; p; p = p.parent) if (p === keep) return
        for (let k = 0; k < focusSaved.length; k++) if (focusSaved[k].material === o.material) return
        const entry = { material: o.material, color: o.material.color.clone() }
        if (o.material.emissive) entry.emissive = o.material.emissive.clone()
        if (o.material.vertexColors) {
          entry.hadVC = true
          o.material.vertexColors = false
          o.material.needsUpdate = true
          o.material.color.set('#f2f4f6')
        } else {
          o.material.color.lerp(whiteTarget, 0.8)
        }
        focusSaved.push(entry)
      })
    }

    const selectionOutline = []
    const hoverOutline = []
    function clearOutlineList(list) {
      for (let i = 0; i < list.length; i++) {
        const edge = list[i]
        if (edge.parent) edge.parent.remove(edge)
        if (edge.geometry) edge.geometry.dispose()
        if (edge.material) edge.material.dispose()
      }
      list.length = 0
    }
    function clearSelectionOutline() { clearOutlineList(selectionOutline) }
    function clearHoverOutline() { clearOutlineList(hoverOutline) }
    function makeThickEdge(parent, a, b, radius, material, bucket) {
      const d = new THREE.Vector3().subVectors(b, a), len = d.length()
      if (len < 0.01) return
      const edge = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 6, 1, false), material.clone())
      edge.position.copy(a).add(b).multiplyScalar(0.5)
      edge.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
      edge.userData.selectionOutline = true
      edge.renderOrder = 80
      parent.add(edge)
      bucket.push(edge)
    }
    function applySelectionOutline(term) {
      clearSelectionOutline()
      buildOutlineEdges(term, selectionOutline)
    }
    /* 검은 라인 아웃라인 — 선택·호버 공용 */
    function buildOutlineEdges(term, bucket) {
      const g = groupReg[term]
      if (!g) return
      const meshes = []
      let maxDiag = 0
      const tmpSize = new THREE.Vector3()
      g.traverse((o) => {
        if (!o.isMesh || !o.geometry || o.userData.flowPart || o.userData.selectionOutline) return
        o.geometry.computeBoundingBox()
        if (!o.geometry.boundingBox) return
        const diag = o.geometry.boundingBox.getSize(tmpSize).length()
        maxDiag = Math.max(maxDiag, diag)
        meshes.push({ mesh: o, diag })
      })
      const radius = Math.max(0.06, Math.min(0.13, maxDiag * 0.0065))
      const lineMat = new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
      for (let m = 0; m < meshes.length; m++) {
        const o = meshes[m].mesh, type = o.geometry.type || ''
        if (meshes[m].diag < maxDiag * 0.26 || (!/BoxGeometry|CylinderGeometry/.test(type))) continue
        const edges = new THREE.EdgesGeometry(o.geometry, 24), pos = edges.attributes.position
        for (let i = 0; i < pos.count; i += 2) makeThickEdge(o, new THREE.Vector3().fromBufferAttribute(pos, i), new THREE.Vector3().fromBufferAttribute(pos, i + 1), radius, lineMat, bucket)
        edges.dispose()
      }
      lineMat.dispose()
    }
    function convexHull2D(points) {
      if (points.length < 3) return points
      points.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
      function cr(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x) }
      const lower = [], upper = []
      for (let i = 0; i < points.length; i++) { while (lower.length >= 2 && cr(lower[lower.length - 2], lower[lower.length - 1], points[i]) <= 0) lower.pop(); lower.push(points[i]) }
      for (let j = points.length - 1; j >= 0; j--) { while (upper.length >= 2 && cr(upper[upper.length - 2], upper[upper.length - 1], points[j]) <= 0) upper.pop(); upper.push(points[j]) }
      lower.pop(); upper.pop()
      return lower.concat(upper)
    }
    function selectedOutlinePoint(item, toX, toY, w, h) {
      const selected = useAppStore.getState().selected
      if (item.id !== selected || !groupReg[item.id]) return { x: item.sx, y: item.sy }
      const points = []
      const g = groupReg[item.id]
      g.updateMatrixWorld(true)
      g.traverse((o) => {
        if (!o.isMesh || !o.geometry || o.userData.selectionOutline || o.userData.flowPart) return
        o.geometry.computeBoundingBox()
        const b = o.geometry.boundingBox
        if (!b) return
        const mn = b.min, mx = b.max
        const cs = [[mn.x, mn.y, mn.z], [mx.x, mn.y, mn.z], [mn.x, mx.y, mn.z], [mx.x, mx.y, mn.z], [mn.x, mn.y, mx.z], [mx.x, mn.y, mx.z], [mn.x, mx.y, mx.z], [mx.x, mx.y, mx.z]]
        for (let k = 0; k < cs.length; k++) {
          const p = new THREE.Vector3(cs[k][0], cs[k][1], cs[k][2]).applyMatrix4(o.matrixWorld).project(camera)
          points.push({ x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h })
        }
      })
      const hull = convexHull2D(points)
      if (hull.length < 3) return { x: item.sx, y: item.sy }
      let cx3 = 0, cy3 = 0
      for (let i = 0; i < hull.length; i++) { cx3 += hull[i].x; cy3 += hull[i].y }
      cx3 /= hull.length; cy3 /= hull.length
      const rx = toX - cx3, ry = toY - cy3
      let best = Infinity, hit = null
      for (let n = 0; n < hull.length; n++) {
        const a = hull[n], b = hull[(n + 1) % hull.length]
        const sx = b.x - a.x, sy = b.y - a.y, den = rx * sy - ry * sx
        if (Math.abs(den) < 0.0001) continue
        const qx = a.x - cx3, qy = a.y - cy3
        const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den
        if (t > 0 && u >= 0 && u <= 1 && t < best) { best = t; hit = { x: cx3 + rx * t, y: cy3 + ry * t } }
      }
      return hit || { x: item.sx, y: item.sy }
    }
    let xraySaved = []
    function clearXray() {
      for (let i = 0; i < xraySaved.length; i++) {
        xraySaved[i].m.depthTest = xraySaved[i].dt
        xraySaved[i].obj.renderOrder = xraySaved[i].ro
      }
      xraySaved = []
    }

    /* ── 라벨 동기화 (선택 상태) ── */
    function syncLabels() {
      const selected = useAppStore.getState().selected
      for (let j = 0; j < labelObjs.length; j++) {
        const L = labelObjs[j]
        if (L.hidden) {
          L.div.classList.remove('sel', 'dim')
          L.line.setAttribute('opacity', '0'); L.dot.setAttribute('opacity', '0')
          leadersSvg.appendChild(L.line); leadersSvg.appendChild(L.dot)
          continue
        }
        const same = L.id === selected
        L.div.classList.toggle('sel', same)
        L.div.classList.toggle('dim', !!selected && !same)
        L.line.setAttribute('stroke', same ? '#000' : '#929497')
        L.line.setAttribute('stroke-width', same ? '1.65' : '1.6')
        L.dot.setAttribute('fill', same ? '#000' : '#929497')
        L.dot.setAttribute('r', same ? '2.24' : '1.25')
        L.dot.setAttribute('stroke', same ? '#000' : '#929497')
        L.dot.setAttribute('stroke-opacity', same ? '1' : '.88')
        L.line.setAttribute('stroke-opacity', same ? '1' : '.88')
        L.line.setAttribute('opacity', same ? '1' : (selected ? '.6' : '.78'))
        L.dot.setAttribute('opacity', same ? '1' : (selected ? '.6' : '.78'))
        ;(same ? selectedLeaderSvg : leadersSvg).appendChild(L.line)
        ;(same ? selectedLeaderSvg : leadersSvg).appendChild(L.dot)
      }
    }

    /* ── 계통/층 필터 (opacity 결합) ── */
    function applyVisibility() {
      const { filter, floor } = useAppStore.getState()
      // 계통 dim: term 그룹 단위 (레퍼런스 동일)
      scene.traverse((o) => {
        if (!o.material) return
        /* 고스트 쉘: 아이솔레이션 시 타 층의 건물 외곽 실루엣 라인만 표시 */
        if (o.userData.ghostShell) {
          o.visible = floor !== 'all' && o.userData.shellFloor !== floor
          return
        }
        const base = (o.material.userData && o.material.userData.baseOp !== undefined) ? o.material.userData.baseOp : 1
        let catDim = false
        for (let p = o; p; p = p.parent) {
          if (p.userData && p.userData.cat) { catDim = filter !== 'all' && p.userData.cat !== filter; break }
        }
        // 층 필터는 완전 숨김(반투명 누적 방지), 계통 필터는 레퍼런스처럼 잔상 유지
        // 사이트 디테일(주차장·도로·조경)은 전체 뷰와 "1층" 뷰에서만 표시
        let floorHidden = false
        if (floor !== 'all' && o.userData.flowPart && !o.userData.flowParticle) {
          // 흐름 배관·조인트: 시공 컨텍스트 층 태그는 무시하고 세그먼트의 z-대역(도면
          // 좌표)이 선택 층과 겹칠 때만 표시 — 층 관통 라이저는 모든 층에서 유지
          if (o.userData._zBand === undefined) {
            const wb = new THREE.Box3().setFromObject(o)
            o.userData._zBand = [wb.min.y / FS.y, wb.max.y / FS.y]
          }
          const B = FLOOR_BANDS[floor]
          floorHidden = !(o.userData._zBand[0] < B[1] - 0.3 && o.userData._zBand[1] > B[0] + 0.3)
        } else if (!o.userData.flowParticle) {
          floorHidden =
            (floor !== 'all' && o.userData.floor && o.userData.floor !== floor) ||
            (o.userData.siteDetail && floor !== 'f1' && floor !== 'all') ||
            // 미태깅 사이트·지형·대지: 2층/옥상 아이솔레이션에서는 숨김 (전체·1층·B1 유지)
            ((floor === 'f2' || floor === 'roof') && !o.userData.floor && !o.userData.selectionOutline)
        }
        o.userData._dimmed = catDim || !!floorHidden
        o.userData._floorHidden = !!floorHidden
        /* 층 아이솔레이션: 타 층 구조·장비는 숨김 — 외곽 실루엣은 고스트 쉘이 담당 */
        o.visible = !floorHidden
        o.material.transparent = catDim || base < 1
        o.material.opacity = catDim ? (o.isLineSegments ? 0.03 : 0.06) : base
        // 지하 1층 뷰: 지형 상면을 반투명 유리처럼 (지하가 천장에 덮이지 않게)
        if (o.userData.terrain && o.userData.floorTop) {
          o.material.transparent = true
          o.material.opacity = floor === 'b1' ? 0.14 : base
        }
      })
      for (let i = 0; i < labelObjs.length; i++) {
        const L = labelObjs[i]
        const cat = TERMS[L.id].cat
        L.hidden = (filter !== 'all' && cat !== filter) || (floor !== 'all' && L.floor !== floor)
      }
      labelsDirty = true
      layoutLabels(true)
      syncLabels()
      syncFlowUI()
    }

    /* ── Flow 토글 (레퍼런스 syncFlowUI 포팅) ── */
    function syncFlowUI() {
      const { flowState } = useAppStore.getState()
      for (let f = 0; f < flows.length; f++) {
        const enabled = !!flowState[flows[f].key]
        flows[f].enabled = enabled
        for (let p = 0; p < flows[f].parts.length; p++) {
          const part = flows[f].parts[p], mat = part.material
          part.visible = !part.userData._floorHidden
          if (!mat.userData) mat.userData = {}
          if (!mat.userData.flowBaseColor) mat.userData.flowBaseColor = mat.color.clone()
          /* Flow OFF: 배관은 색·불투명도 그대로 유지, 움직임(도트 애니메이션)만 정지 */
          mat.color.copy(mat.userData.flowBaseColor)
          if (part.userData._dimmed) continue  // 층/계통 필터가 우선
          const baseOp = mat.userData.baseOp === undefined ? 1 : mat.userData.baseOp
          mat.transparent = baseOp < 1
          mat.opacity = baseOp
          mat.needsUpdate = true
        }
        for (let d = 0; d < flows[f].dots.length; d++) {
          // OFF: 도트(패킷)는 숨김 — 배관은 위에서 그대로 유지됨
          flows[f].dots[d].visible = enabled && !flows[f].dots[d].userData._floorHidden
        }
      }
    }

    /* ── 카메라 조작 (레퍼런스 포팅) ── */
    let dragMode = 0
    const last = { x: 0, y: 0 }
    let dragMoved = false
    const ray = new THREE.Raycaster(), mv = new THREE.Vector2()
    let camGoal = null   // 사이드바 포커스 비행 목표 { t:Vector3, d, p }

    function onMouseDown(e) {
      camGoal = null      // 사용자가 직접 조작하면 비행 취소
      dragMode = (e.button === 2) ? 2 : 1
      dragMoved = false
      last.x = e.clientX; last.y = e.clientY
    }
    function onMouseMove(e) {
      if (!dragMode) { hoverPick(e); return }
      // 화면 px → 디자인 px (스케일 배율 보정, 단층 원본과 동일한 조작감)
      const s = designScale()
      const dx = (e.clientX - last.x) / s, dy = (e.clientY - last.y) / s
      if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true
      last.x = e.clientX; last.y = e.clientY
      if (dragMode === 1) {
        sph.az -= dx * 0.0052
        // 거의 180° 상하 회전: 수직 탑뷰(0.06) ↔ 수평 시점(1.54)
        sph.pol = Math.max(0.06, Math.min(1.54, sph.pol - dy * 0.0042))
      } else {
        const k = sph.dist * 0.0011
        const right = new THREE.Vector3().subVectors(camera.position, target).cross(new THREE.Vector3(0, 1, 0)).normalize()
        const up = new THREE.Vector3(0, 1, 0)
        target.add(right.multiplyScalar(dx * k)).add(up.multiplyScalar(dy * k))
      }
      updateCam()
    }
    function onMouseUp() { dragMode = 0 }
    function onWheel(e) {
      e.preventDefault()
      camGoal = null
      const newDist = Math.max(52, Math.min(1100, sph.dist * (e.deltaY > 0 ? 1.1 : 1 / 1.1)))
      const applied = newDist / sph.dist
      const r = canvas.getBoundingClientRect()
      mv.x = ((e.clientX - r.left) / r.width) * 2 - 1
      mv.y = -((e.clientY - r.top) / r.height) * 2 + 1
      ray.setFromCamera(mv, camera)
      let pt = new THREE.Vector3()
      const hits = ray.intersectObjects(pickables, false)
      if (hits.length) pt.copy(hits[0].point)
      else if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), pt)) pt = null
      if (pt) target.lerp(pt, 1 - applied)
      sph.dist = newDist
      updateCam()
    }
    function termOf(obj) {
      let o = obj
      while (o) { if (o.userData && o.userData.term) return o.userData.term; o = o.parent }
      return null
    }
    function pickAt(e) {
      const r = canvas.getBoundingClientRect()
      mv.x = ((e.clientX - r.left) / r.width) * 2 - 1
      mv.y = -((e.clientY - r.top) / r.height) * 2 + 1
      ray.setFromCamera(mv, camera)
      const hits = ray.intersectObjects(pickables, false)
      const { filter, floor } = useAppStore.getState()
      for (let i = 0; i < hits.length; i++) {
        const obj = hits[i].object
        if (obj.userData._dimmed) continue
        const t = termOf(obj)
        if (t) {
          if (filter !== 'all' && TERMS[t] && TERMS[t].cat !== filter) continue
          if (floor !== 'all' && obj.userData.floor && obj.userData.floor !== floor) continue
          return t
        }
      }
      return null
    }
    function hoverPick(e) {
      if (e.target !== canvas) { setHover(null); return }
      const t = pickAt(e)
      setHover(t)
      if (t) { showTip(t, e); canvas.style.cursor = 'pointer' }
      else { hideTip(); canvas.style.cursor = dragMode ? 'grabbing' : 'default' }
    }
    function onClick(e) {
      if (dragMoved) { dragMoved = false; return }
      const t = pickAt(e)
      useAppStore.getState().setSelected(t || null)
    }
    canvas.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('click', onClick)

    /* ── 스토어 구독 ── */
    // 재마운트(모드 전환) 시 라벨 OFF 상태가 유지된 채 돌아올 수 있으므로
    // 초기 labelsOn을 즉시 반영 — 안 하면 미배치 라벨이 (0,0)에 겹쳐 노출된다
    host.classList.toggle('labels-off', !useAppStore.getState().labelsOn)
    let prev = { selected: null, filter: 'all', floor: 'all', flowState: useAppStore.getState().flowState, resetTick: 0, labelsOn: useAppStore.getState().labelsOn, focusTick: 0 }
    const unsubscribe = useAppStore.subscribe((state) => {
      if (state.labelsOn !== prev.labelsOn) {
        host.classList.toggle('labels-off', !state.labelsOn)
        if (state.labelsOn) { labelsDirty = true; layoutLabels(true) }
      }
      /* 사이드바 포커스: 해당 층으로 전환 + 카메라가 부품으로 비행·확대 */
      if (state.focusTick !== prev.focusTick && state.focusId) {
        const L = labelObjs.find((l) => l.id === state.focusId)
        if (L) {
          // fws처럼 전 층을 관통하는 계통은 층 아이솔레이션 없이 전체 뷰 유지
          // 층 전환은 requestFocus 액션이 floor를 함께 설정 → 아래 floor 브랜치에서 처리
          let dist = 140
          const fg = groupReg[state.focusId]
          if (fg) {
            const bb = new THREE.Box3().setFromObject(fg)
            if (!bb.isEmpty()) {
              const sphere = bb.getBoundingSphere(new THREE.Sphere())
              dist = THREE.MathUtils.clamp(sphere.radius * 2.8, 95, 300)
            }
          }
          camGoal = {
            t: L.anchor.clone(),
            d: dist,
            p: THREE.MathUtils.clamp(sph.pol, 0.55, 1.15),
          }
        }
        prev.focusTick = state.focusTick
      }
      if (state.resetTick !== prev.resetTick) {
        camGoal = null   // 진행 중인 포커스 비행 취소
        sph.az = HOME.az; sph.pol = HOME.pol; sph.dist = HOME.dist
        target.set(HOME.tx, HOME.ty, HOME.tz)
        updateCam()
      }
      if (state.filter !== prev.filter || state.floor !== prev.floor) {
        applyVisibility()
        if (state.selected && state.filter !== 'all' && TERMS[state.selected].cat !== state.filter) {
          state.setSelected(null)
        }
      }
      if (state.flowState !== prev.flowState) {
        syncFlowUI()
        if (state.selected) applyFocus(state.selected)
      }
      if (state.selected !== prev.selected) {
        clearHoverOutline() // 선택 아웃라인과 중복 방지
        if (state.selected) {
          syncLabels()
          refreshSelectedLeader()
          const requestedId = state.selected
          requestAnimationFrame(() => {
            if (useAppStore.getState().selected !== requestedId) return
            applyFocus(requestedId)
            clearXray()
            applySelectionOutline(requestedId)
            refreshSelectedLeader()
          })
        } else {
          clearXray(); clearSelectionOutline(); restoreFocus(); syncLabels(); refreshSelectedLeader()
        }
      }
      // 재진입(콜백 중 상태 변경) 대비: 스냅샷이 아닌 최신 상태로 prev 갱신
      const cur = useAppStore.getState()
      prev = { selected: cur.selected, filter: cur.filter, floor: cur.floor, flowState: cur.flowState, resetTick: cur.resetTick, labelsOn: cur.labelsOn, focusTick: cur.focusTick }
    })

    /* ── 렌더 루프 ── */
    const camDirH = new THREE.Vector3()
    let raf = 0
    function animate(ts) {
      raf = requestAnimationFrame(animate)
      /* 포커스 비행: 목표 지점·거리·각도로 부드럽게 수렴 */
      if (camGoal) {
        target.lerp(camGoal.t, 0.09)
        sph.dist += (camGoal.d - sph.dist) * 0.09
        sph.pol += (camGoal.p - sph.pol) * 0.09
        updateCam()
        if (target.distanceTo(camGoal.t) < 0.4 && Math.abs(sph.dist - camGoal.d) < 0.8) camGoal = null
      }
      /* 외벽 자동 페이드 — 층 아이솔레이션 시엔 벽을 얇은 유리처럼 (레퍼런스 렌더 무드) */
      const isoFloorNow = useAppStore.getState().floor
      const floorIso = isoFloorNow !== 'all'
      camDirH.subVectors(camera.position, target); camDirH.y = 0; camDirH.normalize()
      for (let i = 0; i < wallsFade.length; i++) {
        const wf = wallsFade[i]
        // 지하 1층 뷰에서는 지형 볼륨 전체를 반투명 유리로 (천장처럼 덮이는 것 방지)
        // 지형 볼륨: 카메라를 향한 면은 투명하게(지하 내부 클리어) —
        // 임계값 스위치 대신 연속 페이드라 각도 회전 시 팝핑이 없고,
        // 양면 렌더링 백드롭 덕에 관통 시 흰 쐐기도 생기지 않는다
        const terrFace = THREE.MathUtils.clamp(wf.n.dot(camDirH) / 0.4, 0, 1)
        const tgt = wf.m.userData._dimmed ? 0.06
          : wf.m.userData.terrain ? (isoFloorNow === 'b1' ? 0.12 : 0.5 - 0.42 * terrFace)
          : ((wf.n.dot(camDirH) > 0.18) ? 0.07 : (floorIso ? 0.26 : 0.95))
        wf.m.material.transparent = true
        wf.m.material.opacity += (tgt - wf.m.material.opacity) * 0.18
        if (!wf.e.material.userData._ghost)
          wf.e.material.opacity = wf.m.material.opacity > 0.4 ? wf.e.material.userData.baseOp : (floorIso && !wf.m.userData._dimmed ? 0.3 : 0)
      }
      /* 상부 슬래브 페이드: 탑뷰 · 하부 장비 선택 · 층 필터 연동 */
      const selected = useAppStore.getState().selected
      const selZ = selected != null && anchorZ[selected] !== undefined ? anchorZ[selected] : Infinity
      const isoFloor = useAppStore.getState().floor
      for (let i = 0; i < slabs.length; i++) {
        const s = slabs[i]
        let tgt = s.baseOp
        if (s.m.userData._dimmed) tgt = 0.06
        else if (isoFloor !== 'all' && s.floor === isoFloor) tgt = 0.97  // 선택 층의 바닥판은 흰 플레이트로
        else if (selZ < s.zTop - 1) tgt = 0.08
        else if (s.floor === 'roof' && sph.pol < 0.62) tgt = 0.1
        s.m.material.transparent = true
        s.m.material.opacity += (tgt - s.m.material.opacity) * 0.15
        s.e.material.transparent = true
        if (!s.e.material.userData || !s.e.material.userData._ghost)
          s.e.material.opacity = s.m.material.opacity > 0.4 ? 1 : 0
        s.top.material.opacity = Math.min(s.top.material.userData.baseOp, s.m.material.opacity)
      }
      /* 유체 패킷 */
      const tt = (ts || 0) * 0.00010
      for (let f = 0; f < flows.length; f++) {
        const F = flows[f]
        if (!F.enabled) continue
        for (let d = 0; d < F.dots.length; d++) {
          const u = ((tt + F.off + F.dots[d].userData.flowU + 1) % 1) * F.tot
          let seg = 1
          while (seg < F.lens.length && F.lens[seg] < u) seg++
          const a = F.vs[seg - 1], b = F.vs[Math.min(seg, F.vs.length - 1)]
          const t2 = (u - F.lens[seg - 1]) / Math.max(F.lens[seg] - F.lens[seg - 1], 0.001)
          F.dots[d].position.lerpVectors(a, b, Math.min(t2, 1))
          // 층 아이솔레이션 중에는 현재 위치가 선택 층 대역 안일 때만 도트 표시
          if (isoFloorNow !== 'all') F.dots[d].visible = FLOOR_OF_Z(F.dots[d].position.y) === isoFloorNow
        }
      }
      layoutLabels()
      renderer.render(scene, camera)
    }

    /* ── 리사이즈 ── */
    function resize() {
      const w = host.clientWidth, h = host.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      leadersSvg.setAttribute('width', w); leadersSvg.setAttribute('height', h)
      leadersSvg.setAttribute('viewBox', '0 0 ' + w + ' ' + h)
      selectedLeaderSvg.setAttribute('width', w); selectedLeaderSvg.setAttribute('height', h)
      selectedLeaderSvg.setAttribute('viewBox', '0 0 ' + w + ' ' + h)
      labelsDirty = true
      markCameraMoving()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(host)
    // 창 크기 변경 → 디자인 스케일 변동 → 픽셀비율만 갱신 (레이아웃 크기는 고정)
    const onWinResize = () => applyPixelRatio()
    window.addEventListener('resize', onWinResize)

    resize()
    updateCam()
    applyVisibility()
    animate(0)

    // 디버그 훅 (콘솔 진단용)
    window.__AIDC = { ctx, scene, useAppStore, applyVisibility }

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      unsubscribe()
      window.removeEventListener('resize', onWinResize)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      renderer.dispose()
      labelsDiv.innerHTML = ''
      leadersSvg.innerHTML = ''
      selectedLeaderSvg.innerHTML = ''
    }
  }, [])

  return (
    <div ref={hostRef} className="viewport3d">
      <canvas className="gl" />
      <svg className="leaders" />
      <div className="labels" />
      <svg className="selected-leader" aria-hidden="true" />
      <div className="tip3d" role="tooltip" style={{ display: 'none' }} />
      <div className="scene-copyright">© 2026 SUNJIN Engineering &amp; Architecture. All rights reserved.</div>
    </div>
  )
}
