import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './markdown.css'
import './command.css'

// 平台标记供标题栏留白和快捷键文案使用（Electron 渲染层同步可见）。
document.documentElement.dataset.platform = /Mac/i.test(navigator.userAgent)
  ? 'darwin'
  : /Win/i.test(navigator.userAgent)
    ? 'win32'
    : 'linux'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
