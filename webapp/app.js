import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import {
  SUPABASE_PROJECT_REF,
  SUPABASE_ANON_KEY,
  SUPABASE_TABLE,
  SNOOZE_FIELD,
  ACTIVE_STATUS_LIST,
  REVIEW_STATUS_LIST,
  CHECKIN_STATUS_LIST,
  CHECKIN_WINDOW_DAYS,
  CHECKIN_DEBUG_MONTH,
  TENURE_STATUS_LIST,
  ALL_ROW_LIMIT
} from "./config.js";

const statusPill = document.getElementById("statusPill");
const refreshBtn = document.getElementById("refreshBtn");
const tabs = Array.from(document.querySelectorAll(".tab"));
const activePanel = document.getElementById("activePanel");
const reviewPanel = document.getElementById("reviewPanel");
const checkinPanel = document.getElementById("checkinPanel");
const searchPanel = document.getElementById("searchPanel");
const tenurePanel = document.getElementById("tenurePanel");
const activeGroups = document.getElementById("activeGroups");
const reviewTable = document.getElementById("reviewTable");
const checkinTable = document.getElementById("checkinTable");
const searchTable = document.getElementById("searchTable");
const tenureTable = document.getElementById("tenureTable");
const activeCount = document.getElementById("activeCount");
const reviewCount = document.getElementById("reviewCount");
const checkinCount = document.getElementById("checkinCount");
const searchCount = document.getElementById("searchCount");
const tenureCount = document.getElementById("tenureCount");
const searchInput = document.getElementById("searchInput");

const state = {
  rows: [],
  activeTab: "active",
  searchTerm: "",
  searchRows: null
};

function setStatus(message, type = "info") {
  statusPill.textContent = message;
  statusPill.style.background = type === "error" ? "#ffd6cc" : "#ffffff";
  statusPill.style.color = type === "error" ? "#8a1f0e" : "#1d1b26";
}

function resolveSupabaseUrl(projectRef) {
  if (!projectRef) return "";
  const trimmed = projectRef.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}.supabase.co`;
}

const supabaseUrl = resolveSupabaseUrl(SUPABASE_PROJECT_REF);
const supabaseKey = SUPABASE_ANON_KEY;
function normalizeStatus(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\"'“”‘’]+|[\"'“”‘’]+$/g, "")
    .replace(/[.,;:]+$/g, "");
}

const activeStatusList = (ACTIVE_STATUS_LIST || []).map(normalizeStatus).filter(Boolean);
const reviewStatusList = (REVIEW_STATUS_LIST || []).map(normalizeStatus).filter(Boolean);
const checkinStatusList = (CHECKIN_STATUS_LIST || []).map(normalizeStatus).filter(Boolean);
const tenureStatusList = (TENURE_STATUS_LIST || []).map(normalizeStatus).filter(Boolean);
const activeStatusSet = new Set(activeStatusList);
const reviewStatusSet = new Set(reviewStatusList);
const checkinStatusSet = new Set(checkinStatusList);
const tenureStatusSet = new Set(tenureStatusList);

function validateConfig() {
  if (!SUPABASE_PROJECT_REF || SUPABASE_PROJECT_REF.includes("config.js")) {
    setStatus("Set SUPABASE_PROJECT_REF in webapp/config.js", "error");
    return false;
  }
  if (!supabaseUrl.startsWith("https://") || !supabaseUrl.includes(".supabase.co")) {
    setStatus("Supabase URL must be https://<project>.supabase.co", "error");
    return false;
  }
  if (!supabaseKey || supabaseKey === "your-anon-key") {
    setStatus("Set SUPABASE_ANON_KEY in webapp/config.js", "error");
    return false;
  }
  return true;
}

const supabase = createClient(supabaseUrl, supabaseKey);

function toDateString(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function toDateInputValue(value, fallback) {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toISOString().slice(0, 10);
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function matchesStatusList(statusValue, list, set) {
  if (!set.size) return true;
  const normalized = normalizeStatus(statusValue);
  const clean = normalized.replace(/[\"'“”‘’]/g, "");
  if (set.has(normalized) || set.has(clean)) return true;
  return list.some(value => normalized.startsWith(value) || clean.startsWith(value) || clean.includes(value));
}

function isActive(row) {
  return matchesStatusList(row?.status, activeStatusList, activeStatusSet);
}

function isReview(row) {
  if (!reviewStatusSet.size) return false;
  const hasCheckIn = Boolean(row?.[SNOOZE_FIELD]);
  return matchesStatusList(row?.status, reviewStatusList, reviewStatusSet) && hasCheckIn;
}

function parseCheckin(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  if (typeof value === "string") {
    const cleaned = value
      .replace(/^[A-Za-z]+,\s*/, "")
      .replace(/(\d+)(st|nd|rd|th)/gi, "$1")
      .replace(/\s+/g, " ")
      .trim();
    const fallback = new Date(cleaned);
    if (!Number.isNaN(fallback.getTime())) return fallback;
  }
  return null;
}

function isCheckin(row) {
  if (!checkinStatusSet.size) return false;
  if (!matchesStatusList(row?.status, checkinStatusList, checkinStatusSet)) return false;
  const checkinValue = row?.[SNOOZE_FIELD];
  const parsed = parseCheckin(checkinValue);
  if (!parsed) return false;
  if (CHECKIN_DEBUG_MONTH) {
    const [year, month] = CHECKIN_DEBUG_MONTH.split("-").map(Number);
    if (!year || !month) return false;
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() + 1 === month;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - CHECKIN_WINDOW_DAYS);
  const end = new Date(today);
  end.setDate(end.getDate() + CHECKIN_WINDOW_DAYS);
  return parsed >= start && parsed <= end;
}

function isTenure(row) {
  if (!tenureStatusSet.size) return false;
  if (!matchesStatusList(row?.status, tenureStatusList, tenureStatusSet)) return false;
  if (!row?.start_date) return false;
  const checkinValue = row?.[SNOOZE_FIELD];
  if (!checkinValue) return true;
  const parsedCheckin = parseCheckin(checkinValue);
  if (!parsedCheckin) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  parsedCheckin.setHours(0, 0, 0, 0);
  return parsedCheckin < today;
}

function sortByCheckinAsc(a, b) {
  const aDate = parseCheckin(a?.[SNOOZE_FIELD]);
  const bDate = parseCheckin(b?.[SNOOZE_FIELD]);
  if (aDate && bDate) return aDate - bDate;
  if (aDate) return -1;
  if (bDate) return 1;
  return 0;
}

function getActiveColumns() {
  return [
    "name",
    "status",
    "link",
    "current_company",
    "current_role",
    "roles",
    "loc",
    "notes",
    SNOOZE_FIELD
  ].filter(col => state.rows.some(row => row[col] !== undefined));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatCell(value) {
  if (value === null || value === undefined || value === "") return "<span class=\"muted\">—</span>";
  if (Array.isArray(value)) {
    return escapeHtml(value.join(", "));
  }
  if (typeof value === "object") {
    return escapeHtml(JSON.stringify(value));
  }
  return escapeHtml(value);
}

function formatLinkCell(value) {
  if (!value) return "<span class=\"muted\">—</span>";
  const url = String(value);
  if (!/^https?:\/\//i.test(url)) {
    return escapeHtml(url);
  }
  const safeUrl = escapeHtml(url);
  return `<a class="link" href="${safeUrl}" target="_blank" rel="noreferrer">Open</a>`;
}

function renderNotesCell(row) {
  const rowId = row.id || "";
  const rowLink = row.link || "";
  const rowName = row.name || "";
  const noteValue = row?.notes ?? "";
  const escapedNote = escapeHtml(noteValue);
  return `<textarea class="notes-field" rows="5" data-action="notes" data-id="${escapeHtml(rowId)}" data-link="${escapeHtml(rowLink)}" data-name="${escapeHtml(rowName)}" data-initial="${escapedNote}">${escapedNote}</textarea>`;
}

function renderStatusCell(row) {
  const rowId = row.id || "";
  const rowLink = row.link || "";
  const rowName = row.name || "";
  const currentStatus = String(row?.status || "");
  const normalizedCurrent = normalizeStatus(currentStatus);
  const options = [
    "cold",
    "connecting",
    "connected",
    "developing",
    "interviewing",
    "closing",
    "work trial",
    "backburner",
    "veto",
    "done"
  ];
  const optionMarkup = options
    .map(option => {
      const selected = normalizeStatus(option) === normalizedCurrent ? " selected" : "";
      return `<option value="${escapeHtml(option)}"${selected}>${escapeHtml(option)}</option>`;
    })
    .join("");
  return `<select class="status-select" data-action="status" data-id="${escapeHtml(rowId)}" data-link="${escapeHtml(rowLink)}" data-name="${escapeHtml(rowName)}">${optionMarkup}</select>`;
}

function renderTableCell(column, row) {
  if (column === "notes") {
    return `<td class="notes-cell">${renderNotesCell(row)}</td>`;
  }
  if (column === "status") {
    return `<td>${renderStatusCell(row)}</td>`;
  }
  if (column === "link") {
    return `<td>${formatLinkCell(row[column])}</td>`;
  }
  return `<td>${formatCell(row[column])}</td>`;
}

function renderSnoozeTable(tableEl, rows, columns) {
  const headerCells = columns.map(col => `<th>${escapeHtml(col)}</th>`).join("");
  const actionHeader = "<th>Snooze until</th><th></th>";
  tableEl.querySelector("thead").innerHTML = `<tr>${headerCells}${actionHeader}</tr>`;

  const defaultSnooze = toDateString(addMonths(new Date(), 3));
  tableEl.querySelector("tbody").innerHTML = rows
    .map(row => {
      const cells = columns.map(col => renderTableCell(col, row)).join("");
      const rowId = row.id || "";
      const rowLink = row.link || "";
      const rowName = row.name || "";
      const snoozeValue = toDateInputValue(row?.[SNOOZE_FIELD], defaultSnooze);
      const snoozeInput = `<input class="snooze-input" type="date" value="${snoozeValue}" />`;
      const snoozeButton = `<button class="snooze-button" data-action="snooze" data-id="${escapeHtml(rowId)}" data-link="${escapeHtml(rowLink)}" data-name="${escapeHtml(rowName)}">Snooze</button>`;
      return `<tr>${cells}<td>${snoozeInput}</td><td>${snoozeButton}</td></tr>`;
    })
    .join("");
}

function renderActiveView() {
  const statusOrder = new Map(activeStatusList.map((value, index) => [value, index]));
  const rows = state.rows
    .filter(isActive)
    .slice()
    .sort((a, b) => {
      const aStatus = normalizeStatus(a?.status);
      const bStatus = normalizeStatus(b?.status);
      const aRank = statusOrder.has(aStatus)
        ? statusOrder.get(aStatus)
        : activeStatusList.findIndex(value => aStatus.startsWith(value));
      const bRank = statusOrder.has(bStatus)
        ? statusOrder.get(bStatus)
        : activeStatusList.findIndex(value => bStatus.startsWith(value));
      if (aRank !== bRank) return (aRank === -1 ? 999 : aRank) - (bRank === -1 ? 999 : bRank);
      const aName = String(a?.name || "");
      const bName = String(b?.name || "");
      return aName.localeCompare(bName);
    });
  activeCount.textContent = `${rows.length} active`;
  activeCount.style.display = state.activeTab === "active" ? "inline" : "none";

  const columns = getActiveColumns();
  const grouped = new Map();
  rows.forEach(row => {
    const normalized = normalizeStatus(row?.status);
    const statusKey = activeStatusList.find(value => normalized.startsWith(value)) || normalized || "unknown";
    if (!grouped.has(statusKey)) grouped.set(statusKey, []);
    grouped.get(statusKey).push(row);
  });

  const headerCells = columns.map(col => `<th>${escapeHtml(col)}</th>`).join("");
  const actionHeader = "<th>Snooze until</th><th></th>";
  const defaultSnooze = toDateString(addMonths(new Date(), 3));

  activeGroups.innerHTML = activeStatusList
    .filter(status => grouped.has(status))
    .map(status => {
      const statusRows = grouped.get(status) || [];
      const tableBody = statusRows
        .map(row => {
          const cells = columns.map(col => renderTableCell(col, row)).join("");
          const rowId = row.id || "";
          const rowLink = row.link || "";
          const rowName = row.name || "";
          const snoozeValue = toDateInputValue(row?.[SNOOZE_FIELD], defaultSnooze);
          const snoozeInput = `<input class="snooze-input" type="date" value="${snoozeValue}" />`;
          const snoozeButton = `<button class="snooze-button" data-action="snooze" data-id="${escapeHtml(rowId)}" data-link="${escapeHtml(rowLink)}" data-name="${escapeHtml(rowName)}">Snooze</button>`;
          return `<tr>${cells}<td>${snoozeInput}</td><td>${snoozeButton}</td></tr>`;
        })
        .join("");
      const title = status.replace(/\b\w/g, char => char.toUpperCase());
      return `
        <details class="status-group" open>
          <summary>${escapeHtml(title)} <span class="summary-count">${statusRows.length}</span></summary>
          <div class="table-wrap">
            <table>
              <thead><tr>${headerCells}${actionHeader}</tr></thead>
              <tbody>${tableBody}</tbody>
            </table>
          </div>
        </details>
      `;
    })
    .join("");
}

function renderReviewView() {
  const rows = state.rows.filter(isReview).slice().sort(sortByCheckinAsc);
  reviewCount.textContent = `${rows.length} review`;
  reviewCount.style.display = state.activeTab === "review" ? "inline" : "none";

  const columns = getActiveColumns();
  renderSnoozeTable(reviewTable, rows, columns);
}

function renderCheckinView() {
  const rows = state.rows.filter(isCheckin).slice().sort(sortByCheckinAsc);
  checkinCount.textContent = `${rows.length} check-in`;
  checkinCount.style.display = state.activeTab === "checkin" ? "inline" : "none";

  const columns = getActiveColumns();
  renderSnoozeTable(checkinTable, rows, columns);
}

function renderTenureView() {
  const rows = state.rows.filter(isTenure);
  tenureCount.textContent = `${rows.length} tenure`;
  tenureCount.style.display = state.activeTab === "tenure" ? "inline" : "none";

  const columns = [
    "name",
    "current_company",
    "current_role",
    "start_date",
    "started_at",
    "loc",
    "link",
    SNOOZE_FIELD
  ].filter(col => state.rows.some(row => row[col] !== undefined));

  renderSnoozeTable(tenureTable, rows, columns);
}

function renderSearchView() {
  const rows = state.searchRows ?? [];
  searchCount.textContent = `${rows.length} results`;
  searchCount.style.display = state.activeTab === "search" ? "inline" : "none";

  const columns = getActiveColumns();

  if (!state.searchTerm) {
    searchTable.querySelector("thead").innerHTML = "";
    searchTable.querySelector("tbody").innerHTML = "";
    return;
  }
  renderSnoozeTable(searchTable, rows, columns);
}

async function fetchRows() {
  if (!validateConfig()) {
    return;
  }
  setStatus("Loading…");
  try {
    const pageSize = 1000;
    let rows = [];
    for (let offset = 0; offset < ALL_ROW_LIMIT; offset += pageSize) {
      const { data, error } = await supabase
        .from(SUPABASE_TABLE)
        .select("*")
        .range(offset, offset + pageSize - 1);

      if (error) {
        setStatus(error.message || "Supabase error", "error");
        console.error(error);
        return;
      }
      if (!data || data.length === 0) break;
      rows = rows.concat(data);
      if (data.length < pageSize) break;
    }
    if (rows.length && rows[0]?.created_at) {
      rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    state.rows = rows;
    renderActiveView();
    renderReviewView();
    renderCheckinView();
    renderTenureView();
    renderSearchView();
    setStatus("Synced");
  } catch (err) {
    setStatus(err?.message || "Network error", "error");
    console.error(err);
  }
}

async function fetchSearchRows(query) {
  if (!query) {
    state.searchRows = [];
    renderSearchView();
    return;
  }
  const trimmed = query.trim();
  const safe = trimmed.replace(/,/g, "");
  const terms = safe.split(/\s+/).filter(Boolean);
  const orParts = terms.map(term => `name.ilike.*${term}*`);
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .select("*")
    .or(orParts.join(","))
    .limit(100);
  if (error) {
    setStatus(error.message || "Search query failed", "error");
    console.error(error);
    state.searchRows = [];
    renderSearchView();
    return;
  }
  state.searchRows = Array.isArray(data) ? data : [];
  renderSearchView();
}

async function snoozeCandidate({ id, link, name, date }) {
  if (!id && !link && !name) {
    setStatus("Missing candidate identifiers", "error");
    return;
  }
  setStatus("Snoozing…");
  let query = supabase.from(SUPABASE_TABLE).update({ [SNOOZE_FIELD]: date });
  if (id) {
    query = query.eq("id", id);
  } else {
    query = query.eq("link", link).eq("name", name);
  }
  const { error } = await query;

  if (error) {
    setStatus(error.message, "error");
    console.error(error);
    return;
  }
  const row = state.rows.find(item => (id && item.id === id) || (item.link === link && item.name === name));
  if (row) row[SNOOZE_FIELD] = date;
  renderActiveView();
  renderReviewView();
  renderCheckinView();
  renderTenureView();
  setStatus("Snoozed");
}

async function updateStatus({ id, link, name, status }) {
  if (!id && !link && !name) {
    setStatus("Missing candidate identifiers", "error");
    return;
  }
  let query = supabase.from(SUPABASE_TABLE).update({ status });
  if (id) {
    query = query.eq("id", id);
  } else {
    query = query.eq("link", link).eq("name", name);
  }
  const { error } = await query;
  if (error) {
    setStatus(error.message, "error");
    console.error(error);
    return;
  }
  const row = state.rows.find(item => (id && item.id === id) || (item.link === link && item.name === name));
  if (row) row.status = status;
  renderActiveView();
  renderReviewView();
  renderCheckinView();
  renderTenureView();
  setStatus("Status updated");
}

async function updateNotes({ id, link, name, notes }) {
  if (!id && !link && !name) {
    setStatus("Missing candidate identifiers", "error");
    return;
  }
  let query = supabase.from(SUPABASE_TABLE).update({ notes });
  if (id) {
    query = query.eq("id", id);
  } else {
    query = query.eq("link", link).eq("name", name);
  }
  const { error } = await query;
  if (error) {
    setStatus(error.message, "error");
    console.error(error);
    return;
  }
  const row = state.rows.find(item => (id && item.id === id) || (item.link === link && item.name === name));
  if (row) row.notes = notes;
  setStatus("Notes saved");
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  tabs.forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tabName));
  const app = document.querySelector(".app");
  app.classList.add("compact-header");
  activePanel.classList.toggle("hidden", tabName !== "active");
  reviewPanel.classList.toggle("hidden", tabName !== "review");
  checkinPanel.classList.toggle("hidden", tabName !== "checkin");
  searchPanel.classList.toggle("hidden", tabName !== "search");
  tenurePanel.classList.toggle("hidden", tabName !== "tenure");
  activeCount.style.display = tabName === "active" ? "inline" : "none";
  reviewCount.style.display = tabName === "review" ? "inline" : "none";
  checkinCount.style.display = tabName === "checkin" ? "inline" : "none";
  searchCount.style.display = tabName === "search" ? "inline" : "none";
  tenureCount.style.display = tabName === "tenure" ? "inline" : "none";
  localStorage.setItem("crm.activeTab", tabName);
}

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    setActiveTab(tab.dataset.tab);
  });
});

function handleSnoozeClick(event) {
  const button = event.target.closest("[data-action=\"snooze\"]");
  if (!button) return;
  const id = button.dataset.id;
  const link = button.dataset.link;
  const name = button.dataset.name;
  const input = button.closest("tr")?.querySelector(".snooze-input");
  const dateValue = input?.value;
  if (!dateValue) {
    setStatus("Pick a snooze date", "error");
    return;
  }
  snoozeCandidate({ id, link, name, date: dateValue });
}

function handleNotesFocus(event) {
  const field = event.target.closest(".notes-field");
  if (!field) return;
  field.classList.add("expanded");
}

function handleNotesBlur(event) {
  const field = event.target.closest(".notes-field");
  if (!field) return;
  field.classList.remove("expanded");
  const initial = field.dataset.initial ?? "";
  const current = field.value ?? "";
  if (current === initial) return;
  field.dataset.initial = current;
  updateNotes({
    id: field.dataset.id,
    link: field.dataset.link,
    name: field.dataset.name,
    notes: current
  });
}

activeGroups.addEventListener("click", handleSnoozeClick);
reviewTable.addEventListener("click", handleSnoozeClick);
checkinTable.addEventListener("click", handleSnoozeClick);
searchTable.addEventListener("click", handleSnoozeClick);
tenureTable.addEventListener("click", handleSnoozeClick);
activeGroups.addEventListener("change", event => {
  const select = event.target.closest("[data-action=\"status\"]");
  if (!select) return;
  updateStatus({
    id: select.dataset.id,
    link: select.dataset.link,
    name: select.dataset.name,
    status: select.value
  });
});
reviewTable.addEventListener("change", event => {
  const select = event.target.closest("[data-action=\"status\"]");
  if (!select) return;
  updateStatus({
    id: select.dataset.id,
    link: select.dataset.link,
    name: select.dataset.name,
    status: select.value
  });
});
checkinTable.addEventListener("change", event => {
  const select = event.target.closest("[data-action=\"status\"]");
  if (!select) return;
  updateStatus({
    id: select.dataset.id,
    link: select.dataset.link,
    name: select.dataset.name,
    status: select.value
  });
});
activeGroups.addEventListener("focusin", handleNotesFocus);
reviewTable.addEventListener("focusin", handleNotesFocus);
checkinTable.addEventListener("focusin", handleNotesFocus);
searchTable.addEventListener("focusin", handleNotesFocus);
tenureTable.addEventListener("focusin", handleNotesFocus);
activeGroups.addEventListener("focusout", handleNotesBlur);
reviewTable.addEventListener("focusout", handleNotesBlur);
checkinTable.addEventListener("focusout", handleNotesBlur);
searchTable.addEventListener("focusout", handleNotesBlur);
tenureTable.addEventListener("focusout", handleNotesBlur);

searchInput.addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  state.searchTerm = String(event.target.value || "").trim().toLowerCase();
  fetchSearchRows(state.searchTerm);
});

refreshBtn.addEventListener("click", fetchRows);

const savedTab = localStorage.getItem("crm.activeTab");
setActiveTab(["active", "review", "checkin", "search", "tenure"].includes(savedTab) ? savedTab : "active");
fetchRows();
