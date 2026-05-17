import { useState } from 'react'
import { RecordPage } from './pages/RecordPage'
import { EditorPage } from './pages/EditorPage'
import type { ProjectFile } from '@shared/types'

type View = 'record' | 'editor'

export function App(): JSX.Element {
  const [view, setView] = useState<View>('record')
  const [project, setProject] = useState<ProjectFile | null>(null)

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">screen-half</div>
        <div className="app__subtitle">
          screen + webcam → vertical 9:16 with auto-zoom
        </div>
      </header>
      <main className="app__main">
        {view === 'record' ? (
          <RecordPage
            onRecorded={(p) => {
              setProject(p)
              setView('editor')
            }}
          />
        ) : (
          <EditorPage
            project={project}
            onBack={() => setView('record')}
          />
        )}
      </main>
    </div>
  )
}
