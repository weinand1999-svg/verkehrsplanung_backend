import express from "express";
import cors from "cors";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Test endpoint
app.get("/", (req, res) => {
  res.send("Verkehrsplanung-Backend läuft 🚦");
});

// Main endpoint for Lovable form submissions
app.post("/api/verkehrsplanung", (req, res) => {
  const data = req.body;

  console.log("Neue Verkehrsplanungs-Anfrage empfangen:");
  console.log(JSON.stringify(data, null, 2));

  // TODO:
  // 1. Validierungslogik aus Schritt 2 implementieren
  // 2. Maskenverarbeitung
  // 3. KI-Prompt aus Schritt 3 erzeugen
  // 4. OpenAI / andere KI aufrufen
  // 5. Ergebnis speichern & URL zurückgeben

  res.json({
    status: "success",
    message: "Anfrage empfangen. Validierung & KI-Verarbeitung werden später implementiert."
  });
});

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
});
