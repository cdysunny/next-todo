import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSchedule, readSchedule, dateCourses, beijingDate, currentWeek } from '../src/schedule.js';

const header = ['', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
const lab = '\n大学物理实验-2\n老师(讲师)\n6,8,10,12([周])[01-02-03-04节]\n实验室\n';
const grid = [
  [], ['学年学期：2026-2027-1 其他信息不会导入'], header,
  ['1-2节(8:30-10:05)', '', '', lab],
  ['3-4节(10:20-11:55)', '\n概率论\n老师(讲师)\n9-10([周])[03-04节]\n旧教室\n\n概率论\n老师(讲师)\n11-16([周])[03-04节]\n新教室\n', '', lab],
  ['5-6节(14:00-15:35)', '', '\n创新创业教育\n老师(讲师)\n8([周])[05-06节]\n郫都线上001\n'],
  ['9-11节(18:50-21:15)', '', '', '', '', '', '\nPPT\n(智慧树网课)\n老师(讲师)\n1-8([周])[09-10节]\n智慧树ZHSWK05\n'],
  ['', '实验摘要不是第二条课程'],
];

test('课表按周展开，跨节去重，保留换教室与非智慧树线上课', () => {
  const { term, courses, excluded, errors } = parseSchedule(grid);
  assert.equal(term, '2026-2027-1'); assert.deepEqual(errors, []); assert.deepEqual(excluded, ['PPT']);
  assert.deepEqual(courses.filter(c => c.title === '大学物理实验-2').map(c => [c.week,c.time,c.periods]), [6,8,10,12].map(w => [w,'08:30','1-2-3-4']));
  assert.equal(courses.find(c => c.week === 11).place, '新教室');
  assert.equal(courses.find(c => c.week === 10 && c.day === 1).place, '旧教室');
  assert.equal(courses.find(c => c.title === '创新创业教育').place, '郫都线上001');
});

test('无法识别的课程注明单元格，不推测开始时间', () => {
  const { errors } = parseSchedule([...grid.slice(0, 3), ['1-2节(8:30-10:05)', '课程\n老师\n1([周])[02节]\n教室', '无结构内容']]);
  assert.match(errors[0], /B4/); assert.match(errors[1], /C4/);
  assert.ok(parseSchedule([[]]).errors.length);
});

test('缺地点的跨节课程导入一次，不会把下一门课的名称当成地点', () => {
  const practice = '实践教学\n老师(讲师)\n21([周])[01-02-03-04节]';
  const next = '专业英语\n老师(讲师)\n6([周])[01-02节]\n教学楼1322';
  const { courses, errors } = parseSchedule([
    ...grid.slice(0, 3),
    ['1-2节(8:30-10:05)', `${practice}\n\n${next}`],
    ['3-4节(10:20-11:55)', practice],
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(courses.map(({title, week, periods, place, time}) => [title, week, periods, place, time]), [
    ['专业英语', 6, '1-2', '教学楼1322', '08:30'],
    ['实践教学', 21, '1-2-3-4', '地点待定', '08:30'],
  ]);
});

test('只生成北京时间开课时间，校验第 1 周周一', () => {
  const [course] = dateCourses([{ week: 2, day: 3, time: '08:30' }], '2026-09-07');
  assert.equal(course.starts_at, '2026-09-16T00:30:00.000Z');
  assert.equal(course.ends_at, undefined);
  assert.throws(() => dateCourses([], '2026-09-08'), /星期一/);
  assert.throws(() => dateCourses([], '2026-02-30'), /星期一/);
  assert.equal(beijingDate(new Date('2026-11-22T16:01:00Z')), '2026-11-23');
  assert.equal(currentWeek('2026-09-07', '2026-11-22'), 11);
});

test('用真实工作簿核对第 11 周场次及跨节去重', { skip: !process.env.COURSE_WORKBOOK }, async () => {
  const file = await readFile(process.env.COURSE_WORKBOOK);
  const { courses, errors, excluded } = await readSchedule(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  assert.deepEqual(errors, []);
  assert.equal(excluded.length, 2);
  assert.equal(courses.filter(c => c.week === 11).length, 13);
  assert.equal(courses.filter(c => c.week === 12 && c.periods === '1-2-3-4').length, 1);
});
