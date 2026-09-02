import { useEffect, useRef } from 'react'
import Header from './components/Header.jsx'
import Toolbar from './components/Toolbar.jsx'
import Sidebar from './components/Sidebar.jsx'
import Viewport from './components/Viewport.jsx'
import { useAppStore } from './store/useAppStore.js'
import singleHtml from './single/aidc-single.html?raw'

/* 단층 원본과 동일한 고정 디자인 캔버스 (창에 맞춰 축소·중앙 정렬) */
const DESIGN_W = 1908
const DESIGN_H = 928

export default function App() {
  const mode = useAppStore((s) => s.mode)
  const setMode = useAppStore((s) => s.setMode)
  const shellRef = useRef(null)

  /* 단층 기준 레이아웃: 1908×928 캔버스를 min(w/1908, h/928) 배율로 스케일 */
  useEffect(() => {
    const el = shellRef.current
    if (!el) return
    const apply = () => {
      const s = Math.max(0.1, Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H))
      window.__designScale = s
      el.style.transform = `scale(${s})`
      el.style.left = (window.innerWidth - DESIGN_W * s) / 2 + 'px'
      el.style.top = (window.innerHeight - DESIGN_H * s) / 2 + 'px'
    }
    apply()
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [mode])

  /* 단층(원본 HTML) 쪽 드롭다운에서 '복층' 선택 → 메시지로 복귀 */
  useEffect(() => {
    const onMessage = (e) => {
      if (e.data && e.data.aidcMode === 'multi') setMode('multi')
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [setMode])

  /* 단층 모드: 업로드된 원본 코드를 수정 없이 그대로 전체 화면 iframe으로 구동 */
  if (mode === 'single') {
    return <iframe className="single-frame" title="인터랙티브 인프라 용어사전 · 단층" srcDoc={singleHtml} />
  }

  return (
    <div className="app-shell" ref={shellRef}>
      <Header />
      <div className="wrap">
        <Sidebar />
        <main className="stage">
          <Toolbar />
          <Viewport />
        </main>
      </div>
    </div>
  )
}
