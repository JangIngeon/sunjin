import { create } from 'zustand'
import { LABELS } from '../scene/buildFacility.js'

const FLOOR_OF_Z = (z) => (z < 12 ? 'b1' : z < 25.5 ? 'f1' : z < 39 ? 'f2' : 'roof')

/** 용어의 라벨 앵커 높이로 소속 층 결정 (fws는 전 층 관통 → 전체 유지) */
function floorOfTerm(id) {
  if (id === 'fws') return 'all'
  const entry = LABELS.find((l) => l[0] === id)
  return entry ? FLOOR_OF_Z(entry[1][2]) : 'all'
}

/**
 * Shared state between the React UI (header/toolbar/sidebar) and the
 * imperative three.js viewport. Mirrors the reference implementation's
 * globals: activeFilter, activeFloor, flowState/flowOn, selected.
 */
export const useAppStore = create((set) => ({
  /**
   * 모델 모드: multi(복층·React 앱) | single(단층·원본 HTML을 iframe으로 그대로 실행).
   * 단층 코드는 수정 없이 원본 그대로 구동된다.
   */
  mode: 'multi',
  setMode: (mode) => set((s) => (s.mode === mode ? {} : { mode })),

  /** 계통 필터: all | cooling | power | it | mgmt */
  filter: 'all',
  setFilter: (filter) => set({ filter }),

  /** 층 필터: all | b1 | f1 | f2 | roof */
  floor: 'all',
  setFloor: (floor) => set({ floor }),

  /** Flow 표시 상태 (레퍼런스와 동일한 5계통) */
  flowState: { condensate: true, chilled: true, heat: true, tcs: true, power: true },
  toggleFlow: (key) =>
    set((s) => ({ flowState: { ...s.flowState, [key]: !s.flowState[key] } })),
  flowOn: true,
  toggleFlowMaster: () =>
    set((s) => {
      const on = !s.flowOn
      const flowState = { ...s.flowState }
      Object.keys(flowState).forEach((k) => (flowState[k] = on))
      return { flowOn: on, flowState }
    }),

  /** 선택된 용어 id (null = 선택 없음) */
  selected: null,
  setSelected: (selected) => set({ selected }),

  /**
   * 사이드바에서 부품을 클릭했을 때: 선택 + 해당 층 전환 + 카메라 줌인.
   * (3D 라벨/모델 클릭은 setSelected만 — 카메라는 움직이지 않음)
   */
  focusId: null,
  focusTick: 0,
  requestFocus: (id) =>
    set((s) => ({
      selected: id,
      focusId: id,
      focusTick: s.focusTick + 1,
      floor: floorOfTerm(id),
    })),

  /** 장비 라벨(리더라인 포함) 표시 여부 */
  labelsOn: true,
  toggleLabels: () => set((s) => ({ labelsOn: !s.labelsOn })),

  /** 카메라 리셋 트리거 — 시점 초기화 + 선택 해제 + 층 필터 '전체' 복귀 */
  resetTick: 0,
  requestReset: () =>
    set((s) => ({ resetTick: s.resetTick + 1, selected: null, floor: 'all' })),

  /** 사이드바 검색어 */
  query: '',
  setQuery: (query) => set({ query }),
}))
