const DECK_HEIGHTS = {
  stepdeck: 42,
  flatbed: 60
};

const TRUCK_LENGTH_INCHES = 22 * 12;

// Company, vehicle, and trailer information is entered locally by the user.
// No fleet data is bundled with this public extension.
const COMPANIES_DB = [];

const companySelect = document.getElementById("companySelect");
const truckUnitSelect = document.getElementById("truckUnitSelect");
const trailerUnitSelect = document.getElementById("trailerUnitSelect");
const trailerTypeSelect = document.getElementById("trailerTypeSelect");

const loadWidthInput = document.getElementById("loadWidthInput");
const overallWidthInput = document.getElementById("overallWidthInput");
const loadHeightInput = document.getElementById("loadHeightInput");
const overallHeightInput = document.getElementById("overallHeightInput");
const loadLengthInput = document.getElementById("loadLengthInput");
const trailerLengthInput = document.getElementById("trailerLengthInput");
const overallLengthInput = document.getElementById("overallLengthInput");
const frontOverhangInput = document.getElementById("frontOverhangInput");
const rearOverhangInput = document.getElementById("rearOverhangInput");
const loadWeightInput = document.getElementById("loadWeightInput");
const grossWeightInput = document.getElementById("grossWeightInput");

let currentCompany = null;
let currentMatchingTrailers = [];
const DRAFT_STORAGE_KEY = "permitAutofillDraftV1";
const LAST_PERMIT_STORAGE_KEY = "permitAutofillLastPayloadV1";
const DRAFT_INPUT_SELECTOR = "input[id]:not([id^='map'])";
let saveDraftTimer = null;

function getDraftInputs() {
  return Array.from(document.querySelectorAll(DRAFT_INPUT_SELECTOR));
}

async function restoreDraft() {
  try {
    const { [DRAFT_STORAGE_KEY]: draft = {} } = await chrome.storage.local.get(DRAFT_STORAGE_KEY);
    getDraftInputs().forEach(input => {
      if (typeof draft[input.id] === "string") input.value = draft[input.id];
    });
  } catch (error) {
    console.warn("Saved draft could not be restored:", error);
  }
}

function scheduleDraftSave() {
  clearTimeout(saveDraftTimer);
  saveDraftTimer = setTimeout(() => {
    const draft = Object.fromEntries(getDraftInputs().map(input => [input.id, input.value]));
    chrome.storage.local.set({ [DRAFT_STORAGE_KEY]: draft }).catch(error => {
      console.warn("Draft could not be saved:", error);
    });
  }, 300);
}

document.addEventListener("input", event => {
  if (event.target.matches?.(DRAFT_INPUT_SELECTOR)) scheduleDraftSave();
});

const clearDraftBtn = document.getElementById("clearDraftBtn");
if (clearDraftBtn) {
  clearDraftBtn.addEventListener("click", async () => {
    await chrome.storage.local.remove([DRAFT_STORAGE_KEY, LAST_PERMIT_STORAGE_KEY]);
    getDraftInputs().forEach(input => { input.value = ""; });
    document.getElementById("statusText").textContent = "Saved draft cleared.";
  });
}

function parseToTotalInches(val) {
  if (!val) return 0;
  const s = val.toString().trim();
  const matchApos = s.match(/(\d+)\s*['’]\s*(\d+)?/);
  if (matchApos) {
    const ft = parseInt(matchApos[1] || "0", 10);
    const inch = parseInt(matchApos[2] || "0", 10);
    return ft * 12 + inch;
  }
  const matchDash = s.match(/^(\d+)[-.\s](\d+)$/);
  if (matchDash) {
    const ft = parseInt(matchDash[1] || "0", 10);
    const inch = parseInt(matchDash[2] || "0", 10);
    return ft * 12 + inch;
  }
  const numOnly = s.match(/^\d+$/);
  if (numOnly) {
    return parseInt(numOnly[0], 10) * 12;
  }
  return 0;
}

function inchesToFeetInchesStr(totalInches) {
  const ft = Math.floor(totalInches / 12);
  const inch = totalInches % 12;
  return `${ft}' ${inch}"`;
}

function formatFeetInches(val) {
  if (val === undefined || val === null) return "";
  const s = val.toString().trim();
  if (s === "" || s === "0" || s === "0'") return "0";
  if (s.includes("'")) return s;

  const matchPair = s.match(/^(\d+)[-.\s](\d+)$/);
  if (matchPair) {
    return `${matchPair[1]}' ${matchPair[2]}"`;
  }

  const matchSingle = s.match(/^(\d+)$/);
  if (matchSingle) {
    return `${matchSingle[1]}' 0"`;
  }
  return s;
}

function calculateOverallHeight() {
  if (!loadHeightInput || !overallHeightInput) return;
  const loadInches = parseToTotalInches(loadHeightInput.value);
  if (loadInches <= 0) return;

  const currentType = trailerTypeSelect ? trailerTypeSelect.value : "stepdeck";
  const deckInches = DECK_HEIGHTS[currentType] || DECK_HEIGHTS.stepdeck;

  const totalHeightInches = loadInches + deckInches;
  overallHeightInput.value = inchesToFeetInchesStr(totalHeightInches);
}

function calculateOverallLengthFromLoad() {
  if (!overallLengthInput) return;

  const trailerInches = parseToTotalInches(trailerLengthInput?.value) || (53 * 12);
  const loadInches = parseToTotalInches(loadLengthInput?.value);
  const frontInches = parseToTotalInches(frontOverhangInput?.value);

  if (loadInches > trailerInches) {
    const rearInches = loadInches - trailerInches;
    if (rearOverhangInput) {
      rearOverhangInput.value = inchesToFeetInchesStr(rearInches);
    }
    const totalLengthInches = TRUCK_LENGTH_INCHES + trailerInches + rearInches + frontInches;
    overallLengthInput.value = inchesToFeetInchesStr(totalLengthInches);
  } else {
    if (rearOverhangInput) {
      rearOverhangInput.value = "0";
    }
    const totalLengthInches = TRUCK_LENGTH_INCHES + trailerInches + frontInches;
    overallLengthInput.value = inchesToFeetInchesStr(totalLengthInches);
  }
}

function calculateOverallLengthFromOverhang() {
  if (!overallLengthInput) return;

  const trailerInches = parseToTotalInches(trailerLengthInput?.value) || (53 * 12);
  const frontInches = parseToTotalInches(frontOverhangInput?.value);
  const rearInches = parseToTotalInches(rearOverhangInput?.value);

  const totalLengthInches = TRUCK_LENGTH_INCHES + trailerInches + frontInches + rearInches;
  overallLengthInput.value = inchesToFeetInchesStr(totalLengthInches);

  if (loadLengthInput) {
    if (frontInches > 0 || rearInches > 0) {
      const calculatedLoadInches = trailerInches + frontInches + rearInches;
      loadLengthInput.value = inchesToFeetInchesStr(calculatedLoadInches);
    } else {
      loadLengthInput.value = inchesToFeetInchesStr(trailerInches);
    }
  }
}

for (let i = 1; i <= 13; i++) {
  const g = document.getElementById(`axleGauge${i}`);
  if (g) {
    g.addEventListener("blur", (e) => {
      if (e.target.value.trim()) e.target.value = formatFeetInches(e.target.value);
    });
  }
}

const spacingIds = [
  "spacing12", "spacing23", "spacing34", "spacing45", "spacing56",
  "spacing67", "spacing78", "spacing89", "spacing910", "spacing1011",
  "spacing1112", "spacing1213"
];

spacingIds.forEach(id => {
  const sp = document.getElementById(id);
  if (sp) {
    sp.addEventListener("blur", (e) => {
      if (e.target.value.trim()) e.target.value = formatFeetInches(e.target.value);
    });
  }
});

const standardDimensionIds = [
  "loadLengthInput", "loadWidthInput", "loadHeightInput",
  "overallLengthInput", "overallWidthInput", "overallHeightInput",
  "frontOverhangInput", "rearOverhangInput", "trailerLengthInput"
];

standardDimensionIds.forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener("blur", (e) => {
      e.target.value = formatFeetInches(e.target.value);
    });
  }
});

if (loadWidthInput && overallWidthInput) {
  loadWidthInput.addEventListener("input", (e) => {
    overallWidthInput.value = e.target.value;
  });
  loadWidthInput.addEventListener("blur", (e) => {
    const formatted = formatFeetInches(e.target.value);
    e.target.value = formatted;
    overallWidthInput.value = formatted;
  });

  overallWidthInput.addEventListener("input", (e) => {
    loadWidthInput.value = e.target.value;
  });
  overallWidthInput.addEventListener("blur", (e) => {
    const formatted = formatFeetInches(e.target.value);
    e.target.value = formatted;
    loadWidthInput.value = formatted;
  });
}

if (loadHeightInput) {
  loadHeightInput.addEventListener("blur", (e) => {
    e.target.value = formatFeetInches(e.target.value);
    calculateOverallHeight();
  });
  loadHeightInput.addEventListener("input", () => {
    calculateOverallHeight();
  });
}

if (trailerTypeSelect) {
  trailerTypeSelect.addEventListener("change", () => {
    calculateOverallHeight();
  });
}

if (loadLengthInput) {
  loadLengthInput.addEventListener("blur", (e) => {
    e.target.value = formatFeetInches(e.target.value);
    calculateOverallLengthFromLoad();
  });
  loadLengthInput.addEventListener("input", () => {
    calculateOverallLengthFromLoad();
  });
}

if (trailerLengthInput) {
  trailerLengthInput.addEventListener("blur", (e) => {
    e.target.value = formatFeetInches(e.target.value);
    calculateOverallLengthFromLoad();
  });
  trailerLengthInput.addEventListener("input", () => {
    calculateOverallLengthFromLoad();
  });
}

if (rearOverhangInput) {
  rearOverhangInput.addEventListener("blur", (e) => {
    e.target.value = formatFeetInches(e.target.value);
    calculateOverallLengthFromOverhang();
  });
  rearOverhangInput.addEventListener("input", () => {
    calculateOverallLengthFromOverhang();
  });
}

if (frontOverhangInput) {
  frontOverhangInput.addEventListener("blur", (e) => {
    e.target.value = formatFeetInches(e.target.value);
    calculateOverallLengthFromOverhang();
  });
  frontOverhangInput.addEventListener("input", () => {
    calculateOverallLengthFromOverhang();
  });
}

function sumAxleWeights() {
  let total = 0;
  for (let i = 1; i <= 13; i++) {
    const val = parseInt(document.getElementById(`axleWt${i}`)?.value || "0", 10);
    if (!isNaN(val)) total += val;
  }
  if (grossWeightInput && total > 0) {
    grossWeightInput.value = total.toString();
  }
}

for (let i = 1; i <= 13; i++) {
  const el = document.getElementById(`axleWt${i}`);
  if (el) el.addEventListener("input", sumAxleWeights);
}

function initCompanies() {
  if (!companySelect) return;
  companySelect.innerHTML = "";
  COMPANIES_DB.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.innerText = `${c.name} (USDOT: ${c.usdot})`;
    companySelect.appendChild(opt);
  });

  const customOpt = document.createElement("option");
  customOpt.value = "custom";
  customOpt.innerText = "-- Custom / Manual Entry --";
  companySelect.appendChild(customOpt);

  selectCompany(COMPANIES_DB[0]?.id || "custom");
}

function selectCompany(companyId) {
  currentCompany = COMPANIES_DB.find(c => c.id === companyId);

  if (currentCompany) {
    document.getElementById("haulerNameInput").value = currentCompany.name;
    document.getElementById("usdotInput").value = currentCompany.usdot;
    document.getElementById("accountInput").value = currentCompany.account;

    loadTruckUnits(currentCompany.trucks);
  } else {
    truckUnitSelect.innerHTML = "<option value=''>-- Manual --</option>";
    trailerUnitSelect.innerHTML = "<option value=''>-- Manual --</option>";
  }
}

function loadTruckUnits(trucks) {
  if (!truckUnitSelect) return;
  truckUnitSelect.innerHTML = "";
  trucks.forEach((t, index) => {
    const opt = document.createElement("option");
    opt.value = index;
    opt.innerText = `${t.unit}`;
    truckUnitSelect.appendChild(opt);
  });

  if (trucks.length > 0) {
    fillTruckFields(trucks[0]);
    filterTrailerForTruck(trucks[0].unit);
  }
}

function filterTrailerForTruck(truckUnit) {
  if (!trailerUnitSelect || !currentCompany) return;
  trailerUnitSelect.innerHTML = "";

  const cleanTruckNum = truckUnit.replace(/[^\d]/g, "");

  currentMatchingTrailers = currentCompany.trailers.filter(tr => {
    const cleanAssigned = tr.assignedTruck.replace(/[^\d]/g, "");
    return cleanAssigned === cleanTruckNum || tr.assignedTruck === truckUnit;
  });

  const listToShow = currentMatchingTrailers.length > 0 ? currentMatchingTrailers : currentCompany.trailers;

  listToShow.forEach((t, index) => {
    const opt = document.createElement("option");
    opt.value = index;
    opt.innerText = `${t.unit}`;
    trailerUnitSelect.appendChild(opt);
  });

  if (listToShow.length > 0) {
    fillTrailerFields(listToShow[0]);
  }
}

function fillTruckFields(truck) {
  document.getElementById("truckMakeInput").value = truck.make;
  document.getElementById("truckYearInput").value = truck.year;
  document.getElementById("truckPlateInput").value = truck.plate;
  document.getElementById("truckStateInput").value = truck.state;
  document.getElementById("truckVinInput").value = truck.vin;
}

function fillTrailerFields(trailer) {
  document.getElementById("trailerMakeInput").value = trailer.make;
  document.getElementById("trailerYearInput").value = trailer.year;
  document.getElementById("trailerPlateInput").value = trailer.plate;
  document.getElementById("trailerStateInput").value = trailer.state;
  document.getElementById("trailerVinInput").value = trailer.vin;
  if (trailerLengthInput) {
    trailerLengthInput.value = "53' 0\"";
  }

  if (trailerTypeSelect) {
    trailerTypeSelect.value = trailer.type || "stepdeck";
  }
  calculateOverallHeight();
  calculateOverallLengthFromLoad();
}

if (companySelect) {
  companySelect.addEventListener("change", (e) => {
    selectCompany(e.target.value);
  });
}

if (truckUnitSelect) {
  truckUnitSelect.addEventListener("change", (e) => {
    if (currentCompany && currentCompany.trucks[e.target.value]) {
      const truck = currentCompany.trucks[e.target.value];
      fillTruckFields(truck);
      filterTrailerForTruck(truck.unit);
    }
  });
}

if (trailerUnitSelect) {
  trailerUnitSelect.addEventListener("change", (e) => {
    if (!currentCompany) return;
    const activeList = currentMatchingTrailers.length > 0 ? currentMatchingTrailers : currentCompany.trailers;
    if (activeList && activeList[e.target.value]) {
      fillTrailerFields(activeList[e.target.value]);
    }
  });
}

const runBtn = document.getElementById("runBtn");
if (runBtn) {
  runBtn.addEventListener("click", async () => {
    const status = document.getElementById("statusText");
    status.textContent = "Filling form...";

    const selectedTruck = currentCompany ? currentCompany.trucks[truckUnitSelect.value] : null;
    const activeList = currentMatchingTrailers.length > 0 ? currentMatchingTrailers : (currentCompany ? currentCompany.trailers : []);
    const selectedTrailer = activeList.length > 0 ? activeList[trailerUnitSelect.value] : null;

    const collectedAxles = [];
    for (let i = 1; i <= 13; i++) {
      const type = document.getElementById(`axleType${i}`)?.value.trim() || "";
      const wt = document.getElementById(`axleWt${i}`)?.value.trim() || "";
      const tires = document.getElementById(`axleTires${i}`)?.value.trim() || "";
      const tread = document.getElementById(`treadWidth${i}`)?.value.trim() || "";
      const rawGauge = document.getElementById(`axleGauge${i}`)?.value.trim() || "";
      const gauge = rawGauge ? formatFeetInches(rawGauge) : "";

      let spacing = "";
      if (i < 13) {
        const nextIdx = i + 1;
        const spInput = document.getElementById(`spacing${i}${nextIdx}`);
        const rawSp = spInput?.value.trim() || "";
        spacing = rawSp ? formatFeetInches(rawSp) : "";
      }

      collectedAxles.push({
        index: i,
        type: type,
        weight: wt,
        tires: tires,
        tread: tread,
        gauge: gauge,
        spacing: spacing
      });
    }

    const rawFront = document.getElementById("frontOverhangInput")?.value?.trim();
    const rawRear = document.getElementById("rearOverhangInput")?.value?.trim();
    const rawTrailerLen = document.getElementById("trailerLengthInput")?.value?.trim();

    const payload = {
      haulerName: document.getElementById("haulerNameInput").value.trim(),
      usdot: document.getElementById("usdotInput").value.trim(),
      account: document.getElementById("accountInput").value.trim(),
      contactName: document.getElementById("contactNameInput").value.trim(),
      contactPhone: document.getElementById("contactPhoneInput").value.trim(),
      contactEmail: document.getElementById("contactEmailInput").value.trim(),

      truckUnit: selectedTruck ? selectedTruck.unit : document.getElementById("truckUnitManualInput").value.trim(),
      truckMake: document.getElementById("truckMakeInput").value.trim(),
      truckYear: document.getElementById("truckYearInput").value.trim(),
      truckPlate: document.getElementById("truckPlateInput").value.trim(),
      truckState: document.getElementById("truckStateInput").value.trim(),
      truckVin: document.getElementById("truckVinInput").value.trim(),

      trailerUnit: selectedTrailer ? selectedTrailer.unit : document.getElementById("trailerUnitManualInput").value.trim(),
      trailerMake: document.getElementById("trailerMakeInput").value.trim(),
      trailerYear: document.getElementById("trailerYearInput").value.trim(),
      trailerPlate: document.getElementById("trailerPlateInput").value.trim(),
      trailerState: document.getElementById("trailerStateInput").value.trim(),
      trailerVin: document.getElementById("trailerVinInput").value.trim(),
      trailerLength: rawTrailerLen ? formatFeetInches(rawTrailerLen) : "53' 0\"",
      trailerType: trailerTypeSelect ? trailerTypeSelect.value : "stepdeck",

      commodity: document.getElementById("commodityDescInput")?.value?.trim() || "Machinery / Excavator",
      loadId: document.getElementById("loadIdInput")?.value?.trim() || "",
      loadWeight: document.getElementById("loadWeightInput")?.value?.trim() || "",
      loadLength: formatFeetInches(document.getElementById("loadLengthInput")?.value),
      loadWidth: formatFeetInches(document.getElementById("loadWidthInput")?.value),
      loadHeight: formatFeetInches(document.getElementById("loadHeightInput")?.value),

      overallLength: formatFeetInches(document.getElementById("overallLengthInput")?.value),
      overallWidth: formatFeetInches(document.getElementById("overallWidthInput")?.value),
      overallHeight: formatFeetInches(document.getElementById("overallHeightInput")?.value),
      frontOverhang: rawFront ? formatFeetInches(rawFront) : "0",
      rearOverhang: rawRear ? formatFeetInches(rawRear) : "0",
      grossWeight: document.getElementById("grossWeightInput")?.value?.trim() || "",

      totalAxles: document.getElementById("totalAxlesInput")?.value?.trim() || "5",
      axles: collectedAxles
    };

    // Keep the last locally-entered payload so the in-page review button also
    // works after a portal refresh. This data never leaves Chrome storage
    // unless the user explicitly runs autofill on an approved portal.
    try {
      await chrome.storage.local.set({ [LAST_PERMIT_STORAGE_KEY]: payload });
    } catch (error) {
      console.warn("Autofill payload could not be saved locally:", error);
    }

    chrome.runtime.sendMessage({ action: "AUTOFILL_ACTIVE_TAB", data: payload }, response => {
      if (chrome.runtime.lastError) {
        status.textContent = `Autofill error: ${chrome.runtime.lastError.message}`;
      } else if (response?.status === "ok") {
        const frameNote = response.framesFilled > 1 ? ` (${response.framesFilled} frames)` : "";
        status.textContent = `${response.portal}: ${response.matchedFields} fields filled${frameNote}. Review, then submit manually.`;
      } else {
        status.textContent = `Autofill error: ${response?.error || "No portal form responded."}`;
      }
    });
  });
}

// ==========================================
// Google Maps Directions Embed Logic
// ==========================================
const btnBuildRoute = document.getElementById("btnBuildRoute");
const btnOpenExternalMaps = document.getElementById("btnOpenExternalMaps");
const btnClearMap = document.getElementById("btnClearMap");
const mapOriginInput = document.getElementById("mapOriginInput");
const mapDestInput = document.getElementById("mapDestInput");
const gmapsRouteFrame = document.getElementById("gmapsRouteFrame");
const mapFrameEmptyNotice = document.getElementById("mapFrameEmptyNotice");

function cleanAddressText(str) {
  if (!str) return "";
  return str.replace(/&/g, "and").replace(/#/g, " ").trim();
}

if (btnBuildRoute) {
  btnBuildRoute.addEventListener("click", () => {
    const origin = cleanAddressText(mapOriginInput?.value);
    const dest = cleanAddressText(mapDestInput?.value);

    if (!origin || !dest) {
      alert("Iltimos, ikkala manzilni ham to'liq kiriting!");
      return;
    }

    if (gmapsRouteFrame) {
      if (mapFrameEmptyNotice) mapFrameEmptyNotice.style.display = "none";

      // Google Maps'ning iframe ichida ruxsat berilgan rasmiy directions URL formati
      const encodedOrigin = encodeURIComponent(origin);
      const encodedDest = encodeURIComponent(dest);
      
      const embedUrl = `https://www.google.com/maps/embed/v1/directions?key=&origin=${encodedOrigin}&destination=${encodedDest}`;
      
      // Iframe yuklanishi
      gmapsRouteFrame.src = `https://maps.google.com/maps?saddr=${encodedOrigin}&daddr=${encodedDest}&hl=en&geocode=&mra=ls&t=m&output=embed`;
    }
  });
}

if (btnOpenExternalMaps) {
  btnOpenExternalMaps.addEventListener("click", () => {
    const origin = encodeURIComponent(cleanAddressText(mapOriginInput?.value));
    const dest = encodeURIComponent(cleanAddressText(mapDestInput?.value));

    let url = "https://www.google.com/maps";
    if (origin && dest) {
      url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${dest}&travelmode=driving`;
    } else if (origin || dest) {
      url = `https://www.google.com/maps/search/?api=1&query=${origin || dest}`;
    }
    chrome.tabs.create({ url });
  });
}

if (btnClearMap) {
  btnClearMap.addEventListener("click", () => {
    if (mapOriginInput) mapOriginInput.value = "";
    if (mapDestInput) mapDestInput.value = "";
    if (gmapsRouteFrame) gmapsRouteFrame.src = "about:blank";
    if (mapFrameEmptyNotice) mapFrameEmptyNotice.style.display = "flex";
  });
}

// Boshlang'ich funksiyalarni xavfsiz chaqirish
try {
  initCompanies();
  restoreDraft();
} catch (e) {
  console.error("initCompanies xatosi:", e);
}

try {
  calculateOverallHeight();
  calculateOverallLengthFromLoad();
} catch (e) {
  console.error("calculate xatosi:", e);
}

