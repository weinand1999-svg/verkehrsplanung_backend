import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ------------------------------------------------------
//  Hilfsfunktionen
// ------------------------------------------------------

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(value) {
  if (value === true) return true;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "ja" || v === "yes" || v === "true" || v === "on" || v === "1";
  }
  return false;
}

// ------------------------------------------------------
//  Basis-Regeln + Standard-spezifische Regelsets
//  (vereinfachte, technische Ableitungen, anpassbar)
// ------------------------------------------------------

const BASE_RULES = {
  sidewalk_min_m: 1.5,          // absolute Mindestbreite Gehweg
  sidewalk_target_m: 1.8,       // sinnvolle Mindestbreite
  lane_min_m: 2.75,             // Mindestbreite Fahrstreifen
  lane_regular_m: 3.25,         // Regelbreite Fahrstreifen innerorts
  cycle_min_m: 1.5,             // generelles Minimum für Radführung
  parking_parallel_min_m: 2.0,
  parking_schraeg_min_m: 2.5,
  parking_quer_min_m: 5.0
};

// RASt – verstärkt Gehweg, Fahrstreifen, Parken
const RAST_RULES = {
  sidewalk_min_m: 1.8,
  lane_min_m: 2.75,
  lane_regular_m: 3.25,
  parking_parallel_min_m: 2.0,
  parking_schraeg_min_m: 2.5,
  parking_quer_min_m: 5.0
};

// ERA – verstärkt Radverkehr
const ERA_RULES = {
  cycle_schutz_min_m: 1.5,
  cycle_radfahr_min_m: 1.85,
  cycle_baulich_min_m: 2.0
};

// EFA – stärkerer Fokus auf Gehkomfort
const EFA_RULES = {
  sidewalk_min_m: 1.8,
  sidewalk_target_m: 2.5
};

// StVO – hier eher Hinweise zu engen Fahrstreifen
const STVO_RULES = {
  lane_min_m: 2.75,
  lane_regular_m: 3.25
};

// Hilfsfunktion: Regeln zusammenführen
function buildRules(standards) {
  let rules = { ...BASE_RULES };

  if (standards.applyRast) {
    rules = { ...rules, ...RAST_RULES };
  }
  if (standards.applyEfa) {
    rules = { ...rules, ...EFA_RULES };
  }
  if (standards.applyStvo) {
    rules = {
      ...rules,
      lane_min_m: Math.max(rules.lane_min_m, STVO_RULES.lane_min_m),
      lane_regular_m: Math.max(rules.lane_regular_m, STVO_RULES.lane_regular_m)
    };
  }
  if (standards.applyEra) {
    // Falls noch keine speziellen ERA-Regeln gesetzt sind, hinzufügen
    rules.cycle_schutz_min_m = ERA_RULES.cycle_schutz_min_m;
    rules.cycle_radfahr_min_m = ERA_RULES.cycle_radfahr_min_m;
    rules.cycle_baulich_min_m = ERA_RULES.cycle_baulich_min_m;
  } else {
    // Fallback, falls kein ERA aktiv: verwende BASE cycle_min als generisches Minimum
    rules.cycle_schutz_min_m = rules.cycle_min_m;
    rules.cycle_radfahr_min_m = Math.max(rules.cycle_min_m, 1.8);
    rules.cycle_baulich_min_m = Math.max(rules.cycle_min_m, 2.0);
  }

  return rules;
}

// ------------------------------------------------------
//  Validierung: wendet kombinierte Regeln auf ein Design an
// ------------------------------------------------------

function validateDesignWithStandards(data, standards) {
  const errors = [];

  // kombinierte Regeln aus RASt/ERA/EFA/StVO
  const RULES = buildRules(standards);

  // --------- 1. Eingabewerte auslesen ---------

  const totalWidthM     = toNumber(data.totalWidthM ?? data.total_width_m);
  const sidewalkLeftM   = toNumber(data.sidewalkLeftM ?? data.sidewalk_left_m);
  const sidewalkRightM  = toNumber(data.sidewalkRightM ?? data.sidewalk_right_m);
  const lanesCount      = toNumber(data.lanesCount ?? data.lanes_count);
  const busTraffic      = toBool(data.bus ?? data.busTraffic);

  const cycleNeeded     = toBool(data.cycleNeeded ?? data.cycle_needed);
  const cycleType       = (data.cycleType ?? data.cycle_type ?? "").toLowerCase(); // "schutzstreifen" | "radfahrstreifen" | "baulicher_radweg"
  const cycleSides      = (data.cycleSides ?? data.cycle_sides ?? "").toLowerCase(); // "einseitig" | "beidseitig"

  const parkingNeeded   = toBool(data.parkingNeeded ?? data.parking_needed);
  const parkingType     = (data.parkingType ?? data.parking_type ?? "").toLowerCase(); // "parallel" | "schraeg" | "quer"

  // --------- 2. Pflichtfelder prüfen ---------

  if (!totalWidthM) {
    errors.push("Gesamtbreite des Straßenraums fehlt oder ist 0.");
  }

  if (!lanesCount) {
    errors.push("Bitte geben Sie die Anzahl der Fahrstreifen an.");
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      summary: {
        totalWidthM,
        sidewalkLeftM,
        sidewalkRightM,
        lanesCount
      }
    };
  }

  // --------- 3. Gehwege prüfen ---------

  if (sidewalkLeftM && sidewalkLeftM < RULES.sidewalk_min_m) {
    errors.push(
      `Linker Gehweg ist mit ${sidewalkLeftM.toFixed(2)} m schmaler als die Mindestbreite von ${RULES.sidewalk_min_m.toFixed(
        2
      )} m.`
    );
  }

  if (sidewalkRightM && sidewalkRightM < RULES.sidewalk_min_m) {
    errors.push(
      `Rechter Gehweg ist mit ${sidewalkRightM.toFixed(2)} m schmaler als die Mindestbreite von ${RULES.sidewalk_min_m.toFixed(
        2
      )} m.`
    );
  }

  const effectiveSidewalkLeftM  = sidewalkLeftM  || RULES.sidewalk_min_m;
  const effectiveSidewalkRightM = sidewalkRightM || RULES.sidewalk_min_m;
  const sidewalkTotalM          = effectiveSidewalkLeftM + effectiveSidewalkRightM;

  // --------- 4. Radverkehr Breitenbedarf ---------

  let cycleWidthPerSideM = 0;

  if (cycleNeeded) {
    if (cycleType === "schutzstreifen") {
      cycleWidthPerSideM = RULES.cycle_schutz_min_m;
    } else if (cycleType === "radfahrstreifen") {
      cycleWidthPerSideM = RULES.cycle_radfahr_min_m;
    } else {
      // baulicher Radweg oder unbekannt
      cycleWidthPerSideM = RULES.cycle_baulich_min_m;
    }
  }

  let cycleSidesCount = 0;
  if (cycleNeeded) {
    if (cycleSides === "beidseitig") {
      cycleSidesCount = 2;
    } else {
      cycleSidesCount = 1; // Standard: einseitig
    }
  }

  const cycleTotalMinWidthM = cycleWidthPerSideM * cycleSidesCount;

  // --------- 5. Parken Breitenbedarf ---------

  let parkingMinWidthM = 0;

  if (parkingNeeded) {
    if (parkingType === "parallel") {
      parkingMinWidthM = RULES.parking_parallel_min_m;
    } else if (parkingType === "schraeg") {
      parkingMinWidthM = RULES.parking_schraeg_min_m;
    } else if (parkingType === "quer") {
      parkingMinWidthM = RULES.parking_quer_min_m;
    } else {
      parkingMinWidthM = RULES.parking_parallel_min_m;
    }
  }

  // --------- 6. Fahrstreifenbreite / Gesamtbreite ---------

  const lanesMinWidthM = lanesCount * RULES.lane_min_m;
  const lanesRegularWidthM = lanesCount * RULES.lane_regular_m;

  const requiredMinWidthM =
    sidewalkTotalM +
    cycleTotalMinWidthM +
    parkingMinWidthM +
    lanesMinWidthM;

  if (requiredMinWidthM > totalWidthM) {
    errors.push(
      `Die gewünschte Anordnung überschreitet die verfügbare Straßenbreite. Verfügbar: ${totalWidthM.toFixed(
        2
      )} m, Mindestbedarf nach gewählten Richtlinien: ${requiredMinWidthM.toFixed(2)} m.`
    );
  }

  // Wie viel bleibt für die Fahrstreifen übrig?
  const availableForLanesBikeParking =
    totalWidthM - sidewalkTotalM;

  const perLaneWidthApprox =
    (availableForLanesBikeParking - cycleTotalMinWidthM - parkingMinWidthM) /
    (lanesCount || 1);

  if (perLaneWidthApprox && perLaneWidthApprox < RULES.lane_min_m) {
    errors.push(
      `Die voraussichtliche Fahrstreifenbreite liegt mit ca. ${perLaneWidthApprox.toFixed(
        2
      )} m unter der Mindestbreite von ${RULES.lane_min_m.toFixed(2)} m.`
    );
  } else if (perLaneWidthApprox && perLaneWidthApprox < lanesRegularWidthM) {
    errors.push(
      `Hinweis: Die voraussichtliche Fahrstreifenbreite liegt mit ca. ${perLaneWidthApprox.toFixed(
        2
      )} m unter der Regelbreite von ${lanesRegularWidthM.toFixed(
        2
      )} m, erfüllt aber ggf. noch Mindestanforderungen.`
    );
  }

  if (busTraffic && perLaneWidthApprox && perLaneWidthApprox < RULES.lane_regular_m) {
    errors.push(
      `Hinweis: Für Linienbusverkehr wird in der Regel eine Fahrstreifenbreite von mindestens ${RULES.lane_regular_m.toFixed(
        2
      )} m empfohlen. Die voraussichtliche Breite liegt darunter.`
    );
  }

  const summary = {
    input: {
      totalWidthM,
      sidewalkLeftM,
      sidewalkRightM,
      lanesCount,
      cycleNeeded,
      cycleType,
      cycleSides,
      parkingNeeded,
      parkingType,
      busTraffic
    },
    computed: {
      sidewalkTotalM,
      cycleTotalMinWidthM,
      parkingMinWidthM,
      lanesMinWidthM,
      requiredMinWidthM,
      perLaneWidthApprox
    },
    rules: RULES,
    standardsApplied: standards
  };

  return {
    ok: errors.length === 0,
    errors,
    summary
  };
}

// ------------------------------------------------------
//  Routen
// ------------------------------------------------------

app.get("/", (req, res) => {
  res.send("Verkehrsplanung-Backend mit RASt, ERA, EFA und StVO-Logik läuft 🚦");
});

app.post("/api/verkehrsplanung", (req, res) => {
  const data = req.body;

  console.log("Neue Verkehrsplanungs-Anfrage empfangen:");
  console.log(JSON.stringify(data, null, 2));

  // Standards aus den Formulardaten ermitteln
  const standards = {
    applyRast:
      toBool(data.RASt) ||
      toBool(data.rast) ||
      toBool(data.applyRast),
    applyEra:
      toBool(data.ERA) ||
      toBool(data.era) ||
      toBool(data.applyEra),
    applyEfa:
      toBool(data.EFA) ||
      toBool(data.efa) ||
      toBool(data.applyEfa),
    applyStvo:
      toBool(data.StVO) ||
      toBool(data.stvo) ||
      toBool(data.applyStvo)
  };

  // Falls gar keine Richtlinie ausgewählt ist -> nur Empfang bestätigen
  if (
    !standards.applyRast &&
    !standards.applyEra &&
    !standards.applyEfa &&
    !standards.applyStvo
  ) {
    return res.json({
      status: "ok",
      message: "Anfrage empfangen (ohne aktivierte Richtlinien).",
      standardsApplied: standards
    });
  }

  const result = validateDesignWithStandards(data, standards);

  if (!result.ok) {
    return res.status(400).json({
      status: "error",
      message: "Die Anfrage erfüllt nicht alle Anforderungen der gewählten Richtlinien (vereinfachte Prüfung).",
      standardsApplied: standards,
      errors: result.errors,
      summary: result.summary
    });
  }

  return res.json({
    status: "ok",
    message: "Anfrage entspricht den vereinfachten Mindestanforderungen der gewählten Richtlinien.",
    standardsApplied: standards,
    summary: result.summary
  });
});

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
