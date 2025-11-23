import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ------------------------------------------------------
// Hilfsfunktionen
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

// Fehler-Helfer: immer Feld + Nachricht
function addError(errors, field, message) {
  errors.push({ field, message });
}

// ------------------------------------------------------
//  Basis-Regeln + Standard-spezifische Regelsets
// ------------------------------------------------------

const BASE_RULES = {
  sidewalk_min_m: 1.5,
  sidewalk_target_m: 1.8,
  lane_min_m: 2.75,
  lane_regular_m: 3.25,
  cycle_min_m: 1.5,
  parking_parallel_min_m: 2.0,
  parking_schraeg_min_m: 2.5,
  parking_quer_min_m: 5.0
};

const RAST_RULES = {
  sidewalk_min_m: 1.8,
  lane_min_m: 2.75,
  lane_regular_m: 3.25,
  parking_parallel_min_m: 2.0,
  parking_schraeg_min_m: 2.5,
  parking_quer_min_m: 5.0
};

const ERA_RULES = {
  cycle_schutz_min_m: 1.5,
  cycle_radfahr_min_m: 1.85,
  cycle_baulich_min_m: 2.0
};

const EFA_RULES = {
  sidewalk_min_m: 1.8,
  sidewalk_target_m: 2.5
};

const STVO_RULES = {
  lane_min_m: 2.75,
  lane_regular_m: 3.25
};

// Regeln zusammenführen
function buildRules(standards) {
  let rules = { ...BASE_RULES };

  if (standards.applyRast) rules = { ...rules, ...RAST_RULES };
  if (standards.applyEfa) rules = { ...rules, ...EFA_RULES };
  if (standards.applyStvo) {
    rules.lane_min_m = Math.max(rules.lane_min_m, STVO_RULES.lane_min_m);
    rules.lane_regular_m = Math.max(
      rules.lane_regular_m,
      STVO_RULES.lane_regular_m
    );
  }

  if (standards.applyEra) {
    rules.cycle_schutz_min_m = ERA_RULES.cycle_schutz_min_m;
    rules.cycle_radfahr_min_m = ERA_RULES.cycle_radfahr_min_m;
    rules.cycle_baulich_min_m = ERA_RULES.cycle_baulich_min_m;
  } else {
    rules.cycle_schutz_min_m = 1.5;
    rules.cycle_radfahr_min_m = 1.85;
    rules.cycle_baulich_min_m = 2.0;
  }

  return rules;
}

// ------------------------------------------------------
// Validierung Hauptfunktion
// ------------------------------------------------------

function validateDesignWithStandards(data, standards) {
  const errors = [];
  const RULES = buildRules(standards);

  // ---------- Formularmapping (deine Feldnamen) ----------

  const totalWidthM = toNumber(data.gesamtbreite);
  const sidewalkLeftM = toNumber(data.gehwegLinks);
  const sidewalkRightM = toNumber(data.gehwegRechts);

  const lanesCount = toNumber(data.fahrstreifen);
  const busTraffic = toBool(data.busverkehr);

  const cycleNeeded = toBool(data.radverkehrGewuenscht);
  const cycleType = (data.radverkehrArt ?? "").toLowerCase();       // "baulich", "schutzstreifen", ...
  const cycleSides = (data.radverkehrFuehrung ?? "").toLowerCase(); // "einseitig", "beidseitig"

  const parkingNeeded = toBool(data.parkstaendeGewuenscht);
  const parkingType = (data.parkart ?? "").toLowerCase();           // "parallel", "schraeg", "quer"

  // ---------- Pflichtfelder ----------

  if (!totalWidthM) {
    addError(errors, "gesamtbreite", "Bitte geben Sie die Gesamtbreite des Straßenraums an.");
  }
  if (!lanesCount) {
    addError(errors, "fahrstreifen", "Bitte geben Sie die Anzahl der Fahrstreifen an.");
  }
  if (!sidewalkLeftM) {
    addError(errors, "gehwegLinks", "Bitte geben Sie die Breite des linken Gehwegs an.");
  }
  if (!sidewalkRightM) {
    addError(errors, "gehwegRechts", "Bitte geben Sie die Breite des rechten Gehwegs an.");
  }

  if (errors.length > 0) {
    return { ok: false, errors, summary: {} };
  }

  // ---------- Gehwege ----------

  if (sidewalkLeftM < RULES.sidewalk_min_m) {
    addError(
      errors,
      "gehwegLinks",
      `Linker Gehweg ist mit ${sidewalkLeftM} m schmaler als die Mindestbreite von ${RULES.sidewalk_min_m} m.`
    );
  }

  if (sidewalkRightM < RULES.sidewalk_min_m) {
    addError(
      errors,
      "gehwegRechts",
      `Rechter Gehweg ist mit ${sidewalkRightM} m schmaler als die Mindestbreite von ${RULES.sidewalk_min_m} m.`
    );
  }

  const sidewalkTotalM = sidewalkLeftM + sidewalkRightM;

  // ---------- Radverkehr ----------

  let cycleWidthPerSide = 0;
  if (cycleNeeded) {
    if (cycleType === "schutzstreifen") {
      cycleWidthPerSide = RULES.cycle_schutz_min_m;
    } else if (cycleType === "radfahrstreifen") {
      cycleWidthPerSide = RULES.cycle_radfahr_min_m;
    } else {
      cycleWidthPerSide = RULES.cycle_baulich_min_m;
    }
  }

  const cycleSidesCount = cycleNeeded
    ? cycleSides === "beidseitig"
      ? 2
      : 1
    : 0;

  const cycleTotalM = cycleWidthPerSide * cycleSidesCount;

  // ---------- Parken ----------

  let parkingM = 0;
  if (parkingNeeded) {
    if (parkingType === "parallel") parkingM = RULES.parking_parallel_min_m;
    else if (parkingType === "schraeg") parkingM = RULES.parking_schraeg_min_m;
    else if (parkingType === "quer") parkingM = RULES.parking_quer_min_m;
  }

  // ---------- Mindestbreite berechnen ----------

  const lanesMin = lanesCount * RULES.lane_min_m;
  const requiredMin = sidewalkTotalM + cycleTotalM + parkingM + lanesMin;

  if (requiredMin > totalWidthM) {
    addError(
      errors,
      "gesamtbreite",
      `Die gewünschte Aufteilung benötigt mindestens ${requiredMin.toFixed(
        2
      )} m, verfügbar sind aber nur ${totalWidthM.toFixed(2)} m.`
    );
  }

  // ---------- Fahrstreifenprüfung ----------

  const widthForLanes = totalWidthM - (sidewalkTotalM + cycleTotalM + parkingM);
  const approxLaneWidth = widthForLanes / lanesCount;

  if (approxLaneWidth < RULES.lane_min_m) {
    addError(
      errors,
      "fahrstreifen",
      `Die voraussichtliche Fahrstreifenbreite liegt mit ca. ${approxLaneWidth.toFixed(
        2
      )} m unter der Mindestbreite von ${RULES.lane_min_m} m.`
    );
  }

  if (busTraffic && approxLaneWidth < RULES.lane_regular_m) {
    addError(
      errors,
      "fahrstreifen",
      `Für Busverkehr wird in der Regel eine Fahrstreifenbreite von mindestens ${RULES.lane_regular_m} m empfohlen.`
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      sidewalks: { sidewalkLeftM, sidewalkRightM },
      cycle: { cycleNeeded, cycleType, cycleSides, cycleTotalM },
      parking: { parkingNeeded, parkingType, parkingM },
      lanes: { lanesCount, approxLaneWidth },
      requiredMin,
      totalWidthM
    },
    rules: RULES,
    standardsApplied: standards
  };
}

// ------------------------------------------------------
// Routes
// ------------------------------------------------------

app.get("/", (req, res) => {
  res.send("Backend läuft mit RASt + ERA + EFA + StVO 🚦");
});

app.post("/api/verkehrsplanung", (req, res) => {
  const data = req.body;

  console.log("Neue Verkehrsplanungs-Anfrage empfangen:");
  console.log(JSON.stringify(data, null, 2));

  const standards = {
    applyRast: toBool(data.rast),
    applyEra: toBool(data.era),
    applyEfa: toBool(data.efa),
    applyStvo: toBool(data.stvo)
  };

  const result = validateDesignWithStandards(data, standards);

  if (!result.ok) {
    return res.status(400).json({
      status: "error",
      message:
        "Die Anfrage erfüllt nicht die Anforderungen der gewählten Richtlinien.",
      errors: result.errors,
      summary: result.summary
    });
  }

  return res.json({
    status: "ok",
    message: "Alle ausgewählten Richtlinien erfüllt.",
    summary: result.summary
  });
});

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
