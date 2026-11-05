import { contextBridge, ipcRenderer } from 'electron'
import type { PetState } from '../shared/pet'

const petApi = {
  state: (): Promise<PetState> => ipcRenderer.invoke('pet:state'),
  complete: (id: string): Promise<void> => ipcRenderer.invoke('pet:complete', id),
  interactive: (value: boolean): void => ipcRenderer.send('pet:interactive', value),
  drag: (phase: 'start' | 'move' | 'end', x?: number, y?: number): void => ipcRenderer.send('pet:drag', phase, { x, y }),
  expanded: (value: boolean): void => ipcRenderer.send('pet:expanded', value),
  open: (id?: string, settings?: boolean): void => ipcRenderer.send('pet:open', id, settings),
  menu: (): void => ipcRenderer.send('pet:menu'),
  onChanged: (cb: (state: PetState) => void) => {
    const listener = (_e: unknown, state: PetState): void => cb(state)
    ipcRenderer.on('pet:changed', listener)
    return (): void => { ipcRenderer.removeListener('pet:changed', listener) }
  }
}
contextBridge.exposeInMainWorld('petApi', petApi)
export type PetApi = typeof petApi
