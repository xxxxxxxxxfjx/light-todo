import assert from 'node:assert/strict'
import { calendarAnnotation, getLunarInfo } from '../src/renderer/src/lib/lunar.ts'

function local(y: number, m: number, d: number): Date {
  return new Date(y, m - 1, d)
}

const spring = getLunarInfo(local(2026, 2, 17))
assert.equal(spring.month, 1)
assert.equal(spring.day, 1)
assert.equal(spring.monthName, '正月')
assert.equal(spring.text, '春节')
assert.equal(spring.festival, '春节')

const midAutumn = getLunarInfo(local(2026, 9, 25))
assert.equal(midAutumn.month, 8)
assert.equal(midAutumn.day, 15)
assert.equal(midAutumn.festival, '中秋')
assert.equal(midAutumn.text, '中秋')

const ordinary = getLunarInfo(local(2026, 11, 5))
assert.equal(ordinary.month, 9)
assert.equal(ordinary.day, 27)
assert.equal(ordinary.text, '廿七')
assert.equal(ordinary.festival, null)

assert.equal(calendarAnnotation(local(2026, 1, 1)), '元旦')
assert.equal(calendarAnnotation(local(2026, 4, 5)), '清明')
assert.equal(calendarAnnotation(local(2026, 10, 1)), '国庆节')
assert.equal(calendarAnnotation(local(2026, 2, 17)), '春节')
assert.equal(calendarAnnotation(local(2026, 9, 25)), '中秋')
assert.equal(calendarAnnotation(local(2026, 11, 5)), '廿七')
assert.equal(calendarAnnotation(local(2026, 2, 14)), '班')
assert.equal(calendarAnnotation(local(2026, 1, 4)), '班')
assert.equal(calendarAnnotation(local(2026, 11, 7)), '休')

// Leap month representation is surfaced rather than silently flattened.
const leap = getLunarInfo(local(2023, 3, 22))
assert.equal(leap.isLeap, true)
assert.equal(leap.monthName, '二月')
assert.equal(leap.text, '闰二月')

// 闰二月初二不是龙抬头：闰月不匹配固定农历节日，也不在日历格子里伪造节日。
const leapDragon = getLunarInfo(local(2023, 3, 23))
assert.equal(leapDragon.isLeap, true)
assert.equal(leapDragon.day, 2)
assert.equal(leapDragon.festival, null)
assert.equal(leapDragon.text, '初二')
assert.equal(calendarAnnotation(local(2023, 3, 23)), '初二')

// 普通二月初二仍然是龙抬头。
const dragon = getLunarInfo(local(2026, 3, 20))
assert.equal(dragon.isLeap, false)
assert.equal(dragon.festival, '龙抬头')

console.log('PASS 农历日期、节日与闰月标记')
