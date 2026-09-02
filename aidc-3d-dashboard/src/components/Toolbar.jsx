import { useAppStore } from '../store/useAppStore.js'

const CAT_CHIPS = [
  ['all', '전체'],
  ['cooling', '냉각'],
  ['power', '전력'],
  ['it', 'IT·컴퓨트'],
  ['mgmt', '감시·제어'],
]

const FLOW_CHIPS = [
  ['condensate', '응축수 루프', '#9CC6E4'],
  ['chilled', '냉수 (FWS·공랭용)', '#3E9CD6'],
  ['heat', '고온수 (FWS·액랭용)', '#E2793B'],
  ['tcs', 'TCS (칩 냉각수)', '#0FA396'],
  ['power', '전력 계통', '#D9A312'],
]

export default function Toolbar() {
  const filter = useAppStore((s) => s.filter)
  const setFilter = useAppStore((s) => s.setFilter)
  const flowState = useAppStore((s) => s.flowState)
  const toggleFlow = useAppStore((s) => s.toggleFlow)
  const flowOn = useAppStore((s) => s.flowOn)
  const toggleFlowMaster = useAppStore((s) => s.toggleFlowMaster)
  const labelsOn = useAppStore((s) => s.labelsOn)
  const toggleLabels = useAppStore((s) => s.toggleLabels)
  const requestReset = useAppStore((s) => s.requestReset)

  return (
    <div className="toolbar">
      <div className="filter-nav" aria-label="계통 필터">
        {CAT_CHIPS.map(([key, label]) => (
          <button
            key={key}
            className={`chip cat-${key}${filter === key ? ' on' : ''}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flow-control" aria-label="Flow 표시">
        {FLOW_CHIPS.map(([key, label, color]) => (
          <button
            key={key}
            className={`flow-chip${flowState[key] ? ' on' : ''}`}
            style={{ '--flow-color': color }}
            aria-pressed={flowState[key]}
            onClick={() => toggleFlow(key)}
          >
            {label}
          </button>
        ))}
        <button
          className={`flow-master${flowOn ? ' on' : ''}`}
          type="button"
          aria-label="모든 Flow 켜기 또는 끄기"
          aria-pressed={flowOn}
          onClick={toggleFlowMaster}
        />
        <button
          className={`label-toggle${labelsOn ? ' on' : ''}`}
          type="button"
          aria-label="장비 라벨 켜기 또는 끄기"
          aria-pressed={labelsOn}
          onClick={toggleLabels}
        >
          라벨
        </button>
        <button className="reset-view" type="button" aria-label="3D 시점 초기화" onClick={requestReset}>
          <svg viewBox="0 0 40 40" aria-hidden="true">
            <path d="M30 20A10 10 0 1 1 27.1 12.9" />
            <path d="M27.1 7.9v5h-5" />
          </svg>
        </button>
      </div>
    </div>
  )
}
