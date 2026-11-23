const weekdays = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
const weekLine = /^([\d,，\-–—\s]+)\s*\(\[周\]\)\s*\[([\d,-]+)节\]$/;
const courseKey = c => JSON.stringify([c.week, c.day, c.periods, c.title, c.place, c.teacher]);
const two = n => String(n).padStart(2, '0');

export function parseSchedule(rows) {
  const courses = new Map(), excluded = new Set(), errors = [], clocks = new Map();
  const term = rows.flat().map(v => String(v ?? '').match(/学年学期\s*[:：]\s*(\d{4}-\d{4}-[12])/)).find(Boolean)?.[1];
  const header = rows.findIndex(row => weekdays.every((day, i) => String(row[i + 1]).trim() === day));
  if (!term || header < 0) return { errors: ['未找到学期或完整的星期表头，请使用教务系统导出的个人课表。'] };

  const blocks = [];
  for (let r = header + 1; r < rows.length; r++) {
    const label = String(rows[r][0] ?? '').trim();
    if (!label.match(/^\d/)) break;
    const match = label.match(/^(\d+)(?:\s*[-–]\s*(\d+))?节\s*[(（]\s*(\d{1,2}):(\d{2})/);
    if (!match || +match[3] > 23 || +match[4] > 59) { errors.push(`A${r + 1}：无法识别节次开始时间。`); continue; }
    const start = +match[1], end = +(match[2] || match[1]);
    if (start < 1 || end < start || end > 30 || clocks.has(start)) { errors.push(`A${r + 1}：节次不正确或重复。`); continue; }
    clocks.set(start, `${two(+match[3])}:${match[4]}`);
    blocks.push({ r, start, end });
  }
  if (!blocks.length) errors.push('未找到可识别的节次。');

  for (const { r, start, end } of blocks) for (let day = 1; day <= 7; day++) {
    const address = `${String.fromCharCode(65 + day)}${r + 1}`;
    const lines = String(rows[r][day] ?? '').split(/\r?\n/).map(s => s.trim());
    let pending = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]) continue;
      const match = lines[i].match(weekLine);
      if (!match) { pending.push(lines[i]); continue; }
      const [title, ...rest] = pending;
      const teacher = rest.at(-1)?.replace(/\([^()]*\)$/, '').trim();
      const next = lines[i + 1];
      // An empty line separates records. Do not consume the next course's title.
      const hasPlace = next && !weekLine.test(next);
      const place = hasPlace ? lines[++i] : '地点待定';
      const periods = match[2].split(/[-,]/).map(Number);
      const weeks = new Set();
      let valid = Boolean(title && teacher && place && !weekLine.test(place) && rest.slice(0, -1).every(s => /^\([^()]+\)$/.test(s)));
      for (const part of match[1].replaceAll('，', ',').split(',')) {
        const range = part.trim().match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/);
        const first = +range?.[1], last = +(range?.[2] ?? first);
        if (!range || first < 1 || last < first || last > 30) { valid = false; break; }
        for (let week = first; week <= last; week++) weeks.add(week);
      }
      const time = clocks.get(periods[0]);
      if (!valid || !time || periods.some((n, j) => !n || n > 30 || (j > 0 && n !== periods[j - 1] + 1)) || periods[0] > end || periods.at(-1) < start) {
        errors.push(`${address}：无法识别「${title || '未命名课程'}」的周次、节次或地点。`);
      } else if (pending.some(s => s.includes('智慧树')) || place.includes('智慧树')) {
        excluded.add(title);
      } else for (const week of weeks) {
        const row = { week, day, periods: periods.join('-'), title, teacher, place, time };
        courses.set(courseKey(row), row);
      }
      pending = [];
    }
    if (pending.length) errors.push(`${address}：有未能识别的课程内容。`);
  }
  if (!courses.size && !excluded.size && !errors.length) errors.push('课表没有可识别的课程。');
  return { term, courses: [...courses.values()].sort((a, b) => a.week - b.week || a.day - b.day || a.time.localeCompare(b.time)), excluded: [...excluded], errors };
}

export async function readSchedule(bytes) {
  const signature = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8));
  if (signature.join() !== '208,207,17,224,161,177,26,225') throw new Error('请上传教务系统导出的原始 .xls 文件。');
  const { read, utils } = await import('xlsx');
  const book = read(bytes, { type: 'array', cellFormula: false, cellHTML: false, sheetRows: 100 });
  const sheet = book.Sheets[book.SheetNames[0]];
  return parseSchedule(utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: true, range: 'A1:H100' }));
}

const dayMs = 86_400_000;
export function weekOne(value) {
  if (!/^20\d\d-\d\d-\d\d$/.test(value)) throw new Error('请输入第 1 周周一的日期。');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value || date.getUTCDay() !== 1) throw new Error('第 1 周的起始日期必须是星期一。');
  return +date;
}

export function dateCourses(courses, monday) {
  const start = weekOne(monday);
  return courses.map(course => {
    const date = new Date(start + ((course.week - 1) * 7 + course.day - 1) * dayMs).toISOString().slice(0, 10);
    return { ...course, starts_at: new Date(`${date}T${course.time}:00+08:00`).toISOString() };
  });
}

export const beijingDate = (date = new Date()) => new Date(+date + 8 * 3600_000).toISOString().slice(0, 10);
export const currentWeek = (monday, date = beijingDate()) => Math.floor((Date.parse(`${date}T00:00:00Z`) - weekOne(monday)) / (7 * dayMs)) + 1;
