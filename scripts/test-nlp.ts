import { parseQuickAdd } from '../src/shared/nlp.ts'

const now = new Date(2026, 10, 2, 10, 0, 0) // 2026-11-02 10:00 Monday
const cases = [
  '明天下午3点 交周报 #工作 @汇报 !高',
  '每周一 站会',
  '每月5号 交房租',
  '每3天 浇花',
  '下周三 评审',
  '今晚8点 跑步',
  '买牛奶',
  '3月5日 交材料 !中',
  '每周一三五 健身 晚上7点',
  '每月第2个周二 复盘'
]
for (const c of cases) {
  const r = parseQuickAdd(c, now)
  console.log(c, '=>', JSON.stringify(r))
}
