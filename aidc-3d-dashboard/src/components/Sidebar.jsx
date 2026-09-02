import { Fragment, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store/useAppStore.js'
import { TERMS, CATS, CAT_ORDER, FLOORS } from '../data/terms.js'

/**
 * 좌측 학습 패널 — 검색 · 선택 상세 · 계통별 용어 리스트.
 * 레퍼런스의 사이드바 구조(검색 룰라인, 상세 블록, 접이식 그룹)를 따른다.
 */
export default function Sidebar() {
  const selected = useAppStore((s) => s.selected)
  const requestFocus = useAppStore((s) => s.requestFocus)
  const query = useAppStore((s) => s.query)
  const setQuery = useAppStore((s) => s.setQuery)
  const floor = useAppStore((s) => s.floor)
  const setFloor = useAppStore((s) => s.setFloor)
  const [collapsed, setCollapsed] = useState({ cooling: true, power: true, it: true, mgmt: true })
  const bodyRef = useRef(null)
  const [fades, setFades] = useState({ top: false, bottom: false })
  const [overflowing, setOverflowing] = useState(false)

  const q = query.trim().toLowerCase()

  function idsFor(cat) {
    return Object.keys(TERMS).filter((id) => {
      const t = TERMS[id]
      if (t.cat !== cat) return false
      if (q && (t.name + t.en).toLowerCase().indexOf(q) === -1) return false
      return true
    })
  }

  function updateFades() {
    const el = bodyRef.current
    if (!el) return
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    /* 넘침량이 작은 마지막 그룹(감시·제어)도 잘림이 있으면 페이드가 뜨도록
       고정 8px 임계 대신 '남은 스크롤 > 2px' 기준 사용 */
    setFades({ top: el.scrollTop > 8, bottom: max > 0 && max - el.scrollTop > 2 })
    // 목록이 패널을 다 채울 때(스크롤 생길 때)만 층 내비 위 구분선 표시
    setOverflowing(el.scrollHeight > el.clientHeight + 2)
  }
  useEffect(() => { updateFades() }, [query, selected, collapsed])
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.addEventListener('scroll', updateFades, { passive: true })
    return () => el.removeEventListener('scroll', updateFades)
  }, [])

  function onKeyDown(e) {
    if (e.key !== 'Enter') return
    for (const cat of CAT_ORDER) {
      const ids = idsFor(cat)
      if (ids.length) { requestFocus(ids[0]); return }
    }
  }

  const t = selected ? TERMS[selected] : null
  const anyResult = CAT_ORDER.some((cat) => idsFor(cat).length > 0)

  return (
    <aside className="learning-panel">
      <div className="side-head">
        <span className="search-symbol" aria-hidden="true">
          <svg viewBox="0 0 72 72" focusable="false">
            <circle cx="30" cy="30" r="26" />
            <path d="M48.4 48.4L63.5 63.5" />
          </svg>
        </span>
        <input
          className="search"
          type="text"
          aria-label="장비와 용어 검색"
          placeholder="검색"
          autoComplete="off"
          spellCheck="false"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          className={`search-clear${query ? ' show' : ''}`}
          type="button"
          aria-label="검색어 지우기"
          onClick={() => setQuery('')}
        >
          <svg viewBox="0 0 32 32" focusable="false"><path d="M5 5L27 27" /><path d="M27 5L5 27" /></svg>
        </button>
      </div>

      <div className={`side-body${selected ? ' has-selection' : ''}`} ref={bodyRef}>
        {t && (
          <div className="detail show" style={{ '--cat': CATS[t.cat].color }}>
            <div className="d-title-block">
              <div className="d-name">{t.name}</div>
              <div className="d-en">{t.en}</div>
            </div>
            <div className="d-desc">{t.desc}</div>
            <div className="d-facts">
              {t.facts.map((f) => (<div className="f" key={f}>{f}</div>))}
            </div>
            <div className="d-rel">
              {t.rel.slice(0, 3).filter((id) => TERMS[id]).map((id) => (
                <button
                  key={id}
                  data-cat={TERMS[id].cat}
                  style={{ '--tag-color': CATS[TERMS[id].cat].color }}
                  onClick={() => requestFocus(id)}
                >
                  {TERMS[id].name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="list">
          {CAT_ORDER.map((cat) => {
            const ids = idsFor(cat)
            if (!ids.length) return null
            const isCollapsed = !q && collapsed[cat]
            return (
              <div key={cat}>
                <div
                  className={`group-lbl${isCollapsed ? ' collapsed' : ''}`}
                  onClick={() => setCollapsed((c) => ({ ...c, [cat]: !c[cat] }))}
                >
                  <span className="dot" style={{ background: CATS[cat].color }} />
                  {CATS[cat].label}
                </div>
                {!isCollapsed && ids.map((id) => (
                  <div
                    key={id}
                    className={`term-item${selected === id ? ' sel' : ''}`}
                    style={{ '--cat': CATS[TERMS[id].cat].color }}
                    onClick={() => requestFocus(id)}
                  >
                    <span className="tn">{TERMS[id].name}</span>
                    <span className="te">{TERMS[id].en}</span>
                  </div>
                ))}
              </div>
            )
          })}
          {!anyResult && <div className="empty">일치하는 용어가 없습니다.</div>}
        </div>
      </div>

      <nav className={`floor-nav${overflowing ? ' divided' : ''}`} aria-label="층 선택">
        {Object.entries(FLOORS).map(([key, label], i) => (
          <Fragment key={key}>
            {i > 0 && <span className="floor-sep" aria-hidden="true" />}
            <button
              className={`floor-btn${floor === key ? ' on' : ''}`}
              aria-pressed={floor === key}
              onClick={() => setFloor(floor === key ? 'all' : key)}
            >
              {label}
            </button>
          </Fragment>
        ))}
      </nav>

      <div className={`scroll-edge scroll-edge-top${fades.top ? ' visible' : ''}`} />
      <div className={`scroll-edge scroll-edge-bottom${fades.bottom ? ' visible' : ''}`} />
    </aside>
  )
}
