(() => {
  if (window.__PERMIT_AUTOFILL_CONTENT_LOADED__) {
    return;
  }
  window.__PERMIT_AUTOFILL_CONTENT_LOADED__ = true;

  let activePermitData = null;
  let deferredFillTimer = null;

  const PORTALS = Object.freeze({
    "alpass.dot.state.al.us": { label: "Alabama AL-ePASS", adapter: "bentley" },
    "txpros.txdmv.gov": { label: "Texas TxPROS", adapter: "texas" },
    "www.kyautomatedpermitsystem.com": { label: "Kentucky KAPS", adapter: "kentucky" },
    "lageauxpm.dotd.la.gov": { label: "Louisiana LaGeaux", adapter: "louisiana" },
    "ar.gotpermits.com": { label: "Arkansas ARPARS", adapter: "generic" },
    "ia.gotpermits.com": { label: "Iowa GotPermits", adapter: "generic" },
    "marylandone.gotpermits.com": { label: "Maryland One", adapter: "generic" },
    "mn.gotpermits.com": { label: "Minnesota GotPermits", adapter: "generic" },
    "ne.gotpermits.com": { label: "Nebraska GotPermits", adapter: "generic" },
    "wv.gotpermits.com": { label: "West Virginia GotPermits", adapter: "generic" }
  });

  // ==========================================
  // FLOATING BUTTON
  // ==========================================
  function injectFloatingButton() {
    if (document.getElementById("permit-autofill-side-btn")) return;

    const btn = document.createElement("button");
    btn.id = "permit-autofill-side-btn";
    btn.innerText = "⚡ AUTOFILL PERMIT";
    
    Object.assign(btn.style, {
      position: "fixed",
      top: "40%",
      right: "-36px",
      transform: "rotate(-90deg)",
      zIndex: "2147483647",
      backgroundColor: "#2563eb",
      color: "#ffffff",
      border: "none",
      borderRadius: "6px 6px 0 0",
      padding: "8px 18px",
      fontSize: "12px",
      fontWeight: "700",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      letterSpacing: "0.5px",
      boxShadow: "0 -2px 10px rgba(0, 0, 0, 0.2)",
      cursor: "pointer",
      transition: "all 0.2s ease",
      userSelect: "none"
    });

    btn.addEventListener("mouseenter", () => {
      btn.style.backgroundColor = "#1d4ed8";
      btn.style.right = "-30px";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.backgroundColor = "#2563eb";
      btn.style.right = "-36px";
    });

    btn.addEventListener("click", () => {
      if (!activePermitData) {
        btn.innerText = "⚠️ OPEN PANEL FIRST";
        btn.style.backgroundColor = "#d97706";
        setTimeout(() => {
          btn.innerText = "⚡ AUTOFILL PERMIT";
          btn.style.backgroundColor = "#2563eb";
        }, 2000);
        return;
      }
      const result = routeAndFillState(activePermitData);
      btn.innerText = `✓ FILLED (${result.matchedFields}) · REVIEW`;
      btn.style.backgroundColor = "#16a34a";

      setTimeout(() => {
        btn.innerText = "⚡ AUTOFILL PERMIT";
        btn.style.backgroundColor = "#2563eb";
      }, 2500);
    });

    document.body.appendChild(btn);
  }

  if (document.body) {
    injectFloatingButton();
  } else {
    window.addEventListener("DOMContentLoaded", injectFloatingButton);
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "AUTOFILL" && request.data) {
      activePermitData = request.data;
      const result = routeAndFillState(request.data);
      scheduleDeferredFill(request.data);
      sendResponse({ status: "ok", ...result });
    }
  });

  function scheduleDeferredFill(data) {
    if (!document.body || !window.MutationObserver) return;
    clearTimeout(deferredFillTimer);
    let attempts = 0;
    const observer = new MutationObserver(() => {
      clearTimeout(deferredFillTimer);
      deferredFillTimer = setTimeout(() => {
        if (++attempts > 3) {
          observer.disconnect();
          return;
        }
        const result = routeAndFillState(data);
        console.debug("[Permit Autofill] Deferred fill result", result);
      }, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 5000);
  }

  // ==========================================
  // Portal adapter router. Never submits an application or payment.
  // ==========================================
  function routeAndFillState(data) {
    if (!data) return { matchedFields: 0, portal: "Unknown portal", adapter: "none" };
    const host = window.location.hostname.toLowerCase();
    const bodyTxt = document.body ? document.body.innerText.toLowerCase() : "";
    const portal = PORTALS[host] || { label: host, adapter: "generic" };
    let matchedFields = 0;

    document.querySelectorAll("[data-autofilled]").forEach(el => {
      delete el.dataset.autofilled;
    });

    // 1. TEXAS (TxPROS)
    if (host.includes("txpros.txdmv.gov") || bodyTxt.includes("txpros") || bodyTxt.includes("texas department of motor vehicles")) {
      matchedFields = fillTexasTxPros(data);
    } else if (portal.adapter === "kentucky" || bodyTxt.includes("kentucky automated permit system")) {
      matchedFields = fillKentuckyKaps(data) + fillKentuckyKapsAxles(data);
    } else if (portal.adapter === "bentley" || host.includes("superload") || bodyTxt.includes("bentley systems") || bodyTxt.includes("alabama department of transportation")) {
      matchedFields = fillBentleyAlabama(data) + fillBentleySuperloadStep2(data) + fillBentleyDimensionsRow(data);
    } else if (portal.adapter === "louisiana") {
      matchedFields = fillLouisianaLaGeaux(data) + fillUniversalCommonFields(data);
    } else {
      matchedFields = fillGenericState(data);
    }
    if (portal.adapter !== "generic" && portal.adapter !== "louisiana") {
      matchedFields += fillUniversalVehicleInfo(data);
      matchedFields += fillUniversalCommonFields(data);
    }
    const result = { matchedFields, portal: portal.label, adapter: portal.adapter };
    console.debug("[Permit Autofill] Fill result", result);
    return result;
  }

  // =========================================================
  // 1-SHTAT: TEXAS (TxPROS) MODULI
  // =========================================================
  function fillTexasTxPros(data) {
    let count = 0;

    // Checkbox: Non-divisible
    const checkboxes = Array.from(document.querySelectorAll("input[type='checkbox']"));
    const nonDivChk = checkboxes.find(c => {
      const pTxt = cleanText(c.closest("tr, td, div, label")?.innerText || "");
      return pTxt.includes("non divisible") || pTxt.includes("single item");
    });
    if (nonDivChk && !nonDivChk.checked) {
      nonDivChk.click();
      nonDivChk.dataset.autofilled = "true";
      count++;
    }

    // Industry
    const allSelects = Array.from(document.querySelectorAll("select")).filter(s => s.offsetParent !== null);
    const industrySelect = allSelects.find(s => cleanText((s.closest("td, tr")?.innerText || "") + s.id + s.name).includes("industry"));
    if (industrySelect) {
      setNativeValue(industrySelect, "Other") || setNativeValue(industrySelect, "Machinery");
      industrySelect.dataset.autofilled = "true";
      count++;
    }

    // Load Description & Describe
    const allInputs = Array.from(document.querySelectorAll("input[type='text'], input:not([type]), textarea")).filter(i => i.offsetParent !== null);
    allInputs.forEach(inp => {
      const nameOrId = (inp.name + " " + inp.id + " " + (inp.closest("td")?.innerText || "")).toLowerCase();
      if (nameOrId.includes("loaddesc") || nameOrId.includes("describe")) {
        if (data.commodity && !inp.dataset.autofilled) {
          if (setNativeValue(inp, data.commodity)) {
            inp.dataset.autofilled = "true";
            count++;
          }
        }
      }
    });

    // Vehicles Table: Power Unit va Trailer 1 qatorlarini aniq DOM tuzilishi orqali topamiz
    const allRows = Array.from(document.querySelectorAll("tr")).filter(r => r.offsetParent !== null);

    // 1) Power Unit Qatori: Ko'k '+' tugmasi bor yoki 'Add Power Unit' sarlavhasi ostidagi 1-faol qator
    const truckRow = allRows.find(r => {
      const txt = cleanText(r.innerText);
      const textInps = r.querySelectorAll("input[type='text'], input:not([type])");
      const hasPlus = r.querySelector("input[src*='add'], input[value*='+'], a[id*='Add'], img[src*='add']") || txt.includes("add power unit");
      return (hasPlus || textInps.length >= 4) && !txt.includes("trailer 1") && r.querySelector("select");
    });

    // 2) Trailer 1 Qatori: O'ng tomonida 'Trailer 1' matni yoki qizil 'X' bo'lgan qator
    const trailerRow = allRows.find(r => {
      const txt = cleanText(r.innerText);
      const textInps = r.querySelectorAll("input[type='text'], input:not([type])");
      return (txt.includes("trailer 1") || txt.includes("trailer")) && textInps.length >= 3;
    });

    // Power Unit (Truck) to'ldirish
    if (truckRow) {
      const tInps = Array.from(truckRow.querySelectorAll("input[type='text'], input:not([type])"));
      const tSels = Array.from(truckRow.querySelectorAll("select"));

      // Ustunlar: Unit/Rig [0] | Year [1] | VIN [2] | License [3] | State [4]
      if (tInps[0] && data.truckUnit) { setNativeValue(tInps[0], data.truckUnit); tInps[0].dataset.autofilled = "true"; count++; }
      if (tInps[1] && data.truckYear) { setNativeValue(tInps[1], data.truckYear); tInps[1].dataset.autofilled = "true"; count++; }

      const makeSel = tSels.find(s => s !== tSels[0]) || tSels[tSels.length - 1];
      if (makeSel && data.truckMake) { setNativeValue(makeSel, data.truckMake); makeSel.dataset.autofilled = "true"; count++; }

      if (tInps[2] && data.truckVin) { setNativeValue(tInps[2], data.truckVin); tInps[2].dataset.autofilled = "true"; count++; }
      if (tInps[3] && data.truckPlate) { setNativeValue(tInps[3], data.truckPlate); tInps[3].dataset.autofilled = "true"; count++; }

      const stateEl = tInps[4] || truckRow.querySelector("select:last-of-type");
      if (stateEl && data.truckState) { setNativeValue(stateEl, data.truckState); stateEl.dataset.autofilled = "true"; count++; }
    }

    // Trailer 1 to'ldirish
    if (trailerRow) {
      const trInps = Array.from(trailerRow.querySelectorAll("input[type='text'], input:not([type])"));
      const trSels = Array.from(trailerRow.querySelectorAll("select"));

      if (trInps[0] && data.trailerUnit) { setNativeValue(trInps[0], data.trailerUnit); trInps[0].dataset.autofilled = "true"; count++; }
      if (trInps[1] && data.trailerYear) { setNativeValue(trInps[1], data.trailerYear); trInps[1].dataset.autofilled = "true"; count++; }

      const trMakeSel = trSels.find(s => s !== trSels[0]);
      let vIdx = 2;
      if (trMakeSel && data.trailerMake) {
        setNativeValue(trMakeSel, data.trailerMake);
        trMakeSel.dataset.autofilled = "true";
        count++;
      } else if (trInps.length >= 6 && data.trailerMake) {
        setNativeValue(trInps[2], data.trailerMake);
        trInps[2].dataset.autofilled = "true";
        vIdx = 3;
        count++;
      }

      if (trInps[vIdx] && data.trailerVin) { setNativeValue(trInps[vIdx], data.trailerVin); trInps[vIdx].dataset.autofilled = "true"; count++; }
      if (trInps[vIdx + 1] && data.trailerPlate) { setNativeValue(trInps[vIdx + 1], data.trailerPlate); trInps[vIdx + 1].dataset.autofilled = "true"; count++; }

      const trState = trInps[vIdx + 2] || trailerRow.querySelector("select:last-of-type");
      if (trState && data.trailerState) { setNativeValue(trState, data.trailerState); trState.dataset.autofilled = "true"; count++; }
    }

    // Loaded Dimensions & Overhangs (Aniq 2-ustunli TxPROS matritsasi)
    allRows.forEach(r => {
      const txt = cleanText(r.innerText);
      const inps = Array.from(r.querySelectorAll("input[type='text'], input:not([type])")).filter(i => i.type !== "button" && i.type !== "submit");

      if (txt.includes("total width")) {
        const w = parseFeetInches(data.overallWidth);
        if (inps[0] && inps[1]) { setNativeValue(inps[0], w.feet); setNativeValue(inps[1], w.inches || "0"); count += 2; }
        if (inps[2] && inps[3]) {
          const fo = parseFeetInches(data.frontOverhang || "0");
          setNativeValue(inps[2], fo.feet || "0"); setNativeValue(inps[3], fo.inches || "0"); count += 2;
        }
      } else if (txt.includes("total height")) {
        const h = parseFeetInches(data.overallHeight);
        if (inps[0] && inps[1]) { setNativeValue(inps[0], h.feet); setNativeValue(inps[1], h.inches || "0"); count += 2; }
        if (inps[2] && inps[3]) {
          const ro = parseFeetInches(data.rearOverhang || "0");
          setNativeValue(inps[2], ro.feet || "0"); setNativeValue(inps[3], ro.inches || "0"); count += 2;
        }
      } else if (txt.includes("total length") && !txt.includes("trailer")) {
        const l = parseFeetInches(data.overallLength);
        if (inps[0] && inps[1]) { setNativeValue(inps[0], l.feet); setNativeValue(inps[1], l.inches || "0"); count += 2; }
      } else if (txt.includes("trailer length")) {
        const tl = parseFeetInches(data.trailerLength || "53' 0\"");
        if (inps[0] && inps[1]) { setNativeValue(inps[0], tl.feet); setNativeValue(inps[1], tl.inches || "0"); count += 2; }
      }
    });

    return count;
  }

  // =========================================================
  // 2-SHTAT: KENTUCKY (KAPS) MODULI
  // =========================================================
  function fillKentuckyKaps(data) {
    let count = 0;
    const allSelects = Array.from(document.querySelectorAll("select")).filter(s => s.offsetParent !== null);
    const descSelect = allSelects.find(s => cleanText(getElementFullContext(s)).includes("load description"));

    if (descSelect) {
      setNativeValue(descSelect, "Other") || setNativeValue(descSelect, "Machinery");
      descSelect.dataset.autofilled = "true";
      count++;

      const container = descSelect.closest(".form-group, .row, div, td")?.parentElement || document;
      const descInput = container.querySelector("input[placeholder*='Load Description'], input[id*='LoadDescriptionText'], input[name*='LoadDescriptionText'], input[type='text']:not([data-autofilled])");
      if (descInput && data.commodity) {
        if (setNativeValue(descInput, data.commodity)) {
          descInput.dataset.autofilled = "true";
          count++;
        }
      }
    }

    const dimTargets = [
      { key: "height", val: data.overallHeight },
      { key: "width", val: data.overallWidth },
      { key: "length", val: data.overallLength },
      { key: "front overhang", val: data.frontOverhang || "0" },
      { key: "rear overhang", val: data.rearOverhang || "0" }
    ];

    const allContainers = Array.from(document.querySelectorAll("div.form-group, div.row, tr, div")).filter(el => el.offsetParent !== null);
    dimTargets.forEach(t => {
      const matchedBox = allContainers.find(box => {
        const directTxt = cleanText(box.querySelector("label, strong, b, span")?.innerText || "");
        return (directTxt.startsWith(t.key) || directTxt === t.key) && box.innerText.includes("ft");
      });

      if (matchedBox) {
        const boxInputs = Array.from(matchedBox.querySelectorAll("input:not([type='hidden'])")).filter(i => i.offsetParent !== null);
        if (boxInputs.length >= 2) {
          const { feet, inches } = parseFeetInches(t.val);
          if (setNativeValue(boxInputs[0], feet)) { boxInputs[0].dataset.autofilled = "true"; count++; }
          if (setNativeValue(boxInputs[1], inches || "0")) { boxInputs[1].dataset.autofilled = "true"; count++; }
        }
      }
    });

    const allControls = Array.from(document.querySelectorAll("input:not([type='hidden']), select")).filter(el => el.offsetParent !== null && !el.dataset.autofilled);
    allControls.forEach(ctrl => {
      const context = getElementFullContext(ctrl);
      if (matches(context, ["unit number", "unit #", "unitno"]) && !matches(context, ["inventory"])) {
        if (data.truckUnit && setNativeValue(ctrl, data.truckUnit)) { ctrl.dataset.autofilled = "true"; count++; }
      } else if (matches(context, ["year"]) && !matches(context, ["load", "axle"])) {
        if (data.truckYear && setNativeValue(ctrl, data.truckYear)) { ctrl.dataset.autofilled = "true"; count++; }
      } else if (matches(context, ["make"]) && !matches(context, ["load", "axle"])) {
        if (data.truckMake && setNativeValue(ctrl, data.truckMake)) { ctrl.dataset.autofilled = "true"; count++; }
      } else if (matches(context, ["vin"])) {
        if (data.truckVin && setNativeValue(ctrl, data.truckVin)) { ctrl.dataset.autofilled = "true"; count++; }
      } else if (matches(context, ["plate", "license plate"])) {
        if (data.truckPlate && setNativeValue(ctrl, data.truckPlate)) { ctrl.dataset.autofilled = "true"; count++; }
      } else if (matches(context, ["state"]) && !matches(context, ["inventory"])) {
        if (data.truckState && setNativeValue(ctrl, data.truckState)) { ctrl.dataset.autofilled = "true"; count++; }
      }
    });

    return count;
  }

  function fillKentuckyKapsAxles(data) {
    let count = 0;
    if (!data.axles || !Array.isArray(data.axles)) return 0;

    const countInputs = Array.from(document.querySelectorAll("input:not([type='hidden'])")).filter(i => {
      if (!i.offsetParent) return false;
      const ctx = getElementFullContext(i);
      return ctx.includes("axle count") || ctx.includes("axlecount");
    });

    const targetAxlesCount = (data.totalAxles || (data.axles ? data.axles.length : 5)).toString();
    if (countInputs.length > 0 && countInputs[0].value !== targetAxlesCount) {
      setNativeValue(countInputs[0], targetAxlesCount);
      count++;
    }

    for (let i = 0; i < data.axles.length; i++) {
      const axle = data.axles[i];
      const axleNum = i + 1;
      const allDivs = Array.from(document.querySelectorAll("div, tr")).filter(el => el.offsetParent !== null);
      const row = allDivs.find(el => {
        const directTxt = cleanText(el.innerText);
        return directTxt.startsWith(`axle ${axleNum}`) && el.querySelectorAll("input:not([type='hidden'])").length >= 1;
      });

      if (!row) continue;
      const inputs = Array.from(row.querySelectorAll("input:not([type='hidden'])")).filter(inp => inp.offsetParent !== null);
      const selects = Array.from(row.querySelectorAll("select")).filter(s => s.offsetParent !== null);

      if (axleNum === 1) {
        if (inputs[0] && axle.weight) { setNativeValue(inputs[0], sanitizeNumber(axle.weight)); count++; }
        if (inputs[2]) { setNativeValue(inputs[2], "0"); count++; }
        if (selects[0] && axle.tires) { setNativeValue(selects[0], axle.tires); count++; }
        if (selects[1] && axle.tread) { setNativeValue(selects[1], axle.tread); count++; }
      } else {
        const prevAxle = data.axles[i - 1];
        const spStr = prevAxle ? prevAxle.spacing : axle.spacing;
        const { feet: spFt, inches: spIn } = parseFeetInches(spStr);

        if (inputs[0]) { setNativeValue(inputs[0], spFt); count++; }
        if (inputs[1]) { setNativeValue(inputs[1], spIn || "0"); count++; }
        if (inputs[2] && axle.weight) { setNativeValue(inputs[2], sanitizeNumber(axle.weight)); count++; }
        if (inputs[4]) { setNativeValue(inputs[4], "0"); count++; }
        if (selects[0] && axle.tires) { setNativeValue(selects[0], axle.tires); count++; }
        if (selects[1] && axle.tread) { setNativeValue(selects[1], axle.tread); count++; }
      }
    }
    return count;
  }

  // =========================================================
  // 3-SHTATLAR GURUHI: BENTLEY PLATFORMASI (ALABAMA / SUPERLOAD)
  // =========================================================
  function fillBentleyAlabama(data) {
    let count = 0;
    const lookupBtn = Array.from(document.querySelectorAll("input[type='button'], input[type='submit'], button"))
      .find(b => cleanText(b.value || b.innerText || "").includes("lookup"));

    const allSelects = Array.from(document.querySelectorAll("select")).filter(s => s.offsetParent !== null);
    const lookupSelect = allSelects.find(s => cleanText(s.innerText || "").includes("anywhere in the name"));

    if (lookupSelect) {
      setNativeValue(lookupSelect, "Anywhere in the Name");
      lookupSelect.dataset.autofilled = "true";
    }

    const searchRow = lookupBtn?.closest("tr") || lookupSelect?.closest("tr");
    if (searchRow) {
      const nameInput = searchRow.querySelector("input[type='text'], input:not([type])");
      if (nameInput && data.haulerName && !nameInput.dataset.autofilled) {
        if (setNativeValue(nameInput, data.haulerName)) {
          nameInput.dataset.autofilled = "true";
          count++;
        }
      }
    }

    const allInputs = Array.from(document.querySelectorAll("input[type='text'], input:not([type])")).filter(i => i.offsetParent !== null && !i.dataset.autofilled);
    allInputs.forEach(inp => {
      const parentTxt = cleanText(inp.closest("td, tr, div")?.innerText || "");
      if (parentTxt.includes("permit for hauler with usdot") || parentTxt.includes("usdot")) {
        if (data.usdot && setNativeValue(inp, data.usdot)) {
          inp.dataset.autofilled = "true";
          count++;
        }
      }
    });

    return count;
  }

  function fillBentleySuperloadStep2(data) {
    let count = 0;
    const allRows = Array.from(document.querySelectorAll("tr")).filter(r => r.offsetParent !== null);

    for (let r of allRows) {
      const rText = cleanText(r.innerText);
      if (rText.includes("license number") && !rText.includes("overall vehicle dimensions")) {
        const textInputs = Array.from(r.querySelectorAll("input[type='text'], input:not([type])")).filter(inp => inp.offsetParent !== null);
        if (textInputs.length >= 2) {
          if (data.truckPlate) { setNativeValue(textInputs[0], data.truckPlate); count++; }
          if (data.trailerPlate) { setNativeValue(textInputs[1], data.trailerPlate); count++; }
        }
      }
      if (rText.includes("state") && r.querySelectorAll("select").length >= 2) {
        const selects = Array.from(r.querySelectorAll("select")).filter(s => s.offsetParent !== null);
        if (selects.length >= 2) {
          if (data.truckState) { setNativeValue(selects[0], data.truckState); count++; }
          if (data.trailerState) { setNativeValue(selects[1], data.trailerState); count++; }
        }
      }
    }
    return count;
  }

  function fillBentleyDimensionsRow(data) {
    let count = 0;
    const allRows = Array.from(document.querySelectorAll("tr")).filter(r => r.offsetParent !== null);

    for (let i = 0; i < allRows.length - 1; i++) {
      const headerRow = allRows[i];
      const headerText = cleanText(headerRow.innerText);

      if (headerText.includes("width") && headerText.includes("height") && (headerText.includes("length") || headerText.includes("overhang"))) {
        let inputRow = allRows[i + 1];
        if (inputRow && inputRow.querySelectorAll("input").length === 0 && allRows[i + 2]) {
          inputRow = allRows[i + 2];
        }

        if (inputRow) {
          const inputs = Array.from(inputRow.querySelectorAll("input:not([type='hidden'])"));
          if (inputs.length >= 6) {
            if (data.overallWidth) { setNativeValue(inputs[0], data.overallWidth); count++; }
            if (data.overallHeight) { setNativeValue(inputs[1], data.overallHeight); count++; }
            if (data.trailerLength) { setNativeValue(inputs[2], data.trailerLength); count++; }
            if (data.overallLength) { setNativeValue(inputs[3], data.overallLength); count++; }
            setNativeValue(inputs[4], data.frontOverhang || "0");
            setNativeValue(inputs[5], data.rearOverhang || "0");
            count += 2;
          }
        }
      }
    }
    return count;
  }

  // =========================================================
  // 4. LOUISIANA (LaGeaux / SafeHaul)
  // =========================================================
  function fillLouisianaLaGeaux(data) {
    let count = 0;
    // LaGeaux is an ExtJS application, not a table form.  Its visual element
    // IDs change each visit, but its data-selenium-id names are stable.
    // This also deliberately excludes the pre-saved fleet pickers: selecting
    // one can replace the data the dispatcher is entering manually.
    const fillControl = (seleniumId, value) => {
      if (value === undefined || value === null || value === "") return;
      const control = document.querySelector(
        `[data-selenium-id="${seleniumId}"] input:not([type='hidden']):not([type='checkbox']), ` +
        `[data-selenium-id="${seleniumId}"] textarea, ` +
        `[data-selenium-id="${seleniumId}"] select`
      );
      if (!control || control.disabled || control.dataset.autofilled === "true") return;
      if (setNativeValue(control, value)) {
        control.dataset.autofilled = "true";
        count++;
      }
    };

    fillControl("text-apply-general-usdotNo", data.usdot);
    fillControl("combo-apply-general-commodity", data.commodity);
    fillControl("text-apply-oversize-grossweight", sanitizeNumber(data.grossWeight));
    fillControl("text-apply-oversize-height", data.overallHeight);
    fillControl("text-apply-oversize-width", data.overallWidth);
    fillControl("text-apply-oversize-trailerlength", data.trailerLength);
    fillControl("text-apply-oversize-totalLength", data.overallLength);
    fillControl("text-apply-oversize-frontOverhang", data.frontOverhang || "0");
    fillControl("text-apply-oversize-rearOverhang", data.rearOverhang || "0");

    fillControl("text-apply-truck-year", data.truckYear);
    fillControl("combo-apply-truck-make", data.truckMake);
    fillControl("text-apply-truck-tagNo", data.truckPlate);
    fillControl("combo-apply-truck-tagState", data.truckState);
    fillControl("text-apply-truck-vin", data.truckVin);
    fillControl("text-apply-truck-truckFleetUnit", data.truckUnit);

    fillControl("text-apply-trailer-year", data.trailerYear);
    fillControl("combo-apply-trailer-make", data.trailerMake);
    fillControl("text-apply-trailer-tagNo", data.trailerPlate);
    fillControl("combo-apply-trailer-tagState", data.trailerState);
    fillControl("text-apply-trailer-vin", data.trailerVin);
    fillControl("text-apply-trailer-trailerFleetUnit", data.trailerUnit);
    return count;
  }

  // =========================================================
  // 5. BOSHQA BARCHA SHTATLAR UCHUN STANDARD GENERIC REJIM
  // =========================================================
  function fillGenericState(data) {
    let filledCount = 0;

    // Split Dimensions
    filledCount += fillUniversalSplitDimensions(data);
    // Axles
    filledCount += fillUniversalAxles(data);
    // Power unit and trailer details
    filledCount += fillUniversalVehicleInfo(data);

    filledCount += fillUniversalCommonFields(data);
    return filledCount;
  }

  function fillUniversalCommonFields(data) {
    let count = 0;
    const allInputs = Array.from(document.querySelectorAll("input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='checkbox']):not([type='radio']):not([type='file']), select, textarea"))
      .filter(el => el.offsetParent !== null && !el.dataset.autofilled);

    const universalRules = [
      { keys: ["hauler name", "carrier name", "company name", "applicant name"], val: data.haulerName },
      { keys: ["usdot", "us dot", "dot number", "dot #"], val: data.usdot },
      { keys: ["customer account", "carrier account", "account number", "account #"], val: data.account },
      { keys: ["load weight", "cargo weight"], val: sanitizeNumber(data.loadWeight) },
      { keys: ["gross weight", "total weight", "gvw"], val: sanitizeNumber(data.grossWeight) },
      { keys: ["contact name", "contact person"], val: data.contactName },
      { keys: ["phone number", "telephone"], val: data.contactPhone },
      { keys: ["contact email", "email"], val: data.contactEmail }
    ];

    allInputs.forEach(el => {
      if (el.dataset.autofilled === "true") return;
      const context = getElementFullContext(el);

      if (matches(context, ["route", "origin", "destination", "axle", "count", "spacing"])) return;

      for (const rule of universalRules) {
        if (!rule.val) continue;
        if (matches(context, rule.keys)) {
          if (setNativeValue(el, rule.val)) {
            el.dataset.autofilled = "true";
            count++;
            break;
          }
        }
      }
    });

    return count;
  }

  function fillUniversalVehicleInfo(data) {
    let count = 0;
    const controls = Array.from(document.querySelectorAll("input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='checkbox']):not([type='radio']):not([type='file']), select"))
      .filter(el => el.offsetParent !== null && !el.dataset.autofilled);

    controls.forEach(el => {
      const context = getElementFullContext(el);
      const vehicleContext = cleanText(`${context} ${el.closest("tr, fieldset, section, .form-group, .row, td")?.innerText || ""}`);
      const isTrailer = matches(vehicleContext, ["trailer", "semi trailer"]);
      const isTruck = !isTrailer && matches(vehicleContext, ["power unit", "truck", "tractor", "tow vehicle"]);
      if (!isTruck && !isTrailer) return;

      const vehicle = isTrailer
        ? { unit: data.trailerUnit, make: data.trailerMake, year: data.trailerYear, vin: data.trailerVin, plate: data.trailerPlate, state: data.trailerState }
        : { unit: data.truckUnit, make: data.truckMake, year: data.truckYear, vin: data.truckVin, plate: data.truckPlate, state: data.truckState };
      const rules = [
        { keys: ["unit number", "unit no", "unit #", "vehicle number", "equipment number"], val: vehicle.unit },
        { keys: ["model year", "vehicle year", "year"], val: vehicle.year },
        { keys: ["vehicle make", "manufacturer", "make"], val: vehicle.make },
        { keys: ["vehicle identification number", "vin"], val: vehicle.vin },
        { keys: ["license plate", "plate number", "plate #", "tag number"], val: vehicle.plate },
        { keys: ["plate state", "license state", "registration state", "state"], val: vehicle.state }
      ];

      for (const rule of rules) {
        if (rule.val && matches(context, rule.keys) && setNativeValue(el, rule.val)) {
          el.dataset.autofilled = "true";
          count++;
          break;
        }
      }
    });
    return count;
  }

  function fillUniversalSplitDimensions(data) {
    let count = 0;
    const dimensionDefs = [
      { keys: ["width", "overall width"], val: data.overallWidth },
      { keys: ["height", "overall height"], val: data.overallHeight },
      { keys: ["trailer length"], val: data.trailerLength || "53' 0\"" },
      { keys: ["length", "overall length"], val: data.overallLength },
      { keys: ["front overhang"], val: data.frontOverhang || "0" },
      { keys: ["rear overhang"], val: data.rearOverhang || "0" }
    ];

    const containers = Array.from(document.querySelectorAll("tr, div.form-group, div.row, td"));
    dimensionDefs.forEach(def => {
      for (let container of containers) {
        const text = cleanText(container.innerText);
        if (matches(text, def.keys) && text.length < 70) {
          const visibleInputs = Array.from(container.querySelectorAll("input:not([type='hidden'])"))
            .filter(inp => inp.offsetParent !== null && !inp.dataset.autofilled);

          if (visibleInputs.length >= 2) {
            const { feet, inches } = parseFeetInches(def.val);
            if (setNativeValue(visibleInputs[0], feet)) { visibleInputs[0].dataset.autofilled = "true"; count++; }
            if (setNativeValue(visibleInputs[1], inches || "0")) { visibleInputs[1].dataset.autofilled = "true"; count++; }
            break;
          }
        }
      }
    });

    return count;
  }

  function fillUniversalAxles(data) {
    let count = 0;
    if (!data.axles || !Array.isArray(data.axles)) return count;

    const allRows = Array.from(document.querySelectorAll("tr")).filter(r => r.offsetParent !== null);
    allRows.forEach(row => {
      const rowText = cleanText(row.innerText);
      const rowInputs = Array.from(row.querySelectorAll("input:not([type='hidden'])")).filter(el => el.offsetParent !== null && !el.dataset.autofilled);
      const rowSelects = Array.from(row.querySelectorAll("select")).filter(el => el.offsetParent !== null && !el.dataset.autofilled);

      if (matches(rowText, ["axle type", "axle description"])) {
        rowSelects.forEach((sel, idx) => {
          if (data.axles[idx]?.type) { setNativeValue(sel, data.axles[idx].type); count++; }
        });
      } else if (matches(rowText, ["axle weight", "weight per axle"])) {
        rowInputs.forEach((input, idx) => {
          if (data.axles[idx]?.weight) { setNativeValue(input, sanitizeNumber(data.axles[idx].weight)); count++; }
        });
      } else if (matches(rowText, ["number of tires", "# of tires"])) {
        rowInputs.forEach((input, idx) => {
          if (data.axles[idx]?.tires) { setNativeValue(input, sanitizeNumber(data.axles[idx].tires)); count++; }
        });
      } else if (matches(rowText, ["axle spacing", "spacing"])) {
        rowInputs.forEach((input, idx) => {
          if (data.axles[idx]?.spacing) { setNativeValue(input, data.axles[idx].spacing); count++; }
        });
      }
    });

    return count;
  }

  // ==========================================
  // YORDAMCHI FUNKSIYALAR
  // ==========================================
  function getElementFullContext(el) {
    const rawLabel = getDirectLabel(el);
    const attributes = [el.id, el.name, el.placeholder, el.getAttribute("aria-label"), el.title].filter(Boolean).join(" ");
    const container = el.closest("tr, td, fieldset, .form-group, .field, [role='group']");
    const containerText = container?.innerText || "";
    // A broad page-level div can contain both truck and trailer labels, which
    // would cause the wrong vehicle data to be selected.
    const controlCount = container?.querySelectorAll("input, select, textarea").length || 0;
    const nearbyText = containerText.length <= 500 && controlCount <= 1 ? containerText : "";
    return cleanText(`${rawLabel} ${attributes} ${nearbyText}`);
  }

  function getDirectLabel(el) {
    const labels = el.labels ? Array.from(el.labels) : [];
    const associatedLabel = labels.find(label => label.innerText?.trim());
    if (associatedLabel) return associatedLabel.innerText.trim();

    if (el.previousElementSibling && el.previousElementSibling.innerText) {
      const txt = el.previousElementSibling.innerText.trim();
      if (txt.length > 0 && txt.length < 60) return txt;
    }

    const group = el.closest("td, fieldset, .form-group, .field, [role='group']");
    const groupLabels = group ? Array.from(group.querySelectorAll("label")).filter(label => label.innerText?.trim()) : [];
    if (groupLabels.length === 1) return groupLabels[0].innerText.trim();
    return "";
  }

  function parseFeetInches(str) {
    if (!str) return { feet: "0", inches: "0" };
    const s = str.toString().trim();
    const matchApos = s.match(/(\d+)\s*['’]\s*(\d+)?/);
    if (matchApos) {
      return { feet: matchApos[1] || "0", inches: matchApos[2] || "0" };
    }
    const numOnly = s.match(/\d+/);
    return { feet: numOnly ? numOnly[0] : s, inches: "0" };
  }

  function cleanText(text) {
    if (!text) return "";
    return text.toLowerCase().replace(/[*:#_\-\/]/g, " ").replace(/\s+/g, " ").trim();
  }

  function matches(targetText, phrases) {
    return phrases.some(p => targetText.includes(cleanText(p)));
  }

  function sanitizeNumber(val) {
    if (!val) return "";
    return val.toString().replace(/[^\d]/g, "");
  }

  function setNativeValue(element, value) {
    if (value === undefined || value === null) return false;

    if (element.tagName === "SELECT") {
      let matched = false;
      const cleanVal = value.toString().toLowerCase().trim();

      for (let opt of element.options) {
        const optVal = opt.value.toLowerCase().trim();
        const optTxt = opt.text.toLowerCase().trim();
        if (optVal === cleanVal || optTxt === cleanVal) {
          element.value = opt.value;
          matched = true;
          break;
        }
      }

      if (!matched) {
        for (let opt of element.options) {
          const optVal = opt.value.toLowerCase().trim();
          const optTxt = opt.text.toLowerCase().trim();
          if (optVal.includes(cleanVal) || optTxt.includes(cleanVal)) {
            element.value = opt.value;
            matched = true;
            break;
          }
        }
      }

      if (!matched) return false;
    } else {
      element.focus();
      const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
      const prototype = Object.getPrototypeOf(element);
      const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

      if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
        prototypeValueSetter.call(element, value);
      } else if (valueSetter) {
        valueSetter.call(element, value);
      } else {
        element.value = value;
      }
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  }
})();
