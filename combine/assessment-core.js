(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AssessmentCore = api;
})(globalThis, function () {
  "use strict";

  const QUESTIONNAIRE_VERSION = "q-v1.3";
  const CONSTITUTION_VERSION = "constitution-v1.0";
  const YUNQI_VERSION = "yunqi-v1.0";
  const SUPPORTED_QUESTIONNAIRE_VERSIONS = [QUESTIONNAIRE_VERSION];

  const OPTS5 = ["没有（根本不）", "很少（有一点）", "有时（有些）", "经常（相当）", "总是（非常）"];
  const Q27 = [
    {id:"S01", t:"您精力充沛吗？", k:[["pinghe",0]]},
    {id:"S02", t:"您容易疲乏吗？", k:[["pinghe",1],["qixu",0]]},
    {id:"S03", t:"您感到闷闷不乐、情绪低沉吗？", k:[["pinghe",1],["qiyu",0]]},
    {id:"S04", t:"您比一般人耐受不了寒冷（冬天的寒冷，夏天的冷空调、电扇等）吗？", k:[["pinghe",1],["yangxu",0]]},
    {id:"S05", t:"您容易气短（呼吸短促，接不上气）吗？", k:[["qixu",0]]},
    {id:"S06", t:"您容易心慌吗？", k:[["qixu",0]]},
    {id:"S07", t:"您胃脘部、背部或腰膝部怕冷吗？", k:[["yangxu",0]]},
    {id:"S08", t:"您感到怕冷、衣服比别人穿得多吗？", k:[["yangxu",0]]},
    {id:"S09", t:"您感觉身体、脸上发热吗？", k:[["yinxu",0]]},
    {id:"S10", t:"您皮肤或口唇干吗？", k:[["yinxu",0]]},
    {id:"S11", t:"您面部两颧潮红或偏红吗？", k:[["yinxu",0]]},
    {id:"S12", t:"您感到身体沉重不轻松或不爽快吗？", k:[["tanshi",0]]},
    {id:"S13", t:"您腹部肥满松软吗？", k:[["tanshi",0]]},
    {id:"S14", t:"您嘴里有黏黏的感觉吗？", k:[["tanshi",0]]},
    {id:"S15", t:"您面部或鼻部有油腻感或者油亮发光吗？", k:[["shire",0]]},
    {id:"S16", t:"您小便时尿道有发热感、尿色浓（深）吗？", k:[["shire",0]]},
    {id:"S17", t:"您带下色黄（白带颜色发黄）吗？", k:[["shire",0]], g:"f"},
    {id:"S18", t:"您的阴囊部位潮湿吗？", k:[["shire",0]], g:"m"},
    {id:"S19", t:"您身体上有哪里疼痛吗？", k:[["xueyu",0]]},
    {id:"S20", t:"您面色晦暗或容易出现褐斑吗？", k:[["xueyu",0]]},
    {id:"S21", t:"您口唇颜色偏暗吗？", k:[["xueyu",0]]},
    {id:"S22", t:"您容易精神紧张、焦虑不安吗？", k:[["qiyu",0]]},
    {id:"S23", t:"您多愁善感、感情脆弱吗？", k:[["qiyu",0]]},
    {id:"S24", t:"您没有感冒时也会打喷嚏吗？", k:[["tebing",0]]},
    {id:"S25", t:"您容易过敏（对药物、食物、气味、花粉或在季节交替、气候变化时）吗？", k:[["tebing",0]]},
    {id:"S26", t:"您的皮肤容易起荨麻疹（风团、风疹块、风疙瘩）吗？", k:[["tebing",0]]},
    {id:"S27", t:"您的皮肤一抓就红，并出现抓痕吗？", k:[["tebing",0]]}
  ];
  const Q8 = [
    {id:"P29", t:"你平时的运动量大概是？", o:["几乎不运动","每周 1—2 次","每周 3 次以上","主要靠体力工作，没有专门锻炼"]},
    {id:"P30", t:"运动或爬楼时，有没有出现过胸闷、心慌、眩晕、异常疲乏、两腿无力？", o:["有过","没有"]},
    {id:"P31", t:"你通常几点入睡？", o:["23 点前","23 点—凌晨 1 点","凌晨 1 点以后"]},
    {id:"P32", t:"你的三餐更接近哪一种？", o:["常吃外卖，偏油腻","常有宵夜","偏爱甜食、黏糯主食","相对规律，吃到七分饱"]},
    {id:"P33", t:"你多数时间待在哪种环境？", o:["潮湿（临水、返潮、地下室）","干燥（长期空调暖气）","空调房久坐","临街、绿化多，花粉季明显"]},
    {id:"P34", t:"每天大约坐着多久（不含睡眠）？", o:["不到 4 小时","4—8 小时","超过 8 小时"]},
    {id:"P35", t:"你主要对什么过敏？", o:["花粉","尘螨（枕被、地毯、窗帘）","食物","说不清／多种都有"], only:"tebing"}
  ];
  const NAME = {pinghe:"平和质",qixu:"气虚质",yangxu:"阳虚质",yinxu:"阴虚质",tanshi:"痰湿质",shire:"湿热质",xueyu:"血瘀质",qiyu:"气郁质",tebing:"特禀质"};
  const ORDER = ["pinghe","qixu","yangxu","yinxu","tanshi","shire","xueyu","qiyu","tebing"];
  const N = {pinghe:4,qixu:3,yangxu:3,yinxu:3,tanshi:3,shire:3,xueyu:3,qiyu:3,tebing:4};

  function seasonNow(d) {
    d = d || new Date();
    const m = d.getMonth() + 1, day = d.getDate();
    if (m === 2) return day >= 15 ? 0 : 3;
    if (m === 3 || m === 4) return 0;
    if (m >= 5 && m <= 7) return 1;
    if (m >= 8 && m <= 10) return 2;
    return 3;
  }
  function seasonToday(d) {
    d = d || new Date();
    return (d.getMonth() + 1) + " 月 " + d.getDate() + " 日";
  }

  const YQ_GAN = ["甲","乙","丙","丁","戊","己","庚","辛","壬","癸"];
  const YQ_ZHI = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];
  const YQ_YUN_OF_GAN = {"甲":"土","己":"土","乙":"金","庚":"金","丙":"水","辛":"水","丁":"木","壬":"木","戊":"火","癸":"火"};
  const YQ_YANG = {"甲":1,"丙":1,"戊":1,"庚":1,"壬":1};
  const YQ_SITIAN_OF_ZHI = {
    "子":"少阴君火","午":"少阴君火","丑":"太阴湿土","未":"太阴湿土",
    "寅":"少阳相火","申":"少阳相火","卯":"阳明燥金","酉":"阳明燥金",
    "辰":"太阳寒水","戌":"太阳寒水","巳":"厥阴风木","亥":"厥阴风木"
  };
  const YQ_DUIHUA = {"少阴君火":"阳明燥金","阳明燥金":"少阴君火","太阴湿土":"太阳寒水","太阳寒水":"太阴湿土","少阳相火":"厥阴风木","厥阴风木":"少阳相火"};
  const YQ_KEQI = ["厥阴风木","少阴君火","太阴湿土","少阳相火","阳明燥金","太阳寒水"];
  const YQ_ZHUQI = ["厥阴风木","少阴君火","少阳相火","太阴湿土","阳明燥金","太阳寒水"];
  const YQ_ELEM = {"厥阴风木":"木","少阴君火":"火","少阳相火":"火","太阴湿土":"土","阳明燥金":"金","太阳寒水":"水"};
  const YQ_SHENG = {"木":"火","火":"土","土":"金","金":"水","水":"木"};
  const YQ_KE = {"木":"土","土":"水","水":"火","火":"金","金":"木"};
  const YQ_ZHI_FANGWEI = {"子":"水","午":"火","卯":"木","酉":"金","辰":"土","戌":"土","丑":"土","未":"土"};
  const YQ_ZHI_ELEM_FULL = {"子":"水","丑":"土","寅":"木","卯":"木","辰":"土","巳":"火","午":"火","未":"土","申":"金","酉":"金","戌":"土","亥":"水"};
  const YQ_JI = {
    "木":{tai:"发生",bu:"委和",ping:"敷和"},"火":{tai:"赫曦",bu:"伏明",ping:"升明"},
    "土":{tai:"敦阜",bu:"卑监",ping:"备化"},"金":{tai:"坚成",bu:"从革",ping:"审平"},
    "水":{tai:"流衍",bu:"涸流",ping:"顺静"}
  };
  const YQ_YUN_ZANG = {"木":"肝胆","火":"心与小肠","土":"脾胃","金":"肺与大肠","水":"肾与膀胱"};
  const YQ_QI_ZANG = {"厥阴风木":"肝胆","少阴君火":"心与小肠","太阴湿土":"脾胃","少阳相火":"三焦与心包","阳明燥金":"肺与大肠","太阳寒水":"肾与膀胱"};
  const YQ_QI_SEG = {
    "厥阴风木":"大寒—春分（初之气）","少阴君火":"春分—小满（二之气）","少阳相火":"小满—大暑（三之气）",
    "太阴湿土":"大暑—秋分（四之气）","阳明燥金":"秋分—小雪（五之气）","太阳寒水":"小雪—大寒（终之气）"
  };
  const YQ_YUN_PLAIN = {
    "木太过":"木气偏过，风气偏胜，土（脾胃）受其制；情绪容易急，消化容易跟不上。",
    "火太过":"火气偏过，暑热偏胜，金（肺）受其制；容易燥热、口干、心烦。",
    "土太过":"土气偏过，雨湿偏胜，水（肾）受其制；容易困重、腹胀、湿黏不爽。",
    "金太过":"金气偏过，燥气偏胜，木（肝）受其制；容易干燥、气机不畅、隐隐作痛。",
    "水太过":"水气偏过，寒气偏胜，火（心）受其制；底子偏寒，容易怕冷、水湿不化。",
    "木不及":"木气不足，燥气来乘，生发之气不够；容易疲乏、胁腹发胀、大便偏稀。",
    "火不及":"火气不足，寒气来乘，长养之气不够；气机容易滞住，胸胁腰背怕冷发紧。",
    "土不及":"土气不足，风气来乘，运化之气不够；容易疲乏、腹胀、食少、大便不成形。",
    "金不及":"金气不足，火气来乘，收敛之气不够；容易气短、喷嚏鼻涕、口疮。",
    "水不及":"水气不足，湿气来乘，封藏之气不够；容易腰膝不适、身重、下肢发凉发肿。"
  };
  const YQ_QI_PLAIN = {
    "厥阴风木":"风气当令，落于肝胆；气机容易上头，胁肋容易胀。",
    "少阴君火":"热气当令，落于心与小肠；容易烦热、咽干、睡不沉。",
    "太阴湿土":"湿气当令，落于脾胃；容易身重、腹胀、舌苔厚。",
    "少阳相火":"相火当令，落于三焦与心包；容易口苦、上火、郁热。",
    "阳明燥金":"燥气当令，落于肺与大肠；容易干燥、便干、皮肤干。",
    "太阳寒水":"寒气当令，落于肾与膀胱；容易怕冷、腰腹冷、小便清长。"
  };
  const YQ_YUN_TEND = {
    "木太过":["qixu","qiyu"],"火太过":["shire","yinxu"],"土太过":["tanshi","yangxu"],
    "金太过":["qiyu","xueyu"],"水太过":["yangxu","tanshi"],
    "木不及":["qixu","yangxu"],"火不及":["xueyu","qiyu"],"土不及":["qixu","qiyu"],
    "金不及":["qixu","shire"],"水不及":["yangxu","tanshi"]
  };
  const YQ_QI_TEND = {
    "厥阴风木":["qiyu","qixu"],"少阴君火":["shire","yinxu"],"太阴湿土":["tanshi","yangxu"],
    "少阳相火":["shire",null],"阳明燥金":["qiyu","yinxu"],"太阳寒水":["yangxu","xueyu"]
  };
  const YQ_TRIGGER = {
    qixu:"太阴湿土",yangxu:"太阳寒水",yinxu:"少阴君火",tanshi:"太阴湿土",
    shire:"少阳相火",xueyu:"阳明燥金",qiyu:"厥阴风木",tebing:"厥阴风木"
  };

  const YQ_RAD = Math.PI / 180;
  function YQ_toJD(y, m, d, h) {
    if (m <= 2) { y -= 1; m += 12; }
    const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + h / 24 + B - 1524.5;
  }
  function YQ_jdToUTC(jd) {
    const z = Math.floor(jd + 0.5), f = jd + 0.5 - z;
    let A = z;
    if (z >= 2299161) { const a = Math.floor((z - 1867216.25) / 36524.25); A = z + 1 + a - Math.floor(a / 4); }
    const B = A + 1524, C = Math.floor((B - 122.1) / 365.25), D = Math.floor(365.25 * C), E = Math.floor((B - D) / 30.6001);
    const day = B - D - Math.floor(30.6001 * E) + f, m = (E < 14) ? E - 1 : E - 13, y = (m > 2) ? C - 4716 : C - 4715;
    const dd = Math.floor(day), hh = (day - dd) * 24;
    return {y:y,m:m,d:dd,h:hh};
  }
  function YQ_sunLon(jd) {
    const T = (jd - 2451545.0) / 36525.0;
    const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
    const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M * YQ_RAD)
      + (0.019993 - 0.000101 * T) * Math.sin(2 * M * YQ_RAD) + 0.000289 * Math.sin(3 * M * YQ_RAD);
    let lon = L0 + C;
    const om = 125.04452 - 1934.136261 * T;
    lon += -0.00569 - 0.00478 * Math.sin(om * YQ_RAD);
    return ((lon % 360) + 360) % 360;
  }
  function YQ_solveLon(target, y, m, d) {
    let jd = YQ_toJD(y, m, d, 0);
    for (let i = 0; i < 6; i++) {
      let dlt = target - YQ_sunLon(jd);
      while (dlt > 180) dlt -= 360;
      while (dlt < -180) dlt += 360;
      jd += dlt / 0.9856473;
    }
    return jd;
  }
  const YQ_DAHAN_CACHE = {};
  function YQ_daHan(year) {
    if (YQ_DAHAN_CACHE[year]) return YQ_DAHAN_CACHE[year];
    const u = YQ_jdToUTC(YQ_solveLon(300, year, 1, 20));
    const t = new Date(Date.UTC(u.y, u.m - 1, u.d, 0));
    t.setUTCMinutes(Math.round(u.h * 60) + 480);
    const r = {y:t.getUTCFullYear(),m:t.getUTCMonth()+1,d:t.getUTCDate(),h:t.getUTCHours(),mi:t.getUTCMinutes()};
    YQ_DAHAN_CACHE[year] = r;
    return r;
  }
  const YQ_JQ_CACHE = {};
  function YQ_jieqi(year, target, am, ad) {
    const key = year + "|" + target;
    if (YQ_JQ_CACHE[key]) return YQ_JQ_CACHE[key];
    const u = YQ_jdToUTC(YQ_solveLon(target, year, am, ad));
    const t = new Date(Date.UTC(u.y, u.m - 1, u.d, 0));
    t.setUTCMinutes(Math.round(u.h * 60) + 480);
    const r = {y:t.getUTCFullYear(),m:t.getUTCMonth()+1,d:t.getUTCDate(),h:t.getUTCHours(),mi:t.getUTCMinutes()};
    YQ_JQ_CACHE[key] = r;
    return r;
  }
  function YQ_cst(o) { return new Date(Date.UTC(o.y,o.m-1,o.d,(o.h||0)-8,o.mi||0)); }
  function YQ_stepBounds(year) {
    const out = [YQ_cst(YQ_daHan(year))];
    [[0,3,20],[60,5,21],[120,7,23],[180,9,23],[240,11,22]].forEach(p => out.push(YQ_cst(YQ_jieqi(year,p[0],p[1],p[2]))));
    out.push(YQ_cst(YQ_daHan(year + 1)));
    return out;
  }
  function YQ_stepTimes(year) {
    const dh = YQ_daHan(year), dh2 = YQ_daHan(year + 1);
    const cf = YQ_jieqi(year,0,3,20), xm = YQ_jieqi(year,60,5,21), ds = YQ_jieqi(year,120,7,23),
      qf = YQ_jieqi(year,180,9,23), xx = YQ_jieqi(year,240,11,22);
    const md = o => o.m + "/" + o.d;
    return [md(dh)+"—"+md(cf),md(cf)+"—"+md(xm),md(xm)+"—"+md(ds),md(ds)+"—"+md(qf),md(qf)+"—"+md(xx),md(xx)+"—"+md(dh2)];
  }
  function YQ_hhmm(o) { return ("0" + o.h).slice(-2) + ":" + ("0" + o.mi).slice(-2); }
  function YQ_mod(n, m) { return ((n % m) + m) % m; }
  function YQ_ganzhi(year) { const n = YQ_mod(year - 1984, 60); return YQ_GAN[n % 10] + YQ_ZHI[n % 12]; }
  function YQ_birthYear(y, m, d, prev) {
    if (prev) return y - 1;
    const h = YQ_daHan(y);
    return (y * 10000 + m * 100 + d < h.y * 10000 + h.m * 100 + h.d) ? y - 1 : y;
  }
  function YQ_calc(year) {
    const gz = YQ_ganzhi(year), gan = gz.charAt(0), zhi = gz.charAt(1);
    const yunElem = YQ_YUN_OF_GAN[gan], tai = !!YQ_YANG[gan];
    const sitian = YQ_SITIAN_OF_ZHI[zhi], zaiquan = YQ_DUIHUA[sitian];
    const k0 = YQ_KEQI.indexOf(zaiquan), keqi = [];
    for (let i = 0; i < 6; i++) keqi.push(YQ_KEQI[YQ_mod(k0 - 5 + i, 6)]);
    const stimes = YQ_stepTimes(year), steps = [];
    for (let j = 0; j < 6; j++) steps.push({no:j+1,zhu:YQ_ZHUQI[j],ke:keqi[j],time:stimes[j]});
    const sitElem = YQ_ELEM[sitian], zaElem = YQ_ELEM[zaiquan], zhiElem = YQ_ZHI_FANGWEI[zhi];
    const flags = [];
    if (sitElem === yunElem) flags.push("天符");
    if (zhiElem === yunElem) flags.push("岁会");
    if (sitElem === yunElem && zhiElem === yunElem) flags.push("太一天符");
    if (tai && zaElem === yunElem) flags.push("同天符");
    if (!tai && zaElem === yunElem) flags.push("同岁会");
    let pingQi = false, pingNote = "";
    if (tai) {
      if (yunElem === "金" && (sitian === "少阴君火" || sitian === "少阳相火")) { pingQi = true; pingNote = "坚成之纪逢" + sitian + "司天，二火抑金，复为平气"; }
      else if (yunElem === "火" && sitian === "太阳寒水") { pingQi = true; pingNote = "赫曦之纪逢寒水司天，水抑其火，复为平气"; }
    } else {
      if (sitElem === yunElem) { pingQi = true; pingNote = "不及之运得司天同气之助，同正" + yunElem; }
      else if (YQ_ZHI_ELEM_FULL[zhi] === yunElem) { pingQi = true; pingNote = "不及之运得年支" + zhi + "同气之助，气乃平"; }
      else if (zaElem === yunElem) { pingQi = true; pingNote = "与在泉同气（同岁会），亦气之平"; }
    }
    const yunName = pingQi ? YQ_JI[yunElem].ping : (tai ? YQ_JI[yunElem].tai : YQ_JI[yunElem].bu);
    return {year:year,gz:gz,gan:gan,zhi:zhi,yunElem:yunElem,tai:tai,yunName:yunName,sitian:sitian,zaiquan:zaiquan,keqi:keqi,steps:steps,flags:flags,pingQi:pingQi,pingNote:pingNote,dahan:YQ_daHan(year),dahanText:YQ_daHan(year).m+"/"+YQ_daHan(year).d+" "+YQ_hhmm(YQ_daHan(year))};
  }
  function YQ_stepIndex(year, m, d) {
    const bounds = YQ_stepBounds(year);
    const t = new Date(year, m - 1, d, 12, 0, 0);
    for (let i = 0; i < 6; i++) if (t >= bounds[i] && t < bounds[i + 1]) return i;
    return 5;
  }
  function YQ_innate(L, stepNo) {
    const pts = {};
    const add = (k, w) => { if (!k) return; pts[k] = (pts[k] || 0) + w; };
    const yt = YQ_YUN_TEND[L.yunElem + (L.tai ? "太过" : "不及")] || [];
    add(yt[0],3); add(yt[1],1.5);
    const st = YQ_QI_TEND[L.sitian] || [];
    add(st[0],2); add(st[1],1);
    const za = YQ_QI_TEND[L.zaiquan] || [];
    add(za[0],2); add(za[1],1);
    const keQi = (L.steps[stepNo] || {}).ke;
    if (keQi && keQi !== L.sitian && keQi !== L.zaiquan) {
      const ke = YQ_QI_TEND[keQi] || [];
      add(ke[0],1);
    }
    const rank = Object.keys(pts).map(k => ({k:k,s:Math.round(pts[k]/12*100)})).sort((a,b) => b.s-a.s);
    const top = rank[0] || null;
    const second = rank[1] || null;
    const keep = rank.filter((x,i) => i === 0 || (x.s >= 20 && x.s >= top.s * 0.55));
    return {all:rank,top:top,second:(keep.length > 1 ? second : null),marks:keep};
  }
  function YQ_todayYear() {
    const now = new Date(), y = now.getFullYear();
    return now < YQ_cst(YQ_daHan(y)) ? y - 1 : y;
  }
  function buildYunqi(birth) {
    if (!birth || !birth.y || !birth.m || !birth.d) return null;
    const year = YQ_birthYear(birth.y,birth.m,birth.d,!!birth.prev);
    const L = YQ_calc(year);
    L.stepNo = YQ_stepIndex(year,birth.m,birth.d);
    L.innate = YQ_innate(L,L.stepNo);
    return L;
  }
  function kindOf(R, inn) {
    const A = (inn.marks || []).map(x => x.k);
    if (!R.main) return "none";
    if (R.main === "pinghe") return "pinghe";
    if (A.indexOf(R.main) >= 0) return "same";
    if (R.mixed.some(k => A.indexOf(k) >= 0)) return "part";
    return "diff";
  }

  function rawOf(key, answers, sex) {
    let raw = 0, miss = 0, cnt = 0;
    Q27.forEach(q => {
      const hit = q.k.find(k => k[0] === key);
      if (!hit || (q.g && q.g !== sex)) return;
      cnt++;
      const v = answers[q.id];
      if (v == null) { miss++; return; }
      raw += hit[1] ? (6 - v) : v;
    });
    if (cnt === 0) return {raw:null,n:N[key],conv:null,miss:0};
    if (miss > 0) return {raw:null,n:cnt,conv:null,miss:miss};
    return {raw:raw,n:cnt,conv:(raw-cnt)/(cnt*4)*100,miss:0};
  }
  function judge(answers, sex) {
    const conv = {}, detail = {};
    ORDER.forEach(k => { const r = rawOf(k,answers,sex); detail[k] = r; conv[k] = r.conv; });
    const bad = ORDER.filter(k => k !== "pinghe");
    const known = bad.filter(k => conv[k] != null);
    const missing = bad.filter(k => conv[k] == null);
    const badYes = known.filter(k => conv[k] >= 40).sort((a,b) => conv[b]-conv[a]);
    const badTend = known.filter(k => conv[k] >= 30 && conv[k] < 40).sort((a,b) => conv[b]-conv[a]);
    const p = conv.pinghe;
    let pingheLevel = "否";
    if (p != null && p >= 60 && known.length > 0) {
      const allUnder30 = known.every(k => conv[k] < 30);
      const allUnder40 = known.every(k => conv[k] < 40);
      if (allUnder30) pingheLevel = "是";
      else if (allUnder40) pingheLevel = "基本是";
    }
    let main = null, mainLevel = "";
    if (pingheLevel === "是" || pingheLevel === "基本是") { main = "pinghe"; mainLevel = pingheLevel; }
    else if (badYes.length) { main = badYes[0]; mainLevel = "是"; }
    else if (badTend.length) { main = badTend[0]; mainLevel = "倾向是"; }
    const mixed = badYes.filter(k => k !== main).slice(0,3);
    return {conv:conv,detail:detail,main:main,mainLevel:mainLevel,mixed:mixed,badYes:badYes,badTend:badTend,pingheLevel:pingheLevel,missing:missing};
  }
  function tebingHit(answers, sex) {
    const done = Q27.every(q => q.g && q.g !== sex ? true : answers[q.id] != null);
    if (!done) return false;
    const r = rawOf("tebing",answers,sex);
    return r.conv != null && r.conv >= 30;
  }

  function parseBirthDate(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const dt = new Date(Date.UTC(y,mo-1,d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo-1 || dt.getUTCDate() !== d) return null;
    return {y:y,m:mo,d:d};
  }
  function isObject(value) { return value != null && typeof value === "object" && !Array.isArray(value); }
  function validateSubmission(payload) {
    const errors = [];
    if (!isObject(payload)) return {valid:false,errors:["请求体必须是对象"]};
    if (payload.questionnaire_version !== QUESTIONNAIRE_VERSION) errors.push("不支持的问卷版本");
    if (payload.sex !== "m" && payload.sex !== "f") errors.push("性别值无效");
    const birth = parseBirthDate(payload.birth_date);
    if (!birth) errors.push("出生日期无效");
    else {
      const nowY = new Date().getFullYear();
      if (birth.y < nowY - 110 || birth.y > nowY) errors.push("出生年份超出允许范围");
    }
    if (typeof payload.birth_prev_dahan !== "boolean") errors.push("大寒交司标记无效");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.assessment_date || "")) || !parseBirthDate(payload.assessment_date)) errors.push("评估日期无效");
    const answers = payload.answers;
    if (!isObject(answers)) errors.push("答案必须是对象");
    const cleanAnswers = {};
    if (isObject(answers)) {
      const defs = Q27.concat(Q8), allowed = new Set(defs.map(q => q.id));
      Object.keys(answers).forEach(id => { if (!allowed.has(id)) errors.push("未知题目：" + id); });
      defs.forEach(q => {
        const value = answers[idOrSelf(q)];
        const max = q.id.charAt(0) === "S" ? 5 : q.o.length;
        if (value == null) return;
        if (!Number.isInteger(value) || value < 1 || value > max) errors.push("答案超出范围：" + q.id);
        else cleanAnswers[q.id] = value;
      });
      if (payload.sex === "m" || payload.sex === "f") {
        Q27.forEach(q => {
          if (q.g && q.g !== payload.sex && cleanAnswers[q.id] != null) {
            errors.push("性别专属题不应作答：" + q.id);
            delete cleanAnswers[q.id];
          }
        });
        Q27.forEach(q => {
          if ((!q.g || q.g === payload.sex) && cleanAnswers[q.id] == null) errors.push("缺少必答题：" + q.id);
        });
        Q8.filter(q => q.id !== "P35").forEach(q => {
          if (cleanAnswers[q.id] == null) errors.push("缺少必答题：" + q.id);
        });
        if (!errors.length && tebingHit(cleanAnswers,payload.sex) && cleanAnswers.P35 == null) errors.push("缺少条件题：P35");
      }
    }
    if (errors.length) return {valid:false,errors:Array.from(new Set(errors)).slice(0,30)};
    return {valid:true,errors:[],value:{
      questionnaire_version:payload.questionnaire_version,
      sex:payload.sex,
      birth_date:payload.birth_date,
      birth_prev_dahan:payload.birth_prev_dahan,
      assessment_date:payload.assessment_date,
      answers:cleanAnswers
    }};
  }
  function idOrSelf(q) { return q.id; }
  function calculateResult(input) {
    const birth = parseBirthDate(input.birth_date);
    if (!birth) throw new Error("出生日期无效");
    birth.prev = !!input.birth_prev_dahan;
    const constitution = judge(input.answers,input.sex);
    const yunqi = buildYunqi(birth);
    const assessmentDate = input.assessment_date ? new Date(input.assessment_date + "T12:00:00") : new Date();
    return {
      constitution:constitution,
      yunqi:yunqi,
      joint_relation:kindOf(constitution,yunqi.innate),
      season_index:seasonNow(assessmentDate)
    };
  }

  return {
    QUESTIONNAIRE_VERSION,CONSTITUTION_VERSION,YUNQI_VERSION,SUPPORTED_QUESTIONNAIRE_VERSIONS,
    OPTS5,Q27,Q8,NAME,ORDER,N,seasonNow,seasonToday,
    YQ_QI_ZANG,YQ_QI_SEG,YQ_YUN_PLAIN,YQ_QI_PLAIN,YQ_TRIGGER,YQ_YUN_ZANG,
    YQ_daHan,YQ_ganzhi,YQ_birthYear,YQ_calc,YQ_hhmm,YQ_todayYear,
    buildYunqi,kindOf,rawOf,judge,tebingHit,parseBirthDate,validateSubmission,calculateResult
  };
});
