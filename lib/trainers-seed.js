/** Состав с сайта (trenery.html / index.html) */
const SITE_TRAINERS = [
  { id: "t-bobina-k", name: "Бобина Ксения", sport: "hg", login: "bobina_k", password: "bobina_k" },
  { id: "t-bobina-s", name: "Бобина Софья", sport: "hg", login: "bobina_s", password: "bobina_s" },
  { id: "t-borkovec", name: "Борковец Валерия", sport: "hg", login: "borkovec", password: "borkovec" },
  { id: "t-korneva", name: "Корнева Яна", sport: "hg", login: "korneva", password: "korneva" },
  { id: "t-smirnov", name: "Смирнов Владислав", sport: "sambo", login: "smirnov", password: "smirnov" },
  { id: "t-stulov", name: "Стулов Вадим", sport: "sambo", login: "stulov", password: "stulov" },
  { id: "t-vereykin", name: "Верейкин Максим", sport: "sambo", login: "vereykin", password: "vereykin" },
  { id: "t-chmel", name: "Чмель Андрей", sport: "sambo", login: "chmel", password: "chmel" }
];

function distributeGroups(trainers, groups) {
  const counters = { hg: 0, sambo: 0 };
  const bySport = { hg: [], sambo: [] };
  for (const t of trainers) {
    t.groupIds = [];
    if (bySport[t.sport]) bySport[t.sport].push(t);
  }
  for (const g of groups || []) {
    const pool = bySport[g.sport];
    if (!pool || !pool.length) continue;
    const i = (counters[g.sport]++ % pool.length);
    pool[i].groupIds.push(g.id);
  }
}

function buildSiteTrainers(groups) {
  const trainers = SITE_TRAINERS.map((t) => ({ ...t, groupIds: [] }));
  distributeGroups(trainers, groups);
  return trainers;
}

function ensureSiteTrainers(db) {
  db.settings = db.settings || {};
  if (db.settings.siteTrainersSeeded) return false;
  db.trainers = buildSiteTrainers(db.groups || []);
  db.settings.siteTrainersSeeded = true;
  return true;
}

module.exports = { SITE_TRAINERS, buildSiteTrainers, ensureSiteTrainers };
