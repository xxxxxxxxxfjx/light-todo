import { contextBridge, ipcRenderer } from 'electron'
import type { IslandState } from '../shared/island'

export type IslandPhase = 'rest' | 'peek' | 'panel'

const islandApi = {
  state: (): Promise<IslandState> => ipcRenderer.invoke('island:state'),
  complete: (id: string): Promise<void> => ipcRenderer.invoke('island:complete', id),
  quickAdd: (text: string): Promise<string | null> => ipcRenderer.invoke('island:quickAdd', text),
  focusable: (value: boolean): void => ipcRenderer.send('island:focusable', value),
  drag: (stage: 'start' | 'move' | 'end', screenX: number): void => ipcRenderer.send('island:drag', stage, screenX),
  open: (id?: string): void => ipcRenderer.send('island:open', id),
  phase: (value: IslandPhase): void => ipcRenderer.send('island:phase', value),
  menu: (): void => ipcRenderer.send('island:menu'),
  onPhaseSet: (cb: (phase: IslandPhase) => void) => {
    const listener = (_e: unknown, next: IslandPhase): void => cb(next)
    ipcRenderer.on('island:phase-set', listener)
    return (): void => { ipcRenderer.removeListener('island:phase-set', listener) }
  },
  onChanged: (cb: (state: IslandState) => void) => {
    const listener = (_e: unknown, state: IslandState): void => cb(state)
    // 任务在主窗口被改动时，pet.ts 的广播也会发到岛窗口，这里顺手重取一次。
    const refresh = (): void => { void islandApi.state().then(cb).catch(() => {}) }
    ipcRenderer.on('island:changed', listener)
    ipcRenderer.on('tasks:changed', refresh)
    return (): void => {
      ipcRenderer.removeListener('island:changed', listener)
      ipcRenderer.removeListener('tasks:changed', refresh)
    }
  }
}

contextBridge.exposeInMainWorld('islandApi', islandApi)
export type IslandApi = typeof islandApi
