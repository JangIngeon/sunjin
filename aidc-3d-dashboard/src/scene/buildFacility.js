import * as THREE from 'three'
import {
  ctx, resetCtx, setFloor, tagFloor, G, V, lam, box, cylY, cylDir, pipe, wall, slab,
  topSurface, gradientGroundSurface, applySiteEdgeFade, fanTop, fanFront, ladder, addEdges, P, CX, CZ,
} from './helpers.js'

/**
 * 충주 데이터센터 — 평면도(지하1층 / 1층 / 2층) 정밀 반영 모델.
 *
 * 좌표(도면 기준, 단위 m):
 *   전산동: x 0~105.3 (그리드 1~15), y 0~38.6 (그리드 N~H, 북→남)
 *   공급동: x 4.2~63.9 (그리드 1~9), y 54~104 (전산동 남측)
 *   사이 마당(주차 밴드): y 38.6~54 — 지반(GL) 높이, 공동구가 지하로 관통
 *   레벨:   B1 바닥 z=0 · 1F(GL) z=9 · 2F z=18 · 옥상 z=27
 *
 * 도면 디테일 반영:
 *   공동구(전산동↔공급동 + 동측 스텁), GIS 상부 오픈, 옥외유류탱크(B1 피트
 *   탱크군 + 1F 지상 탱크), 종류별 주차장(일반 6/4/5/11대 · 장애인 5대 ·
 *   전기차 8대 · 옥외주차장 108대), 진입도로·횡단보도·보행로·조경,
 *   2층 전산실 세로 랙 열(9열), 전기실1·축전지실1/2·전기실2·창고2 남측 밴드,
 *   비상발전기실 4기 + DA 급배기 + 유류탱크실-1/2, 사무 윙(운영사무실·사무실·회의실)
 */

const MAIN = { x0: 0, x1: 105.3, y0: 0, y1: 38.6 }   // 전산동
const SUP = { x0: 4.2, x1: 63.9, y0: 54, y1: 104 }    // 공급동
/* 층고 1.5배 (피치 9m → 13.5m) */
const LV = { b1: 0, f1: 13.5, f2: 27, roof: 40.5 }
const WH = 8.7   // 장비 기준 높이 (덕트·팬월 등 배치 좌표에만 사용)
const XWH = 12.5 // 벽 높이 — 층 피치 13.5 − 슬래브 두께 1: 벽 상단이 천장 슬래브에 밀착
const GL = 13.5  // 지반 레벨 (= 1층 바닥)

export function buildFacility(scene) {
  resetCtx(scene)

  buildSite()
  buildB1()
  buildF1()
  buildF2()
  buildRoof()
  buildDetailPlus()
  buildGhostShells()
  buildFlows()

  return ctx
}

/* ═══ 층 아이솔레이션 고스트 쉘 — 타 층은 건물 외곽 실루엣 라인만 표시 ═══
   두께 없는 단일 외곽 박스 와이어프레임(층×동). 평소 숨김, Viewport의
   applyVisibility가 아이솔레이션 시 해당 층 외의 쉘만 켠다. */
function buildGhostShells() {
  setFloor(null)
  const g = G(null, null)
  const bands = { b1: [0, 13.5], f1: [13.5, 27], f2: [27, 40.5], roof: [40.5, 41.7] }
  for (const f in bands) {
    const z0 = bands[f][0], z1 = bands[f][1]
    for (const r of [MAIN, SUP]) {
      const geo = new THREE.BoxGeometry(r.x1 - r.x0, z1 - z0, r.y1 - r.y0)
      const ls = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.15, depthTest: false, depthWrite: false }),
      )
      ls.material.userData = { baseOp: 0.15 }
      ls.position.set(r.x0 + (r.x1 - r.x0) / 2 - CX, z0 + (z1 - z0) / 2, r.y0 + (r.y1 - r.y0) / 2 - CZ)
      ls.renderOrder = 60
      ls.userData.ghostShell = true
      ls.userData.shellFloor = f
      ls.visible = false
      g.add(ls)
    }
  }
  /* 지상면 외곽선 — 층별 보기 중 항상 표시해 지면 기준을 잡아준다
     (shellFloor 'ground'는 어떤 층과도 일치하지 않아 아이솔레이션 내내 켜짐) */
  const EXT = { x0: -21.6, y0: -16.3, w: 167.2, d: 138.6 }
  const gnd = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(EXT.w, EXT.d)),
    new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.15, depthTest: false, depthWrite: false }),
  )
  gnd.material.userData = { baseOp: 0.15 }
  gnd.rotation.x = -Math.PI / 2
  gnd.position.set(EXT.x0 + EXT.w / 2 - CX, GL + 0.05, EXT.y0 + EXT.d / 2 - CZ)
  gnd.renderOrder = 60
  gnd.userData.ghostShell = true
  gnd.userData.shellFloor = 'ground'
  gnd.visible = false
  g.add(gnd)
}

/* ═══════════════ 대지 · 지형 · 주차 · 외부 동선 ═══════════════ */
function buildSite() {
  setFloor(null)
  const EARTH = '#E9E2D2'
  const g = G(null, null)

  /* 굴토 피트 바닥 — 지하층은 그라데이션 없이 실선으로 */
  box(g, -14, -10, -1.2, 152, 126, 1.2, P.slab, { edge: '#969EA6' })
  gradientGroundSurface(g, -32, -26, -1.15, 190, 160, P.groundTop)
  topSurface(g, -14, -10, 0.04, 152, 126, '#E2E5E9')

  /* 지형 블록 — 굴토 범위 밖을 GL까지 채움.
     E1(전산동) x -1.5~106.8 · y -1.5~40.1
     E2(공급동+서측 유류야드) x -11~64.4 · y 52.5~105.5
     공동구 트렌치 슬롯: x 31~39 · y 40.1~52.5 (개방 → 지하 공동구 노출) */
  function terrain(x, y, w, d, nx, nz) {
    // terrain 플래그: 지하 1층 아이솔레이션에서 유리처럼 반투명 처리 (천장화 방지)
    // 볼륨(지하 단면)은 그라데이션 없이 그대로 — 지상 땅 면(ts)에만 경계 페이드
    const wm = wall(x, y, -1, w, d, GL + 1, nx, nz, false, EARTH)
    wm.userData.terrain = true
    // 반투명 지형: depthWrite off(그리기 순서 깨짐 방지) + 양면 렌더링 —
    // 링을 관통해 배경(흰 쐐기)이 비쳐 보이던 현상을 내부 면이 받쳐준다
    wm.material.depthWrite = false
    wm.material.side = THREE.DoubleSide
    // 땅 깊이 볼륨이 대지 경계에서 뚝 끊기지 않게 — 경계 안 16m 구간 소산
    applySiteEdgeFade(wm, 76, 63, 16)
    const ts = topSurface(g, x, y, GL + 0.02, w, d, P.slabTop)
    ts.userData.terrain = true
  }
  /* 지상 땅 외곽 연장 링 (~10%): 다른 요소는 그대로, GL 면만 바깥으로 확장.
     그라데이션 경계(SITE_FADE)도 연장된 외곽 기준으로 소산 */
  function groundExt(x, y, w, d) {
    const ts = topSurface(g, x, y, GL + 0.02, w, d, P.slabTop)
    ts.userData.terrain = true
  }
  groundExt(-21.6, -16.3, 167.2, 6.3)   // 북측
  groundExt(-21.6, 116, 167.2, 6.3)     // 남측
  groundExt(-21.6, -10, 7.6, 126)       // 서측
  groundExt(138, -10, 7.6, 126)         // 동측

  /* 건물 외벽과의 이격(1.5m 슬릿)이 틈으로 보이던 문제 — 지상면이 외벽까지
     (여유 0.2) 채우도록 각 블록 확장 */
  terrain(-14, -10, 152, 9.8, 0, -1)            // 북측 (y -10 ~ -0.2)
  terrain(-14, -0.2, 13.8, 40.3, -1, 0)         // 전산동 서측 (x -14 ~ -0.2)
  terrain(105.5, -0.2, 32.5, 40.3, 1, 0)        // 전산동 동측 (주차장부)
  terrain(-14, 38.8, 45, 15, 0, 1)              // 사이 마당 서측 (주차 밴드)
  terrain(39, 38.8, 99, 15, 0, 1)               // 사이 마당 동측 (장애인주차·도로)
  terrain(-14, 52.5, 3, 53, -1, 0)              // 공급동 서측 슬리버 (유류야드 개방 유지)
  terrain(64.1, 53.8, 73.9, 50.2, 0.7, 0.7)     // 남동측 대지 (도로·조경, 마당·남측과 비중첩)
  terrain(-14, 104.2, 152, 11.8, 0, 1)          // 남측

  /* ── 사이트 디테일 (주차장·도로·조경) — "1층" 뷰에서만 표시 ──
     스톨 헬퍼: dir 'y' = 스톨 개구가 남북(줄무늬는 x 분할) */
  const sd = G(null, null)
  function stallsX(x, y, n, stallW, stallD, tint) {
    topSurface(sd, x - 0.3, y - 0.3, GL + 0.05, n * stallW + 0.6, stallD + 0.6, tint)
    for (let i = 0; i <= n; i++)
      box(sd, x + i * stallW - 0.06, y, GL, 0.12, stallD, 0.08, '#FFFFFF', { noedge: true })
    box(sd, x, y + (stallD - 0.12), GL, n * stallW, 0.12, 0.08, '#FFFFFF', { noedge: true })
  }
  function stallsY(x, y, n, stallW, stallD, tint) {
    topSurface(sd, x - 0.3, y - 0.3, GL + 0.05, stallD + 0.6, n * stallW + 0.6, tint)
    for (let i = 0; i <= n; i++)
      box(sd, x, y + i * stallW - 0.06, GL, stallD, 0.12, 0.08, '#FFFFFF', { noedge: true })
    box(sd, x + (stallD - 0.12), y, GL, 0.12, n * stallW, 0.08, '#FFFFFF', { noedge: true })
  }
  const PK = '#E4E6E9'          // 일반주차 포장 톤
  stallsY(-12, 14, 6, 2.6, 5, PK)                    // 일반주차(6대) — 전산동 서측
  stallsX(3, 41.5, 4, 2.6, 5, PK)                    // 일반주차(4대)
  stallsX(16.5, 41.5, 5, 2.6, 5, PK)                 // 일반주차(5대)
  stallsX(2, 47.6, 11, 2.6, 4.6, PK)                 // 일반주차(11대)
  stallsX(41, 41.5, 5, 3.4, 5, '#AFCBEA')            // 장애인주차(5대) — 청색 포장
  for (let i = 0; i < 5; i++)                        // 장애인 픽토그램 힌트
    box(g, 42.2 + i * 3.4, 43.6, GL + 0.02, 1, 1, 0.09, '#3F6FB5', { noedge: true })
  stallsY(108.2, 5, 8, 3.0, 4.6, '#CDE8D2')          // 전기차주차(8대) — 녹색 포장
  /* 옥외주차장(108대) — 동측 대형 주차장 2열 (더블로우) */
  topSurface(sd, 114.5, 0.5, GL + 0.04, 21.5, 37.6, '#E1E4E7')
  for (const px of [115.5, 127]) {
    for (let i = 0; i <= 14; i++)
      box(sd, px, 1.2 + i * 2.5, GL, 9.6, 0.12, 0.08, '#FFFFFF', { noedge: true })
    box(sd, px + 4.75, 1.2, GL, 0.12, 35, 0.08, '#FFFFFF', { noedge: true })
  }

  /* ── 진입도로 · 횡단보도 · 보행로 · 조경 (도면 남동측) ── */
  topSurface(sd, 66, 52.5, GL + 0.05, 10, 63.5, '#DDE0E4')          // 진입도로 (남→북)
  topSurface(sd, 39.5, 46.8, GL + 0.05, 99, 5.2, '#DDE0E4')         // 마당 차로 (동서)
  for (let i = 0; i < 6; i++)                                        // 횡단보도
    box(sd, 66.8 + i * 1.5, 88, GL, 1, 4.6, 0.09, '#FFFFFF', { noedge: true })
  topSurface(sd, 64.4, 70, GL + 0.06, 1.8, 18, '#EFE9DC')           // 로비 앞 보행로
  topSurface(sd, 76.5, 56, GL + 0.06, 56, 46, '#DCE8D8')            // 조경 (남동 정원)
  topSurface(sd, 80, 62, GL + 0.08, 3, 36, '#EFE9DC')               // 정원 산책로
  topSurface(sd, 80, 76, GL + 0.08, 46, 3, '#EFE9DC')
  /* 수목 */
  function tree(x, y, s) {
    s = s || 1
    cylY(sd, x, y, GL, 0.22 * s, 1.5 * s, '#B99B72', { seg: 8 })
    const crown = new THREE.Mesh(new THREE.SphereGeometry(1.5 * s, 10, 8), lam('#A8CFA0'))
    crown.position.copy(V(x, y, GL + 2.3 * s))
    sd.add(crown)
  }
  tree(88, 60); tree(98, 66, 1.2); tree(110, 62); tree(120, 72, 1.1)
  tree(92, 86, 1.2); tree(104, 92); tree(116, 88, 1.3); tree(126, 98)
  tree(84, 100, 1.1); tree(70, 110); tree(96, 108, 1.2); tree(124, 52)

  /* 사이트 디테일은 "1층" 아이솔레이션에서만 표시 (Viewport 가시성 규칙) */
  sd.traverse((o) => { o.userData.siteDetail = true })

  /* ── 공동구 (지하 연결 통로 — 도면 1페이지) ── */
  setFloor('b1')
  const t = G(null, null)
  function tunnel(x, y, w, d, capSouth, capEast) {
    // 측벽 + 반투명 상부 슬래브 (트렌치 슬롯으로 위에서 보임)
    const wallHex = '#D8DCE0'
    box(t, x, y, 0, 0.6, d, 4.8, wallHex, { noedge: true })
    box(t, x + w - 0.6, y, 0, 0.6, d, 4.8, wallHex, { noedge: true })
    if (capSouth) box(t, x, y + d - 0.6, 0, w, 0.6, 4.8, wallHex, { noedge: true })
    if (capEast) box(t, x + w - 0.6, y, 0, 0.6, d, 4.8, wallHex, { noedge: true })
    const roofM = box(t, x, y, 4.8, w, d, 0.5, '#E4E7EA', { op: 0.55 })
    roofM.material.depthWrite = false
    topSurface(t, x, y, 0.1, w, d, '#D9DDE2')
  }
  tunnel(32.5, MAIN.y1, 5, SUP.y0 - MAIN.y1, false, false)   // 전산동 ↔ 공급동
  tunnel(SUP.x1, 58, 12, 4.5, true, true)                    // 동측 공동구 스텁
  setFloor(null)
}

/* ═══════════════ 지하 1층 ═══════════════ */
function buildB1() {
  setFloor('b1')

  /* 전산동 B1 — 존 색상 (도면 채색 반영) */
  ;(function zones() {
    const g = G(null, null)
    topSurface(g, 7, 3, 0.08, 41, 24, P.zoneElec)      // 전기실-1
    topSurface(g, 48, 3, 0.08, 18, 13, P.zoneElec)     // 전기실-2
    topSurface(g, 48, 18, 0.08, 12, 10, P.zoneElec)    // 축전지실
    topSurface(g, 70, 3, 0.08, 28, 13, P.zoneMech)     // 기계실
    topSurface(g, 70, 18, 0.08, 28, 15, P.zoneMech)    // 기계 갤러리 (도면 청색 스트라이프)
    topSurface(g, 0, 0, 0.08, 7, 38.6, P.zoneCore)     // 서측 코어
    topSurface(g, 98.3, 0, 0.08, 7, 38.6, P.zoneCore)  // 동측 코어
  })()

  /* 외벽 + 칸막이 */
  wall(MAIN.x0, MAIN.y0, 0, MAIN.x1 - MAIN.x0, 1.1, XWH, 0, -1, false)
  wall(MAIN.x0, MAIN.y1 - 1.1, 0, MAIN.x1 - MAIN.x0, 1.1, XWH, 0, 1, false)
  wall(MAIN.x0, 1.1, 0, 1.1, MAIN.y1 - 2.2, XWH, -1, 0, false)
  wall(MAIN.x1 - 1.1, 1.1, 0, 1.1, MAIN.y1 - 2.2, XWH, 1, 0, false)
  wall(7, 1.1, 0, 0.7, 36.4, XWH, 0, 0, true)
  wall(98.3, 1.1, 0, 0.7, 36.4, XWH, 0, 0, true)
  wall(47.2, 1.1, 0, 0.7, 28, XWH, 0, 0, true)
  wall(66.5, 1.1, 0, 0.7, 36.4, XWH, 0, 0, true)
  wall(48, 16.2, 0, 18, 0.7, XWH, 0, 0, true)
  wall(70, 16.2, 0, 28, 0.7, XWH, 0, 0, true)

  /* 전기실-1 — 수배전반 열반 3열 */
  ;(function switchgearRoom() {
    const g = G('switchgear', 'power')
    for (let row = 0; row < 3; row++) {
      const y = 5.5 + row * 7
      for (let i = 0; i < 6; i++) {
        const x = 10 + i * 5.6
        box(g, x, y, 0, 4.8, 3.1, 2.5, P.yel)
        box(g, x + 0.4, y + 2.95, 0.8, 4, 0.28, 1.4, '#FFEBAF')
        box(g, x + 0.7, y + 3.1, 2.0, 1.4, 0.2, 0.34, '#4A525C', { noedge: true })
        box(g, x + 2.9, y + 3.1, 2.0, 1.1, 0.2, 0.34, '#E86A44', { noedge: true })
      }
    }
  })()

  /* 전기실-2 — 몰드 변압기 3대 */
  ;(function trRoom() {
    const g = G('transformer', 'power')
    for (let i = 0; i < 3; i++) {
      const x = 49.5 + i * 5.6
      box(g, x, 5, 0, 4.4, 5, 3.2, P.yel)
      for (let f = 0; f < 3; f++) {
        box(g, x - 0.4, 5.5 + f * 1.4, 0.5, 0.4, 0.9, 2.2, '#F0B429', { noedge: true })
        box(g, x + 4.4, 5.5 + f * 1.4, 0.5, 0.4, 0.9, 2.2, '#F0B429', { noedge: true })
      }
      for (let b = 0; b < 3; b++) {
        cylY(g, x + 0.9 + b * 1.3, 7.5, 3.2, 0.28, 0.9, '#EDE7D8')
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 10), lam('#E0AC2E'))
        cap.position.copy(V(x + 0.9 + b * 1.3, 7.5, 4.3)); g.add(cap); tagFloor(cap)
      }
      box(g, x + 0.4, 11.5, 0, 3.6, 1.6, 2.2, '#F2CE6A', { noedge: true })
    }
  })()

  /* 축전지실 — 배터리 랙 2×2 */
  ;(function batteryRoom() {
    const g = G('battery', 'power')
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const x = 49 + i * 5.6, y = 19 + j * 4.6
      box(g, x, y, 0, 4.8, 3.4, 2.3, P.yel)
      for (let s = 0; s < 3; s++) box(g, x + 0.3, y + 3.25, 0.35 + s * 0.72, 4.2, 0.24, 0.42, '#FFEBAF')
      box(g, x, y + 3.25, 2.35, 4.8, 0.2, 0.2, '#E86A44', { noedge: true })
    }
  })()

  /* 기계실 — 칠러 2 · 순환펌프 3 · 수처리 */
  ;(function mechRoom() {
    const g = G('chiller', 'cooling')
    function chiller(x, y) {
      box(g, x, y, 0, 15, 4.6, 0.8, P.steel, { noedge: true })
      cylDir(g, [x + 0.8, y + 1.4, 2.2], [x + 14.2, y + 1.4, 2.2], 1.15, P.blue, { seg: 16 })
      cylDir(g, [x + 0.8, y + 3.2, 3.8], [x + 14.2, y + 3.2, 3.8], 1.15, P.blueD, { seg: 16 })
      cylY(g, x + 4.6, y + 2.3, 4.6, 1.1, 1.6, '#DCE6EF')
      cylY(g, x + 9.5, y + 2.3, 4.6, 1.1, 1.6, '#DCE6EF')
      pipe(g, [[x + 4.6, y + 2.3, 5.7], [x + 9.5, y + 2.3, 5.7]], '#AEC2D4', 0.3, false)
      box(g, x + 12.8, y + 1, 0.8, 1.6, 0.4, 3.4, '#454E58')
    }
    chiller(71.5, 4); chiller(71.5, 10)

    const p = G('pumps', 'cooling')
    function pump(x, y) {
      box(p, x - 1.1, y - 1.1, 0, 2.2, 2.2, 0.4, P.steel, { noedge: true })
      cylY(p, x, y, 0.4, 0.88, 0.95, '#9FBFDF')
      cylY(p, x, y, 1.35, 0.68, 1.75, '#DCE6EF')
      cylY(p, x, y, 3.1, 0.76, 0.28, '#9FBFDF')
      pipe(p, [[x, y, 0.7], [x - 1.9, y, 0.7]], '#9FB6CC', 0.32, false)
    }
    pump(90, 5); pump(90, 8.8); pump(90, 12.6)

    const w = G('water-treatment', 'cooling')
    box(w, 94, 10.5, 0, 3.4, 3, 4.2, P.teal)
    box(w, 94.4, 13.4, 2.6, 1.5, 0.26, 1.1, '#454E58')
    cylY(w, 95, 6.5, 0, 0.65, 2.3, '#BFE3DC')
    cylY(w, 96.8, 6.5, 0, 0.65, 2.3, '#BFE3DC')
    pipe(w, [[94.8, 10.5, 3.4], [95, 7.5, 2.6]], '#72B6A8', 0.22, false)
  })()

  /* 기계 갤러리 — 축열조 2기 + 배관 랙 (도면 스트라이프 존) */
  ;(function tesGallery() {
    const g = G('tes', 'cooling')
    function tank(x, y) {
      cylY(g, x, y, 0, 3.4, 6.8, '#E7EDF2', { seg: 26 })
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(3.4, 26, 12, 0, Math.PI * 2, 0, Math.PI / 2), lam('#DDE5EB'))
      dome.position.copy(V(x, y, 6.8)); g.add(dome); ctx.pickables.push(dome); tagFloor(dome)
      cylY(g, x, y, 2.2, 3.55, 0.28, '#C5D3DE', { seg: 26 })
      cylY(g, x, y, 4.7, 3.55, 0.28, '#C5D3DE', { seg: 26 })
      ladder(g, x + 3.9, y, 0, 6.4)
    }
    tank(76, 25.5); tank(88, 25.5)
    const d = G(null, null)
    for (let i = 0; i < 8; i++)
      box(d, 71 + i * 3.2, 20, 0, 1.2, 12, 0.5, '#C9D3DC', { noedge: true })  // 배관 랙 힌트
  })()

  /* ── 공급동 B1 (1FL-4,000): GIS · 유류펌프실 · RCP실 · PIT · 옥외유류탱크 ── */
  ;(function supplyB1() {
    const g0 = G(null, null)
    topSurface(g0, 10, 57, 0.08, 30, 40, P.zoneElec)              // GIS실
    topSurface(g0, SUP.x0, 72, 0.08, 5, 14, P.zoneMech)           // 유류펌프실
    topSurface(g0, 40.5, 60, 0.08, 8, 12, P.zoneCore)             // RCP실
    topSurface(g0, 49, 57, 0.08, 14, 18, '#D9DDE2')               // PIT
    topSurface(g0, 49, 80, 0.08, 14, 16, '#D9DDE2')               // PIT
    topSurface(g0, 27, SUP.y1 - 1, 0.08, 12, 5, P.zoneCore)       // 장비반입구

    // 공급동 외벽
    wall(SUP.x0, SUP.y0, 0, SUP.x1 - SUP.x0, 1.1, XWH, 0, -1, false)
    wall(SUP.x0, SUP.y1 - 1.1, 0, SUP.x1 - SUP.x0, 1.1, XWH, 0, 1, false)
    wall(SUP.x0, SUP.y0 + 1.1, 0, 1.1, SUP.y1 - SUP.y0 - 2.2, XWH, -1, 0, false)
    wall(SUP.x1 - 1.1, SUP.y0 + 1.1, 0, 1.1, SUP.y1 - SUP.y0 - 2.2, XWH, 1, 0, false)
    wall(40, SUP.y0 + 1.1, 0, 0.7, 44, XWH, 0, 0, true)     // GIS | RCP·PIT
    wall(9.4, SUP.y0 + 1.1, 0, 0.7, 44, XWH, 0, 0, true)    // 유류펌프 | GIS

    // GIS — 가스절연개폐장치 3베이 (도면: 홀 안에 3조 종배열)
    const g = G('gis', 'power')
    for (let i = 0; i < 3; i++) {
      const y = 60 + i * 13
      box(g, 12, y, 0, 3.4, 6.4, 2.6, P.gray)
      cylDir(g, [16.5, y + 1.6, 1.9], [30, y + 1.6, 1.9], 1.05, '#D6E0EA', { seg: 14 })
      cylDir(g, [16.5, y + 4.8, 1.9], [30, y + 4.8, 1.9], 1.05, '#D6E0EA', { seg: 14 })
      for (let b = 0; b < 3; b++) {
        cylY(g, 19 + b * 4, y + 3.2, 2.6, 0.75, 1.7, '#CBD8E4', { seg: 14 })
        cylY(g, 19 + b * 4, y + 3.2, 4.3, 0.34, 1.1, '#EDE7D8')
      }
      box(g, 31, y + 0.9, 0, 2.4, 4.6, 1.7, '#C2CFDA', { noedge: true })
    }

    // 유류펌프실 — 이송 펌프 2
    const f = G('fuel', 'power')
    for (let i = 0; i < 2; i++) {
      const y = 75 + i * 5
      box(f, 5, y - 1.1, 0, 2.2, 2.2, 0.4, P.steel, { noedge: true })
      cylY(f, 6.1, y, 0.4, 0.8, 0.9, '#E8C25A')
      cylY(f, 6.1, y, 1.3, 0.6, 1.5, '#EBDEC0')
    }

    // 옥외유류탱크 (B1 피트 — 도면 서측 2개소, 각 3기 횡형 탱크군)
    function tankGroup(y0) {
      topSurface(g0, -9.5, y0 - 1.5, 0.09, 12.5, 13, '#DFE3E7')   // 탱크 패드
      for (let i = 0; i < 3; i++) {
        const y = y0 + i * 4
        cylDir(f, [-8.5, y, 1.6], [1.5, y, 1.6], 1.35, '#EBDEC0', { seg: 16 })
        box(f, -7.5, y - 0.5, 0, 1.4, 1, 0.9, '#CFC2A4', { noedge: true })
        box(f, -0.5, y - 0.5, 0, 1.4, 1, 0.9, '#CFC2A4', { noedge: true })
        cylY(f, -3.5, y, 2.95, 0.28, 0.5, '#CFC2A4')
      }
    }
    tankGroup(58); tankGroup(88)
    pipe(f, [[-3, 74, 0.8], [3, 77, 0.8], [6.1, 76.5, 0.8]], '#DCC998', 0.22, false)

    // RCP실 — 원방 감시·제어반
    const r = G(null, null)
    box(r, 41.5, 62, 0, 2.6, 5.6, 2.4, '#4A5560')
    box(r, 44.7, 62, 0, 2.6, 5.6, 2.4, '#4A5560')
    box(r, 41.8, 65.2, 1.5, 2, 0.22, 0.6, '#7FD8C8', { noedge: true })
  })()
}

/* ═══════════════ 1층 (GL) ═══════════════ */
function buildF1() {
  setFloor('f1')

  slab(MAIN.x0, MAIN.y0, LV.f1, MAIN.x1 - MAIN.x0, MAIN.y1 - MAIN.y0, 1, 'f1')
  slab(43, SUP.y0, LV.f1, SUP.x1 - 43, SUP.y1 - SUP.y0, 1, 'f1')     // 공급동 동측 스트립 (GIS 상부 오픈)
  slab(31.5, MAIN.y1, LV.f1, 7, SUP.y0 - MAIN.y1, 1, 'f1')           // 연결부 (공동구 상부 코리도)

  const z = LV.f1

  ;(function zones() {
    const g = G(null, null)
    topSurface(g, 7, 0, z + 0.08, 91.3, 4.2, P.zoneCrah)        // 항온항습실
    topSurface(g, 12, 6, z + 0.08, 28, 13, P.zoneElec)          // 전기실1
    topSurface(g, 42, 6, z + 0.08, 16, 13, P.zoneElec)          // 축전지실
    topSurface(g, 60, 6, z + 0.08, 28, 13, P.zoneElec)          // 전기실2
    topSurface(g, 0.6, 5, z + 0.08, 6.4, 11, P.zoneCore)        // TPS·MMR·MDF 서
    topSurface(g, 98.3, 5, z + 0.08, 6.4, 11, P.zoneCore)       // TPS·MMR·MDF 동
    topSurface(g, 20, 23, z + 0.08, 14, 13, P.zoneCore)         // 하역장
    topSurface(g, 36, 23, z + 0.08, 12, 10, P.zoneCore)         // 검품실·창고
    topSurface(g, 62, 23, z + 0.08, 32, 13, P.zoneOffice)       // 브리핑룸·상황실·스크린룸
    topSurface(g, 47, 70, z + 0.08, 16, 16, P.zoneOffice)       // 공급동 로비
    topSurface(g, 47, 62, z + 0.08, 8, 7, P.zoneCore)           // 보안실
    topSurface(g, 47, 87, z + 0.08, 13, 8, P.zoneOffice)        // 오픈미팅룸
  })()

  /* 외벽 + 칸막이 */
  wall(MAIN.x0, MAIN.y0, z, MAIN.x1 - MAIN.x0, 1.1, XWH, 0, -1, false)
  wall(MAIN.x0, MAIN.y1 - 1.1, z, MAIN.x1 - MAIN.x0, 1.1, XWH, 0, 1, false)
  wall(MAIN.x0, 1.1, z, 1.1, MAIN.y1 - 2.2, XWH, -1, 0, false)
  wall(MAIN.x1 - 1.1, 1.1, z, 1.1, MAIN.y1 - 2.2, XWH, 1, 0, false)
  wall(43, SUP.y0, z, SUP.x1 - 43, 1.1, XWH, 0, -1, false)             // 공급동 동측 스트립
  wall(43, SUP.y1 - 1.1, z, SUP.x1 - 43, 1.1, XWH, 0, 1, false)
  wall(43, SUP.y0 + 1.1, z, 1.1, SUP.y1 - SUP.y0 - 2.2, XWH, -1, 0, false)
  wall(SUP.x1 - 1.1, SUP.y0 + 1.1, z, 1.1, SUP.y1 - SUP.y0 - 2.2, XWH, 1, 0, false)
  wall(32, MAIN.y1, z, 0.6, SUP.y0 - MAIN.y1, XWH, 0, 0, true)   // 연결부 코리도 벽
  wall(37.9, MAIN.y1, z, 0.6, SUP.y0 - MAIN.y1, XWH, 0, 0, true)
  wall(7, 4.4, z, 91.3, 0.7, XWH, 0, 0, true)
  wall(10.8, 4.9, z, 0.7, 15, XWH, 0, 0, true)
  wall(41, 4.9, z, 0.7, 15, XWH, 0, 0, true)
  wall(58.8, 4.9, z, 0.7, 15, XWH, 0, 0, true)
  wall(12, 20.8, z, 82, 0.7, XWH, 0, 0, true)

  /* 항온항습실 — 팬월 8기 */
  ;(function crahGallery() {
    const g = G('crah', 'cooling')
    for (let i = 0; i < 8; i++) {
      const x = 10 + i * 11.4
      box(g, x, 0.8, z, 6.6, 2.8, WH * 0.82, P.blue)
      box(g, x + 0.3, 0.95, z + WH * 0.82, 6, 2.5, 0.55, '#8FA9C0')
      fanFront(g, x + 1.8, 3.75, z + 1.7, 1.1, 'z')
      fanFront(g, x + 4.8, 3.75, z + 1.7, 1.1, 'z')
      fanFront(g, x + 1.8, 3.75, z + 3.9, 1.1, 'z')
      fanFront(g, x + 4.8, 3.75, z + 3.9, 1.1, 'z')
    }
  })()

  /* 전기실1 — UPS 4 + 정류반 4 */
  ;(function upsRoom() {
    const g = G('ups', 'power')
    for (let i = 0; i < 4; i++) {
      const x = 14 + i * 6.4
      box(g, x, 7, z, 5.4, 3.1, 2.6, P.yel)
      box(g, x + 0.5, 10, z + 1.9, 3.4, 0.26, 0.55, '#454E58')
      box(g, x + 0.8, 10.15, z + 2.05, 1.2, 0.18, 0.26, '#57D0A8', { noedge: true })
      for (let s = 0; s < 4; s++) box(g, x + 0.5, 10.1, z + 0.4 + s * 0.34, 3.4, 0.16, 0.22, '#E8C25A', { noedge: true })
    }
    for (let i = 0; i < 4; i++) {
      const x = 14 + i * 6.4
      box(g, x, 14.5, z, 5.4, 3.1, 2.6, P.yel)
      box(g, x + 0.4, 17.45, z + 0.5, 4.4, 0.26, 1.5, '#FFEBAF')
    }
  })()

  /* 축전지실 */
  ;(function batteryF1() {
    const g = G('battery', 'power')
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const x = 43.5 + i * 6.8, y = 7.5 + j * 6.4
      box(g, x, y, z, 5.8, 3.6, 2.4, P.yel)
      for (let s = 0; s < 3; s++) box(g, x + 0.35, y + 3.45, z + 0.35 + s * 0.75, 5.1, 0.24, 0.44, '#FFEBAF')
      box(g, x, y + 3.45, z + 2.45, 5.8, 0.2, 0.2, '#E86A44', { noedge: true })
    }
  })()

  /* 전기실2 — 수배전반 2열 */
  ;(function sgF1() {
    const g = G('switchgear', 'power')
    for (let row = 0; row < 2; row++) {
      const y = 7.5 + row * 7
      for (let i = 0; i < 5; i++) {
        const x = 61.5 + i * 5.3
        box(g, x, y, z, 4.6, 3.1, 2.5, P.yel)
        box(g, x + 0.4, y + 2.95, z + 0.8, 3.8, 0.26, 1.35, '#FFEBAF')
        box(g, x + 0.6, y + 3.1, z + 1.95, 1.3, 0.2, 0.33, '#4A525C', { noedge: true })
      }
    }
  })()

  /* MMR · MDF */
  ;(function mmr() {
    const g = G('mmr', 'it')
    for (let i = 0; i < 3; i++) {
      box(g, 1.6, 6 + i * 3.4, z, 4.2, 2.6, 2.5, P.purp)
      for (let s = 0; s < 4; s++) box(g, 1.75, 8.45 + i * 3.4, z + 0.4 + s * 0.5, 3.9, 0.2, 0.3, '#DED8F7')
    }
    for (let i = 0; i < 2; i++) {
      box(g, 99.4, 6.5 + i * 3.8, z, 4.2, 2.8, 2.5, P.purp)
      for (let s = 0; s < 3; s++) box(g, 99.55, 9.15 + i * 3.8, z + 0.45 + s * 0.55, 3.9, 0.2, 0.32, '#DED8F7')
    }
  })()

  /* 상황실 · 스크린룸 */
  ;(function noc() {
    const g = G('bms', 'mgmt')
    for (let i = 0; i < 3; i++) {
      const m = box(g, 66 + i * 7.4, 24.2, z + 1, 6.6, 0.4, 3.6, '#4A5560')
      m.rotation.y = (i - 1) * 0.12
      box(g, 66.6 + i * 7.4, 24.1, z + 1.8, 2.1, 0.22, 1.4, i === 0 ? '#7FD8C8' : i === 1 ? '#F2C94C' : '#E8836A', { noedge: true, ry: (i - 1) * 0.12 })
      box(g, 69.4 + i * 7.4, 24.1, z + 1.6, 2.5, 0.22, 1.9, '#8FB4D8', { noedge: true, ry: (i - 1) * 0.12 })
    }
    const d = G(null, null)
    box(d, 68, 30, z + 1.05, 10, 2.6, 0.4, P.wood)
    box(d, 69, 30.6, z, 0.9, 1.4, 2.1, P.wood, { noedge: true })
    box(d, 76, 30.6, z, 0.9, 1.4, 2.1, P.wood, { noedge: true })
    box(d, 70.4, 30.4, z + 1.5, 1.7, 0.2, 1.1, '#5E7A94')
    box(d, 73.2, 30.4, z + 1.5, 1.7, 0.2, 1.1, '#5E7A94')
  })()

  /* 하역장 · 로비 · 오픈미팅룸 · 1F 옥외유류탱크 */
  ;(function deco() {
    const d = G(null, null)
    box(d, 22, 26, z, 2.8, 2.2, 0.4, P.wood, { noedge: true })
    box(d, 22, 26, z + 0.4, 2.8, 2.2, 1.5, P.cream2)
    box(d, 26, 25, z, 2.5, 2, 2.4, P.cream2)
    box(d, 23, 31, z, 2.2, 1.9, 1.5, P.cream2)
    // 로비 데스크 + 소파
    box(d, 50, 73, z, 7.4, 2.4, 1.1, P.wood)
    box(d, 50.5, 79, z, 4.6, 1.8, 0.5, P.rose)
    box(d, 50.5, 79, z + 0.5, 4.6, 0.6, 0.65, P.rose, { noedge: true })
    box(d, 56.5, 79, z, 4.6, 1.8, 0.5, P.rose)
    box(d, 56.5, 79.6, z + 0.5, 4.6, 0.6, 0.65, P.rose, { noedge: true })
    // 오픈미팅룸 테이블
    box(d, 50, 89.5, z, 7, 2.6, 1.05, P.wood)
    for (let c = 0; c < 3; c++) {
      box(d, 50.6 + c * 2.2, 88.4, z, 0.9, 0.9, 1.1, '#8A93A0', { noedge: true })
      box(d, 50.6 + c * 2.2, 92.5, z, 0.9, 0.9, 1.1, '#8A93A0', { noedge: true })
    }
    // 1F 옥외유류탱크 (지상 GL — 도면 2페이지 서측 2개소)
    const f = G('fuel', 'power')
    for (const ty of [58, 88]) {
      topSurface(d, -13.6, ty - 2, GL + 0.06, 2.9, 4, '#DFE3E7')
      cylY(f, -12.2, ty, GL, 1.05, 2.8, '#EBDEC0', { seg: 14 })
      cylY(f, -12.2, ty, GL + 2.8, 1.1, 0.22, '#CFC2A4', { seg: 14 })
    }
  })()
}

/* ═══════════════ 2층 ═══════════════ */
function buildF2() {
  setFloor('f2')

  slab(MAIN.x0, MAIN.y0, LV.f2, MAIN.x1 - MAIN.x0, MAIN.y1 - MAIN.y0, 1, 'f2')
  slab(SUP.x0, SUP.y0, LV.f2, SUP.x1 - SUP.x0, SUP.y1 - SUP.y0, 1, 'f2')
  slab(31.5, MAIN.y1, LV.f2, 7, SUP.y0 - MAIN.y1, 1, 'f2')            // 연결부 (소화가스실)

  const z = LV.f2
  const AISLE_X = [16, 23.6, 31.2, 38.8, 46.4, 54, 61.6, 69.2, 76.8]  // 전산실 9열 (도면 종배열)

  ;(function zones() {
    const g = G(null, null)
    topSurface(g, 7, 0, z + 0.08, 91.3, 4.2, P.zoneCrah)        // 항온항습실
    topSurface(g, 10, 5, z + 0.08, 85, 16.5, P.zoneHall)        // 전산실
    topSurface(g, 12, 24, z + 0.08, 21, 10, P.zoneElec)         // 전기실1
    topSurface(g, 34, 24, z + 0.08, 17, 10, P.zoneElec)         // 축전지실1
    topSurface(g, 52, 24, z + 0.08, 7, 10, P.zoneCore)          // 창고2
    topSurface(g, 60, 24, z + 0.08, 17, 10, P.zoneElec)         // 축전지실2
    topSurface(g, 78, 24, z + 0.08, 16, 10, P.zoneElec)         // 전기실2
    topSurface(g, 0.6, 5, z + 0.08, 6.4, 11, P.zoneCore)        // 공조실 서
    topSurface(g, 98.3, 5, z + 0.08, 6.4, 11, P.zoneCore)       // 공조실 동
    topSurface(g, 32, MAIN.y1 + 1, z + 0.08, 6, 13, P.zoneCore) // 소화가스실 (연결부)
    topSurface(g, 9, 57, z + 0.08, 29, 36, P.zoneMech)          // 비상발전기실
    topSurface(g, SUP.x0, 55, z + 0.08, 5, 7, P.zoneMech)       // 유류탱크실-1
    topSurface(g, SUP.x0, 90, z + 0.08, 5, 7, P.zoneMech)       // 유류탱크실-2
    topSurface(g, 43, 55, z + 0.08, 20, 12, P.zoneOffice)       // 운영사무실
    topSurface(g, 43, 67, z + 0.08, 20, 21, P.zoneOffice)       // 사무실
    topSurface(g, 43, 88, z + 0.08, 20, 14, P.zoneMeet)         // 회의실
  })()

  /* 외벽 + 칸막이 */
  wall(MAIN.x0, MAIN.y0, z, MAIN.x1 - MAIN.x0, 1.1, XWH, 0, -1, false)
  wall(MAIN.x0, MAIN.y1 - 1.1, z, MAIN.x1 - MAIN.x0, 1.1, XWH, 0, 1, false)
  wall(MAIN.x0, 1.1, z, 1.1, MAIN.y1 - 2.2, XWH, -1, 0, false)
  wall(MAIN.x1 - 1.1, 1.1, z, 1.1, MAIN.y1 - 2.2, XWH, 1, 0, false)
  wall(SUP.x0, SUP.y0, z, SUP.x1 - SUP.x0, 1.1, XWH, 0, -1, false)
  wall(SUP.x0, SUP.y1 - 1.1, z, SUP.x1 - SUP.x0, 1.1, XWH, 0, 1, false)
  wall(SUP.x0, SUP.y0 + 1.1, z, 1.1, SUP.y1 - SUP.y0 - 2.2, XWH, -1, 0, false)
  wall(SUP.x1 - 1.1, SUP.y0 + 1.1, z, 1.1, SUP.y1 - SUP.y0 - 2.2, XWH, 1, 0, false)
  wall(32, MAIN.y1, z, 0.6, SUP.y0 - MAIN.y1, XWH, 0, 0, true)   // 소화가스실 벽
  wall(37.9, MAIN.y1, z, 0.6, SUP.y0 - MAIN.y1, XWH, 0, 0, true)
  wall(7, 4.4, z, 91.3, 0.7, XWH, 0, 0, true)
  wall(12, 22.4, z, 82, 0.7, XWH, 0, 0, true)
  wall(7, 1.8, z, 0.7, 35, XWH, 0, 0, true)
  wall(97.6, 1.8, z, 0.7, 35, XWH, 0, 0, true)
  wall(42.3, SUP.y0 + 1.1, z, 0.7, 48, XWH, 0, 0, true)   // 발전기실 | 사무 윙

  /* 항온항습실 — 팬월 10기 */
  ;(function crahF2() {
    const g = G('crah', 'cooling')
    for (let i = 0; i < 10; i++) {
      const x = 8.6 + i * 9.1
      box(g, x, 0.8, z, 6.4, 2.8, WH * 0.82, P.blue)
      box(g, x + 0.3, 0.95, z + WH * 0.82, 5.8, 2.5, 0.55, '#8FA9C0')
      fanFront(g, x + 1.7, 3.75, z + 1.7, 1.1, 'z')
      fanFront(g, x + 4.7, 3.75, z + 1.7, 1.1, 'z')
      fanFront(g, x + 1.7, 3.75, z + 3.9, 1.1, 'z')
      fanFront(g, x + 4.7, 3.75, z + 3.9, 1.1, 'z')
    }
  })()

  /* ── 전산실: GPU 랙 9열 종배열 (도면과 동일 방향) ── */
  ;(function dataHall() {
    const g = G('gpu-rack', 'it')
    for (const ax of AISLE_X) {
      for (const side of [-1, 1]) {
        const x = ax + (side > 0 ? 0.78 : -0.78 - 1.15)
        for (let i = 0; i < 6; i++) {
          const y = 6 + i * 2.25
          box(g, x, y, z, 1.15, 1.9, 2.6, P.rackBody)
          box(g, side > 0 ? x - 0.06 : x + 1.15, y + 0.15, z + 0.2, 0.06, 1.6, 2.2, P.rackDoor, { noedge: true })
          box(g, side > 0 ? x - 0.04 : x + 1.17, y + 1.55, z + 2.42, 0.05, 0.16, 0.12, '#5FE3A8', { noedge: true })
        }
        box(g, x + (side > 0 ? 0.42 : 0.42), 6, z + 2.95, 0.3, 6 * 2.25 - 0.35, 0.1, P.tray, { noedge: true })
      }
    }
    // 스토리지 · 네트워크 (동측)
    const s = G('storage', 'it')
    for (let i = 0; i < 4; i++) {
      box(s, 83 + (i % 2) * 3.2, 7 + Math.floor(i / 2) * 4.4, z, 2.6, 2.9, 2.6, P.purp)
      for (let k = 0; k < 4; k++) box(s, 83.15 + (i % 2) * 3.2, 9.75 + Math.floor(i / 2) * 4.4, z + 0.4 + k * 0.55, 2.3, 0.2, 0.3, '#DED8F7')
    }
    const n = G('network', 'it')
    for (let i = 0; i < 4; i++) {
      box(n, 90.5 + (i % 2) * 3.2, 7 + Math.floor(i / 2) * 4.4, z, 2.6, 2.9, 2.6, P.purp)
      for (let k = 0; k < 3; k++) box(n, 90.65 + (i % 2) * 3.2, 9.75 + Math.floor(i / 2) * 4.4, z + 0.35 + k * 0.5, 2.3, 0.2, 0.22, '#7A6CC9', { noedge: true })
      box(n, 90.65 + (i % 2) * 3.2, 9.75 + Math.floor(i / 2) * 4.4, z + 2.15, 2.3, 0.2, 0.36, '#DED8F7')
    }
  })()

  /* 핫아일 격리 캐노피 (열별 종방향) */
  ;(function containment() {
    const g = G('containment', 'cooling')
    for (const ax of AISLE_X) {
      box(g, ax - 0.78, 5.7, z + 3.1, 1.56, 6 * 2.25 + 0.4, 0.12, '#CFE4F0', { op: 0.28 })
      box(g, ax - 0.78, 5.6, z + 2.6, 1.56, 0.1, 0.5, '#CFE4F0', { op: 0.24 })
      box(g, ax - 0.78, 5.7 + 6 * 2.25 + 0.3, z + 2.6, 1.56, 0.1, 0.5, '#CFE4F0', { op: 0.24 })
    }
  })()

  /* CDU 5기 + 콜드플레이트 마커 */
  ;(function liquidCooling() {
    const g = G('cdu', 'cooling')
    for (let r = 0; r < 5; r++) {
      const x = 20 + r * 12
      box(g, x, 22.6, z, 3, 2.4, 2.4, P.cdu)
      box(g, x + 0.3, 24.9, z + 1.8, 1.2, 0.2, 0.4, '#454E58')
      cylDir(g, [x + 0.8, 25, z + 0.9], [x + 0.8, 25.5, z + 0.9], 0.24, '#0FA396', { seg: 10 })
      cylDir(g, [x + 1.8, 25, z + 0.9], [x + 1.8, 25.5, z + 0.9], 0.24, '#E2793B', { seg: 10 })
    }
    const cp = G('cold-plate', 'cooling')
    box(cp, AISLE_X[2] + 0.9, 11, z + 2.62, 0.5, 0.7, 0.5, '#0FA396')
  })()

  /* ── 남측 전기 밴드: 전기실1(UPS) · 축전지실1/2 · 전기실2(수배전+PDU) ── */
  ;(function elecBand() {
    const g = G('ups', 'power')
    for (let i = 0; i < 3; i++) {
      const x = 14 + i * 6.2
      box(g, x, 25, z, 5.2, 3.1, 2.6, P.yel)
      box(g, x + 0.5, 28, z + 1.9, 3.2, 0.26, 0.55, '#454E58')
      box(g, x + 0.8, 28.15, z + 2.05, 1.2, 0.18, 0.26, '#57D0A8', { noedge: true })
    }
    const b = G('battery', 'power')
    for (const bx of [35.5, 41.7, 61.5, 67.7]) {
      box(b, bx, 25, z, 5.2, 3.4, 2.3, P.yel)
      for (let s = 0; s < 3; s++) box(b, bx + 0.3, 28.25, z + 0.35 + s * 0.72, 4.6, 0.24, 0.42, '#FFEBAF')
      box(b, bx, 28.25, z + 2.35, 5.2, 0.2, 0.2, '#E86A44', { noedge: true })
    }
    const sg = G('switchgear', 'power')
    for (let i = 0; i < 2; i++) {
      const x = 79 + i * 5.4
      box(sg, x, 25, z, 4.6, 3.1, 2.5, P.yel)
      box(sg, x + 0.4, 27.95, z + 0.8, 3.8, 0.26, 1.35, '#FFEBAF')
    }
    const p = G('pdu', 'power')
    for (let i = 0; i < 2; i++) {
      const x = 89.5 + i * 4.4
      box(p, x, 25, z, 3.6, 3, 2.5, P.yel)
      for (let s = 0; s < 3; s++) box(p, x + 0.4, 27.85, z + 0.5 + s * 0.5, 2.8, 0.18, 0.32, '#E8C25A', { noedge: true })
      cylDir(p, [x + 1, 27.9, z + 2.2], [x + 1, 28.2, z + 2.2], 0.5, '#FFEBAF', { seg: 14 })
    }
  })()

  /* ── 버스웨이 2계통 (전산실 상부 — 랙 열 직교, 동서 방향) ── */
  ;(function busway() {
    const g = G('busway', 'power')
    for (const by of [8, 16]) {
      box(g, 14, by - 0.55, z + 5.1, 66, 1.1, 1.0, P.yel)
      for (const ax of AISLE_X) {
        box(g, ax - 0.7, by - 0.7, z + 4.6, 1.4, 1.4, 0.6, P.yelD)
        pipe(g, [[ax, by, z + 4.7], [ax, by, z + 3.1]], '#EBB410', 0.2, false)
      }
    }
  })()

  /* ── 소화가스실 (연결부 상부 — 도면 3페이지 위치) ── */
  ;(function fireGas() {
    const g = G('fire-gas', 'mgmt')
    for (let i = 0; i < 6; i++) {
      const x = 33 + (i % 3) * 1.5, y = 42 + Math.floor(i / 3) * 2.2
      cylY(g, x, y, z, 0.58, 3.2, '#F7CE55')
      cylY(g, x, y, z + 3.2, 0.24, 0.5, '#A39E90')
    }
    box(g, 33, 47.5, z, 4, 2.6, 2.2, '#DDE3E8')
  })()

  /* ── 공급동 2F: 비상발전기실 · DA · 유류탱크실 · 사무 윙 ── */
  ;(function genRoom() {
    const g = G('generator', 'power')
    function gen(x, y) {
      box(g, x, y, z, 12, 5.2, 0.9, '#CFC2A4', { noedge: true })
      box(g, x + 0.3, y + 0.2, z + 0.9, 2.6, 4.8, 5.4, '#F5C542')
      for (let s = 0; s < 4; s++) box(g, x + 0.15, y + 0.6 + s * 1.05, z + 1.6, 0.18, 0.7, 4.2, '#D9A93C', { noedge: true })
      box(g, x + 3.2, y + 0.5, z + 0.9, 5, 4.2, 4.2, P.yel)
      cylDir(g, [x + 8.6, y + 2.6, z + 3], [x + 11.4, y + 2.6, z + 3], 1.5, '#F7CE55', { seg: 16 })
      cylY(g, x + 11.4, y + 2.6, z + 3, 0.5, 0.24, '#E0AC2E')
      cylDir(g, [x + 3.7, y + 0.9, z + 5.8], [x + 7.6, y + 0.9, z + 5.8], 0.55, '#AFB6BD', { seg: 12 })
      pipe(g, [[x + 7.6, y + 0.9, z + 5.8], [x + 8.4, y + 0.9, z + 5.8], [x + 8.4, y + 0.9, z + 7.2]], '#8E8B82', 0.3, false)
      box(g, x + 4.8, y + 4.8, z + 5.3, 2, 0.24, 1.2, '#454E58')
    }
    gen(11, 60); gen(24, 60); gen(11, 78); gen(24, 78)
    // DA(급기) 루버 — 서측 전면
    const d = G(null, null)
    for (let i = 0; i < 7; i++) box(d, 9.3, 57 + i * 5.4, z + 1 + (i % 2) * 0.8, 0.3, 4, 3, '#C6CDD3', { noedge: true })
    // DA(배기) 샤프트 — 발전기실 북·남
    box(d, 16, 55.2, z, 10, 1.6, 4.5, '#DDE3E8', { op: 0.85 })
    box(d, 16, 93.2, z, 10, 1.6, 4.5, '#DDE3E8', { op: 0.85 })

    // 유류탱크실-1/2 — 일일 서비스 탱크
    const f = G('fuel', 'power')
    for (const ty of [56, 91]) {
      cylY(f, 6.6, ty + 2.5, z, 1.6, 4.4, '#EBDEC0', { seg: 16 })
      cylY(f, 6.6, ty + 2.5, z + 4.4, 1.66, 0.3, '#DCC998', { seg: 16 })
      pipe(f, [[6.6, ty + 2.5, z + 1], [10.5, ty + 4, z + 1]], '#DCC998', 0.2, false)
    }
  })()

  ;(function officeWing() {
    const d = G(null, null)
    // 운영사무실 (상단)
    box(d, 46, 58, z, 8, 2.2, 1.05, P.wood)
    box(d, 47, 58.4, z + 1.1, 1.6, 0.2, 1, '#5E7A94')
    box(d, 50.5, 58.4, z + 1.1, 1.6, 0.2, 1, '#5E7A94')
    box(d, 47.5, 61, z, 1, 1, 1.1, '#8A93A0', { noedge: true })
    box(d, 51, 61, z, 1, 1, 1.1, '#8A93A0', { noedge: true })
    // 사무실 데스크 3열
    for (let r = 0; r < 3; r++) {
      box(d, 46, 69 + r * 6.4, z, 8, 2.2, 1.05, P.wood)
      box(d, 47, 69.4 + r * 6.4, z + 1.1, 1.6, 0.2, 1, '#5E7A94')
      box(d, 50.5, 69.4 + r * 6.4, z + 1.1, 1.6, 0.2, 1, '#5E7A94')
      box(d, 47.5, 72 + r * 6.4, z, 1, 1, 1.1, '#8A93A0', { noedge: true })
      box(d, 51, 72 + r * 6.4, z, 1, 1, 1.1, '#8A93A0', { noedge: true })
    }
    // 회의실 ×2 (남단) — 칸막이 + 테이블
    wall(43, 87.6, z, 20, 0.5, WH * 0.7, 0, 0, true)
    wall(53, 88, z, 0.5, 14, WH * 0.7, 0, 0, true)
    for (const mx of [45, 55.5]) {
      box(d, mx, 92, z, 6.4, 2.8, 1.05, P.wood)
      for (let c = 0; c < 3; c++) {
        box(d, mx + 0.5 + c * 2.1, 90.8, z, 0.9, 0.9, 1.1, '#8A93A0', { noedge: true })
        box(d, mx + 0.5 + c * 2.1, 95.2, z, 0.9, 0.9, 1.1, '#8A93A0', { noedge: true })
      }
    }
  })()
}

/* ═══════════════ 옥상 ═══════════════ */
function buildRoof() {
  setFloor('roof')

  slab(MAIN.x0, MAIN.y0, LV.roof, MAIN.x1 - MAIN.x0, MAIN.y1 - MAIN.y0, 1, 'roof', P.roof, P.roofTop, 0.8)
  slab(SUP.x0, SUP.y0, LV.roof, SUP.x1 - SUP.x0, SUP.y1 - SUP.y0, 1, 'roof', P.roof, P.roofTop, 0.62)
  slab(31.5, MAIN.y1, LV.roof, 7, SUP.y0 - MAIN.y1, 1, 'roof', P.roof, P.roofTop, 0.62)

  const z = LV.roof

  ;(function parapet() {
    const d = G(null, null)
    box(d, MAIN.x0, MAIN.y0, z, MAIN.x1 - MAIN.x0, 0.5, 1.1, P.roof, { noedge: true })
    box(d, MAIN.x0, MAIN.y1 - 0.5, z, MAIN.x1 - MAIN.x0, 0.5, 1.1, P.roof, { noedge: true })
    box(d, MAIN.x0, MAIN.y0, z, 0.5, MAIN.y1 - MAIN.y0, 1.1, P.roof, { noedge: true })
    box(d, MAIN.x1 - 0.5, MAIN.y0, z, 0.5, MAIN.y1 - MAIN.y0, 1.1, P.roof, { noedge: true })
  })()

  ;(function towers() {
    const g = G('cooling-tower', 'cooling')
    function tower(x, y) {
      box(g, x, y, z, 10, 8, 1.4, '#EAE2D2')
      box(g, x + 0.3, y + 0.3, z + 1.4, 9.4, 7.4, 4.2, P.cream2)
      for (let s = 0; s < 4; s++) {
        box(g, x + 0.6, y + 7.5, z + 1.8 + s * 0.85, 8.8, 0.22, 0.34, '#DCCFB4', { noedge: true })
        box(g, x + 9.5, y + 0.6, z + 1.8 + s * 0.85, 0.22, 6.8, 0.34, '#D4C7AC', { noedge: true })
      }
      box(g, x, y, z + 5.6, 10, 8, 0.7, P.cream)
      fanTop(g, x + 2.7, y + 2.4, z + 6.3, 1.4)
      fanTop(g, x + 7.3, y + 2.4, z + 6.3, 1.4)
      fanTop(g, x + 2.7, y + 5.7, z + 6.3, 1.4)
      fanTop(g, x + 7.3, y + 5.7, z + 6.3, 1.4)
      ladder(g, x + 10.3, y + 4, z, 6.2)
    }
    tower(12, 7); tower(26, 7); tower(40, 7)
  })()

  ;(function drycoolers() {
    const g = G('dry-cooler', 'cooling')
    function dryc(x, y) {
      box(g, x, y, z, 7.4, 1.5, 0.85, P.steel, { noedge: true })
      const v1 = box(g, x + 0.55, y + 0.4, z + 0.55, 6.3, 0.4, 3.7, '#F2D9B8'); v1.rotation.x = -0.42
      const v2 = box(g, x + 0.55, y + 4.85, z + 0.55, 6.3, 0.4, 3.7, '#F2D9B8'); v2.rotation.x = 0.42
      box(g, x + 0.3, y + 0.3, z + 3.4, 6.8, 4.9, 0.42, P.cream2)
      fanTop(g, x + 2, y + 2.7, z + 3.85, 1.2, '#B08A62')
      fanTop(g, x + 5.4, y + 2.7, z + 3.85, 1.2, '#B08A62')
    }
    dryc(62, 7); dryc(72, 7); dryc(82, 7)
  })()

  ;(function ahu() {
    const d = G(null, null)
    box(d, 62, 22, z, 7, 5.4, 2.6, P.cream2)
    fanTop(d, 65.5, 24.7, z + 2.6, 1.4)
    box(d, 74, 22.5, z, 6, 4.6, 2, P.cream2)
    for (let s = 0; s < 3; s++) box(d, 74.3, 27, z + 0.4 + s * 0.55, 5.4, 0.2, 0.22, '#D4C7AC', { noedge: true })
    for (const fy of [62, 80]) { box(d, 16, fy, z, 4, 4, 1, P.cream2); fanTop(d, 18, fy + 2, z + 1, 1.3) }
  })()
}

/* ═══════════════ 계통 배관 · 흐름 ═══════════════ */
function buildFlows() {
  setFloor('b1')

  // 전력: GIS → 공동구 → B1 전기실-1
  ;(function powerIntake() {
    const g = G('gis', 'power')
    pipe(g, [[24, 66, 1.8], [35, 58, 1.8], [35, 40, 1.8], [35, 24, 2.2], [28, 14, 2.6]], '#EBB410', 0.34)
  })()

  // 전력: 수배전반 → 변압기 → 동측 EPS 라이저 (B1→2F) + 서측 라이저 (B1→1F)
  ;(function powerRisers() {
    const g = G('switchgear', 'power')
    pipe(g, [[26, 14, 2.6], [44, 14, 2.6], [51, 10, 3.0]], '#EBB410', 0.3, false)
    pipe(g, [[56, 10, 3.0], [76, 30, 3.0], [101.5, 30, 3.0], [101.5, 30, 29.5], [93, 27, 29.5]], '#EBB410', 0.34)
    pipe(g, [[24, 8, 2.8], [3.6, 8, 2.8], [3.6, 8, 16.1], [15, 8.5, 16.1]], '#EBB410', 0.3)
  })()

  // 응축수 루프: 옥상 냉각탑 ↔ B1 칠러 응축기
  ;(function condensate() {
    const g = G('fws', 'cooling')
    pipe(g, [[17, 12, 42.1], [17, 33, 42.1], [96, 33, 42.1], [96, 33, 3.6], [86, 12, 3.9]], '#9CC6E4', 0.42)
  })()

  // 냉수(FWS·공랭용): B1 칠러 → 서측 라이저 → 1F·2F 항온항습실 헤더
  ;(function chilled() {
    const g = G('fws', 'cooling')
    pipe(g, [[80, 6, 2.4], [60, 2.5, 2.4], [9.5, 2.5, 2.4], [9.5, 2.5, 30.9], [94, 2.5, 30.9]], '#3E9CD6', 0.42)
    setFloor('f1')
    pipe(g, [[9.5, 2.5, 17.4], [94, 2.5, 17.4]], '#3E9CD6', 0.3)
    for (const dx of [16, 39, 62, 85]) pipe(g, [[dx, 2.5, 17.4], [dx, 2.5, 15.7]], '#3E9CD6', 0.2, false)
    setFloor('f2')
    for (const dx of [16, 39, 62, 85]) pipe(g, [[dx, 2.5, 30.9], [dx, 2.5, 29.2]], '#3E9CD6', 0.2, false)
  })()

  setFloor('f2')

  // 고온수(FWS·액랭용): CDU 회수 헤더 → 동측 라이저 → 옥상 드라이쿨러
  ;(function hotLoop() {
    const g = G('fws', 'cooling')
    pipe(g, [[21, 25.6, 29.7], [60, 25.6, 29.7], [96.5, 25.6, 29.7], [96.5, 25.6, 42.1], [96.5, 9, 42.1], [90, 9, 42.1]], '#E2793B', 0.42)
  })()

  // TCS: CDU → 공급 헤더 → 각 열 매니폴드 (종방향)
  ;(function tcsLoops() {
    const t = G('tcs', 'cooling')
    const m = G('manifold', 'cooling')
    const AISLE_X = [16, 23.6, 31.2, 38.8, 46.4, 54, 61.6, 69.2, 76.8]
    for (let r = 0; r < 5; r++) {
      const cx = 21.5 + r * 12
      pipe(t, [[cx, 22.6, 29.4], [cx, 20.8, 30.5]], '#0FA396', 0.26, false)
    }
    pipe(t, [[16, 20.8, 30.5], [76.8, 20.8, 30.5]], '#0FA396', 0.28)
    for (const ax of AISLE_X) pipe(m, [[ax, 20.8, 30.5], [ax, 6, 30.5]], '#0FA396', 0.22, false)
  })()

  // 전력: 버스웨이 급전 (남측 전기실 → 동서 버스웨이 2계통)
  ;(function buswayFeed() {
    const g = G('busway', 'power')
    pipe(g, [[80, 24.5, 29.8], [80, 16, 32.6], [16, 16, 32.6]], '#EBB410', 0.28)
    pipe(g, [[80, 24.5, 29.8], [80, 8, 32.6], [16, 8, 32.6]], '#EBB410', 0.28)
  })()

  // 전력: 비상발전기 → 연결부 → 전산동 라이저 (모선 연락)
  ;(function genTie() {
    const g = G('generator', 'power')
    pipe(g, [[23, 60, 33.6], [35, 52, 33.6], [35, 40, 33.6], [80, 40, 33.6], [101.5, 33, 33.6], [101.5, 30, 29.8]], '#EBB410', 0.3)
  })()

  setFloor(null)
}

/* ═══════════════ 디테일 증강 (스케일 확장에 따른 밀도 보강) ═══════════════
   단면계획·평면도 기반 추가 요소: 케이블 트레이, 배관 헤더, 트렌치,
   급기 덕트, EOR 분전 캐비닛, 옥상 프리쿨링 냉동기 가대 프레임 등 */
function buildDetailPlus() {
  /* ── B1 ── */
  setFloor('b1')
  ;(function b1Plus() {
    // 전기실-1: 배전반 열 상부 케이블 트레이 3주행
    const sg = G('switchgear', 'power')
    for (const ty of [7, 14, 21]) {
      box(sg, 9.5, ty - 0.5, 4.4, 35, 1.0, 0.16, P.tray, { noedge: true })
      for (let k = 0; k < 8; k++) box(sg, 10.5 + k * 4.4, ty - 0.5, 4.1, 0.16, 1.0, 0.3, '#8FA083', { noedge: true })
    }
    // 기계실: 칠러 ↔ 펌프 스키드 냉수 헤더 + 밸브
    const pm = G('pumps', 'cooling')
    pipe(pm, [[87.6, 4.5, 1.2], [87.6, 13.5, 1.2]], '#9FB6CC', 0.34, false)
    for (const vy of [5, 8.8, 12.6]) {
      pipe(pm, [[87.6, vy, 1.2], [88.9, vy, 0.9]], '#9FB6CC', 0.24, false)
      cylY(pm, 87.6, vy, 1.7, 0.28, 0.5, '#5C7C9E')
    }
    // 기계 갤러리: 배관 랙 위 실배관 2주행
    const tg = G(null, null)
    cylDir(tg, [71.5, 21.2, 1.15], [95.5, 21.2, 1.15], 0.34, '#C4D6E4', { seg: 12, pick: false })
    cylDir(tg, [71.5, 22.6, 1.15], [95.5, 22.6, 1.15], 0.34, '#E8C9AF', { seg: 12, pick: false })
    // GIS실: 케이블 트렌치 마킹 2열
    const gz = G('gis', 'power')
    topSurface(gz, 34.6, 59, 0.12, 1.1, 39, '#C8CFD8')
    topSurface(gz, 37.2, 59, 0.12, 1.1, 39, '#C8CFD8')
  })()

  /* ── 1F ── */
  ;(function f1Plus() {
    setFloor('f1')
    const z = LV.f1
    // 항온항습실: 팬월 상부 급기 덕트 (동서 주행 + 팬월별 수직 연결)
    const cr = G('crah', 'cooling')
    box(cr, 8, 0.9, z + WH * 0.82 + 0.85, 96, 2.2, 1.4, '#D3DEE8', { op: 0.92 })
    for (let i = 0; i < 8; i++) {
      const x = 10 + i * 11.4
      box(cr, x + 2.5, 1.2, z + WH * 0.82 + 0.55, 1.6, 1.6, 0.32, '#B9CAD9', { noedge: true })
    }
    // 전기실1: UPS 열 상부 케이블 트레이 2주행
    const up = G('ups', 'power')
    for (const ty of [8.6, 16.1]) {
      box(up, 13.4, ty - 0.5, z + 4.2, 27, 1.0, 0.16, P.tray, { noedge: true })
      for (let k = 0; k < 6; k++) box(up, 14.6 + k * 4.4, ty - 0.5, z + 3.9, 0.16, 1.0, 0.3, '#8FA083', { noedge: true })
    }
    // 하역장: 지게차 + 팔레트 스택
    const d = G(null, null)
    box(d, 30.5, 27.5, z, 1.5, 2.6, 1.1, '#E8A33D')
    box(d, 30.7, 28.0, z + 1.1, 1.1, 1.3, 0.9, '#4A5560')
    box(d, 30.35, 30.1, z + 0.2, 1.8, 0.16, 0.14, '#8A93A0', { noedge: true })
    box(d, 30.35, 30.35, z + 0.2, 1.8, 0.16, 0.14, '#8A93A0', { noedge: true })
    box(d, 27, 30.5, z, 2.4, 2, 0.35, P.wood, { noedge: true })
    box(d, 27, 30.5, z + 0.35, 2.4, 2, 1.1, P.cream2)
    // 로비: 사이니지 + 플랜터
    box(d, 47.6, 71, z, 0.4, 2.6, 2.3, '#30353C')
    box(d, 47.55, 71.4, z + 0.9, 0.5, 1.8, 1.0, '#7FD8C8', { noedge: true })
    for (const py of [69.4, 84.6]) {
      box(d, 60.8, py, z, 1.3, 1.3, 0.75, '#C9D3DC', { noedge: true })
      cylY(d, 61.45, py + 0.65, z + 0.75, 0.5, 1.3, '#A8CFA0', { seg: 10 })
    }
  })()

  /* ── 2F ── */
  ;(function f2Plus() {
    setFloor('f2')
    const z = LV.f2
    const AISLE_X = [16, 23.6, 31.2, 38.8, 46.4, 54, 61.6, 69.2, 76.8]
    // 각 랙 열 남단 EOR(End-of-Row) 분전 캐비닛
    const pd = G('pdu', 'power')
    for (const ax of AISLE_X) {
      box(pd, ax - 0.75, 19.85, z, 1.5, 1.3, 2.2, P.gray)
      box(pd, ax - 0.45, 21.1, z + 1.5, 0.9, 0.14, 0.4, '#454E58', { noedge: true })
    }
    // 전산실 상부 광케이블 트레이 (동서 1주행 — 버스웨이와 별도 레벨)
    const nw = G('network', 'it')
    box(nw, 14, 11.6, z + 4.5, 66, 0.8, 0.14, '#B9AEE0', { noedge: true })
    for (const ax of AISLE_X) box(nw, ax - 0.4, 11.5, z + 4.2, 0.8, 1.0, 0.3, '#9D8FD4', { noedge: true })
    // 소화가스실: 실린더 2기 추가 + 방출 헤더
    const fg = G('fire-gas', 'mgmt')
    for (const fx of [33, 34.5]) { cylY(fg, fx, 46.6, z, 0.58, 3.2, '#F7CE55'); cylY(fg, fx, 46.6, z + 3.2, 0.24, 0.5, '#A39E90') }
    pipe(fg, [[33, 42, z + 3.9], [36, 42, z + 3.9], [36, 46.6, z + 3.9]], '#C9B98A', 0.16, false)
    // 발전기실 바닥 정비 통로 마킹
    const gd = G(null, null)
    topSurface(gd, 10, 68.5, z + 0.1, 27, 1.6, '#E9D9A8')
    topSurface(gd, 10, 86.5, z + 0.1, 27, 1.6, '#E9D9A8')
  })()

  /* ── 옥상 ── */
  ;(function roofPlus() {
    setFloor('roof')
    const z = LV.roof
    // 프리쿨링 냉동기 + 가대 프레임 (단면계획: '프리쿨링 냉동기(기계) · 냉동기 가대 프레임')
    const d = G(null, null)
    const FR = { x0: 14, y0: 21, w: 30, dpt: 12, h: 2.6 }
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++)
      box(d, FR.x0 + 1 + i * ((FR.w - 2.6) / 3), FR.y0 + 1 + j * (FR.dpt - 2.6), z, 0.6, 0.6, FR.h, '#9AA5B1', { noedge: true })
    box(d, FR.x0, FR.y0, z + FR.h, FR.w, 0.55, 0.5, '#8A96A3', { noedge: true })
    box(d, FR.x0, FR.y0 + FR.dpt - 0.55, z + FR.h, FR.w, 0.55, 0.5, '#8A96A3', { noedge: true })
    box(d, FR.x0, FR.y0, z + FR.h, 0.55, FR.dpt, 0.5, '#8A96A3', { noedge: true })
    box(d, FR.x0 + FR.w - 0.55, FR.y0, z + FR.h, 0.55, FR.dpt, 0.5, '#8A96A3', { noedge: true })
    topSurface(d, FR.x0, FR.y0, z + FR.h + 0.52, FR.w, FR.dpt, '#CBD4DC', 0.96)
    for (let i = 0; i < 3; i++) {
      const cx = FR.x0 + 1.6 + i * 9.6
      box(d, cx, FR.y0 + 2, z + FR.h + 0.55, 8, 5.2, 2.4, '#CFE0EE')
      cylDir(d, [cx + 0.8, FR.y0 + 3.2, z + FR.h + 1.4], [cx + 7.2, FR.y0 + 3.2, z + FR.h + 1.4], 0.75, P.blue, { seg: 14 })
      cylDir(d, [cx + 0.8, FR.y0 + 5.6, z + FR.h + 2.2], [cx + 7.2, FR.y0 + 5.6, z + FR.h + 2.2], 0.75, P.blueD, { seg: 14 })
      fanTop(d, cx + 2.2, FR.y0 + 4.6, z + FR.h + 2.95, 1.05)
      fanTop(d, cx + 5.8, FR.y0 + 4.6, z + FR.h + 2.95, 1.05)
    }
    // 냉각탑 급수 헤더 + 탑별 분기
    const ct = G('cooling-tower', 'cooling')
    pipe(ct, [[13, 16.8, z + 1.2], [49, 16.8, z + 1.2]], '#9CC6E4', 0.3, false)
    for (const tx of [17, 31, 45]) pipe(ct, [[tx, 16.8, z + 1.2], [tx, 15.2, z + 1.6]], '#9CC6E4', 0.22, false)
  })()

  setFloor(null)
}

/* ═══════════════ 라벨 앵커 ═══════════════ */
export const LABELS = [
  ['cooling-tower', [31, 11, 47.7]],
  ['dry-cooler', [75.5, 9.5, 45]],
  ['crah', [50, 2.2, 32.6]],
  ['gpu-rack', [24.4, 12, 30.4]],
  ['containment', [46.4, 12, 30.4]],
  ['cold-plate', [32.4, 11.3, 29.9]],
  ['manifold', [23.6, 8, 30.7]],
  ['tcs', [46, 20.8, 30.6]],
  ['cdu', [45.5, 23.8, 29.4]],
  ['busway', [47, 8, 32.7]],
  ['pdu', [91.5, 26.5, 29.6]],
  ['storage', [85.5, 9, 29.8]],
  ['network', [93, 9, 29.8]],
  ['mmr', [3.8, 9, 16.1]],
  ['ups', [24, 8.6, 16.3]],
  ['battery', [50, 10.6, 16.1]],
  ['switchgear', [26, 12, 2.6]],
  ['transformer', [55, 7.5, 3.4]],
  ['gis', [22, 73, 3.2]],
  ['fuel', [-3.5, 62, 3.6]],
  ['generator', [17, 82, 32]],
  ['fire-gas', [34.8, 43, 30.8]],
  ['chiller', [79, 6.3, 2.6]],
  ['pumps', [90, 8.8, 2.2]],
  ['water-treatment', [95.7, 12, 4.4]],
  ['tes', [82, 25.5, 7]],
  ['fws', [9.5, 2.5, 21.5]],
  ['bms', [77, 25, 17.3]],
]
