export type ThemePreference = 'system' | 'light' | 'dark'

export function windowColors(dark: boolean): { color: string; symbolColor: string } {
  return dark
    ? { color: '#1c1c20', symbolColor: '#f2f2f5' }
    : { color: '#f3f3f5', symbolColor: '#3b3b41' }
}
