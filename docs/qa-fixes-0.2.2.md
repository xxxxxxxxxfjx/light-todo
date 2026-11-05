# LightTodo 0.2.2 启动修复与日历滚动条

报错原因：0.2.1启动器在未设置LIGHTTODO_DATA_DIR时，先向LocalAppData/LightTodo创建日志目录；当前用户环境拒绝该访问，异常导致应用尚未启动就退出。原有成品测试设置了工作区数据目录，未覆盖这一默认路径。

修复：单文件和目录版启动器使用exe旁LightTodoData保存日志，内层启动器继承外层便携根目录；尊重显式LIGHTTODO_DATA_DIR。写日志改为尽力而为，IOException、权限或安全异常不会阻止启动，也不会打断兼容重试。不调整系统权限，不要求管理员运行。

日历滚动条：当天任务、月格内容、周视图和每天的全天任务区统一使用7px宽度、圆角细滑块、透明轨道，悬停和焦点状态加深；深浅主题配色分别处理，隐藏两端箭头，保留拖动及稳定的滚动槽位置。

验证：node/web类型检查通过；启动器独立回归通过默认无数据目录变量、日志不可写仍重试、继承外层便携目录三个场景。成品额外测试清除数据目录相关环境变量，以已有日历截图流程和SQLite读取验证exe旁默认路径。

测试命令：
- node scripts/test-launcher.cjs
- node scripts/test-default-launch.mjs release/0.2.2/LightTodo-0.2.2-x64.exe

当前会话无Playwright MCP工具；UI使用AGENTS.md允许保留的旧回归流程兜底，新增启动器回归不向页面注入操作脚本。

成品验证结果：默认无数据目录变量启动通过，截图/SQLite/便携日志均已验证（.qa-default-launch-xA8LHX）；最终0.2.2的周视图、四档窗口尺寸、主题同步和重启持久化回归通过（.qa-layout-theme-io9YR8）。滚动条截图：.tmp/shots/calendar-scrollbars-0.2.2.png。
