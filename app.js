import {
  buildCounterBets,
  buildThreeTierSuggestions,
  buildTopBets,
  identifyUndercoverWinner,
  rankRace
} from "./algorithmEngine.js";
import { defaultHorses, raceMeta, raceSources } from "./data.js";

const NUMERIC_FIELDS = [
  "speed",
  "form",
  "class",
  "paceFit",
  "distanceFit",
  "connections",
  "consistency",
  "volatility",
  "lateKick",
  "improvingTrend"
];

const tableBody = document.querySelector("#horse-table-body");
const topBetsRoot = document.querySelector("#top-bets");
const undercoverRoot = document.querySelector("#undercover-winner");
const algoSlipRoot = document.querySelector("#algo-slip");
const counterSlipRoot = document.querySelector("#counter-slip");
const tierSuggestionsRoot = document.querySelector("#tier-suggestions");
const sourceListRoot = document.querySelector("#source-list");
const bankrollInput = document.querySelector("#bankroll-input");
const recalcButton = document.querySelector("#recalc-btn");
const addHorseButton = document.querySelector("#add-horse-btn");
const subhead = document.querySelector(".subhead");

let horses = structuredClone(defaultHorses);

const escapeHtml = (text) =>
  String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const asPercent = (value) => `${(value * 100).toFixed(1)}%`;

const readBankroll = () => {
  const value = Number(bankrollInput.value);
  return Number.isFinite(value) && value > 0 ? value : 100;
};

const createHorseRow = (horse, index) => {
  const numericInputs = NUMERIC_FIELDS.map(
    (field) =>
      `<td><input type="number" data-field="${field}" value="${Number(horse[field] ?? 0)}" min="0" max="100" /></td>`
  ).join("");

  return `
    <tr data-index="${index}">
      <td><input type="text" data-field="name" value="${escapeHtml(horse.name)}" /></td>
      <td><input type="text" data-field="odds" value="${escapeHtml(horse.odds)}" /></td>
      ${numericInputs}
    </tr>
  `;
};

const renderHorseTable = () => {
  tableBody.innerHTML = horses.map((horse, index) => createHorseRow(horse, index)).join("");
};

const syncHorsesFromTable = () => {
  const rows = [...tableBody.querySelectorAll("tr")];
  horses = rows
    .map((row) => {
      const fields = [...row.querySelectorAll("input")];
      const record = {};

      for (const field of fields) {
        const key = field.dataset.field;
        if (!key) {
          continue;
        }
        if (NUMERIC_FIELDS.includes(key)) {
          const value = Number(field.value);
          record[key] = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
        } else {
          record[key] = field.value.trim();
        }
      }

      return {
        ...record,
        history: defaultHorses.find((horse) => horse.name === record.name)?.history ?? "No note."
      };
    })
    .filter((horse) => horse.name);
};

const renderTopBets = (topBets) => {
  const rows = topBets
    .map(
      (bet) => `
        <tr>
          <td>${bet.rank}</td>
          <td>${escapeHtml(bet.type)}</td>
          <td>${escapeHtml(bet.ticket)}</td>
          <td>${escapeHtml(bet.risk)}</td>
          <td>${escapeHtml(bet.stake)}</td>
        </tr>
      `
    )
    .join("");

  topBetsRoot.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Type</th>
          <th>Ticket</th>
          <th>Risk</th>
          <th>Stake</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
};

const renderUndercover = (horse) => {
  if (!horse) {
    undercoverRoot.innerHTML = "<p>No undercover profile available (short field).</p>";
    return;
  }

  undercoverRoot.innerHTML = `
    <div class="callout">
      <p><strong>${escapeHtml(horse.name)}</strong> (${escapeHtml(horse.odds)})</p>
      <p>Model edge: <strong>${asPercent(horse.valueEdge)}</strong></p>
      <p>Dark-horse profile is supported by late-kick/trend components and non-favorite pricing.</p>
    </div>
  `;
};

const renderSlip = (root, bets) => {
  root.innerHTML = `
    <ul class="ticket-list">
      ${bets
        .map(
          (bet) => `
            <li>
              <span>${escapeHtml(bet.type)}</span>
              <strong>${escapeHtml(bet.ticket)}</strong>
              <span>${escapeHtml(bet.stake)}</span>
            </li>
          `
        )
        .join("")}
    </ul>
  `;
};

const renderTierSuggestions = (suggestions) => {
  tierSuggestionsRoot.innerHTML = suggestions
    .map(
      (entry) => `
        <article class="tier-card">
          <h3>${escapeHtml(entry.tier)}</h3>
          <p class="horse-name">${escapeHtml(entry.horse.name)} (${escapeHtml(entry.horse.odds)})</p>
          <p>Model win probability: <strong>${asPercent(entry.horse.modelProbability)}</strong></p>
          <p>Market implied probability: <strong>${asPercent(entry.horse.marketProbability)}</strong></p>
          <p>Edge: <strong>${asPercent(entry.horse.valueEdge)}</strong></p>
          <p>${escapeHtml(entry.strategy)}</p>
          <p class="muted">${escapeHtml(entry.horse.history)}</p>
        </article>
      `
    )
    .join("");
};

const renderSources = () => {
  sourceListRoot.innerHTML = raceSources
    .map(
      (source) => `
        <li>
          <a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a>
          <p>${escapeHtml(source.usedFor)}</p>
        </li>
      `
    )
    .join("");
};

const recalculate = () => {
  syncHorsesFromTable();

  if (horses.length < 3) {
    topBetsRoot.innerHTML = "<p>Add at least three horses to generate ticket ladders.</p>";
    undercoverRoot.innerHTML = "<p>Undercover winner needs at least six horses in the field.</p>";
    algoSlipRoot.innerHTML = "";
    counterSlipRoot.innerHTML = "";
    tierSuggestionsRoot.innerHTML = "";
    return;
  }

  const bankroll = readBankroll();
  const ranked = rankRace(horses);
  const undercover = identifyUndercoverWinner(ranked);
  const topBets = buildTopBets(ranked, bankroll);
  const counterBets = buildCounterBets(ranked, bankroll, undercover);
  const tierSuggestions = buildThreeTierSuggestions(ranked, undercover);

  renderTopBets(topBets);
  renderUndercover(undercover);
  renderSlip(algoSlipRoot, topBets);
  renderSlip(counterSlipRoot, counterBets);
  renderTierSuggestions(tierSuggestions);
};

const addHorse = () => {
  horses.push({
    name: `New Horse ${horses.length + 1}`,
    odds: "10/1",
    speed: 70,
    form: 70,
    class: 70,
    paceFit: 70,
    distanceFit: 70,
    connections: 70,
    consistency: 70,
    volatility: 50,
    lateKick: 70,
    improvingTrend: 70,
    history: "No note."
  });
  renderHorseTable();
};

const bootstrap = () => {
  subhead.textContent = `${raceMeta.name} | ${raceMeta.date} | ${raceMeta.class} | ${raceMeta.distance} | Purse ${raceMeta.purse}`;
  renderHorseTable();
  renderSources();
  recalculate();
};

recalcButton.addEventListener("click", recalculate);
addHorseButton.addEventListener("click", addHorse);
tableBody.addEventListener("change", recalculate);
bankrollInput.addEventListener("change", recalculate);

bootstrap();
